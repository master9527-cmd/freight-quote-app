const caseId = new URLSearchParams(window.location.search).get("id");

const caseSummaryCard = document.getElementById("case-summary-card");
const agentsContainer = document.getElementById("agents-container");
const newAgentNameInput = document.getElementById("new-agent-name");
const newAgentRoleSelect = document.getElementById("new-agent-role");
const addAgentBtn = document.getElementById("add-agent-btn");
const newAgentMessage = document.getElementById("new-agent-message");
const rateTableRoot = document.getElementById("rate-table-rows");
const rateTableStatus = document.getElementById("rate-table-status");

const editCaseCard = document.getElementById("edit-case-card");
const editCaseForm = document.getElementById("edit-case-form");
const editCaseStatus = document.getElementById("edit-case-status");
const editCaseCancelBtn = document.getElementById("edit-case-cancel-btn");
const editUnitsRows = document.getElementById("edit-units-rows");
const editIncotermSelect = document.getElementById("edit-case-incoterm");
const editScopeCheckboxes = {
  export: document.getElementById("edit-case-scope-export"),
  intl: document.getElementById("edit-case-scope-intl"),
  import: document.getElementById("edit-case-scope-import"),
};

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

let currentCase = null;

function quoteScopeSummaryText(scope) {
  const s = scope || { export: true, intl: true, import: true };
  return SEGMENT_TYPES.filter((t) => s[t] !== false)
    .map((t) => SEGMENT_TYPE_LABELS[t])
    .join("、") || "(無,三段都不計入報價)";
}

function renderCaseSummary(c) {
  const units = (c.cargo && c.cargo.units) || [];
  const unitsText = units.length ? units.map((u) => `${u.type} x${u.qty}`).join("、") : "-";

  caseSummaryCard.innerHTML = `
    <div class="agent-card-header">
      <h2>${escapeHtml(c.ref || "(未編號)")} — ${escapeHtml(c.name)}</h2>
      <button type="button" class="btn-small" id="edit-case-toggle-btn">編輯案件</button>
    </div>
    <div class="case-summary">
      <span><strong>航線:</strong> ${escapeHtml(c.origin || "-")} → ${escapeHtml(c.destination || "-")}</span>
      <span><strong>模式:</strong> ${MODE_LABELS[c.mode] || c.mode}</span>
      <span><strong>類型:</strong> ${QUOTE_TYPE_LABELS[c.quote_type] || c.quote_type}</span>
      <span><strong>報價幣別:</strong> ${escapeHtml(c.quote_currency)}</span>
      <span><strong>計費重量:</strong> ${c.cargo && c.cargo.chargeableWeightKg != null ? c.cargo.chargeableWeightKg + " KG" : "-"}</span>
      <span><strong>票數/BL:</strong> ${c.cargo && c.cargo.shipmentQty != null ? c.cargo.shipmentQty : "-"}</span>
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
  document.getElementById("edit-case-chargeable-weight").value = (c.cargo && c.cargo.chargeableWeightKg) ?? "";
  document.getElementById("edit-case-shipment-qty").value = (c.cargo && c.cargo.shipmentQty) ?? "";
  editIncotermSelect.value = c.incoterm || "";
  const scope = c.quote_scope || { export: true, intl: true, import: true };
  SEGMENT_TYPES.forEach((t) => (editScopeCheckboxes[t].checked = scope[t] !== false));
  document.getElementById("edit-case-trade-remark").value = c.trade_remark || "";

  editUnitsRows.innerHTML = "";
  ((c.cargo && c.cargo.units) || []).forEach((u) =>
    addDynamicRow(editUnitsRows, { colAValue: u.type, colBValue: u.qty, colAPlaceholder: "類型,如 20GP / PLT / CTN", colBPlaceholder: "數量" })
  );

  editCaseStatus.textContent = "";
  editCaseStatus.className = "save-status";
  editCaseCard.style.display = "block";
  editCaseCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("edit-add-unit-row-btn").addEventListener("click", () =>
  addDynamicRow(editUnitsRows, { colAPlaceholder: "類型,如 20GP / PLT / CTN", colBPlaceholder: "數量" })
);

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
    const mode = document.getElementById("edit-case-mode").value;
    const quoteType = document.getElementById("edit-case-quote-type").value;
    const quoteCurrency = document.getElementById("edit-case-currency").value.trim();

    // 案件名稱/報價幣別是必填欄位,還沒填完整時不要真的送出存檔(送了會被資料庫 not null 擋下,
    // 那是很難懂的錯誤訊息),用「有未填完整的項目」狀態文字表示就好,等使用者補完自然存入
    if (!name || !quoteCurrency) {
      return { incomplete: true };
    }

    const chargeableWeightKg = document.getElementById("edit-case-chargeable-weight").value;
    const shipmentQty = document.getElementById("edit-case-shipment-qty").value;

    const payload = {
      name,
      mode,
      origin: document.getElementById("edit-case-origin").value.trim(),
      destination: document.getElementById("edit-case-destination").value.trim(),
      quote_type: quoteType,
      quote_currency: quoteCurrency,
      cargo: {
        units: collectRows(editUnitsRows, "type", "qty"),
        chargeableWeightKg: chargeableWeightKg ? Number(chargeableWeightKg) : null,
        shipmentQty: shipmentQty ? Number(shipmentQty) : null,
      },
      incoterm: editIncotermSelect.value || null,
      quote_scope: {
        export: editScopeCheckboxes.export.checked,
        intl: editScopeCheckboxes.intl.checked,
        import: editScopeCheckboxes.import.checked,
      },
      trade_remark: document.getElementById("edit-case-trade-remark").value.trim() || null,
    };

    const modeChanged = payload.mode !== currentCase.mode;
    const quoteCurrencyChanged = payload.quote_currency !== currentCase.quote_currency;

    const { error } = await supabaseClient.from("cases").update(payload).eq("id", caseId);
    if (error) throw error;

    Object.assign(currentCase, payload);
    renderCaseSummary(currentCase);

    // mode 會影響 Segment 的 from/to 標籤跟港口/機場自動完成類型,只有真的改到 mode 才需要重繪代理成本區塊,
    // 不要整頁重新整理(autosave 底下如果動不動整頁刷新,使用者在其他欄位打到一半的東西會被沖掉)
    if (modeChanged) {
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
    const agentsWithSegments = await fetchAgentsWithCosts(caseId);
    renderRateTableSection(collectUsedCurrencies(agentsWithSegments));
  } catch (error) {
    // 靜默失敗即可,不影響比較分析/報價分頁已經成功刷新的結果
  }
}

function renderAgentCard(agent, segmentsByType) {
  const card = document.createElement("div");
  card.className = "agent-card";
  card.innerHTML = `
    <div class="agent-card-header">
      <h3>${escapeHtml(agent.name)}</h3>
      <select class="agent-role-select">
        <option value="both">出口/進口皆可</option>
        <option value="export">出口地代理</option>
        <option value="import">進口地代理</option>
      </select>
      <button type="button" class="btn-danger-link delete-agent-btn">刪除代理</button>
    </div>
    <div class="segment-grid"></div>
  `;

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

  card.querySelector(".delete-agent-btn").addEventListener("click", async () => {
    if (!confirm(`確定要刪除代理「${agent.name}」及其所有成本資料嗎?`)) return;
    const { error } = await supabaseClient.from("agents").delete().eq("id", agent.id);
    if (error) {
      alert(`刪除失敗:${error.message}`);
      return;
    }
    card.remove();
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
      caseMode: currentCase.mode,
    });
  });

  agentsContainer.appendChild(card);
}

async function loadAgentsAndSegments() {
  // 背景重繪代理成本區塊前(例如編輯案件時改了運輸模式),先強制存一次使用者可能正在打字、還沒 blur 的
  // FeeLine/Lane 欄位,避免下面的 agentsContainer.innerHTML 整包重繪把還沒存的輸入蓋掉
  await flushFocusedAutosave(agentsContainer);

  let agentsWithSegments;
  try {
    agentsWithSegments = await fetchAgentsWithCosts(caseId);
  } catch (error) {
    agentsContainer.innerHTML = `<div class="message error" style="display:block">讀取代理/成本資料失敗:${error.message}</div>`;
    return;
  }

  renderRateTableSection(collectUsedCurrencies(agentsWithSegments));

  if (!agentsWithSegments.length) {
    agentsContainer.innerHTML = `<p class="empty-state">還沒有任何代理,請先在上方新增代理。</p>`;
    return;
  }

  agentsContainer.innerHTML = "";
  agentsWithSegments.forEach((agent) => renderAgentCard(agent, agent.segmentsByType));
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
    const { error } = await supabaseClient.from("agents").insert({ case_id: caseId, name, role });
    if (error) throw error;
    newAgentNameInput.value = "";
    await loadAgentsAndSegments();
  } catch (error) {
    newAgentMessage.textContent = error.message || "新增代理失敗";
    newAgentMessage.className = "message error";
  } finally {
    addAgentBtn.disabled = false;
  }
});

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

  currentCase = data;
  renderCaseSummary(data);
  await loadAgentsAndSegments();
})();
