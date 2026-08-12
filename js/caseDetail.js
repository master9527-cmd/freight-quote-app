const caseId = new URLSearchParams(window.location.search).get("id");

const caseSummaryCard = document.getElementById("case-summary-card");
const agentsContainer = document.getElementById("agents-container");
const newAgentNameInput = document.getElementById("new-agent-name");
const newAgentRoleSelect = document.getElementById("new-agent-role");
const addAgentBtn = document.getElementById("add-agent-btn");
const newAgentMessage = document.getElementById("new-agent-message");
const aiImportWizardBtn = document.getElementById("ai-import-wizard-btn");
const rateTableRoot = document.getElementById("rate-table-rows");
const rateTableStatus = document.getElementById("rate-table-status");

const editCaseCard = document.getElementById("edit-case-card");
const editCaseForm = document.getElementById("edit-case-form");
const editCaseStatus = document.getElementById("edit-case-status");
const editCaseCancelBtn = document.getElementById("edit-case-cancel-btn");
const editUnitsRows = document.getElementById("edit-units-rows");
const editIncotermSelect = document.getElementById("edit-case-incoterm");
const editModeSelect = document.getElementById("edit-case-mode");
const editCargoWeightSection = document.getElementById("edit-cargo-weight-section");
const editScopeCheckboxes = {
  export: document.getElementById("edit-case-scope-export"),
  intl: document.getElementById("edit-case-scope-intl"),
  import: document.getElementById("edit-case-scope-import"),
};
const editQuoteTypeSelect = document.getElementById("edit-case-quote-type");
const editCaseModeField = document.getElementById("edit-case-mode-field");
const editCaseScenarioScopedSection = document.getElementById("edit-case-scenario-scoped-section");
const editCaseProjectNote = document.getElementById("edit-case-project-note");

// spec 29.1:quoteType='project'時,運輸模式/票數/貨量單位/計費重量/報價範圍改在各情境內個別設定,
// 「編輯案件」表單這幾個欄位就不適用了,改顯示提示文字,避免使用者以為填這裡就會生效
function updateEditCaseProjectVisibility() {
  const isProject = editQuoteTypeSelect.value === "project";
  editCaseModeField.style.display = isProject ? "none" : "";
  editCaseScenarioScopedSection.style.display = isProject ? "none" : "";
  editCaseProjectNote.style.display = isProject ? "" : "none";
}
editQuoteTypeSelect.addEventListener("change", updateEditCaseProjectVisibility);

// spec 第40.2節:Case層級的起運地/目的地也要有港口/機場自動完成——編輯案件卡片是固定存在的靜態表單(每次「編輯案件」
// 只是重新帶值進去,不是重新render DOM),只需要掛一次,不能放進 openEditCaseForm() 裡(那樣每次點「編輯案件」
// 就會重複掛一次,累積出重疊的下拉清單)。掛的當下用 editModeSelect 目前的值(頁面靜態預設值)當基準,
// 跟 js/cases.js 新增案件表單同樣的範圍限制:之後改了模式,自動完成的清單種類不會即時跟著換
attachLocationAutocomplete(document.getElementById("edit-case-origin"), editModeSelect.value);
attachLocationAutocomplete(document.getElementById("edit-case-destination"), editModeSelect.value);

INCOTERM_OPTIONS.forEach((code) => {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = code;
  editIncotermSelect.appendChild(opt);
});

editIncotermSelect.addEventListener("change", () => {
  const suggested = INCOTERM_SUGGESTED_SCOPE[editIncotermSelect.value];
  if (!suggested) return;
  SEGMENT_TYPES.forEach((t) => (editScopeCheckboxes[t].checked = suggested[t]));
});

// 切換運輸模式時,計費重量/材積這組欄位的意義完全不同(空運計費重量 vs 海運LCL材積),直接重繪成空白,
// 不保留舊模式打過的值(spec第27節cargo模型擴充);實際存檔還是要等 autosave(blur/change)觸發才會真的送出
editModeSelect.addEventListener("change", () => {
  renderCargoWeightSection(editCargoWeightSection, editModeSelect.value, {});
});

let currentCase = null;

function quoteScopeSummaryText(scope) {
  const s = scope || { export: true, intl: true, import: true };
  return SEGMENT_TYPES.filter((t) => s[t] !== false)
    .map((t) => SEGMENT_TYPE_LABELS[t])
    .join("、") || "(無,三段都不計入報價)";
}

function renderCaseSummary(c) {
  // spec 29.1:project案件的mode/cargo改讀目前作用中情境的資料,不是案件本身(getActiveScopeData()對非project案件直接回傳c)
  const scope = getActiveScopeData();
  const cargo = scope.cargo || {};
  const units = cargo.units || [];
  // spec 29.2節:qtyMin/qtyMax是客戶給的約略月量範圍,純資訊用途,有填才附註顯示
  const unitsText = units.length
    ? units
        .map((u) => `${u.type} x${u.qty}${u.qtyMin != null || u.qtyMax != null ? `(約${u.qtyMin ?? "?"}~${u.qtyMax ?? "?"}/月)` : ""}`)
        .join("、")
    : "-";
  const sc = c.quote_type === "project" ? activeScenario() : null;

  caseSummaryCard.innerHTML = `
    <div class="agent-card-header">
      <h2>${escapeHtml(c.ref || "(未編號)")} — ${escapeHtml(c.name)}</h2>
      <button type="button" class="btn-small" id="edit-case-toggle-btn">編輯案件</button>
    </div>
    <div class="case-summary">
      <span><strong>航線:</strong> ${escapeHtml(c.origin || "-")} → ${escapeHtml(c.destination || "-")}</span>
      <span><strong>模式:</strong> ${escapeHtml(MODE_LABELS[scope.mode] || scope.mode || "-")}${sc ? `(目前情境:${escapeHtml(sc.label)})` : ""}</span>
      <span><strong>類型:</strong> ${QUOTE_TYPE_LABELS[c.quote_type] || c.quote_type}</span>
      <span><strong>報價幣別:</strong> ${escapeHtml(c.quote_currency)}</span>
      <span><strong>計費重量:</strong> ${cargo.chargeableWeightKg != null ? cargo.chargeableWeightKg + " KG" : "-"}</span>
      <span><strong>票數/BL:</strong> ${cargo.shipmentQty != null ? cargo.shipmentQty : "-"}</span>
      <span><strong>貨量單位:</strong> ${unitsText}</span>
      <span><strong>Incoterm:</strong> ${escapeHtml(c.incoterm || "(未指定)")}</span>
      <span><strong>報價範圍:</strong> ${escapeHtml(quoteScopeSummaryText(c.quote_scope))}</span>
      ${c.trade_remark ? `<span><strong>貿易條件備註:</strong> ${escapeHtml(c.trade_remark)}</span>` : ""}
    </div>
  `;

  caseSummaryCard.querySelector("#edit-case-toggle-btn").addEventListener("click", () => openEditCaseForm(c));
}

function openEditCaseForm(c) {
  document.getElementById("edit-case-name").value = c.name || "";
  document.getElementById("edit-case-mode").value = c.mode;
  document.getElementById("edit-case-origin").value = c.origin || "";
  document.getElementById("edit-case-destination").value = c.destination || "";
  document.getElementById("edit-case-quote-type").value = c.quote_type;
  document.getElementById("edit-case-currency").value = c.quote_currency || "";
  document.getElementById("edit-case-shipment-qty").value = (c.cargo && c.cargo.shipmentQty) ?? "";
  renderCargoWeightSection(editCargoWeightSection, c.mode, c.cargo || {});
  editIncotermSelect.value = c.incoterm || "";
  const scope = c.quote_scope || { export: true, intl: true, import: true };
  SEGMENT_TYPES.forEach((t) => (editScopeCheckboxes[t].checked = scope[t] !== false));
  document.getElementById("edit-case-trade-remark").value = c.trade_remark || "";

  editUnitsRows.innerHTML = "";
  ((c.cargo && c.cargo.units) || []).forEach((u) => addCargoUnitRow(editUnitsRows, u));

  updateEditCaseProjectVisibility();
  editCaseStatus.textContent = "";
  editCaseStatus.className = "save-status";
  editCaseCard.style.display = "block";
  editCaseCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("edit-add-unit-row-btn").addEventListener("click", () => addCargoUnitRow(editUnitsRows));

// 貨量單位列的刪除按鈕(row.remove())不會觸發 blur/change,要自己觸發 autosave 把移除結果存回去
editUnitsRows.addEventListener("click", (event) => {
  if (event.target.closest(".remove-row")) editCaseTrigger();
});

editCaseCancelBtn.addEventListener("click", () => {
  editCaseCard.style.display = "none";
});

// 保留 submit 監聽只是為了擋掉按 Enter 觸發的瀏覽器預設表單送出(會整頁跳轉/重新整理),
// 實際存檔完全交給下面的 autosave,不再需要「儲存變更」按鈕(spec 6.5.4)
editCaseForm.addEventListener("submit", (event) => event.preventDefault());

const editCaseTrigger = createAutosaveTrigger(
  editCaseStatus,
  async () => {
    const name = document.getElementById("edit-case-name").value.trim();
    const quoteType = document.getElementById("edit-case-quote-type").value;
    const quoteCurrency = document.getElementById("edit-case-currency").value.trim();
    // spec 29.1:project案件的運輸模式改在各情境內個別設定,這個表單的mode欄位是隱藏的,不要拿讀不到的值覆蓋
    const isProject = quoteType === "project";
    const mode = isProject ? currentCase.mode : document.getElementById("edit-case-mode").value;

    // 案件名稱/報價幣別是必填欄位,還沒填完整時不要真的送出存檔(送了會被資料庫 not null 擋下,
    // 那是很難懂的錯誤訊息),用「有未填完整的項目」狀態文字表示就好,等使用者補完自然存入
    if (!name || !quoteCurrency) {
      return { incomplete: true };
    }

    const payload = {
      name,
      mode,
      origin: document.getElementById("edit-case-origin").value.trim(),
      destination: document.getElementById("edit-case-destination").value.trim(),
      quote_type: quoteType,
      quote_currency: quoteCurrency,
      incoterm: editIncotermSelect.value || null,
      trade_remark: document.getElementById("edit-case-trade-remark").value.trim() || null,
    };

    // spec 29.1:project案件的貨量單位/計費重量/報價範圍改在情境內設定(見 edit-scenario-card),
    // 這裡維持案件目前已存的值,不要用畫面上被隱藏、讀不到的欄位覆蓋掉
    if (isProject) {
      payload.cargo = currentCase.cargo || {};
      payload.quote_scope = currentCase.quote_scope || { export: true, intl: true, import: true };
    } else {
      const shipmentQty = document.getElementById("edit-case-shipment-qty").value;
      // spec 27.1節:貨櫃類型正規化(空運不套用)、29.2節:qtyMin/qtyMax 純資訊用途,collectCargoUnits已一併處理
      const units = collectCargoUnits(editUnitsRows, mode);
      payload.cargo = {
        units,
        shipmentQty: shipmentQty ? Number(shipmentQty) : null,
        ...collectCargoWeightVolume(editCargoWeightSection),
      };
      payload.quote_scope = {
        export: editScopeCheckboxes.export.checked,
        intl: editScopeCheckboxes.intl.checked,
        import: editScopeCheckboxes.import.checked,
      };
    }

    const becameProject = isProject && currentCase.quote_type !== "project";
    const modeChanged = payload.mode !== currentCase.mode;
    const quoteCurrencyChanged = payload.quote_currency !== currentCase.quote_currency;
    // 貨量單位改變時,perUnit 費用項目的單位類型下拉選項來源也要跟著換(spec第27.1節),
    // 用 JSON 比對簡單判斷有沒有變動,有變就重繪整個代理成本區塊(下拉選項才會反映最新的 cargo.units)
    const unitsChanged = JSON.stringify(payload.cargo.units) !== JSON.stringify((currentCase.cargo && currentCase.cargo.units) || []);

    const { error } = await supabaseClient.from("cases").update(payload).eq("id", caseId);
    if (error) throw error;

    Object.assign(currentCase, payload);
    updateEditCaseProjectVisibility();

    // 案件剛被改成project類型:這時候還沒有任何情境,先建立/載入情境列表,才能渲染情境列跟後續的代理成本區塊
    if (becameProject) {
      await loadScenarios();
    }
    renderScenarioBar();
    renderCaseSummary(currentCase);

    // mode 會影響 Segment 的 from/to 標籤跟港口/機場自動完成類型,只有真的改到 mode 才需要重繪代理成本區塊,
    // 不要整頁重新整理(autosave 底下如果動不動整頁刷新,使用者在其他欄位打到一半的東西會被沖掉)
    if (becameProject || (!isProject && (modeChanged || unitsChanged))) {
      await loadAgentsAndSegments();
    } else if (quoteCurrencyChanged) {
      // quote_currency 是 rateTable 的換算基準,改了之後「1 X = ? 報價幣別」的標籤跟排除清單都要跟著換,
      // 不需要重繪整個代理成本區塊,只重新掃描/渲染匯率設定區塊即可
      await refreshRateTableCurrencies();
      refreshComparisonAndQuoteTabs();
    }
  },
  { sectionId: "edit-case" }
);

attachAutosaveListeners(editCaseForm, editCaseTrigger);

// ============================================================
// 情境管理(spec 29.1):quoteType='project'時,案件底下有多個情境(Scenario),
// 每個情境各自有mode/cargo/代理成本/比較/報價,共用案件層級的客戶/Incoterm/rate_table等資訊。
// inquiry/tender案件不會用到這整段(scenarios永遠是空陣列,activeScenario()永遠回傳null,
// getActiveScopeData()直接回傳currentCase本身,其他分頁的行為跟改動前完全一樣)。
// ============================================================

let scenarios = [];
let activeScenarioId = null;

const scenarioBarEl = document.getElementById("scenario-bar");
const scenarioOverviewCard = document.getElementById("scenario-overview-card");
const scenarioOverviewRoot = document.getElementById("scenario-overview-root");
const editScenarioCard = document.getElementById("edit-scenario-card");
const editScenarioForm = document.getElementById("edit-scenario-form");
const editScenarioStatus = document.getElementById("edit-scenario-status");
const editScenarioUnitsRows = document.getElementById("edit-scenario-units-rows");
const editScenarioCargoWeightSection = document.getElementById("edit-scenario-cargo-weight-section");
const editScenarioModeSelect = document.getElementById("edit-scenario-mode");

function activeScenario() {
  return scenarios.find((s) => s.id === activeScenarioId) || null;
}

// project案件目前作用中的「範圍」資料:mode/cargo/selection/markup/quoteFormat/quoteCurrencyBySegment/sellMode/manualSell/costBasis
// 改讀情境自己的值,其餘(rate_table/quote_currency/quote_scope/letterhead/incoterm等)仍是案件層級共用——
// comparison.js/quote.js只認得這個merge後的物件,不用另外判斷是否為project案件
function getActiveScopeData() {
  if (!currentCase || currentCase.quote_type !== "project") return currentCase;
  const sc = activeScenario();
  if (!sc) return currentCase;
  return {
    ...currentCase,
    mode: sc.mode,
    cargo: sc.cargo || {},
    selection: sc.selection || {},
    markup: sc.markup || {},
    quote_format: sc.quote_format,
    quote_currency_by_segment: sc.quote_currency_by_segment,
    sell_mode: sc.sell_mode || "markup",
    manual_sell: sc.manual_sell,
    cost_basis: sc.cost_basis || "total",
  };
}

// 目前的成本/報價設定(selection/markup/quoteFormat...)存檔要寫到哪張表哪一列——
// project案件寫進scenarios表(目前作用中的那個情境),否則維持寫進cases表(案件本身),
// comparison.js的persistSelection、quote.js的存檔邏輯共用這個判斷,不用各自處理
function getActiveRecordTarget() {
  const sc = currentCase && currentCase.quote_type === "project" ? activeScenario() : null;
  return sc ? { table: "scenarios", id: sc.id } : { table: "cases", id: caseId };
}

// 目前作用中的scenario_id,project案件才有值——新增代理、fetchAgentsWithCosts都要用這個做範圍過濾
function activeScenarioIdForQuery() {
  return currentCase && currentCase.quote_type === "project" ? activeScenarioId : null;
}

async function loadScenarios() {
  const { data, error } = await supabaseClient
    .from("scenarios")
    .select("*")
    .eq("case_id", caseId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  scenarios = data || [];

  // project案件至少要有一個情境才能開始輸入,既有案件被改成project、或第一個情境沒建成功,
  // 這裡自動補一個空白情境,不讓使用者卡在「看不到任何東西可以編輯」的畫面
  if (!scenarios.length) {
    const { data: created, error: createErr } = await supabaseClient
      .from("scenarios")
      .insert({ case_id: caseId, label: "情境 1", mode: currentCase.mode || "air", cargo: {}, selection: {}, markup: {} })
      .select("*")
      .single();
    if (createErr) throw createErr;
    scenarios = [created];
  }

  if (!activeScenarioId || !scenarios.some((s) => s.id === activeScenarioId)) {
    activeScenarioId = scenarios[0].id;
  }
}

// spec 27.1節v2的既有資料正規化(見下方 healStaleCargoUnitTypeNormalization),project案件的cargo改存在
// scenarios表,這裡是對應的情境版本:每個情境的cargo.units各自檢查一次
async function healStaleScenarioCargoUnitTypeNormalization() {
  for (const sc of scenarios) {
    if (sc.mode === "air") continue;
    const units = (sc.cargo && sc.cargo.units) || [];
    if (!units.length) continue;
    let changed = false;
    const normalized = units.map((u) => {
      const normType = normalizeContainerType(u.type);
      if (normType !== u.type) changed = true;
      return { ...u, type: normType };
    });
    if (!changed) continue;
    const cargo = { ...sc.cargo, units: normalized };
    const { error } = await supabaseClient.from("scenarios").update({ cargo }).eq("id", sc.id);
    if (!error) sc.cargo = cargo;
  }
}

function renderScenarioBar() {
  if (!currentCase || currentCase.quote_type !== "project") {
    scenarioBarEl.style.display = "none";
    scenarioOverviewCard.style.display = "none";
    editScenarioCard.style.display = "none";
    return;
  }
  scenarioBarEl.style.display = "flex";
  scenarioBarEl.innerHTML =
    scenarios
      .map(
        (s) => `
      <button type="button" class="scenario-tab-btn ${s.id === activeScenarioId ? "active" : ""}" data-id="${s.id}">
        ${escapeHtml(s.label || "(未命名情境)")} <span class="scenario-tab-mode">${escapeHtml(MODE_LABELS[s.mode] || s.mode)}</span>
      </button>`
      )
      .join("") +
    `
    <button type="button" class="btn-link" id="add-scenario-btn">+ 新增情境</button>
    <button type="button" class="btn-small" id="edit-scenario-open-btn">編輯目前情境</button>
    ${scenarios.length > 1 ? `<button type="button" class="btn-danger-link" id="delete-scenario-btn">刪除目前情境</button>` : ""}
    <button type="button" class="btn-small" id="scenario-overview-open-btn">情境總覽</button>
  `;

  scenarioBarEl.querySelectorAll(".scenario-tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.id === activeScenarioId) return;
      activeScenarioId = btn.dataset.id;
      scenarioOverviewCard.style.display = "none";
      renderScenarioBar();
      renderCaseSummary(currentCase);
      await loadAgentsAndSegments();
      refreshComparisonAndQuoteTabs();
    });
  });
  document.getElementById("add-scenario-btn").addEventListener("click", addScenario);
  document.getElementById("edit-scenario-open-btn").addEventListener("click", () => openEditScenarioForm(activeScenario()));
  document.getElementById("scenario-overview-open-btn").addEventListener("click", openScenarioOverview);
  const delBtn = document.getElementById("delete-scenario-btn");
  if (delBtn) delBtn.addEventListener("click", deleteActiveScenario);
}

async function addScenario() {
  const label = prompt("情境名稱(如「空運-一般貨」「海運-標準櫃」)", `情境 ${scenarios.length + 1}`);
  if (label === null) return;
  const { data, error } = await supabaseClient
    .from("scenarios")
    .insert({
      case_id: caseId,
      label: label.trim() || `情境 ${scenarios.length + 1}`,
      mode: activeScenario() ? activeScenario().mode : "air",
      cargo: {},
      selection: {},
      markup: {},
      sort_order: scenarios.length,
    })
    .select("*")
    .single();
  if (error) {
    alert(`新增情境失敗:${error.message}`);
    return;
  }
  scenarios.push(data);
  activeScenarioId = data.id;
  renderScenarioBar();
  renderCaseSummary(currentCase);
  await loadAgentsAndSegments();
  refreshComparisonAndQuoteTabs();
}

async function deleteActiveScenario() {
  const sc = activeScenario();
  if (!sc) return;
  if (!confirm(`確定要刪除情境「${sc.label}」嗎?這個情境底下的代理成本資料會一併刪除,無法復原。`)) return;
  const { error } = await supabaseClient.from("scenarios").delete().eq("id", sc.id);
  if (error) {
    alert(`刪除失敗:${error.message}`);
    return;
  }
  scenarios = scenarios.filter((s) => s.id !== sc.id);
  activeScenarioId = scenarios[0] ? scenarios[0].id : null;
  renderScenarioBar();
  renderCaseSummary(currentCase);
  await loadAgentsAndSegments();
  refreshComparisonAndQuoteTabs();
}

function openEditScenarioForm(sc) {
  if (!sc) return;
  document.getElementById("edit-scenario-label").value = sc.label || "";
  editScenarioModeSelect.value = sc.mode;
  document.getElementById("edit-scenario-shipment-qty").value = (sc.cargo && sc.cargo.shipmentQty) ?? "";
  renderCargoWeightSection(editScenarioCargoWeightSection, sc.mode, sc.cargo || {});

  editScenarioUnitsRows.innerHTML = "";
  ((sc.cargo && sc.cargo.units) || []).forEach((u) => addCargoUnitRow(editScenarioUnitsRows, u));

  editScenarioStatus.textContent = "";
  editScenarioStatus.className = "save-status";
  scenarioOverviewCard.style.display = "none";
  editScenarioCard.style.display = "block";
  editScenarioCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("edit-scenario-add-unit-row-btn").addEventListener("click", () => addCargoUnitRow(editScenarioUnitsRows));

// 切換情境的運輸模式時,計費重量/材積這組欄位意義完全不同,直接重繪成空白(比照 editModeSelect 的行為,spec第27節)
editScenarioModeSelect.addEventListener("change", () => {
  renderCargoWeightSection(editScenarioCargoWeightSection, editScenarioModeSelect.value, {});
});

document.getElementById("edit-scenario-cancel-btn").addEventListener("click", () => {
  editScenarioCard.style.display = "none";
});

// 同 editCaseForm:純粹擋掉 Enter 觸發的預設表單送出,實際存檔交給下面的 autosave(spec 6.5.4)
editScenarioForm.addEventListener("submit", (event) => event.preventDefault());

const editScenarioTrigger = createAutosaveTrigger(
  editScenarioStatus,
  async () => {
    const sc = activeScenario();
    if (!sc) return { incomplete: false };
    const label = document.getElementById("edit-scenario-label").value.trim();
    const mode = editScenarioModeSelect.value;
    if (!label) return { incomplete: true };

    const shipmentQty = document.getElementById("edit-scenario-shipment-qty").value;
    const units = collectCargoUnits(editScenarioUnitsRows, mode);

    const payload = {
      label,
      mode,
      cargo: {
        units,
        shipmentQty: shipmentQty ? Number(shipmentQty) : null,
        ...collectCargoWeightVolume(editScenarioCargoWeightSection),
      },
    };

    const modeChanged = payload.mode !== sc.mode;
    const unitsChanged = JSON.stringify(payload.cargo.units) !== JSON.stringify((sc.cargo && sc.cargo.units) || []);

    const { error } = await supabaseClient.from("scenarios").update(payload).eq("id", sc.id);
    if (error) throw error;
    Object.assign(sc, payload);
    renderScenarioBar();
    renderCaseSummary(currentCase);

    if (modeChanged || unitsChanged) {
      await loadAgentsAndSegments();
    }
    refreshComparisonAndQuoteTabs();
    return { incomplete: false };
  },
  { sectionId: "edit-scenario" }
);
attachAutosaveListeners(editScenarioForm, editScenarioTrigger);

// 情境總覽(spec 29.1):把所有情境的關鍵數字(總成本)並列,方便「空運快但貴、海運慢但便宜」這類時間/成本權衡比較
async function openScenarioOverview() {
  editScenarioCard.style.display = "none";
  scenarioOverviewCard.style.display = "block";
  scenarioOverviewRoot.innerHTML = `<p class="empty-state">載入中...</p>`;
  scenarioOverviewCard.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const rows = await Promise.all(
      scenarios.map(async (sc) => {
        const agents = await fetchAgentsWithCosts(caseId, sc.id);
        const cargo = sc.cargo || {};
        const selected = computeSelectedCosts(agents, sc.selection || {}, cargo, currentCase, currentCase.quote_currency);
        return { scenario: sc, agentsCount: agents.length, selected };
      })
    );

    scenarioOverviewRoot.innerHTML = `
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <thead>
            <tr><th>情境</th><th>模式</th><th>代理數</th><th>已選段數</th><th>組合總成本(Total,${escapeHtml(currentCase.quote_currency)})</th></tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td>${escapeHtml(r.scenario.label)}</td>
                <td>${escapeHtml(MODE_LABELS[r.scenario.mode] || r.scenario.mode)}</td>
                <td>${r.agentsCount}</td>
                <td>${SEGMENT_TYPES.filter((t) => r.selected.perSegment[t]).length} / 3</td>
                <td>${r.selected.anySelected ? formatMoneyWithWarnings(r.selected.sumTotal, r.selected, currentCase.quote_currency) : "尚未選定任何段落"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 6px">
        用來比較不同情境(如空運快但貴、海運慢但便宜)的權衡取捨,純供分析參考,不影響各情境實際的報價金額。
      </p>
    `;
  } catch (error) {
    scenarioOverviewRoot.innerHTML = `<div class="message error" style="display:block">讀取情境總覽失敗:${error.message}</div>`;
  }
}

document.getElementById("scenario-overview-close-btn").addEventListener("click", () => {
  scenarioOverviewCard.style.display = "none";
});

// 匯率設定區塊(spec 6.6節,對應第21節 v4 幣別架構):案件層級共用一張 rate_table,
// 列出目前案件內所有 FeeLine 用到、但不等於 quote_currency 的幣別,each 一列可輸入/抓即時匯率。
// quote_currency 本身不列在清單裡(換算時固定視為1,見 pricing.js rateToQuoteCurrency)。
function renderRateTableSection(usedCurrencies) {
  const quoteCurrency = currentCase.quote_currency;
  const rateByCurrency = {};
  (currentCase.rate_table || []).forEach((r) => {
    rateByCurrency[r.currency] = r.rate;
  });

  const currencies = Array.from(new Set(usedCurrencies || []))
    .filter((c) => c && c !== quoteCurrency)
    .sort();

  if (!currencies.length) {
    rateTableRoot.innerHTML = `<p class="empty-state">目前案件內的費用都是 ${escapeHtml(quoteCurrency || "報價幣別")},不需要額外設定匯率。</p>`;
    return;
  }

  rateTableRoot.innerHTML = currencies
    .map((c) => {
      const rate = rateByCurrency[c];
      const missing = rate == null || rate === "";
      return `
        <div class="rate-table-row${missing ? " rate-missing" : ""}" data-currency="${escapeHtml(c)}">
          <span class="rate-table-label">1 ${escapeHtml(c)} =</span>
          <input type="number" step="0.000001" min="0" class="rate-table-input" value="${rate ?? ""}" placeholder="尚未設定" />
          <span class="rate-table-label">${escapeHtml(quoteCurrency || "")}</span>
          <button type="button" class="btn-link rate-fetch-btn">抓即時匯率</button>
          ${missing ? `<span class="rate-missing-badge">⚠ 尚未設定匯率</span>` : ""}
        </div>
      `;
    })
    .join("");

  rateTableRoot.querySelectorAll(".rate-fetch-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".rate-table-row");
      const currency = row.dataset.currency;
      btn.disabled = true;
      btn.textContent = "查詢中…";
      const rate = await fetchLiveRate(currency, quoteCurrency);
      btn.disabled = false;
      btn.textContent = "抓即時匯率";
      if (rate == null) {
        alert(`抓不到 ${currency} → ${quoteCurrency} 的即時匯率,請手動輸入(免費匯率API可能未涵蓋這個幣別)`);
        return;
      }
      row.querySelector(".rate-table-input").value = rate;
      await rateTableTrigger();
    });
  });
}

const rateTableTrigger = createAutosaveTrigger(
  rateTableStatus,
  async () => {
    const rows = Array.from(rateTableRoot.querySelectorAll(".rate-table-row"));
    const payload = rows.map((row) => ({
      currency: row.dataset.currency,
      rate: row.querySelector(".rate-table-input").value ? Number(row.querySelector(".rate-table-input").value) : null,
    }));

    const { error } = await supabaseClient.from("cases").update({ rate_table: payload }).eq("id", caseId);
    if (error) throw error;
    currentCase.rate_table = payload;

    // 就地更新每列的「缺匯率」樣式,不整包重新渲染(避免使用者剛按完「抓即時匯率」的其他列被打斷)
    rows.forEach((row, i) => {
      const missing = payload[i].rate == null;
      row.classList.toggle("rate-missing", missing);
      const existingBadge = row.querySelector(".rate-missing-badge");
      if (existingBadge) existingBadge.remove();
      if (missing) {
        const badge = document.createElement("span");
        badge.className = "rate-missing-badge";
        badge.textContent = "⚠ 尚未設定匯率";
        row.appendChild(badge);
      }
    });

    refreshComparisonAndQuoteTabs();
  },
  { sectionId: "rate-table" }
);
attachAutosaveListeners(rateTableRoot, rateTableTrigger);

// 新增/修改費用項目可能帶入 rate_table 裡還沒出現過的新幣別(spec 6.6:「新增一筆 FeeLine 時,
// 若用到 rateTable 裡還沒出現過的新幣別,該幣別要自動加入這張表」),供 segmentForm.js 的
// refreshComparisonAndQuoteTabs 一併呼叫,重新掃描目前用到的幣別、重繪這個區塊
async function refreshRateTableCurrencies() {
  try {
    const agentsWithSegments = await fetchAgentsWithCosts(caseId, activeScenarioIdForQuery());
    renderRateTableSection(collectUsedCurrencies(agentsWithSegments));
  } catch (error) {
    // 靜默失敗即可,不影響比較分析/報價分頁已經成功刷新的結果
  }
}

// spec 6.5.1節A:收折摘要「代理名稱｜出口段小計｜國際段小計｜進口段小計」——use_lanes的段落沒有單一小計數字
// 好顯示(要選定哪條Lane才知道),改顯示航線數,不用勉強擠一個容易誤導的數字進去。這是初次渲染用的版本;
// 之後任一段落存檔後的即時更新,改由 segmentForm.js 透過 onCostChanged 回傳「剛算好的那一段」文字,
// 不會重新拿這裡的 segmentsByType 重算(那份資料存檔後不會再更新,重算只會拿到舊值)
function segmentSummaryText(s, cargo, rateTable, quoteCurrency) {
  if (!s) return "-";
  if (s.use_lanes) return `${(s.lanes || []).length}條航線`;
  // 第46節統整版:直接用formatMoney顯示total,驅動數字(如計費重量)還沒填時會顯示誤導的「0.00」,
  // 改用formatCostAmount,pending時顯示中性的「依實際計費重量另計」,跟比較分析/報價頁行為一致
  const cost = feeLineTotals(s.feeLines, cargo, rateTable, quoteCurrency, quoteCurrency);
  return formatCostAmount(cost.total, cost, "");
}

function renderAgentCard(agent, segmentsByType) {
  const card = document.createElement("div");
  card.className = "agent-card";
  card.id = `agent-card-${agent.id}`;
  const scope = getActiveScopeData();

  // 每一段自己的摘要文字分開存,某段存檔後只更新那一段自己的值,其餘維持原樣,避免互相覆蓋成舊資料
  const segmentSummaryTexts = {};
  SEGMENT_TYPES.forEach((t) => {
    segmentSummaryTexts[t] = segmentSummaryText(segmentsByType[t], scope.cargo || {}, currentCase.rate_table, currentCase.quote_currency);
  });
  function renderAgentSummaryHtml() {
    return SEGMENT_TYPES.map((t) => `${SEGMENT_TYPE_SHORT_LABELS[t]} ${segmentSummaryTexts[t]}`).join(" ｜ ");
  }
  function refreshAgentSummaryDisplay() {
    const el = card.querySelector(":scope > .collapsible-header .collapsible-summary");
    if (el) el.innerHTML = renderAgentSummaryHtml();
  }

  card.innerHTML = `
    <div class="collapsible-header agent-card-header">
      <span class="collapsible-chevron">▸</span>
      <h3>${escapeHtml(agent.name)}</h3>
      <span class="collapsible-summary">${renderAgentSummaryHtml()}</span>
      <select class="agent-role-select">
        <option value="both">出口/進口皆可</option>
        <option value="export">出口地代理</option>
        <option value="import">進口地代理</option>
      </select>
      <button type="button" class="btn-link ai-import-agent-btn">AI 智慧匯入</button>
      <button type="button" class="btn-danger-link delete-agent-btn">刪除代理</button>
    </div>
    <div class="collapsible-body">
      <div class="segment-grid"></div>
    </div>
  `;
  initCollapsible(card, { levelClass: "collapsible-agent" });

  const roleSelect = card.querySelector(".agent-role-select");
  roleSelect.value = agent.role || "both";
  roleSelect.addEventListener("change", async () => {
    const newRole = roleSelect.value;
    const { error } = await supabaseClient.from("agents").update({ role: newRole }).eq("id", agent.id);
    if (error) {
      alert(`更新代理角色失敗:${error.message}`);
      roleSelect.value = agent.role || "both";
      return;
    }
    agent.role = newRole;
    if (typeof refreshComparisonAndQuoteTabs === "function") refreshComparisonAndQuoteTabs();
  });

  card.querySelector(".ai-import-agent-btn").addEventListener("click", () => {
    openAiImportForAgent(agent, scope.mode);
  });

  card.querySelector(".delete-agent-btn").addEventListener("click", async () => {
    if (!confirm(`確定要刪除代理「${agent.name}」及其所有成本資料嗎?`)) return;
    const { error } = await supabaseClient.from("agents").delete().eq("id", agent.id);
    if (error) {
      alert(`刪除失敗:${error.message}`);
      return;
    }
    card.remove();
    renderCaseNavSidebar();
    if (typeof refreshComparisonAndQuoteTabs === "function") refreshComparisonAndQuoteTabs();
  });

  const grid = card.querySelector(".segment-grid");
  ["export", "intl", "import"].forEach((segmentType) => {
    const s = segmentsByType[segmentType] || null;
    renderSegmentCard(grid, {
      agentId: agent.id,
      segmentType,
      existing: s,
      feeLines: s ? s.feeLines : [],
      lanes: s ? s.lanes : [],
      caseCurrency: currentCase.quote_currency,
      caseMode: scope.mode,
      caseCargo: scope.cargo || {},
      caseRateTable: currentCase.rate_table,
      onCostChanged: (text) => {
        segmentSummaryTexts[segmentType] = text;
        refreshAgentSummaryDisplay();
      },
    });
  });

  agentsContainer.appendChild(card);
}

// ============================================================
// 全部展開/全部收折 + 案件導覽側欄(spec 6.5.1節)
// ============================================================

const expandCollapseAllBtn = document.getElementById("expand-collapse-all-btn");
let allCardsExpanded = false;
if (expandCollapseAllBtn) {
  expandCollapseAllBtn.addEventListener("click", () => {
    allCardsExpanded = !allCardsExpanded;
    setAllCollapsed(agentsContainer, !allCardsExpanded);
    expandCollapseAllBtn.textContent = allCardsExpanded ? "全部收折" : "全部展開";
  });
}

const caseNavTree = document.getElementById("case-nav-tree");
const caseNavSidebar = document.getElementById("case-nav-sidebar");
const caseNavOverlay = document.getElementById("case-nav-overlay");
const caseNavHamburger = document.getElementById("case-nav-hamburger");
const caseNavCloseBtn = document.getElementById("case-nav-close-btn");
let caseNavObserver = null;

function openCaseNav() {
  caseNavSidebar.classList.add("open");
  caseNavOverlay.classList.add("open");
}
function closeCaseNav() {
  caseNavSidebar.classList.remove("open");
  caseNavOverlay.classList.remove("open");
}
if (caseNavHamburger) {
  caseNavHamburger.addEventListener("click", openCaseNav);
  caseNavCloseBtn.addEventListener("click", closeCaseNav);
  caseNavOverlay.addEventListener("click", closeCaseNav);
}

// spec 6.5.1節B:直接掃描目前渲染出來的Agent/Segment/Lane卡片(而不是另外維護一份資料),
// 這樣新增/刪除代理、段落第一次存檔產生id、新增/刪除航線之後,只要卡片本身重繪過,樹狀結構自然跟著正確,
// 不用在每個異動點各自手動同步一份導覽資料
function renderCaseNavSidebar() {
  if (!caseNavTree) return;
  const agentCards = Array.from(agentsContainer.querySelectorAll(":scope > .agent-card"));
  if (!agentCards.length) {
    caseNavTree.innerHTML = `<p class="empty-state" style="padding: 8px">還沒有代理資料</p>`;
    setupCaseNavScrollSpy();
    return;
  }

  caseNavTree.innerHTML = agentCards
    .map((agentCard) => {
      const agentName = agentCard.querySelector(":scope > .collapsible-header h3");
      const segCards = Array.from(agentCard.querySelectorAll(".segment-card"));
      const segLinks = segCards
        .map((segCard) => {
          if (!segCard.id) return "";
          const segLabel = segCard.querySelector(":scope > .collapsible-header h4");
          const laneCards = Array.from(segCard.querySelectorAll(".lane-card"));
          const laneLinks = laneCards
            .map((laneCard) => {
              if (!laneCard.id) return "";
              const laneLabel = laneCard.querySelector(":scope > .collapsible-header h5");
              return `<button type="button" class="nav-lane-item" data-target="${laneCard.id}">${escapeHtml(laneLabel ? laneLabel.textContent : "(航線)")}</button>`;
            })
            .join("");
          return `<button type="button" class="nav-segment-item" data-target="${segCard.id}">${escapeHtml(segLabel ? segLabel.textContent : "")}</button>${laneLinks}`;
        })
        .join("");
      return `<button type="button" class="nav-agent-item" data-target="${agentCard.id}">${escapeHtml(agentName ? agentName.textContent : "")}</button>${segLinks}`;
    })
    .join("");

  caseNavTree.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      expandCollapsibleAncestors(target);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      closeCaseNav();
    });
  });

  setupCaseNavScrollSpy();
}

// 側欄跟著目前捲動到的位置自動高亮對應項目(spec 6.5.1節B:「隨時清楚知道我現在在看代理A的進口段」)
function setupCaseNavScrollSpy() {
  if (caseNavObserver) caseNavObserver.disconnect();
  if (!caseNavTree) return;
  const targets = Array.from(agentsContainer.querySelectorAll(".agent-card, .segment-card, .lane-card")).filter((el) => el.id);
  if (!targets.length) return;
  caseNavObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        caseNavTree.querySelectorAll(".active").forEach((el) => el.classList.remove("active"));
        const btn = caseNavTree.querySelector(`[data-target="${entry.target.id}"]`);
        if (btn) btn.classList.add("active");
      });
    },
    { rootMargin: "-96px 0px -70% 0px", threshold: 0 }
  );
  targets.forEach((t) => caseNavObserver.observe(t));
}

// spec 5.1-A:案件層級AI匯入精靈的「併入既有代理」下拉選單要用——每次 loadAgentsAndSegments 重新整理時
// 一併記住這份清單,不用另外重查一次資料庫
let lastLoadedAgents = [];

async function loadAgentsAndSegments() {
  // 背景重繪代理成本區塊前(例如編輯案件時改了運輸模式),先強制存一次使用者可能正在打字、還沒 blur 的
  // FeeLine/Lane 欄位,避免下面的 agentsContainer.innerHTML 整包重繪把還沒存的輸入蓋掉
  await flushFocusedAutosave(agentsContainer);

  let agentsWithSegments;
  try {
    agentsWithSegments = await fetchAgentsWithCosts(caseId, activeScenarioIdForQuery());
  } catch (error) {
    agentsContainer.innerHTML = `<div class="message error" style="display:block">讀取代理/成本資料失敗:${error.message}</div>`;
    return;
  }

  lastLoadedAgents = agentsWithSegments;
  renderRateTableSection(collectUsedCurrencies(agentsWithSegments));

  if (!agentsWithSegments.length) {
    agentsContainer.innerHTML = `<p class="empty-state">還沒有任何代理,請先在上方新增代理。</p>`;
    renderCaseNavSidebar();
    return;
  }

  agentsContainer.innerHTML = "";
  agentsWithSegments.forEach((agent) => renderAgentCard(agent, agent.segmentsByType));
  renderCaseNavSidebar();
}

addAgentBtn.addEventListener("click", async () => {
  const name = newAgentNameInput.value.trim();
  const role = newAgentRoleSelect.value;
  newAgentMessage.className = "message";
  newAgentMessage.textContent = "";

  if (!name) {
    newAgentMessage.textContent = "請輸入代理名稱";
    newAgentMessage.className = "message error";
    return;
  }

  addAgentBtn.disabled = true;
  try {
    const { error } = await supabaseClient.from("agents").insert({ case_id: caseId, scenario_id: activeScenarioIdForQuery(), name, role });
    if (error) throw error;
    newAgentNameInput.value = "";
    await loadAgentsAndSegments();
    // spec 6.5.1節A:「展開時只展開使用者當下要編輯的那一個」——剛新增的代理(agents依created_at排序,新的在最後一筆)
    // 直接展開讓使用者馬上能填,不用先收折再自己點開
    const newCard = agentsContainer.querySelector(":scope > .agent-card:last-child");
    if (newCard) {
      toggleCollapsible(newCard, true);
      newCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    newAgentMessage.textContent = error.message || "新增代理失敗";
    newAgentMessage.className = "message error";
  } finally {
    addAgentBtn.disabled = false;
  }
});

// spec 5.1-A/第36節:案件層級AI匯入精靈,跟上面「+新增代理」並列的主要入口
if (aiImportWizardBtn) {
  aiImportWizardBtn.addEventListener("click", () => {
    const scope = getActiveScopeData();
    openAiImportWizard({
      caseId,
      scenarioId: activeScenarioIdForQuery(),
      mode: scope.mode,
      existingAgents: lastLoadedAgents.map((a) => ({ id: a.id, name: a.name })),
    });
  });
}

// spec 27.1節v2:cargo.units.type 的正規化(normalizeContainerType)先前只套用在「新輸入/存檔」的資料,
// 資料庫裡既有的舊案件(如 ATE 案例)從沒被回頭處理過,導致跟 FeeLine 的 amount_by_type 標準代碼比對不到。
// 在案件明細頁讀取當下「自我修復」:值不同就直接寫回資料庫,等同於隨著使用者操作自然跑過一次性批次正規化,
// 對已經是標準代碼的資料完全是no-op,可安全重複執行。
async function healStaleCargoUnitTypeNormalization(caseRow) {
  if (caseRow.mode === "air") return; // 空運沒有貨櫃概念,不套用這份正規化(spec 6.5.5節)
  const units = (caseRow.cargo && caseRow.cargo.units) || [];
  if (!units.length) return;
  let changed = false;
  const normalized = units.map((u) => {
    const normType = normalizeContainerType(u.type);
    if (normType !== u.type) changed = true;
    return { ...u, type: normType };
  });
  if (!changed) return;
  const cargo = { ...caseRow.cargo, units: normalized };
  const { error } = await supabaseClient.from("cases").update({ cargo }).eq("id", caseRow.id);
  if (!error) caseRow.cargo = cargo; // 修正記憶體內資料,這次讀取當下就正確,不用等下次重新整理
}

(async () => {
  const session = await requireSession();
  if (!session) return;

  if (!caseId) {
    caseSummaryCard.innerHTML = `<div class="message error" style="display:block">網址缺少案件 id</div>`;
    agentsContainer.innerHTML = "";
    return;
  }

  const { data, error } = await supabaseClient.from("cases").select("*").eq("id", caseId).single();
  if (error || !data) {
    caseSummaryCard.innerHTML = `<div class="message error" style="display:block">找不到此案件,或沒有權限查看。</div>`;
    agentsContainer.innerHTML = "";
    return;
  }

  await healStaleCargoUnitTypeNormalization(data);
  currentCase = data;

  // spec 29.1:project案件在載入代理成本前,要先確定目前是哪個情境(沒有情境就自動建一個),
  // 才知道要抓哪個scenario_id底下的代理
  if (currentCase.quote_type === "project") {
    await loadScenarios();
    await healStaleScenarioCargoUnitTypeNormalization();
  }
  renderScenarioBar();
  renderCaseSummary(currentCase);
  await loadAgentsAndSegments();
})();
