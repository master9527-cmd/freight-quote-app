// 代理成本卡片(v2:Segment 不再選單一 pricingType,改為 FeeLine 清單 + 選用 Lane)
// 對應 spec 2.3–2.5、第10節修正1、2、6.5.4節(autosave,取消手動儲存按鈕)

function addDynamicRow(container, { colAValue = "", colBValue = "", colAPlaceholder = "名稱", colBPlaceholder = "金額", colAType = "text" } = {}) {
  const row = document.createElement("div");
  row.className = "dynamic-row";
  row.innerHTML = `
    <input type="${colAType}" class="col-type" placeholder="${colAPlaceholder}" value="${escapeHtml(String(colAValue))}" />
    <input type="number" step="any" class="col-amount" placeholder="${colBPlaceholder}" value="${colBValue}" />
    <button type="button" class="remove-row" title="刪除">×</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function collectRows(container, keyA, keyB, { keyAType = "string" } = {}) {
  const results = [];
  container.querySelectorAll(".dynamic-row").forEach((row) => {
    const aRaw = row.querySelector(".col-type").value.trim();
    const bRaw = row.querySelector(".col-amount").value;
    if (aRaw !== "" && bRaw !== "") {
      results.push({ [keyA]: keyAType === "number" ? Number(aRaw) : aRaw, [keyB]: Number(bRaw) });
    }
  });
  return results;
}

// 兩欄只填一半的列(如級距只填了單價、threshold KG 忘了填)不該被靜默丟棄——
// 之前 collectRows 會直接跳過這種列,導致存檔後級距少一筆、金額算錯,使用者卻看不到任何錯誤訊息(spec 第17節)。
// autosave 模式下不阻斷存檔,但呼叫端要知道「這裡還有東西沒填完」才能顯示狀態文字,不能真的存一半又裝作沒事。
function hasPartiallyFilledRow(container) {
  return Array.from(container.querySelectorAll(".dynamic-row")).some((row) => {
    const aRaw = row.querySelector(".col-type").value.trim();
    const bRaw = row.querySelector(".col-amount").value.trim();
    return (aRaw === "") !== (bRaw === "");
  });
}

// 任何一筆成本資料(FeeLine/Lane/Segment)存檔或刪除成功後,主動重新整理「比較分析」「報價」分頁,
// 不要依賴使用者自己記得手動切分頁/整頁重新整理才看得到最新數字。
function refreshComparisonAndQuoteTabs() {
  if (typeof loadComparisonTab === "function") loadComparisonTab();
  if (typeof loadQuoteTab === "function") loadQuoteTab();
  // 新增/修改 FeeLine 可能帶入 rateTable 裡還沒出現過的新幣別(spec 6.6),要一併重新掃描(caseDetail.js)
  if (typeof refreshRateTableCurrencies === "function") refreshRateTableCurrencies();
}

// ============================================================
// FeeLine:單筆費用項目(basis 決定要顯示哪些欄位)
// ============================================================

function feeLineBasisDetailSkeleton(basis) {
  if (basis === "perUnit") {
    return `
      <div class="section-label">各單位單價(type 對應貨量單位,如 20GP/40HQ/PLT)</div>
      <div class="dynamic-rows fl-amount-by-type-rows"></div>
      <button type="button" class="btn-link fl-add-row-btn">+ 新增單位費率</button>
    `;
  }
  const amountLabel = { flat: "金額", perShipment: "每票/BL單價", perKg: "每KG單價" }[basis] || "金額";
  return `
    <div class="field-inline">
      <label>${amountLabel}</label>
      <input type="number" step="0.01" class="fl-amount" />
    </div>
  `;
}

// perKgBreak 的簡單模式(spec 2.4 / 第16節):預設只顯示「每KG單價」+「最低消費」兩欄,
// 只有 breaks 筆數 > 1(使用者按過「+ 新增級距」)才切換成多級距表格；
// 多級距表格刪到剩 <= 1 筆時,自動收合回簡單模式,並帶走最後剩下那筆的單價,不用使用者重打

function renderPerKgBreakSimple(detailEl, rateValue, minChargeValue, trigger) {
  detailEl.innerHTML = `
    <div class="field-inline">
      <label>每KG單價</label>
      <input type="number" step="0.01" class="fl-simple-rate" />
    </div>
    <div class="field-inline">
      <label>最低消費(選填)</label>
      <input type="number" step="0.01" class="fl-min-charge" />
    </div>
    <button type="button" class="btn-link fl-add-row-btn">+ 新增級距(適用於不同重量有不同單價的情況)</button>
  `;
  if (rateValue != null && rateValue !== "") detailEl.querySelector(".fl-simple-rate").value = rateValue;
  if (minChargeValue != null && minChargeValue !== "") detailEl.querySelector(".fl-min-charge").value = minChargeValue;

  detailEl.querySelector(".fl-add-row-btn").addEventListener("click", () => {
    const carriedRate = detailEl.querySelector(".fl-simple-rate").value;
    const carriedMinCharge = detailEl.querySelector(".fl-min-charge").value;
    renderPerKgBreakMultiTier(detailEl, [{ thresholdKg: 0, ratePerKg: carriedRate }], carriedMinCharge, trigger);
  });
}

// thresholdKg 的意義是「這一階從幾KG開始」，不是上限：sorted 之後,每一筆的有效範圍
// 是「自己的 threshold 起、到下一筆 threshold 為止(不含)」，最高的那一筆是「以上、無上限」。
// 第一筆(最低那階)一定要從 0 開始才能涵蓋所有重量,所以鎖定不給使用者改。(spec 第17節)
function renderPerKgBreakMultiTier(detailEl, initialBreaks, minChargeValue, trigger) {
  detailEl.innerHTML = `
    <div class="field-inline">
      <label>最低消費(選填)</label>
      <input type="number" step="0.01" class="fl-min-charge" />
    </div>
    <div class="section-label">級距(每一筆代表「從這個重量開始」的單價,不是上限;第一筆固定從 0kg 開始,最高那一筆代表「以上、無上限」)</div>
    <div class="dynamic-rows fl-breaks-rows"></div>
    <button type="button" class="btn-link fl-add-row-btn">+ 新增級距</button>
  `;
  if (minChargeValue != null && minChargeValue !== "") detailEl.querySelector(".fl-min-charge").value = minChargeValue;

  const rowsEl = detailEl.querySelector(".fl-breaks-rows");

  function refreshRangeLabels() {
    const rows = Array.from(rowsEl.querySelectorAll(".dynamic-row"));
    rows.forEach((row, i) => {
      const thresholdInput = row.querySelector(".col-type");
      if (i === 0) {
        thresholdInput.value = "0";
        thresholdInput.disabled = true;
        thresholdInput.title = "第一階固定從 0kg 開始,才能涵蓋所有重量";
      } else {
        thresholdInput.disabled = false;
        thresholdInput.title = "";
      }
    });

    const parsed = rows.map((row, i) => {
      const raw = row.querySelector(".col-type").value.trim();
      return { i, val: raw === "" ? null : Number(raw) };
    });
    const numeric = parsed.filter((p) => p.val != null && !Number.isNaN(p.val)).sort((a, b) => a.val - b.val);

    rows.forEach((row, i) => {
      const rangeEl = row.querySelector(".fl-break-range");
      const p = parsed[i];
      if (p.val == null || Number.isNaN(p.val)) {
        rangeEl.textContent = "請先填 threshold KG(級距起點)";
        rangeEl.classList.add("fl-break-range-warning");
        return;
      }
      const pos = numeric.findIndex((n) => n.i === i);
      const isTop = pos === numeric.length - 1;
      if (isTop) {
        rangeEl.textContent = `適用於 ${p.val}kg 以上(無上限)`;
        rangeEl.classList.remove("fl-break-range-warning");
      } else if (numeric[pos + 1].val === p.val) {
        rangeEl.textContent = `⚠ 與其他級距 threshold 重複(${p.val}kg)`;
        rangeEl.classList.add("fl-break-range-warning");
      } else {
        rangeEl.textContent = `適用於 ${p.val} ~ ${numeric[pos + 1].val}kg(未滿 ${numeric[pos + 1].val}kg)`;
        rangeEl.classList.remove("fl-break-range-warning");
      }
    });
  }

  function handleRowRemoved() {
    const remainingRows = rowsEl.querySelectorAll(".dynamic-row");
    if (remainingRows.length <= 1) {
      const lastRow = remainingRows[0];
      const rate = lastRow ? lastRow.querySelector(".col-amount").value : "";
      const currentMinCharge = detailEl.querySelector(".fl-min-charge").value;
      renderPerKgBreakSimple(detailEl, rate, currentMinCharge, trigger);
    }
  }

  function addBreakRow(values) {
    addDynamicRow(rowsEl, {
      colAValue: values.thresholdKg ?? "",
      colBValue: values.ratePerKg ?? "",
      colAPlaceholder: "threshold KG(級距起點)",
      colBPlaceholder: "每KG單價",
      colAType: "number",
    });
    const row = rowsEl.lastElementChild;
    const rangeEl = document.createElement("span");
    rangeEl.className = "fl-break-range";
    row.insertBefore(rangeEl, row.querySelector(".remove-row"));
    row.querySelector(".col-type").addEventListener("input", refreshRangeLabels);
    row.querySelector(".remove-row").addEventListener("click", () => {
      handleRowRemoved();
      if (detailEl.contains(rowsEl)) refreshRangeLabels();
      trigger(); // row.remove() 不會觸發 blur/change,刪除級距列要自己觸發 autosave 把結果存回去
    });
  }

  (initialBreaks.length ? initialBreaks : [{ thresholdKg: 0, ratePerKg: "" }]).forEach(addBreakRow);
  refreshRangeLabels();

  detailEl.querySelector(".fl-add-row-btn").addEventListener("click", () => {
    addBreakRow({ thresholdKg: "", ratePerKg: "" });
    refreshRangeLabels();
  });
}

function renderPerKgBreakDetail(detailEl, prefillData, trigger) {
  const breaks = [...(prefillData?.breaks || [])].sort((a, b) => Number(a.thresholdKg) - Number(b.thresholdKg));
  const minCharge = prefillData?.min_charge;
  if (breaks.length > 1) {
    renderPerKgBreakMultiTier(detailEl, breaks, minCharge, trigger);
  } else {
    renderPerKgBreakSimple(detailEl, breaks[0]?.ratePerKg, minCharge, trigger);
  }
}

function buildFeeLineRow(data, defaultCurrency, trigger) {
  const row = document.createElement("div");
  row.className = "fee-line-row";
  row.dataset.id = data.id || "";

  row.innerHTML = `
    <div class="fee-line-row-header">
      <input type="text" class="fl-name" placeholder="費用名稱,如 吊櫃費/文件費" value="${escapeHtml(data.name || "")}" />
      <select class="fl-certainty">
        <option value="certain">計入 Subtotal(certain)</option>
        <option value="possible">僅計入 Total(possible)</option>
      </select>
      <select class="fl-basis">
        ${Object.entries(BASIS_LABELS)
          .map(([value, label]) => `<option value="${value}">${label}</option>`)
          .join("")}
      </select>
      <button type="button" class="btn-danger-link fl-remove-btn">刪除</button>
    </div>
    <div class="field-inline fl-currency-field">
      <label>幣別</label>
      <input type="text" class="fl-currency" value="${escapeHtml(data.currency || defaultCurrency || "")}" placeholder="如 USD/CNY/TWD" />
    </div>
    <div class="fl-basis-detail"></div>
    <div class="field-inline fl-remark-field">
      <label>備註</label>
      <input type="text" class="fl-remark" value="${escapeHtml(data.remark || "")}" placeholder="難以結構化的條件文字,如「23噸以上加收 overweight surcharge」" />
    </div>
  `;

  row.querySelector(".fl-certainty").value = data.certainty || "certain";
  const basisSelect = row.querySelector(".fl-basis");
  basisSelect.value = data.basis || "flat";

  function renderDetail(prefillData) {
    const detailEl = row.querySelector(".fl-basis-detail");

    if (basisSelect.value === "perKgBreak") {
      renderPerKgBreakDetail(detailEl, prefillData, trigger);
      return;
    }

    detailEl.innerHTML = feeLineBasisDetailSkeleton(basisSelect.value);

    if (basisSelect.value === "perUnit") {
      const rowsEl = detailEl.querySelector(".fl-amount-by-type-rows");
      detailEl.querySelector(".fl-add-row-btn").addEventListener("click", () =>
        addDynamicRow(rowsEl, { colAPlaceholder: "單位類型,如 40HQ", colBPlaceholder: "單價" })
      );
      (prefillData?.amount_by_type || []).forEach((t) =>
        addDynamicRow(rowsEl, { colAValue: t.type, colBValue: t.amount, colAPlaceholder: "單位類型,如 40HQ", colBPlaceholder: "單價" })
      );
      // 刪除單位費率列(row.remove())不會觸發 blur/change,要自己觸發 autosave 把移除結果存回去
      rowsEl.addEventListener("click", (event) => {
        if (event.target.closest(".remove-row")) trigger();
      });
    } else if (prefillData?.amount != null) {
      detailEl.querySelector(".fl-amount").value = prefillData.amount;
    }
  }

  renderDetail(data);
  // fl-basis 的 change 事件會冒泡,外層卡片的 attachAutosaveListeners 已經會接到並觸發 autosave,
  // 這裡只需要重繪對應的明細欄位
  basisSelect.addEventListener("change", () => renderDetail(null));

  row.querySelector(".fl-remove-btn").addEventListener("click", async () => {
    const label = row.querySelector(".fl-name").value || "此費用項目";
    if (!confirm(`確定要刪除「${label}」嗎?`)) return;
    if (row.dataset.id) {
      const { error } = await supabaseClient.from("fee_lines").delete().eq("id", row.dataset.id);
      if (error) {
        alert(`刪除失敗:${error.message}`);
        return;
      }
      refreshComparisonAndQuoteTabs();
    }
    row.remove();
    trigger(); // 重新評估這個區塊目前是否還有「未填完整」的項目
  });

  return row;
}

// ============================================================
// FeeLine 清單(掛在 segment 或 lane 之一)——純渲染,不含自己的存檔邏輯。
// 存檔改由外層(Segment/Lane)透過 saveFeeLineRows 統一處理,跟段落/航線設定合併成同一次 autosave(spec 6.5.4)
// ============================================================

function renderFeeLineList(container, { existingFeeLines, defaultCurrency, trigger }) {
  container.innerHTML = `
    <div class="section-label">費用清單(FeeLine)</div>
    <div class="fee-line-rows"></div>
    <button type="button" class="btn-link add-fee-line-btn">+ 新增費用項目</button>
  `;

  const rowsContainer = container.querySelector(".fee-line-rows");
  (existingFeeLines || []).forEach((fl) => rowsContainer.appendChild(buildFeeLineRow(fl, defaultCurrency, trigger)));

  container.querySelector(".add-fee-line-btn").addEventListener("click", () => {
    rowsContainer.appendChild(buildFeeLineRow({ certainty: "certain", basis: "flat" }, defaultCurrency, trigger));
  });
}

// 收集並存檔一個容器底下所有 FeeLine 列(用在 Segment 或 Lane 的合併 autosave 裡):
// 新列 insert、既有列 upsert,insert 完成後直接把新 id 寫回對應 DOM 列,不整包重新渲染——
// 避免使用者這時候如果已經在打下一個欄位,存檔完成時被整包重繪蓋掉還沒存的輸入。
// 名稱還沒填的列一律不送出:完全空白的新列直接忽略(不算未填完整,只是還沒用到的空位),
// 但如果已經填了金額/級距等資料卻漏填名稱,或級距/單位列本身只填一半,回報 incomplete=true(spec 第17節)。
async function saveFeeLineRows(rowsContainer, parentColumn, parentId, defaultCurrency) {
  const newRows = [];
  const newPayloads = [];
  const existingPayloads = [];
  let incomplete = false;

  rowsContainer.querySelectorAll(".fee-line-row").forEach((row) => {
    const name = row.querySelector(".fl-name").value.trim();
    const basis = row.querySelector(".fl-basis").value;
    const detailEl = row.querySelector(".fl-basis-detail");

    const payload = {
      [parentColumn]: parentId,
      name,
      certainty: row.querySelector(".fl-certainty").value,
      currency: row.querySelector(".fl-currency").value.trim() || defaultCurrency,
      remark: row.querySelector(".fl-remark").value.trim() || null,
      basis,
      amount: null,
      amount_by_type: null,
      min_charge: null,
      breaks: null,
    };

    let hasAmountData = false;
    if (basis === "perUnit") {
      const amountByTypeRowsEl = detailEl.querySelector(".fl-amount-by-type-rows");
      payload.amount_by_type = collectRows(amountByTypeRowsEl, "type", "amount");
      hasAmountData = payload.amount_by_type.length > 0;
      if (hasPartiallyFilledRow(amountByTypeRowsEl)) incomplete = true;
    } else if (basis === "perKgBreak") {
      const minChargeVal = detailEl.querySelector(".fl-min-charge").value;
      payload.min_charge = minChargeVal ? Number(minChargeVal) : null;
      const simpleRateInput = detailEl.querySelector(".fl-simple-rate");
      if (simpleRateInput) {
        const rateVal = simpleRateInput.value;
        payload.breaks = rateVal ? [{ thresholdKg: 0, ratePerKg: Number(rateVal) }] : [];
        hasAmountData = rateVal.trim() !== "" || minChargeVal.trim() !== "";
      } else {
        const breaksRowsEl = detailEl.querySelector(".fl-breaks-rows");
        if (hasPartiallyFilledRow(breaksRowsEl)) incomplete = true;
        payload.breaks = collectRows(breaksRowsEl, "thresholdKg", "ratePerKg", { keyAType: "number" });
        hasAmountData = payload.breaks.length > 0 || minChargeVal.trim() !== "";
      }
    } else {
      const amountVal = detailEl.querySelector(".fl-amount").value;
      payload.amount = Number(amountVal || 0);
      hasAmountData = amountVal.trim() !== "";
    }

    if (!name) {
      if (hasAmountData) incomplete = true; // 有填資料但忘了取名字,先不存,等補完
      return;
    }

    if (row.dataset.id) {
      existingPayloads.push({ ...payload, id: row.dataset.id });
    } else {
      newRows.push(row);
      newPayloads.push(payload);
    }
  });

  if (newPayloads.length) {
    const { data, error } = await supabaseClient.from("fee_lines").insert(newPayloads).select("id");
    if (error) throw error;
    data.forEach((d, i) => {
      newRows[i].dataset.id = d.id;
    });
  }
  if (existingPayloads.length) {
    const { error } = await supabaseClient.from("fee_lines").upsert(existingPayloads);
    if (error) throw error;
  }

  return { incomplete };
}

// ============================================================
// Lane(僅 segment.useLanes = true 時使用),每條 Lane 內嵌自己的 FeeLine 清單。
// Lane 基本資料與底下的 FeeLine 清單合併成同一次 autosave(spec 6.5.4)。
// getSegmentId 用函式而非直接傳值,是因為新段落的 segment id 要等第一次 autosave 完成才會有,
// 不能在 Lane 卡片一開始建立時就把值定死。
// ============================================================

function buildLaneCard(lane, getSegmentId, defaultCurrency) {
  const card = document.createElement("div");
  card.className = "lane-card";
  card.dataset.id = lane.id || "";

  function titleText() {
    const carrier = card.querySelector(".ln-carrier").value.trim();
    const routing = card.querySelector(".ln-routing").value.trim();
    return `${carrier || "(未命名航線)"}${routing ? " — " + routing : ""}`;
  }

  card.innerHTML = `
    <div class="lane-card-header">
      <h5>${escapeHtml(lane.carrier || "(新航線)")}${lane.routing ? " — " + escapeHtml(lane.routing) : ""}</h5>
      <button type="button" class="btn-danger-link lane-remove-btn">刪除航線</button>
    </div>
    <div class="form-grid">
      <div class="field-inline"><label>船/航空公司代號(carrier)</label><input type="text" class="ln-carrier" value="${escapeHtml(lane.carrier || "")}" /></div>
      <div class="field-inline"><label>路由(routing)</label><input type="text" class="ln-routing" value="${escapeHtml(lane.routing || "")}" /></div>
      <div class="field-inline"><label>轉運天數 Min</label><input type="number" class="ln-transit-min" value="${lane.transit_days_min ?? ""}" /></div>
      <div class="field-inline"><label>轉運天數 Max</label><input type="number" class="ln-transit-max" value="${lane.transit_days_max ?? ""}" /></div>
      <div class="field-inline"><label>轉運站點數</label><input type="number" class="ln-stops" value="${lane.stops_count ?? ""}" /></div>
      <div class="field-inline"><label>Incoterm</label><input type="text" class="ln-incoterm" value="${escapeHtml(lane.incoterm || "")}" /></div>
      <div class="field-inline"><label>有效期起</label><input type="date" class="ln-validity-start" value="${lane.validity_start || ""}" /></div>
      <div class="field-inline"><label>有效期迄</label><input type="date" class="ln-validity-end" value="${lane.validity_end || ""}" /></div>
      <div class="field-inline field-full"><label>備註</label><input type="text" class="ln-remark" value="${escapeHtml(lane.remark || "")}" /></div>
    </div>
    <div class="save-status ln-save-status"></div>
    <div class="lane-fee-lines-container"></div>
  `;

  const statusEl = card.querySelector(".ln-save-status");
  const feeLinesContainer = card.querySelector(".lane-fee-lines-container");

  const trigger = createAutosaveTrigger(
    statusEl,
    async () => {
      const payload = {
        segment_id: getSegmentId(),
        carrier: card.querySelector(".ln-carrier").value.trim() || null,
        routing: card.querySelector(".ln-routing").value.trim() || null,
        transit_days_min: card.querySelector(".ln-transit-min").value ? Number(card.querySelector(".ln-transit-min").value) : null,
        transit_days_max: card.querySelector(".ln-transit-max").value ? Number(card.querySelector(".ln-transit-max").value) : null,
        stops_count: card.querySelector(".ln-stops").value ? Number(card.querySelector(".ln-stops").value) : null,
        incoterm: card.querySelector(".ln-incoterm").value.trim() || null,
        validity_start: card.querySelector(".ln-validity-start").value || null,
        validity_end: card.querySelector(".ln-validity-end").value || null,
        remark: card.querySelector(".ln-remark").value.trim() || null,
      };

      if (card.dataset.id) {
        const { error } = await supabaseClient.from("lanes").update(payload).eq("id", card.dataset.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient.from("lanes").insert(payload).select("id").single();
        if (error) throw error;
        card.dataset.id = data.id;
      }
      card.querySelector("h5").textContent = titleText();

      let incomplete = false;
      const feeLineRowsEl = feeLinesContainer.querySelector(".fee-line-rows");
      if (feeLineRowsEl) {
        const result = await saveFeeLineRows(feeLineRowsEl, "lane_id", card.dataset.id, defaultCurrency);
        incomplete = result.incomplete;
      }

      refreshComparisonAndQuoteTabs();
      return { incomplete };
    },
    { sectionId: `lane-${lane.id || Math.random().toString(36).slice(2)}` }
  );

  renderFeeLineList(feeLinesContainer, {
    existingFeeLines: lane.feeLines || [],
    defaultCurrency,
    trigger,
  });

  card.querySelector(".lane-remove-btn").addEventListener("click", async () => {
    if (!confirm(`確定要刪除航線「${titleText()}」及其所有費用項目嗎?`)) return;
    if (card.dataset.id) {
      const { error } = await supabaseClient.from("lanes").delete().eq("id", card.dataset.id);
      if (error) {
        alert(`刪除失敗:${error.message}`);
        return;
      }
      refreshComparisonAndQuoteTabs();
    }
    card.remove();
  });

  attachAutosaveListeners(card, trigger);

  return card;
}

function renderLaneList(container, { getSegmentId, existingLanes, defaultCurrency }) {
  container.innerHTML = `
    <div class="section-label">航線列表(Lane)</div>
    <div class="lane-cards"></div>
    <button type="button" class="btn-link add-lane-btn">+ 新增航線</button>
  `;
  const cardsContainer = container.querySelector(".lane-cards");
  (existingLanes || []).forEach((lane) => cardsContainer.appendChild(buildLaneCard(lane, getSegmentId, defaultCurrency)));
  container.querySelector(".add-lane-btn").addEventListener("click", () => {
    cardsContainer.appendChild(buildLaneCard({}, getSegmentId, defaultCurrency));
  });
}

// ============================================================
// Segment 卡片(對外進入點,caseDetail.js 呼叫)。
// 段落設定與底下的 FeeLine 清單合併成同一次 autosave,不再拆成「儲存段落設定」「儲存費用清單」兩顆按鈕(spec 6.5.4)。
// 新段落一開始沒有 id,第一次 autosave 觸發時(不論是改到段落欄位還是打了一筆費用項目)才會建立 segment 列,
// 所以 FeeLine/Lane 清單一開始就直接渲染,不用等「先存段落設定」這個前置步驟。
// ============================================================

function renderSegmentCard(container, { agentId, segmentType, existing, feeLines, lanes, caseCurrency, caseMode }) {
  const card = document.createElement("div");
  card.className = "segment-card";
  card.dataset.segmentId = existing ? existing.id : "";

  const labels = getLocationLabels(caseMode, segmentType);
  const defaultCurrency = existing ? existing.default_currency : caseCurrency;
  const useLanesInitial = existing ? existing.use_lanes : false;
  const checkboxId = `use-lanes-${agentId}-${segmentType}`;

  card.innerHTML = `
    <h4>${SEGMENT_TYPE_LABELS[segmentType]}</h4>
    <div class="field-inline"><label>預設幣別(選填,新增費用項目時預帶入,不參與計算)</label><input type="text" class="f-default-currency" value="${escapeHtml(defaultCurrency || "")}" /></div>
    <div class="field-inline"><label>${labels.from}</label><input type="text" class="f-from-location" value="${escapeHtml((existing && existing.from_location) || "")}" /></div>
    <div class="field-inline"><label>${labels.to}</label><input type="text" class="f-to-location" value="${escapeHtml((existing && existing.to_location) || "")}" /></div>
    <div class="field-inline checkbox-field">
      <input type="checkbox" class="f-use-lanes" id="${checkboxId}" ${useLanesInitial ? "checked" : ""} />
      <label for="${checkboxId}">需要比較多航線/多船公司(啟用 Lane)</label>
    </div>
    <div class="save-status seg-save-status"></div>
    <div class="fee-lines-section"></div>
    <div class="lanes-section"></div>
  `;

  attachLocationAutocomplete(card.querySelector(".f-from-location"), caseMode);
  attachLocationAutocomplete(card.querySelector(".f-to-location"), caseMode);

  const feeLinesSection = card.querySelector(".fee-lines-section");
  const lanesSection = card.querySelector(".lanes-section");
  const useLanesCheckbox = card.querySelector(".f-use-lanes");
  const statusEl = card.querySelector(".seg-save-status");

  function syncSectionVisibility() {
    feeLinesSection.style.display = useLanesCheckbox.checked ? "none" : "block";
    lanesSection.style.display = useLanesCheckbox.checked ? "block" : "none";
  }

  const trigger = createAutosaveTrigger(
    statusEl,
    async () => {
      const payload = {
        agent_id: agentId,
        segment_type: segmentType,
        default_currency: card.querySelector(".f-default-currency").value.trim() || caseCurrency,
        from_location: card.querySelector(".f-from-location").value.trim() || null,
        to_location: card.querySelector(".f-to-location").value.trim() || null,
        use_lanes: useLanesCheckbox.checked,
      };

      const { data, error } = await supabaseClient
        .from("segments")
        .upsert(payload, { onConflict: "agent_id,segment_type" })
        .select()
        .single();
      if (error) throw error;
      card.dataset.segmentId = data.id;

      let incomplete = false;
      const feeLineRowsEl = feeLinesSection.querySelector(".fee-line-rows");
      if (feeLineRowsEl) {
        const result = await saveFeeLineRows(feeLineRowsEl, "segment_id", data.id, payload.default_currency);
        incomplete = result.incomplete;
      }

      refreshComparisonAndQuoteTabs();
      return { incomplete };
    },
    { sectionId: `segment-${agentId}-${segmentType}` }
  );

  renderFeeLineList(feeLinesSection, {
    existingFeeLines: feeLines || [],
    defaultCurrency,
    trigger,
  });
  renderLaneList(lanesSection, {
    getSegmentId: () => card.dataset.segmentId,
    existingLanes: lanes || [],
    defaultCurrency,
  });

  syncSectionVisibility();
  useLanesCheckbox.addEventListener("change", syncSectionVisibility);

  // 掛在整張卡片上,涵蓋段落欄位跟底下所有 FeeLine 列(含動態新增的);
  // Lane 卡片巢狀在同一張卡片裡,各自也有自己的 attachAutosaveListeners,
  // 兩層都會收到 Lane 內欄位的 blur/change——這裡的段落層只是順便重存一次不變的段落設定,無害,只是多一次呼叫
  attachAutosaveListeners(card, trigger);

  container.appendChild(card);
}
