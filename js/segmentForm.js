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
  // spec 6.5.1節B:段落/航線第一次存檔才會有id、新增/刪除航線都會影響導覽樹狀結構,存檔後順便重繪一次,
  // 不用在每個異動點各自手動同步(caseDetail.js)
  if (typeof renderCaseNavSidebar === "function") renderCaseNavSidebar();
}

// ============================================================
// FeeLine:單筆費用項目(basis 決定要顯示哪些欄位)
// ============================================================

// perUnit 的「單位類型」下拉選項(spec 27.1節v2修正):選項改抓 6.5.5 節「貨櫃類型標準參考」完整清單,
// 不限縮成只有這個案件 cargo.units 裡已登記的類型——代理的費率表本來就可能涵蓋比這批貨更多的類型,這是正常情況
// (spec 0.1節原則1:代理成本是費率表,不是這批貨專屬帳單)。用下拉選單(而非自由輸入)仍是為了從源頭避免
// 「打法不一致(如 20'GP vs 20GP)導致比對不到、金額靜默算成0」這整類問題(spec 0.1節原則2)。
function unitTypeOptionsHtml(cargoUnits, selectedType) {
  // 第40.1節:perContainer/perContainerPerDay 的類型選單只列真正的貨櫃代碼(不含PLT/CTN/CHASSIS),
  // 這三者現在各自是perPallet/perCarton/perChassisPerDay的隱含單位,不會出現在這個下拉裡
  const standardTypes = REAL_CONTAINER_CODES;
  let options = `<option value="">請選擇單位類型</option>`;
  options += standardTypes
    .map((t) => `<option value="${escapeHtml(t)}" ${t === selectedType ? "selected" : ""}>${escapeHtml(CONTAINER_TYPE_LABELS[t])}</option>`)
    .join("");
  // 既有資料若不是標準清單裡的代碼(舊資料、或非貨櫃的自訂單位如空運ULD),仍要保留原始值可見,
  // 不能讓下拉選單悄悄把使用者原本存的值換掉(spec 17節:不完整/對不上的資料不該被靜默吞掉或蓋掉)
  if (selectedType && !standardTypes.includes(selectedType)) {
    options += `<option value="${escapeHtml(selectedType)}" selected>${escapeHtml(selectedType)}(非標準代碼)</option>`;
  }
  return options;
}

// spec 第39.1節:這批貨cargo.units裡「有登記數量」的類型清單——跟 js/pricing.js 的 registeredUnitTypes()
// 是同一個判斷邏輯,這裡只拿到 cargoUnits(不是完整 cargo 物件)所以就地重算,不用改動既有呼叫點的參數型別
function registeredCargoUnitTypeSet(cargoUnits) {
  return new Set((cargoUnits || []).filter((u) => Number(u.qty || 0) > 0).map((u) => u.type));
}

// spec 第39.1節(ATE/ALFA案例修正):perUnit的type若不是這批貨cargo.units登記的類型,這筆費率目前不計入金額,
// 但這是「代理費率表本來就可能涵蓋更多類型」的正常情況(spec 0.1節原則1),不用警示色,只要持續可見的中性提示,
// 不能讓使用者要跑去比較分析頁核對總額才發現錢不見了。非標準代碼(自訂類型,如「Shipment」)更可能是選錯計價基礎,
// 額外加一句引導改用 flat/perShipment。
function unitTypeHintText(cargoUnits, type) {
  if (!type) return "";
  if (registeredCargoUnitTypeSet(cargoUnits).has(type)) return "";
  const isStandard = Object.prototype.hasOwnProperty.call(CONTAINER_TYPE_LABELS, type);
  const base = "ℹ️ 貨量資訊未登記此類型,此列目前不計入金額";
  return isStandard ? base : `${base}。若這是固定費用(如整趟運費),建議考慮改用 flat 固定金額或 perShipment 每票計價,避免漏算`;
}

function addUnitTypeFeeRow(container, cargoUnits, { typeValue = "", amountValue = "" } = {}) {
  const row = document.createElement("div");
  row.className = "dynamic-row";
  row.innerHTML = `
    <select class="col-type">${unitTypeOptionsHtml(cargoUnits, typeValue)}</select>
    <input type="number" step="any" class="col-amount" placeholder="單價" value="${amountValue}" />
    <button type="button" class="remove-row" title="刪除">×</button>
    <div class="unit-type-hint"></div>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  container.appendChild(row);
  // spec 6.5.5/第35節:成本輸入 perUnit 費用的貨櫃類型欄位旁也加ⓘ圖示,確認費率對應哪種規格的櫃
  const typeSelect = row.querySelector(".col-type");
  attachContainerSpecInfoIcon(typeSelect, () => typeSelect.value);

  const hintEl = row.querySelector(".unit-type-hint");
  function refreshHint() {
    const text = unitTypeHintText(cargoUnits, typeSelect.value);
    hintEl.textContent = text;
    hintEl.style.display = text ? "" : "none";
  }
  typeSelect.addEventListener("change", refreshHint);
  refreshHint();
}

// 第40.1節(全文取代規則):perUnit拆成perContainer/perPallet/perCarton,perUnitPerDay拆成
// perContainerPerDay/perPalletPerDay/perChassisPerDay。三種UI形狀:
// (1) perContainer/perContainerPerDay:沿用原perUnit的「amountByType多列」UI(類型下拉已限定只列真正貨櫃代碼),
//     PerDay版多一個「天數」欄位(套用在整筆FeeLine,不是逐類型各自的天數)
// (2) perPallet/perCarton:單一金額輸入(隱含單位分別是PLT/CTN,不需要類型下拉)
// (3) perPalletPerDay/perChassisPerDay:單一金額輸入+天數欄位
const ARRAY_TYPE_BASIS = new Set(["perContainer", "perContainerPerDay"]);
const PER_DAY_BASIS = new Set(["perContainerPerDay", "perPalletPerDay", "perChassisPerDay"]);

function feeLineBasisDetailSkeleton(basis, cargoUnits) {
  if (ARRAY_TYPE_BASIS.has(basis)) {
    const daysField = PER_DAY_BASIS.has(basis)
      ? `<div class="field-inline"><label>天數</label><input type="number" step="1" class="fl-days" /></div>`
      : "";
    return `
      <div class="section-label">各貨櫃類型單價(可自由選擇任何標準貨櫃類型輸入費率,不限這批貨目前登記的類型——代理的費率表本來就可能涵蓋比這批貨更多的類型)</div>
      <div class="dynamic-rows fl-amount-by-type-rows"></div>
      <button type="button" class="btn-link fl-add-row-btn">+ 新增單位費率</button>
      ${daysField}
    `;
  }
  if (basis === "perPalletPerDay" || basis === "perChassisPerDay") {
    const amountLabel = basis === "perPalletPerDay" ? "每棧板每天單價" : "每底盤每天單價";
    const chassisNote =
      basis === "perChassisPerDay" ? `<p class="field-hint">若未在貨量資訊登記底盤(CHASSIS)數量,預設視為1</p>` : "";
    return `
      <div class="field-inline"><label>${amountLabel}</label><input type="number" step="0.01" class="fl-amount" /></div>
      <div class="field-inline"><label>天數</label><input type="number" step="1" class="fl-days" /></div>
      ${chassisNote}
    `;
  }
  const amountLabel = { flat: "金額", perShipment: "每票/BL單價", perKg: "每KG單價", perPallet: "每棧板單價", perCarton: "每箱單價" }[basis] || "金額";
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
    <p class="field-hint">💡 若代理報價是空運 Pivot Weight 結構(pivot重量門檻,低於用較高的under-pivot費率、高於用較低的over-pivot費率):
      「最低消費」填 pivot重量 × under-pivot費率,再按「+ 新增級距」變成兩筆——第一筆(0kg)填 under-pivot費率,第二筆(pivot重量)填 over-pivot費率,
      建議在下方備註註明「Pivot Weight: Xkg」方便日後辨識(spec 29.3節,沿用既有 perKgBreak 結構,不需要額外欄位)</p>
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

// 依目前這一列的資料(basis/amount/amount_by_type/breaks/min_charge)+ 案件 cargo,即時算出「缺資料無法計算」警示文字,
// 沒有 name/沒開始填資料的空白列不顯示(避免使用者剛新增一列就被一堆警示轟炸)。這裡直接沿用跟存檔時同一套判斷
// (pricing.js 的 feeLineAmountDetailed),確保畫面上看到的警示跟比較分析/報價頁最終算出來的結果一致(spec 第27.2節)
function feeLineIncompleteWarningText(flLike, cargo) {
  if (!flLike || !flLike.name) return "";
  const detail = feeLineAmountDetailed(flLike, cargo);
  return detail.incomplete ? `⚠ ${detail.reason}` : "";
}

function buildFeeLineRow(data, defaultCurrency, trigger, cargo) {
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
    <div class="fl-incomplete-warning cell-missing-rate"></div>
    <div class="field-inline fl-remark-field">
      <label>備註</label>
      <input type="text" class="fl-remark" value="${escapeHtml(data.remark || "")}" placeholder="難以結構化的條件文字,如「23噸以上加收 overweight surcharge」" />
    </div>
  `;

  row.querySelector(".fl-certainty").value = data.certainty || "certain";
  const basisSelect = row.querySelector(".fl-basis");
  basisSelect.value = data.basis || "flat";
  row.querySelector(".fl-incomplete-warning").textContent = feeLineIncompleteWarningText(data, cargo);

  function renderDetail(prefillData) {
    const detailEl = row.querySelector(".fl-basis-detail");
    const cargoUnits = (cargo && cargo.units) || [];
    const basis = basisSelect.value;

    if (basis === "perKgBreak") {
      renderPerKgBreakDetail(detailEl, prefillData, trigger);
      return;
    }

    detailEl.innerHTML = feeLineBasisDetailSkeleton(basis, cargoUnits);

    if (ARRAY_TYPE_BASIS.has(basis)) {
      const rowsEl = detailEl.querySelector(".fl-amount-by-type-rows");
      const addRowBtn = detailEl.querySelector(".fl-add-row-btn");
      addRowBtn.addEventListener("click", () => addUnitTypeFeeRow(rowsEl, cargoUnits));
      (prefillData?.amount_by_type || []).forEach((t) => addUnitTypeFeeRow(rowsEl, cargoUnits, { typeValue: t.type, amountValue: t.amount }));
      // 刪除單位費率列(row.remove())不會觸發 blur/change,要自己觸發 autosave 把移除結果存回去
      rowsEl.addEventListener("click", (event) => {
        if (event.target.closest(".remove-row")) trigger();
      });
      const daysEl = detailEl.querySelector(".fl-days");
      if (daysEl && prefillData?.days != null) daysEl.value = prefillData.days;
    } else {
      if (prefillData?.amount != null) detailEl.querySelector(".fl-amount").value = prefillData.amount;
      const daysEl = detailEl.querySelector(".fl-days");
      if (daysEl && prefillData?.days != null) daysEl.value = prefillData.days;
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
// cargo:案件層級的貨量資訊(spec 第27.1/27.2節),perUnit 單位類型下拉選項跟每列的「缺資料」警示都要用到
// ============================================================

function renderFeeLineList(container, { existingFeeLines, defaultCurrency, trigger, cargo }) {
  container.innerHTML = `
    <div class="section-label">費用清單(FeeLine)</div>
    <div class="fee-line-rows"></div>
    <button type="button" class="btn-link add-fee-line-btn">+ 新增費用項目</button>
  `;

  const rowsContainer = container.querySelector(".fee-line-rows");
  (existingFeeLines || []).forEach((fl) => rowsContainer.appendChild(buildFeeLineRow(fl, defaultCurrency, trigger, cargo)));

  container.querySelector(".add-fee-line-btn").addEventListener("click", () => {
    rowsContainer.appendChild(buildFeeLineRow({ certainty: "certain", basis: "flat" }, defaultCurrency, trigger, cargo));
  });
}

// 收集並存檔一個容器底下所有 FeeLine 列(用在 Segment 或 Lane 的合併 autosave 裡):
// 新列 insert、既有列 upsert,insert 完成後直接把新 id 寫回對應 DOM 列,不整包重新渲染——
// 避免使用者這時候如果已經在打下一個欄位,存檔完成時被整包重繪蓋掉還沒存的輸入。
// 名稱還沒填的列一律不送出:完全空白的新列直接忽略(不算未填完整,只是還沒用到的空位),
// 但如果已經填了金額/級距等資料卻漏填名稱,或級距/單位列本身只填一半,回報 incomplete=true(spec 第17節)。
// cargo:同步更新每一列的「缺資料無法計算」警示(spec 第27.2節)——用跟這裡組出來的 payload 完全一樣的資料去判斷,
// 確保畫面上顯示的警示跟實際存進資料庫、之後比較分析/報價頁算出來的結果一致,不會兩邊看到不同的東西。
async function saveFeeLineRows(rowsContainer, parentColumn, parentId, defaultCurrency, cargo) {
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
      days: null,
    };

    let hasAmountData = false;
    if (ARRAY_TYPE_BASIS.has(basis)) {
      const amountByTypeRowsEl = detailEl.querySelector(".fl-amount-by-type-rows");
      payload.amount_by_type = collectRows(amountByTypeRowsEl, "type", "amount");
      hasAmountData = payload.amount_by_type.length > 0;
      if (hasPartiallyFilledRow(amountByTypeRowsEl)) incomplete = true;
      if (PER_DAY_BASIS.has(basis)) {
        const daysVal = detailEl.querySelector(".fl-days").value;
        payload.days = daysVal ? Number(daysVal) : null;
      }
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
      if (PER_DAY_BASIS.has(basis)) {
        const daysVal = detailEl.querySelector(".fl-days").value;
        payload.days = daysVal ? Number(daysVal) : null;
      }
    }

    const warnEl = row.querySelector(".fl-incomplete-warning");
    if (warnEl) warnEl.textContent = feeLineIncompleteWarningText(payload, cargo);

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

  // spec 6.5.1節A:收折摘要要即時反映剛存檔的結果,回傳這次實際存進去的完整 FeeLine 清單(不含忘記取名字的空列),
  // 讓呼叫端不用重新查一次資料庫就能就地重算Subtotal/Total
  const savedFeeLines = [...existingPayloads, ...newPayloads];
  return { incomplete, feeLines: savedFeeLines };
}

// ============================================================
// Lane(僅 segment.useLanes = true 時使用),每條 Lane 內嵌自己的 FeeLine 清單。
// Lane 基本資料與底下的 FeeLine 清單合併成同一次 autosave(spec 6.5.4)。
// getSegmentId 用函式而非直接傳值,是因為新段落的 segment id 要等第一次 autosave 完成才會有,
// 不能在 Lane 卡片一開始建立時就把值定死。
// ============================================================

// spec 29.4節:船期/航班附加資訊存的是 timestamptz,畫面用 <input type="datetime-local">,兩者格式互轉
function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromDatetimeLocalValue(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function laneSummaryHtml(cost) {
  return `${formatMoney(cost.total, "")}`;
}

function buildLaneCard(lane, getSegmentId, defaultCurrency, cargo, rateTable, quoteCurrency, caseMode, onCostChanged, defaultCollapsed = true) {
  const card = document.createElement("div");
  card.className = "lane-card";
  card.dataset.id = lane.id || "";
  if (lane.id) card.id = `lane-card-${lane.id}`;

  function titleText() {
    const carrier = card.querySelector(".ln-carrier").value.trim();
    const routing = card.querySelector(".ln-routing").value.trim();
    return `${carrier || "(未命名航線)"}${routing ? " — " + routing : ""}`;
  }

  const initialCost = feeLineTotals(lane.feeLines || [], cargo, rateTable, quoteCurrency, quoteCurrency);
  card.innerHTML = `
    <div class="collapsible-header lane-card-header">
      <span class="collapsible-chevron">▸</span>
      <h5>${escapeHtml(lane.carrier || "(新航線)")}${lane.routing ? " — " + escapeHtml(lane.routing) : ""}</h5>
      <span class="collapsible-summary">${laneSummaryHtml(initialCost)}</span>
      <button type="button" class="btn-danger-link lane-remove-btn">刪除航線</button>
    </div>
    <div class="collapsible-body">
      <div class="form-grid">
        <div class="field-inline"><label>船/航空公司代號(carrier)</label><input type="text" class="ln-carrier" value="${escapeHtml(lane.carrier || "")}" /></div>
        <div class="field-inline"><label>起點港口/機場(fromPort)</label><input type="text" class="ln-from-port" value="${escapeHtml(lane.from_port || "")}" /></div>
        <div class="field-inline"><label>訖點港口/機場(toPort)</label><input type="text" class="ln-to-port" value="${escapeHtml(lane.to_port || "")}" /></div>
        <div class="field-inline"><label>路由(routing,完整路線敘述,選填)</label><input type="text" class="ln-routing" value="${escapeHtml(lane.routing || "")}" /></div>
        <div class="field-inline"><label>轉運天數 Min</label><input type="number" class="ln-transit-min" value="${lane.transit_days_min ?? ""}" /></div>
        <div class="field-inline"><label>轉運天數 Max</label><input type="number" class="ln-transit-max" value="${lane.transit_days_max ?? ""}" /></div>
        <div class="field-inline"><label>轉運站點數</label><input type="number" class="ln-stops" value="${lane.stops_count ?? ""}" /></div>
        <div class="field-inline"><label>Incoterm</label><input type="text" class="ln-incoterm" value="${escapeHtml(lane.incoterm || "")}" /></div>
        <div class="field-inline"><label>有效期起</label><input type="date" class="ln-validity-start" value="${lane.validity_start || ""}" /></div>
        <div class="field-inline"><label>有效期迄</label><input type="date" class="ln-validity-end" value="${lane.validity_end || ""}" /></div>
        <div class="field-inline field-full"><label>備註</label><input type="text" class="ln-remark" value="${escapeHtml(lane.remark || "")}" /></div>
      </div>
      <div class="section-label" style="margin-top: 8px">船期/航班附加資訊(選填,參考/附註用途,不參與成本計算,spec 29.4)</div>
      <div class="form-grid">
        <div class="field-inline"><label>船名 vesselName(海運)</label><input type="text" class="ln-vessel-name" value="${escapeHtml(lane.vessel_name || "")}" /></div>
        <div class="field-inline"><label>航次 voyageNumber(海運)</label><input type="text" class="ln-voyage-number" value="${escapeHtml(lane.voyage_number || "")}" /></div>
        <div class="field-inline"><label>SI截止 siCutoff</label><input type="datetime-local" class="ln-si-cutoff" value="${toDatetimeLocalValue(lane.si_cutoff)}" /></div>
        <div class="field-inline"><label>VGM截止 vgmCutoff</label><input type="datetime-local" class="ln-vgm-cutoff" value="${toDatetimeLocalValue(lane.vgm_cutoff)}" /></div>
        <div class="field-inline"><label>CY截止 cyCutoff</label><input type="datetime-local" class="ln-cy-cutoff" value="${toDatetimeLocalValue(lane.cy_cutoff)}" /></div>
        <div class="field-inline"><label>ETD</label><input type="datetime-local" class="ln-etd" value="${toDatetimeLocalValue(lane.etd)}" /></div>
        <div class="field-inline"><label>ETA</label><input type="datetime-local" class="ln-eta" value="${toDatetimeLocalValue(lane.eta)}" /></div>
        <div class="field-inline"><label>每週班次 weeklyFrequency(空運,如 D1234567/Daily/D135)</label><input type="text" class="ln-weekly-frequency" value="${escapeHtml(lane.weekly_frequency || "")}" /></div>
        <div class="field-inline">
          <label>是否直航/直飛 isDirect</label>
          <select class="ln-is-direct">
            <option value="" ${lane.is_direct == null ? "selected" : ""}>(未指定)</option>
            <option value="true" ${lane.is_direct === true ? "selected" : ""}>是</option>
            <option value="false" ${lane.is_direct === false ? "selected" : ""}>否</option>
          </select>
        </div>
        <div class="field-inline field-full"><label>轉運/轉機站點(選填,逗號分隔的港口/機場代碼)</label><input type="text" class="ln-transship-points" placeholder="如 HKG, ANC" value="${escapeHtml((lane.transship_points || []).join(", "))}" /></div>
      </div>
      <div class="save-status ln-save-status"></div>
      <div class="lane-fee-lines-container"></div>
    </div>
  `;
  initCollapsible(card, { levelClass: "collapsible-lane", defaultCollapsed });
  // spec 第40.2節:Lane的起訖點也要有港口/機場自動完成,跟routing(自由文字完整路線敘述)分開的結構化欄位
  attachLocationAutocomplete(card.querySelector(".ln-from-port"), caseMode);
  attachLocationAutocomplete(card.querySelector(".ln-to-port"), caseMode);

  const statusEl = card.querySelector(".ln-save-status");
  const feeLinesContainer = card.querySelector(".lane-fee-lines-container");

  const trigger = createAutosaveTrigger(
    statusEl,
    async () => {
      const payload = {
        segment_id: getSegmentId(),
        carrier: card.querySelector(".ln-carrier").value.trim() || null,
        from_port: card.querySelector(".ln-from-port").value.trim() || null,
        to_port: card.querySelector(".ln-to-port").value.trim() || null,
        routing: card.querySelector(".ln-routing").value.trim() || null,
        transit_days_min: card.querySelector(".ln-transit-min").value ? Number(card.querySelector(".ln-transit-min").value) : null,
        transit_days_max: card.querySelector(".ln-transit-max").value ? Number(card.querySelector(".ln-transit-max").value) : null,
        stops_count: card.querySelector(".ln-stops").value ? Number(card.querySelector(".ln-stops").value) : null,
        incoterm: card.querySelector(".ln-incoterm").value.trim() || null,
        validity_start: card.querySelector(".ln-validity-start").value || null,
        validity_end: card.querySelector(".ln-validity-end").value || null,
        remark: card.querySelector(".ln-remark").value.trim() || null,
        // spec 29.4節:船期/航班附加資訊,選填,參考用途
        vessel_name: card.querySelector(".ln-vessel-name").value.trim() || null,
        voyage_number: card.querySelector(".ln-voyage-number").value.trim() || null,
        si_cutoff: fromDatetimeLocalValue(card.querySelector(".ln-si-cutoff").value),
        vgm_cutoff: fromDatetimeLocalValue(card.querySelector(".ln-vgm-cutoff").value),
        cy_cutoff: fromDatetimeLocalValue(card.querySelector(".ln-cy-cutoff").value),
        etd: fromDatetimeLocalValue(card.querySelector(".ln-etd").value),
        eta: fromDatetimeLocalValue(card.querySelector(".ln-eta").value),
        weekly_frequency: card.querySelector(".ln-weekly-frequency").value.trim() || null,
        is_direct: card.querySelector(".ln-is-direct").value === "" ? null : card.querySelector(".ln-is-direct").value === "true",
        transship_points: card
          .querySelector(".ln-transship-points")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      if (card.dataset.id) {
        const { error } = await supabaseClient.from("lanes").update(payload).eq("id", card.dataset.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient.from("lanes").insert(payload).select("id").single();
        if (error) throw error;
        card.dataset.id = data.id;
        card.id = `lane-card-${data.id}`;
      }
      card.querySelector("h5").textContent = titleText();

      let incomplete = false;
      const feeLineRowsEl = feeLinesContainer.querySelector(".fee-line-rows");
      if (feeLineRowsEl) {
        const result = await saveFeeLineRows(feeLineRowsEl, "lane_id", card.dataset.id, defaultCurrency, cargo);
        incomplete = result.incomplete;
        // spec 6.5.1節A:存檔完就地更新這條Lane的收折摘要,不用等重新整理整頁才看到最新小計
        const cost = feeLineTotals(result.feeLines, cargo, rateTable, quoteCurrency, quoteCurrency);
        card.querySelector(":scope > .collapsible-header .collapsible-summary").innerHTML = laneSummaryHtml(cost);
        if (onCostChanged) onCostChanged();
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
    cargo,
  });

  card.querySelector(".lane-remove-btn").addEventListener("click", async (event) => {
    event.stopPropagation();
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
    if (onCostChanged) onCostChanged();
  });

  attachAutosaveListeners(card, trigger);

  return card;
}

function renderLaneList(container, { getSegmentId, existingLanes, defaultCurrency, cargo, rateTable, quoteCurrency, caseMode, onCostChanged }) {
  container.innerHTML = `
    <div class="section-label">航線列表(Lane)</div>
    <div class="lane-cards"></div>
    <button type="button" class="btn-link add-lane-btn">+ 新增航線</button>
  `;
  const cardsContainer = container.querySelector(".lane-cards");
  (existingLanes || []).forEach((lane) =>
    cardsContainer.appendChild(buildLaneCard(lane, getSegmentId, defaultCurrency, cargo, rateTable, quoteCurrency, caseMode, onCostChanged))
  );
  container.querySelector(".add-lane-btn").addEventListener("click", () => {
    // spec 6.5.1節A:剛新增的航線直接展開,不用使用者自己再點開(比照新增代理的行為)
    const newCard = buildLaneCard({}, getSegmentId, defaultCurrency, cargo, rateTable, quoteCurrency, caseMode, onCostChanged, false);
    cardsContainer.appendChild(newCard);
    newCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (onCostChanged) onCostChanged();
  });
}

// ============================================================
// Segment 卡片(對外進入點,caseDetail.js 呼叫)。
// 段落設定與底下的 FeeLine 清單合併成同一次 autosave,不再拆成「儲存段落設定」「儲存費用清單」兩顆按鈕(spec 6.5.4)。
// 新段落一開始沒有 id,第一次 autosave 觸發時(不論是改到段落欄位還是打了一筆費用項目)才會建立 segment 列,
// 所以 FeeLine/Lane 清單一開始就直接渲染,不用等「先存段落設定」這個前置步驟。
// ============================================================

function renderSegmentCard(container, { agentId, segmentType, existing, feeLines, lanes, caseCurrency, caseMode, caseCargo, caseRateTable, onCostChanged }) {
  const card = document.createElement("div");
  card.className = "segment-card";
  card.dataset.segmentId = existing ? existing.id : "";
  if (existing) card.id = `segment-card-${existing.id}`;

  const labels = getLocationLabels(caseMode, segmentType);
  const defaultCurrency = existing ? existing.default_currency : caseCurrency;
  const useLanesInitial = existing ? existing.use_lanes : false;
  const checkboxId = `use-lanes-${agentId}-${segmentType}`;

  const initialSummary = useLanesInitial
    ? `${(lanes || []).length}條航線`
    : formatMoney(feeLineTotals(feeLines || [], caseCargo, caseRateTable, caseCurrency, caseCurrency).total, "");

  card.innerHTML = `
    <div class="collapsible-header">
      <span class="collapsible-chevron">▸</span>
      <h4>${SEGMENT_TYPE_LABELS[segmentType]}</h4>
      <span class="collapsible-summary">${initialSummary}</span>
    </div>
    <div class="collapsible-body">
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
    </div>
  `;
  initCollapsible(card, { levelClass: "collapsible-segment" });

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

  // spec 6.5.1節A:存檔完就地更新這個段落的收折摘要(useLanes段落顯示航線數,否則顯示Subtotal),
  // 並往上通知所屬的Agent卡片一起刷新——freshFeeLines有傳就用它(剛存檔的最新資料),沒傳就重新從畫面現況算
  function refreshSegmentSummary(freshFeeLines) {
    const text = useLanesCheckbox.checked
      ? `${lanesSection.querySelectorAll(".lane-card").length}條航線`
      : formatMoney(feeLineTotals(freshFeeLines || feeLines || [], caseCargo, caseRateTable, caseCurrency, caseCurrency).total, "");
    const summaryEl = card.querySelector(":scope > .collapsible-header .collapsible-summary");
    if (summaryEl) summaryEl.innerHTML = text;
    if (onCostChanged) onCostChanged(text);
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
      card.id = `segment-card-${data.id}`;

      let incomplete = false;
      const feeLineRowsEl = feeLinesSection.querySelector(".fee-line-rows");
      if (feeLineRowsEl) {
        const result = await saveFeeLineRows(feeLineRowsEl, "segment_id", data.id, payload.default_currency, caseCargo);
        incomplete = result.incomplete;
        refreshSegmentSummary(result.feeLines);
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
    cargo: caseCargo,
  });
  renderLaneList(lanesSection, {
    getSegmentId: () => card.dataset.segmentId,
    existingLanes: lanes || [],
    defaultCurrency,
    cargo: caseCargo,
    rateTable: caseRateTable,
    quoteCurrency: caseCurrency,
    caseMode,
    onCostChanged: refreshSegmentSummary,
  });

  syncSectionVisibility();
  useLanesCheckbox.addEventListener("change", () => {
    syncSectionVisibility();
    refreshSegmentSummary();
  });

  // 掛在整張卡片上,涵蓋段落欄位跟底下所有 FeeLine 列(含動態新增的);
  // Lane 卡片巢狀在同一張卡片裡,各自也有自己的 attachAutosaveListeners,
  // 兩層都會收到 Lane 內欄位的 blur/change——這裡的段落層只是順便重存一次不變的段落設定,無害,只是多一次呼叫
  attachAutosaveListeners(card, trigger);

  container.appendChild(card);
}
