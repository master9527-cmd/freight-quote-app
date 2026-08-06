// 港口/機場自動完成(spec 6.5.2):資料來源 OurAirports(機場)/ UN-LOCODE(海港),
// 陸運交接點沒有標準化公開清單,僅靠使用者「常用清單」逐漸累積
// js/data/airports.json、js/data/seaports.json 是離線預先處理好的靜態資料(不即時打外部 API)

const LOCATION_DATASET_CACHE = {};

function modeToLocationKind(mode) {
  if (mode === "air") return "airport";
  if (mode === "sea_fcl" || mode === "sea_lcl") return "seaport";
  return "land";
}

function loadLocationDataset(kind) {
  if (kind === "land") return Promise.resolve([]);
  if (!LOCATION_DATASET_CACHE[kind]) {
    const file = kind === "airport" ? "js/data/airports.json" : "js/data/seaports.json";
    LOCATION_DATASET_CACHE[kind] = fetch(file)
      .then((r) => r.json())
      .catch(() => []);
  }
  return LOCATION_DATASET_CACHE[kind];
}

async function loadLocationFavorites(kind) {
  const { data, error } = await supabaseClient
    .from("location_favorites")
    .select("code,label,use_count,last_used_at")
    .eq("kind", kind)
    .order("last_used_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return data;
}

async function recordLocationFavorite(kind, code, label) {
  if (!code) return;
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData.session && sessionData.session.user.id;
  if (!userId) return;

  const { data: existing } = await supabaseClient
    .from("location_favorites")
    .select("id, use_count")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("code", code)
    .maybeSingle();

  if (existing) {
    await supabaseClient
      .from("location_favorites")
      .update({ use_count: existing.use_count + 1, last_used_at: new Date().toISOString(), label })
      .eq("id", existing.id);
  } else {
    await supabaseClient.from("location_favorites").insert({ user_id: userId, kind, code, label });
  }
}

function locationEntryLabel(entry, kind) {
  if (kind === "airport") {
    return `${entry.code} — ${entry.city ? entry.city + ", " : ""}${entry.name}`;
  }
  return `${entry.code} — ${entry.name}`;
}

// 把一個現有 <input type="text"> 升級成可搜尋自動完成(不改變它本身作為文字欄位存值的行為)
function attachLocationAutocomplete(inputEl, mode) {
  const kind = modeToLocationKind(mode);

  const wrap = document.createElement("div");
  wrap.className = "location-autocomplete-wrap";
  inputEl.parentNode.insertBefore(wrap, inputEl);
  wrap.appendChild(inputEl);

  const list = document.createElement("div");
  list.className = "location-autocomplete-list";
  list.style.display = "none";
  wrap.appendChild(list);

  let dataset = [];
  let favorites = [];
  let loaded = false;

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    const [ds, fav] = await Promise.all([loadLocationDataset(kind), loadLocationFavorites(kind)]);
    dataset = ds;
    favorites = fav;
  }

  function renderList(query) {
    const q = query.trim().toLowerCase();
    let results;

    if (!q) {
      results = favorites.map((f) => ({ code: f.code, label: f.label, favorite: true }));
    } else {
      const favMatches = favorites
        .filter((f) => f.code.toLowerCase().includes(q) || f.label.toLowerCase().includes(q))
        .map((f) => ({ code: f.code, label: f.label, favorite: true }));
      const seen = new Set(favMatches.map((m) => m.code));
      const dsMatches = dataset
        .filter(
          (d) =>
            d.code.toLowerCase().includes(q) ||
            (d.name && d.name.toLowerCase().includes(q)) ||
            (d.city && d.city.toLowerCase().includes(q))
        )
        .slice(0, 30)
        .map((d) => ({ code: d.code, label: locationEntryLabel(d, kind), favorite: false }))
        .filter((m) => !seen.has(m.code));
      results = [...favMatches, ...dsMatches].slice(0, 30);
    }

    if (!results.length) {
      list.style.display = "none";
      return;
    }
    list.innerHTML = results
      .map(
        (r) =>
          `<div class="location-autocomplete-item${r.favorite ? " favorite" : ""}" data-code="${escapeHtml(r.code)}" data-label="${escapeHtml(r.label)}">${r.favorite ? "★ " : ""}${escapeHtml(r.label)}</div>`
      )
      .join("");
    list.style.display = "block";
  }

  inputEl.addEventListener("focus", async () => {
    await ensureLoaded();
    renderList(inputEl.value);
  });
  inputEl.addEventListener("input", async () => {
    await ensureLoaded();
    renderList(inputEl.value);
  });
  inputEl.addEventListener("blur", () => {
    setTimeout(() => {
      list.style.display = "none";
      if (kind === "land") {
        const val = inputEl.value.trim();
        if (val) recordLocationFavorite("land", val, val);
      }
    }, 150);
  });

  list.addEventListener("mousedown", (event) => {
    const item = event.target.closest(".location-autocomplete-item");
    if (!item) return;
    event.preventDefault();
    inputEl.value = item.dataset.label;
    list.style.display = "none";
    inputEl.dispatchEvent(new Event("change"));
    if (kind !== "land") recordLocationFavorite(kind, item.dataset.code, item.dataset.label);
  });
}
