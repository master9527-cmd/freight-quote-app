const toggleBtn = document.getElementById("toggle-new-case-btn");
const newCaseCard = document.getElementById("new-case-card");
const cancelBtn = document.getElementById("cancel-new-case-btn");
const newCaseForm = document.getElementById("new-case-form");
const newCaseMessage = document.getElementById("new-case-message");
const createCaseBtn = document.getElementById("create-case-btn");
const unitsRows = document.getElementById("units-rows");
const addUnitRowBtn = document.getElementById("add-unit-row-btn");
const caseListContainer = document.getElementById("case-list-container");
const incotermSelect = document.getElementById("case-incoterm");
const modeSelect = document.getElementById("case-mode");
const cargoWeightSection = document.getElementById("cargo-weight-section");
const scopeCheckboxes = {
  export: document.getElementById("case-scope-export"),
  intl: document.getElementById("case-scope-intl"),
  import: document.getElementById("case-scope-import"),
};

let currentUserId = null;

INCOTERM_OPTIONS.forEach((code) => {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = code;
  incotermSelect.appendChild(opt);
});

incotermSelect.addEventListener("change", () => {
  const suggested = INCOTERM_SUGGESTED_SCOPE[incotermSelect.value];
  if (!suggested) return;
  SEGMENT_TYPES.forEach((t) => (scopeCheckboxes[t].checked = suggested[t]));
});

// cargo模型擴充(spec 第27節):空運雙模式計費重量/海運LCL材積,依 mode 決定要顯示哪一組欄位,
// 切換運輸模式時直接重繪(不保留舊模式打過的值,因為換模式後這些欄位的意義本來就不一樣)
renderCargoWeightSection(cargoWeightSection, modeSelect.value, {});
modeSelect.addEventListener("change", () => {
  renderCargoWeightSection(cargoWeightSection, modeSelect.value, {});
});

// spec 第40.2節:Case層級的起運地/目的地也要有港口/機場自動完成,不是只有Segment層級——這個表單只會建立一次
// (顯示/隱藏用display切換,不是每次重新render),所以只需要在頁面載入時掛一次,不用像Segment卡片那樣每次重繪都重掛。
// mode 用目前選定的值當基準(使用者通常先選運輸模式再打起訖地);之後若改了模式,自動完成清單種類不會跟著即時切換,
// 這是範圍克制的已知限制,不影響欄位本身正常輸入/存值
attachLocationAutocomplete(document.getElementById("case-origin"), modeSelect.value);
attachLocationAutocomplete(document.getElementById("case-destination"), modeSelect.value);

function showFormMessage(text, type) {
  newCaseMessage.textContent = text;
  newCaseMessage.className = `message ${type}`;
}

toggleBtn.addEventListener("click", () => {
  newCaseCard.style.display = newCaseCard.style.display === "none" ? "block" : "none";
});

cancelBtn.addEventListener("click", () => {
  newCaseCard.style.display = "none";
  newCaseForm.reset();
  unitsRows.innerHTML = "";
  SEGMENT_TYPES.forEach((t) => (scopeCheckboxes[t].checked = true));
  renderCargoWeightSection(cargoWeightSection, modeSelect.value, {});
});

addUnitRowBtn.addEventListener("click", () => addCargoUnitRow(unitsRows));

async function loadCases() {
  const { data, error } = await supabaseClient
    .from("cases")
    .select("id, ref, name, origin, destination, mode, quote_type, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    caseListContainer.innerHTML = `<div class="message error" style="display:block">讀取案件列表失敗:${error.message}</div>`;
    return;
  }

  if (!data.length) {
    caseListContainer.innerHTML = `<p class="empty-state">還沒有任何案件,點右上角「+ 新增案件」開始。</p>`;
    return;
  }

  const rows = data
    .map(
      (c) => `
    <tr>
      <td><a href="case.html?id=${c.id}">${escapeHtml(c.ref) || "(未編號)"}</a></td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.origin || "")} → ${escapeHtml(c.destination || "")}</td>
      <td><span class="tag">${MODE_LABELS[c.mode] || c.mode}</span></td>
      <td><span class="tag">${QUOTE_TYPE_LABELS[c.quote_type] || c.quote_type}</span></td>
      <td>${new Date(c.created_at).toLocaleDateString()}</td>
    </tr>`
    )
    .join("");

  caseListContainer.innerHTML = `
    <table class="case-table">
      <thead>
        <tr><th>編號</th><th>案件名稱</th><th>航線</th><th>模式</th><th>類型</th><th>建立日期</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

newCaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  createCaseBtn.disabled = true;
  showFormMessage("", "");
  newCaseMessage.className = "message";

  const mode = document.getElementById("case-mode").value;
  const origin = document.getElementById("case-origin").value.trim();
  const destination = document.getElementById("case-destination").value.trim();

  try {
    const ref = await generateCaseRef(supabaseClient, currentUserId, { mode, origin, destination });

    const shipmentQty = document.getElementById("case-shipment-qty").value;

    const payload = {
      user_id: currentUserId,
      ref,
      name: document.getElementById("case-name").value.trim(),
      origin,
      destination,
      mode,
      quote_type: document.getElementById("case-quote-type").value,
      quote_currency: document.getElementById("case-currency").value.trim() || "USD",
      cargo: {
        units: collectCargoUnits(unitsRows, mode),
        shipmentQty: shipmentQty ? Number(shipmentQty) : null,
        ...collectCargoWeightVolume(cargoWeightSection),
      },
      incoterm: incotermSelect.value || null,
      quote_scope: {
        export: scopeCheckboxes.export.checked,
        intl: scopeCheckboxes.intl.checked,
        import: scopeCheckboxes.import.checked,
      },
      trade_remark: document.getElementById("case-trade-remark").value.trim() || null,
    };

    const { data, error } = await supabaseClient.from("cases").insert(payload).select("id").single();
    if (error) throw error;

    // spec 29.1:Project案件底下的mode/cargo改由「情境」管理,不是案件本身——用這次表單上已經填好的
    // mode/cargo資料直接建立第一個情境,使用者不用建完案件後還要重打一次同樣的資料
    if (payload.quote_type === "project") {
      const { error: scenarioError } = await supabaseClient
        .from("scenarios")
        .insert({ case_id: data.id, label: "情境 1", mode: payload.mode, cargo: payload.cargo, selection: {}, markup: {} });
      if (scenarioError) throw scenarioError;
    }

    window.location.href = `case.html?id=${data.id}`;
  } catch (error) {
    showFormMessage(error.message || "建立案件失敗,請再試一次。", "error");
    createCaseBtn.disabled = false;
  }
});

(async () => {
  const session = await requireSession();
  if (!session) return;
  currentUserId = session.user.id;
  await loadCases();
})();
