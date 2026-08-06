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
});

function addUnitRow(type = "", qty = "") {
  const row = document.createElement("div");
  row.className = "dynamic-row";
  row.innerHTML = `
    <input type="text" class="col-type" placeholder="類型,如 20GP / PLT / CTN" value="${type}" />
    <input type="number" class="col-amount" placeholder="數量" min="0" step="1" value="${qty}" />
    <button type="button" class="remove-row" title="刪除">×</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  unitsRows.appendChild(row);
}

addUnitRowBtn.addEventListener("click", () => addUnitRow());

function collectUnits() {
  const units = [];
  unitsRows.querySelectorAll(".dynamic-row").forEach((row) => {
    const type = row.querySelector(".col-type").value.trim();
    const qty = row.querySelector(".col-amount").value;
    if (type && qty) {
      units.push({ type, qty: Number(qty) });
    }
  });
  return units;
}

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

    const chargeableWeightKg = document.getElementById("case-chargeable-weight").value;
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
        units: collectUnits(),
        chargeableWeightKg: chargeableWeightKg ? Number(chargeableWeightKg) : null,
        shipmentQty: shipmentQty ? Number(shipmentQty) : null,
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
