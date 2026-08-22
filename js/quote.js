// 報價分頁(spec 4):markup / 手動賣價切換、即時利潤、quoteFormat 三選一、PDF/Excel 匯出
// v4(第21節):成本/賣價/加成的內部計算恆定用 case.quote_currency 為基準(維持既有 markup 語意不變),
// 每段顯示幣別(quoteCurrencyBySegment)、利潤顯示幣別純粹是「換算後另外呈現」的顯示層,不影響加成計算本身
// 本輪(spec 4節修訂):手動輸入賣價模式下,allin 格式只顯示一個總價輸入框,segment/items 格式維持三段各自輸入,
// 兩組數字分開存在 case.manual_sell = { allin, bySegment:{export,intl,import} },互不覆蓋;
// 空運模式下賣價總額旁邊附註換算後的每KG單價,海運不顯示

// 預期利潤卡片的顯示幣別:純畫面檢視偏好,不持久化(spec:跟報價分段幣別是獨立的兩件事,不用綁在一起)
let quoteProfitCurrency = null;

// spec 第50.2節:All-in報價費率輸出樣式——費率單位的短標籤(畫面/Excel共用),以及依運輸模式篩選可選單位
// (空運→perKg;海運LCL→perCBM或perRevenueTon;海運FCL→perContainer;其餘模式不支援rate樣式,只有lumpSum)
const ALLIN_RATE_UNIT_LABELS = { perKg: "KG", perCBM: "CBM", perRevenueTon: "計費噸(Revenue Ton)", perContainer: "櫃" };
function allinRateUnitOptionsForMode(mode) {
  if (mode === "air") return ["perKg"];
  if (mode === "sea_lcl") return ["perCBM", "perRevenueTon"];
  if (mode === "sea_fcl") return ["perContainer"];
  return [];
}

function costForSegment(perSegment, segType, costBasis) {
  const opt = perSegment[segType];
  if (!opt) return 0;
  return costBasis === "subtotal" ? opt.cost.subtotal : opt.cost.total;
}

// spec 2.1/第14節第1點:quoteScope 決定這段要不要算進「這次報價」要跟客戶收的總額,
// 沒設過 quote_scope 的舊案件視同三段全收(向下相容,行為跟改動前一樣)
function isSegmentInQuoteScope(caseData, segType) {
  const scope = caseData && caseData.quote_scope;
  return !scope || scope[segType] !== false;
}

// spec 3.1:段落還沒有選定成本組合時(比較分析頁尚未選代理/Lane),金額一律視為0、不計入報價總額,
// 跟 quoteScope=false(有資料但這次報價不收這段錢)是兩種不同狀態,分開判斷、分開標示
function isSegmentUsable(ctx, segType) {
  return !!ctx.selectedCosts.perSegment[segType];
}

function segmentDisplayCurrency(caseData, state, segType) {
  return (state.quoteCurrencyBySegment && state.quoteCurrencyBySegment[segType]) || caseData.quote_currency;
}

function segCurrencySelectHtml(caseData, state, segType) {
  const currencies = caseAvailableCurrencies(caseData);
  const current = segmentDisplayCurrency(caseData, state, segType);
  return `<select class="seg-currency-select" data-segtype="${segType}">${currencies
    .map((c) => `<option value="${escapeHtml(c)}" ${c === current ? "selected" : ""}>${escapeHtml(c)}</option>`)
    .join("")}</select>`;
}

// 空運業界慣用「每公斤多少錢」快速比較報價,海運不適用(spec 4節):amount 是已經確定要顯示的金額(換算後的顯示幣別),
// 缺重量資料或非空運時不顯示任何東西
function perKgHintHtml(amount, currency, ctx) {
  if (!ctx.caseData || ctx.caseData.mode !== "air") return "";
  const w = Number((ctx.cargo && ctx.cargo.chargeableWeightKg) || 0);
  if (!w || amount == null) return "";
  return ` <span class="per-kg-hint">(≈ ${formatMoney(amount / w, currency)}/KG)</span>`;
}

// amountInQuoteCurrency 是已經算好、以 case.quote_currency 計價的金額,換算成 toCurrency 純粹供顯示用;
// 缺匯率時回傳警示 HTML,不回傳 0(spec 2.4/4節)。perKg=true 時,換算成功才附註每KG單價(空運限定)。
// cost(選填,第46節統整版):傳入該金額背後對應的cost物件(有pendingCount欄位)時,金額後面會附加
// pricing.js的pendingNoteHtml中性提示——完全沒有可算的金額時只顯示提示、不顯示容易誤解成真的是0元的0.00,
// 呼叫端只在markup模式(不是manual手動賣價)才傳這個參數,manual的賣價是使用者自己打的數字不受此限制
function convOrWarnHtml(amountInQuoteCurrency, toCurrency, ctx, perKg = false, cost = null) {
  const caseData = ctx.caseData;
  const v = convertCurrency(amountInQuoteCurrency, caseData.quote_currency, toCurrency, caseData.rate_table, caseData.quote_currency);
  if (v == null) return `<span class="cell-missing-rate">⚠ 缺匯率</span>`;
  const note = cost ? pendingNoteHtml(cost) : "";
  if (note && !v) return note;
  return formatMoney(v, "") + (perKg ? perKgHintHtml(v, toCurrency, ctx) : "") + note;
}

// basis 是 perContainer/perContainerPerDay 的費用不會走到這裡(itemsDisplayRowsForFeeLine 已經拆成逐類型的顯示列,
// 說明欄改用該類型自己的「單價 × 數量」,見 renderItemsManualInput/renderQuotePreview 呼叫端)。
// perKgBreak 的成本端費率卡(原幣別,不換算,純參考用)維持在這裡顯示——第41節要解耦的是「賣價」欄位
// (本次適用賣價,見下方 perKgBreakPendingSellRateCardHtml),不是這個成本說明欄,這裡原本就已經完整列出
// 所有級距、不受計費重量限制,只是措辭在缺重量時微調得更清楚。
function feeLineDescriptionHtml(fl, cargo) {
  const w = Number((cargo && cargo.chargeableWeightKg) || 0);
  const hasWeight = cargo && cargo.chargeableWeightKg != null && Number(cargo.chargeableWeightKg) > 0;
  if (fl.basis === "perKgBreak") {
    const applicable = hasWeight ? applicableBreakRate(fl.breaks, w) : null;
    const minCharge = fl.min_charge != null ? Number(fl.min_charge) : 0;
    const breaksHtml =
      [...(fl.breaks || [])]
        .sort((a, b) => Number(a.thresholdKg) - Number(b.thresholdKg))
        .map(
          (b) =>
            `<span style="${hasWeight && Number(b.ratePerKg) === applicable ? "font-weight:bold;text-decoration:underline" : ""}">${b.thresholdKg}kg+: ${b.ratePerKg}</span>`
        )
        .join(" / ") || "-";
    if (!hasWeight) {
      return `<span class="fee-basis-badge rate-card-pending">費率卡</span> Min charge: ${formatMoney(minCharge, "")}<br/>${breaksHtml}<br/>(尚未提供本次計費重量)`;
    }
    const byWeight = applicable * w;
    const hitMinCharge = minCharge > byWeight;
    const basisBadge = hitMinCharge
      ? `<span class="fee-basis-badge min-charge">命中最低消費</span>`
      : `<span class="fee-basis-badge by-rate">依單價計算</span>`;
    return `${basisBadge} Min charge: ${formatMoney(minCharge, "")} / 單價×重量: ${formatMoney(byWeight, "")}<br/>${breaksHtml}<br/>本次適用:${applicable}/kg × ${w}kg`;
  }
  const days = Number(fl.days || 0);
  const basisLabel =
    {
      flat: "固定",
      perShipment: `每票 × ${Number((cargo && cargo.shipmentQty) || 0)}`,
      perKg: `每KG × ${w}`,
      perPallet: `每棧板 × ${getUnitQty(cargo, "PLT")}`,
      perCarton: `每箱 × ${getUnitQty(cargo, "CTN")}`,
      perPalletPerDay: `每棧板/天 × ${getUnitQty(cargo, "PLT")} × ${days}天`,
      perChassisPerDay: `每底盤/天 × ${getUnitQty(cargo, "CHASSIS") || 1} × ${days}天`,
    }[fl.basis] || fl.basis;
  return `${fl.amount ?? 0}(${basisLabel})`;
}

// 第41節新增:perKgBreak 的「本次適用賣價」欄位,在缺計費重量時不再顯示「⚠缺計費重量,無法計算」擋住整欄,
// 改顯示完整的級距售價表(每級距成本單價×加成比例,換算成displayCurrency)+ 說明文字——這是27.2節「這批貨
// 實際金額算不算得出來」跟「費率卡能不能生成」的分野。ratio 沿用既有items格式markup模式的比例邏輯(見
// renderQuotePreview呼叫端),跟其餘bases的perContainer類型列(costForType*ratio)是同一套既有近似方式,
// 維持一致,不在這裡另外引入更精確但跟其他列不一致的換算方式。
// 只在 fl.basis==='perKgBreak' 且 !hasWeight 時被呼叫(hasWeight時走原本已經正確的 feeLineAmountIn 路徑)。
function perKgBreakPendingSellRateCardHtml(fl, ratio, displayCurrency, ctx) {
  const minCharge = fl.min_charge != null ? Number(fl.min_charge) : 0;
  const sortedBreaks = [...(fl.breaks || [])].sort((a, b) => Number(a.thresholdKg) - Number(b.thresholdKg));
  const tiersHtml =
    sortedBreaks.map((b) => `${b.thresholdKg}kg+: ${convOrWarnHtml(Number(b.ratePerKg) * ratio, displayCurrency, ctx)}/kg`).join(" / ") || "-";
  return `<span class="fee-basis-badge rate-card-pending">費率卡</span> Min charge: ${convOrWarnHtml(minCharge * ratio, displayCurrency, ctx)}<br/>${tiersHtml}<br/><span class="whatif-bracket-note">尚未提供本次計費重量,暫無法標示適用級距或算出實際總金額,此表僅供費率參考</span>`;
}

// items格式 basis 是 perContainer/perContainerPerDay 的費用(第40.1節從perUnit拆分而來),拆成
// 「一個貨櫃類型一個顯示列」(spec 第33節修正):只列這批貨 cargo.units 裡實際有數量(qty>0)的類型,
// 代理費率表裡有、這批貨用不到的類型不出現——呼應0.1節「費率表 vs 這批貨帳單」原則。
// perPallet/perCarton/perPalletPerDay/perChassisPerDay(單一費率,沒有「同時報好幾種類型」的情境)
// 維持單一列(type:null),走 feeLineDescriptionHtml 的一般路徑,跟flat/perShipment/perKg同一套。
// 回傳 [{ type, basisLabel, unitAmount, qty }]:unitAmount 是該類型的成本端單價(來自 amount_by_type),
// qty 是這批貨對應類型的登記數量(PerDay版已經把天數乘進qty裡,確保 unitAmount×qty 直接等於這個類型的
// 成本小計,供markup模式算賣價比例用;basisLabel加註"/天"提醒這個數字已經含天數)。
function itemsDisplayRowsForFeeLine(fl, cargo) {
  if (!ARRAY_TYPE_BASIS.has(fl.basis)) {
    return [{ type: null, basisLabel: fl.basis }];
  }
  const registered = new Set(registeredUnitTypes(cargo));
  const isPerDay = PER_DAY_BASIS.has(fl.basis);
  const days = isPerDay ? Number(fl.days || 0) : 1;
  return (fl.amount_by_type || [])
    .filter((t) => t.type && registered.has(t.type))
    .map((t) => ({
      type: t.type,
      basisLabel: isPerDay ? `每${containerTypeShortLabel(t.type)}/天` : `每${containerTypeShortLabel(t.type)}`,
      unitAmount: Number(t.amount || 0),
      qty: getUnitQty(cargo, t.type) * days,
    }));
}

function readLetterheadForm() {
  return {
    companyName: document.getElementById("q-lh-company").value.trim(),
    slogan: document.getElementById("q-lh-slogan").value.trim(),
    address: document.getElementById("q-lh-address").value.trim(),
    contact: document.getElementById("q-lh-contact").value.trim(),
    terms: document.getElementById("q-lh-terms").value.trim(),
  };
}

// 只讀最上層那三個下拉選單(sellMode/costBasis/quoteFormat),不碰下面動態切換的輸入區——
// 用在「決定接下來要把輸入區渲染成哪種形狀」之前,這時候輸入區的 DOM 可能還是舊的、即將被換掉
function readTopLevelQuoteControls() {
  const quoteFormat = document.getElementById("q-format").value;
  const styleEl = document.getElementById("q-allin-style");
  const unitEl = document.getElementById("q-allin-rate-unit");
  const allinOutputStyle = quoteFormat === "allin" && styleEl ? styleEl.value : "lumpSum";
  return {
    sellMode: document.getElementById("q-sell-mode").value,
    costBasis: document.getElementById("q-cost-basis").value,
    quoteFormat,
    allinOutputStyle,
    allinRateUnit: allinOutputStyle === "rate" && unitEl && unitEl.value ? unitEl.value : null,
  };
}

// 完整讀取目前畫面上的報價設定,包含下面動態輸入區(呼叫前輸入區必須已經渲染成跟 sellMode/quoteFormat 相符的形狀)
function readQuoteFormState() {
  const top = readTopLevelQuoteControls();
  const perSegment = {};
  let manualAllinValue = null;
  let manualAllinRateValue = null;
  let manualByItemValues = null;

  if (top.sellMode === "manual" && top.quoteFormat === "allin" && top.allinOutputStyle === "rate") {
    // spec 第50.2節:allin+rate樣式的手動輸入是「固定費率」,不是總金額,跟現有manual_sell.allin分開存
    const input = document.querySelector(".q-manual-sell-allin-rate");
    manualAllinRateValue = input ? Number(input.value || 0) : 0;
  } else if (top.sellMode === "manual" && top.quoteFormat === "allin") {
    const input = document.querySelector(".q-manual-sell-allin");
    manualAllinValue = input ? Number(input.value || 0) : 0;
  } else if (top.sellMode === "manual" && top.quoteFormat === "items") {
    // items格式手動賣價(spec 4節/第32節新增):細到每筆FeeLine各自一個輸入框+各自可選幣別,
    // 用同一列(tr)裡的金額輸入框找對應的幣別下拉,不靠id字串拼querySelector(fee_line的id是uuid,拼字串較脆弱)
    manualByItemValues = {};
    document.querySelectorAll(".q-manual-sell-item").forEach((input) => {
      const flId = input.dataset.feeLineId;
      const row = input.closest("tr");
      const currencySelect = row ? row.querySelector(".q-manual-sell-item-currency") : null;
      manualByItemValues[flId] = { amount: Number(input.value || 0), currency: currencySelect ? currencySelect.value : null };
    });
    // perContainer/perContainerPerDay(spec第33/40.1節):一個貨櫃類型一個輸入列,同一個feeLineId底下收集成byType陣列,
    // 取代上面單一amount/currency的寫法(兩者互斥,一筆FeeLine只會落在其中一種DOM結構裡)
    const byTypeMap = {};
    document.querySelectorAll(".q-manual-sell-item-type").forEach((input) => {
      const flId = input.dataset.feeLineId;
      const type = input.dataset.type;
      const row = input.closest("tr");
      const currencySelect = row ? row.querySelector(".q-manual-sell-item-type-currency") : null;
      if (!byTypeMap[flId]) byTypeMap[flId] = [];
      byTypeMap[flId].push({ type, amount: Number(input.value || 0), currency: currencySelect ? currencySelect.value : null });
    });
    Object.keys(byTypeMap).forEach((flId) => {
      manualByItemValues[flId] = { byType: byTypeMap[flId] };
    });
  } else {
    SEGMENT_TYPES.forEach((t) => {
      if (top.sellMode === "manual") {
        const input = document.querySelector(`.q-manual-sell[data-segtype="${t}"]`);
        perSegment[t] = { manualValue: input ? Number(input.value || 0) : 0 };
      } else {
        const modeSel = document.querySelector(`.q-markup-mode[data-segtype="${t}"]`);
        const valInput = document.querySelector(`.q-markup-value[data-segtype="${t}"]`);
        perSegment[t] = { markupMode: modeSel ? modeSel.value : "percent", markupValue: valInput ? Number(valInput.value || 0) : 0 };
      }
    });
  }

  return { ...top, perSegment, manualAllinValue, manualAllinRateValue, manualByItemValues };
}

function renderSegmentRows(tbody, { selectedCosts, sellMode, costBasis, markup, manualSell, caseData }) {
  tbody.innerHTML = SEGMENT_TYPES.map((t) => {
    const opt = selectedCosts.perSegment[t];
    const cost = costForSegment(selectedCosts.perSegment, t, costBasis);
    // spec 3.1:「尚未選定」(比較分析頁還沒挑代理/Lane)跟 quoteScope=false(有資料但這次報價不收)是兩種不同狀態,
    // 兩者都不計入總價、都用同一套灰階樣式呈現,但標籤文字要分開,不能讓使用者誤以為兩者是同一回事
    const notSelected = !opt;
    const included = isSegmentInQuoteScope(caseData, t) && !notSelected;
    const rowClass = included ? "" : ' class="scope-excluded-row"';
    // 這裡的警示涵蓋兩種情況(spec 2.4/4/27.2節):缺匯率(FeeLine原始幣別在rateTable查不到)、
    // 或缺必要的貨量資訊(票數/計費重量/對應貨量單位)導致部分費用根本無法計算,兩種都表示下面的 cost/賣價/利潤不完整
    const missingBadge = opt ? costWarningBadgeHtml(opt.cost) : "";
    const statusBadge = notSelected
      ? ` <span class="scope-excluded-badge">(尚未選定)</span>`
      : included
        ? ""
        : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`;
    const label = SEGMENT_TYPE_LABELS[t] + statusBadge + missingBadge;
    if (sellMode === "manual") {
      const val = manualSell[t] != null ? manualSell[t] : "";
      return `
        <tr${rowClass}>
          <td>${label}</td>
          <td>${formatCostAmount(cost, opt ? opt.cost : null, "")}</td>
          <td><input type="number" step="0.01" class="q-manual-sell" data-segtype="${t}" value="${val}" style="width: 120px" /></td>
          <td class="q-sell-display" data-segtype="${t}">-</td>
        </tr>`;
    }
    const setting = markup[t] || { mode: "percent", value: 0 };
    return `
      <tr${rowClass}>
        <td>${label}</td>
        <td>${formatCostAmount(cost, opt ? opt.cost : null, "")}</td>
        <td>
          <select class="q-markup-mode" data-segtype="${t}" style="width: 90px">
            <option value="percent" ${setting.mode === "percent" ? "selected" : ""}>%</option>
            <option value="fixed" ${setting.mode === "fixed" ? "selected" : ""}>固定金額</option>
          </select>
          <input type="number" step="0.01" class="q-markup-value" data-segtype="${t}" value="${setting.value ?? 0}" style="width: 90px" />
        </td>
        <td class="q-sell-display" data-segtype="${t}">-</td>
      </tr>`;
  }).join("");
}

// allin + 手動輸入賣價的特殊情境(spec 4節,本輪修訂重點):不像 markup 模式或 segment/items 格式那樣列三段,
// 只顯示「選定組合總成本(供參考)」+「報價總價」單一輸入框,使用者直接打這次要跟客戶收多少錢的總數
function renderAllinManualInput(container, { ctx, state, costBasis }) {
  let totalCost = 0;
  SEGMENT_TYPES.forEach((t) => {
    if (isSegmentInQuoteScope(ctx.caseData, t)) totalCost += costForSegment(ctx.selectedCosts.perSegment, t, costBasis);
  });
  const quoteCurrency = ctx.caseData.quote_currency;
  container.innerHTML = `
    <div class="form-grid">
      <div class="field-inline">
        <label>選定組合總成本(${escapeHtml(quoteCurrency)},供參考)</label>
        <div style="padding-top: 6px">${formatCostAmount(totalCost, ctx.selectedCosts, "")}</div>
      </div>
      <div class="field-inline">
        <label>報價總價(手動輸入,${escapeHtml(quoteCurrency)})</label>
        <input type="number" step="0.01" class="q-manual-sell-allin" value="${state.manualSellAllin ?? ""}" style="width: 160px" />
      </div>
    </div>
  `;
}

// spec 第50.2節:allin格式+輸出樣式='rate'+手動輸入賣價的情境——跟lumpSum的renderAllinManualInput()
// 平行存在(互斥,quoteFormat/allinOutputStyle只會落在其中一種),差別是這裡打的是一個費率(每unit),
// 不是總金額。若這批貨剛好已知對應的驅動數字(重量/材積/櫃數),額外顯示「預估總金額」參考資訊——
// 跟lumpSum模式角色互換:這裡總金額只是參考,費率才是報價主體(spec原文)
function renderAllinRateManualInput(container, { ctx, state, top }) {
  const unit = top.allinRateUnit;
  const unitLabel = ALLIN_RATE_UNIT_LABELS[unit] || "";
  const divisor = unit ? allinRateDivisor(unit, ctx.cargo) : null;
  const quoteCurrency = ctx.caseData.quote_currency;
  const rateValue = state.manualSellAllinRate;
  const refHtml =
    divisor != null && rateValue != null
      ? `<p style="font-size: 12px; color: var(--color-text-muted)">若本批貨為 ${formatMoney(divisor, "")}${escapeHtml(unitLabel)},預估總金額為 ${formatMoney(rateValue * divisor, quoteCurrency)}</p>`
      : "";
  container.innerHTML = `
    <div class="form-grid">
      <div class="field-inline">
        <label>固定費率(手動輸入,${escapeHtml(quoteCurrency)}/${escapeHtml(unitLabel)})</label>
        <input type="number" step="0.0001" class="q-manual-sell-allin-rate" value="${rateValue ?? ""}" style="width: 160px" />
      </div>
    </div>
    ${refHtml}
  `;
}

// items格式手動賣價(spec 4節/第32節新增):不像markup模式或allin/segment格式那樣是段落層級一個數字,
// 這裡細到每一筆FeeLine各自一個輸入框、各自可選幣別——實務上同一段內不同費用常常要用不同幣別報給客戶。
// 逐筆金額是使用者自己輸入的原幣別數字,不經過rateTable換算;段落小計才透過rateTable換算成統一幣別呈現
// (由 recomputeAndRender 即時更新 .q-item-segment-subtotal),兩者並存、不互相覆蓋。
function renderItemsManualInput(container, { ctx, state }) {
  const caseData = ctx.caseData;
  const currencies = caseAvailableCurrencies(caseData);
  const byItem = state.manualSellByItem || {};

  container.innerHTML = SEGMENT_TYPES.map((t) => {
    const opt = ctx.selectedCosts.perSegment[t];
    if (!opt) {
      return `<div class="card" style="margin-top: 10px"><h4>${SEGMENT_TYPE_LABELS[t]}</h4><p class="empty-state">尚未選定成本組合</p></div>`;
    }
    const rows = (opt.feeLines || [])
      .flatMap((fl) => {
        const saved = byItem[fl.id];
        const displayRows = itemsDisplayRowsForFeeLine(fl, ctx.cargo);
        return displayRows.map((dr) => {
          if (dr.type) {
            // perContainer/perContainerPerDay(spec第33/40.1節):一個貨櫃類型一個輸入列,金額是該類型的單價(跟成本端amountByType同語意),
            // 說明欄顯示成本端的單價×數量供對照,不是賣價本身
            const savedType = saved && saved.byType ? saved.byType.find((x) => x.type === dr.type) : null;
            const amount = savedType && savedType.amount != null ? savedType.amount : "";
            const currency = (savedType && savedType.currency) || fl.currency;
            return `
              <tr>
                <td>${escapeHtml(fl.name)}${fl.certainty === "possible" ? " <em>(possible)</em>" : ""}</td>
                <td>${escapeHtml(dr.basisLabel)}</td>
                <td>${dr.unitAmount} × ${dr.qty}</td>
                <td>
                  <input type="number" step="0.01" class="q-manual-sell-item-type" data-fee-line-id="${fl.id}" data-type="${escapeHtml(dr.type)}" value="${amount}" style="width: 100px" />
                  <select class="q-manual-sell-item-type-currency" data-fee-line-id="${fl.id}" data-type="${escapeHtml(dr.type)}">
                    ${currencies.map((c) => `<option value="${escapeHtml(c)}" ${c === currency ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
                  </select>
                </td>
              </tr>`;
          }
          const amount = saved && saved.amount != null ? saved.amount : "";
          const currency = (saved && saved.currency) || fl.currency;
          // manual模式的賣價本來就是使用者自己打一個數字,不受計費重量限制(見下方輸入框);
          // perKgBreak的說明欄沿用 feeLineDescriptionHtml 的成本端費率卡(第41節已改成永遠完整顯示,
          // 不受計費重量限制)供輸入時對照參考
          return `
            <tr>
              <td>${escapeHtml(fl.name)}${fl.certainty === "possible" ? " <em>(possible)</em>" : ""}</td>
              <td>${dr.basisLabel}</td>
              <td>${feeLineDescriptionHtml(fl, ctx.cargo)}</td>
              <td>
                <input type="number" step="0.01" class="q-manual-sell-item" data-fee-line-id="${fl.id}" value="${amount}" style="width: 100px" />
                <select class="q-manual-sell-item-currency" data-fee-line-id="${fl.id}">
                  ${currencies.map((c) => `<option value="${escapeHtml(c)}" ${c === currency ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
                </select>
              </td>
            </tr>`;
        });
      })
      .join("");
    return `
      <div class="card" style="margin-top: 10px">
        <h4>${SEGMENT_TYPE_LABELS[t]}${opt.label ? " — " + escapeHtml(opt.label) : ""}</h4>
        <table style="width: 100%; font-size: 13px">
          <thead><tr><th style="text-align: left">費用項目</th><th style="text-align: left">Basis</th><th style="text-align: left">說明</th><th style="text-align: left">賣價(逐筆選幣別)</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4">(無費用項目)</td></tr>`}</tbody>
        </table>
        <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 6px">
          段落小計(已換算為 ${escapeHtml(segmentDisplayCurrency(caseData, state, t))}):<span class="q-item-segment-subtotal" data-segtype="${t}">-</span>
        </p>
      </div>`;
  }).join("");
}

// 依目前 sellMode/quoteFormat 組合,決定「賣價輸入區」要渲染成哪種形狀——
// markup 模式(不管哪種格式)、或 manual+segment:三段各自一列的表格(既有行為不變)
// manual+allin:單一總價輸入框(spec 4節這次修的bug);manual+items:逐筆FeeLine各自輸入框+幣別(spec 4節/第32節新增)
function renderSellInputArea(container, { ctx, state, top }) {
  const isAllinRateManual = top.sellMode === "manual" && top.quoteFormat === "allin" && top.allinOutputStyle === "rate";
  const isAllinManual = top.sellMode === "manual" && top.quoteFormat === "allin" && top.allinOutputStyle !== "rate";
  const isItemsManual = top.sellMode === "manual" && top.quoteFormat === "items";
  if (isAllinRateManual) {
    renderAllinRateManualInput(container, { ctx, state, top });
    return;
  }
  if (isAllinManual) {
    renderAllinManualInput(container, { ctx, state, costBasis: top.costBasis });
    return;
  }
  if (isItemsManual) {
    renderItemsManualInput(container, { ctx, state });
    return;
  }
  container.innerHTML = `
    <table style="width: 100%; font-size: 13px">
      <thead>
        <tr><th style="text-align: left">段落</th><th style="text-align: left">成本</th><th style="text-align: left">加成設定 / 手動賣價</th><th style="text-align: left">賣價</th></tr>
      </thead>
      <tbody id="q-segment-rows"></tbody>
    </table>
  `;
  renderSegmentRows(document.getElementById("q-segment-rows"), {
    selectedCosts: ctx.selectedCosts,
    sellMode: top.sellMode,
    costBasis: top.costBasis,
    markup: state.markup,
    manualSell: state.manualSellBySegment,
    caseData: ctx.caseData,
  });
}

// sells/sumCost/sumSell 都是以 case.quote_currency 計算好的內部基準金額(維持既有 markup 語意不變,不受顯示幣別影響),
// 這裡才依 quoteCurrencyBySegment / quoteProfitCurrency 換算成使用者選的顯示幣別呈現(spec 第21節)
// allinRateResult(選填,spec第50.2節):quoteFormat='allin'且allinOutputStyle='rate'時傳入,見computeAllinRate()
function renderQuotePreview(ctx, state, formState, sells, sumCost, sumSell, allinRateResult) {
  const lh = readLetterheadForm();
  const cargo = ctx.cargo || {};
  const caseData = ctx.caseData;
  const quoteCurrency = caseData.quote_currency;
  const rateTable = caseData.rate_table;
  const unitsText = (cargo.units || []).map((u) => `${u.type} x${u.qty}`).join("、") || "-";
  const isAllinManual = formState.sellMode === "manual" && formState.quoteFormat === "allin";

  const anyMissingRate =
    !isAllinManual &&
    SEGMENT_TYPES.some(
      (t) =>
        isSegmentInQuoteScope(caseData, t) &&
        ctx.selectedCosts.perSegment[t] &&
        (ctx.selectedCosts.perSegment[t].cost.missingRate || ctx.selectedCosts.perSegment[t].cost.incompleteCount)
    );

  // 第46節統整版(取代原本第41節的「整段100%是perKgBreak」全有全無判斷):markup模式下,選定組合裡
  // 只要有任一段驅動數字還沒填(ctx.selectedCosts.pendingCount>0),報價總價就不能顯示一個容易被誤解成
  // 「算好的完整數字」的金額——改顯示「依實際計費重量另計」。這裡天然涵蓋「整段都pending」「混合
  // flat+perKgBreak只有部分pending」「perShipment缺票數」等所有情況,不用針對每種組合各寫一個判斷式。
  // manual模式的賣價是使用者自己打的數字,不受這個限制。
  const totalPending = formState.sellMode === "markup" && ctx.selectedCosts.pendingCount > 0;
  const pendingRateCardNoteHtml = `<span class="whatif-bracket-note">依實際計費重量另計</span>`;

  let bodyHtml;
  if (formState.quoteFormat === "allin" && formState.allinOutputStyle === "rate") {
    // spec 第50.2節:報價本身就是一個費率數字,不強制需要知道最終總量——跟lumpSum模式角色互換,
    // 費率是報價主體,估計總金額(divisor已知時才有)只是附加參考,見computeAllinRate()
    const r = allinRateResult || { rate: null, unit: formState.allinRateUnit, divisor: null, missingRate: false, excludedNames: [], estimatedTotal: null };
    const unitLabel = ALLIN_RATE_UNIT_LABELS[r.unit] || "";
    const rateCellHtml = r.rate == null ? pendingRateCardNoteHtml : `${formatMoney(r.rate, quoteCurrency)}/${escapeHtml(unitLabel)}`;
    const excludedNote =
      r.excludedNames && r.excludedNames.length
        ? `<div class="whatif-bracket-note">含${r.excludedNames.length}筆需知道實際貨量才能算入:${escapeHtml(r.excludedNames.join("、"))}</div>`
        : "";
    const refRow =
      r.estimatedTotal != null
        ? `<tr><td>預估總金額(若本批貨為 ${formatMoney(r.divisor, "")}${escapeHtml(unitLabel)})</td><td>${formatMoney(r.estimatedTotal, quoteCurrency)}</td></tr>`
        : "";
    const familyRows = formState.sellMode === "markup" ? computeAllinRateFamilyComparisonRows(ctx, formState) : [];
    bodyHtml = `
      <table>
        <tr><th>項目</th><th>金額</th></tr>
        <tr><td>報價費率${r.missingRate ? ` <span class="cell-missing-rate">⚠ 部分費用缺匯率</span>` : ""}</td><td>${rateCellHtml}${excludedNote}</td></tr>
        ${refRow}
      </table>
      ${renderAllinRateFamilyComparisonHtml(familyRows, quoteCurrency)}`;
  } else if (formState.quoteFormat === "allin") {
    // allin 格式只有單一總數字,不適用分段幣別,統一用 case.quote_currency(spec 4節)
    const sellCellHtml = totalPending
      ? pendingRateCardNoteHtml
      : `${formatMoney(sumSell, quoteCurrency)}${perKgHintHtml(sumSell, quoteCurrency, ctx)}`;
    bodyHtml = `
      <table>
        <tr><th>項目</th><th>金額</th></tr>
        <tr><td>報價總價${anyMissingRate ? ` <span class="cell-missing-rate">⚠ 部分費用缺匯率或資料不完整,此總價不完整</span>` : ""}</td><td>${sellCellHtml}</td></tr>
      </table>`;
  } else if (formState.quoteFormat === "segment") {
    bodyHtml = `
      <table>
        <tr><th>段落</th><th>幣別</th><th>金額</th></tr>
        ${SEGMENT_TYPES.map((t) => {
          const opt = ctx.selectedCosts.perSegment[t];
          const notSelected = !opt;
          const included = isSegmentInQuoteScope(caseData, t) && !notSelected;
          const missingBadge = opt ? costWarningBadgeHtml(opt.cost) : "";
          const statusBadge = notSelected
            ? ` <span class="scope-excluded-badge">(尚未選定)</span>`
            : included
              ? ""
              : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`;
          const label = SEGMENT_TYPE_LABELS[t] + statusBadge + missingBadge;
          const displayCurrency = segmentDisplayCurrency(caseData, state, t);
          const pendingCost = formState.sellMode === "markup" && opt ? opt.cost : null;
          // 空運每KG輔助顯示只加在國際運輸段(spec 4節:業界慣用每KG快速比較的是主運費這一段)
          const sellCell = convOrWarnHtml(sells[t], displayCurrency, ctx, t === "intl", pendingCost);
          return `<tr${included ? "" : ' class="scope-excluded-row"'}><td>${label}</td><td>${segCurrencySelectHtml(caseData, state, t)}</td><td>${sellCell}</td></tr>`;
        }).join("")}
        <tr><td colspan="2"><strong>總計(${escapeHtml(quoteCurrency)})</strong></td><td><strong>${totalPending ? pendingRateCardNoteHtml : formatMoney(sumSell, quoteCurrency)}</strong></td></tr>
      </table>`;
  } else {
    // items格式:markup模式沿用「段落賣價÷段落成本」的比例套用邏輯,逐筆換算成同一顯示幣別;
    // manual模式(spec 4節/第32節新增)改成直接讀取每筆FeeLine自己輸入的賣價金額+幣別,不透過比例反推——
    // 這正是這個模式存在的意義,讓同一段內不同費用可以各自用不同幣別報給客戶,逐筆維持原幣別顯示,
    // 只有段落小計那一列才透過rateTable換算成統一幣別(並標示「已換算」,呼應第4節的說明文字要求)
    const isManualItems = formState.sellMode === "manual";
    bodyHtml =
      SEGMENT_TYPES.map((t) => {
        const opt = ctx.selectedCosts.perSegment[t];
        if (!opt) return `<p>${SEGMENT_TYPE_LABELS[t]}:尚未選定成本組合</p>`;
        const included = isSegmentInQuoteScope(caseData, t);
        const scopeBadge = included ? "" : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`;
        const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
        const ratio = cost !== 0 ? sells[t] / cost : 1;
        const displayCurrency = segmentDisplayCurrency(caseData, state, t);
        const rows = (opt.feeLines || [])
          .flatMap((fl) => {
            const displayRows = itemsDisplayRowsForFeeLine(fl, cargo);
            return displayRows.map((dr) => {
              let displayHtml;
              let descriptionHtml;
              if (dr.type) {
                // perContainer/perContainerPerDay(spec第33/40.1節):Basis具體化成「每40'HQ」,一個類型一列,不再顯示generic代號
                descriptionHtml = `${dr.unitAmount} × ${dr.qty}`;
                if (isManualItems) {
                  const entry = formState.manualByItemValues ? formState.manualByItemValues[fl.id] : null;
                  const bt = entry && entry.byType ? entry.byType.find((x) => x.type === dr.type) : null;
                  const rate = bt ? Number(bt.amount || 0) : 0;
                  const itemCurrency = (bt && bt.currency) || fl.currency;
                  displayHtml = formatMoney(rate * dr.qty, itemCurrency);
                } else {
                  const costForType = dr.unitAmount * dr.qty;
                  displayHtml = convOrWarnHtml(costForType * ratio, displayCurrency, ctx);
                }
              } else {
                descriptionHtml = feeLineDescriptionHtml(fl, cargo);
                if (isManualItems) {
                  const entry = formState.manualByItemValues ? formState.manualByItemValues[fl.id] : null;
                  const amount = entry ? Number(entry.amount || 0) : 0;
                  const itemCurrency = (entry && entry.currency) || fl.currency;
                  displayHtml = formatMoney(amount, itemCurrency);
                } else {
                  // 先算這筆 FeeLine 在 quote_currency 下的基準金額,乘上這段的加成比例(維持既有 markup 分攤邏輯),
                  // 最後才換算成這段選定的顯示幣別——換算永遠是最後一步,不影響 ratio 本身怎麼算出來的
                  const r = feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, quoteCurrency);
                  // 第46節統整版(取代原本第41節只限perKgBreak的特判):r.pending時是中性的「驅動數字還沒填」
                  // 狀態,不再顯示紅色⚠——perKgBreak維持顯示完整的級距售價費率卡(比單純文字提示更有資訊量,
                  // 是既有做對的部分不用改),其餘basis(如perShipment缺票數)一樣用中性措辭呈現
                  displayHtml = r.pending
                    ? fl.basis === "perKgBreak"
                      ? perKgBreakPendingSellRateCardHtml(fl, ratio, displayCurrency, ctx)
                      : `<span class="whatif-bracket-note">未定:${escapeHtml(r.reason)}</span>`
                    : r.incomplete
                      ? `<span class="cell-missing-rate">⚠ ${escapeHtml(r.reason)}</span>`
                      : r.missingRate
                        ? `<span class="cell-missing-rate">⚠ 缺匯率</span>`
                        : convOrWarnHtml(r.amount * ratio, displayCurrency, ctx);
                }
              }
              return `
                <tr>
                  <td>${escapeHtml(fl.name)}${fl.certainty === "possible" ? " <em>(possible)</em>" : ""}</td>
                  <td>${escapeHtml(dr.basisLabel)}</td>
                  <td>${descriptionHtml}</td>
                  <td>${displayHtml}</td>
                </tr>`;
            });
          })
          .join("");
        const subtotalLabel = isManualItems ? `小計(已換算為${escapeHtml(displayCurrency)})` : "小計";
        const subtotalMissingBadge =
          isManualItems && formState.itemsManualMissingRateBySeg && formState.itemsManualMissingRateBySeg[t]
            ? ` <span class="cell-missing-rate">⚠ 部分項目缺匯率,未計入小計</span>`
            : "";
        return `
          <h4>${SEGMENT_TYPE_LABELS[t]}${opt.label ? " — " + escapeHtml(opt.label) : ""}${scopeBadge} ${segCurrencySelectHtml(caseData, state, t)}</h4>
          <table>
            <tr><th>費用項目</th><th>Basis</th><th>說明</th><th>本次適用賣價${isManualItems ? "(逐筆原幣別)" : `(${escapeHtml(displayCurrency)})`}</th></tr>
            ${rows}
            <tr><td colspan="3"><strong>${subtotalLabel}</strong></td><td><strong>${convOrWarnHtml(sells[t], displayCurrency, ctx, t === "intl", isManualItems ? null : opt.cost)}</strong>${subtotalMissingBadge}</td></tr>
          </table>`;
      }).join("") +
      `<p><strong>總計(${escapeHtml(quoteCurrency)}):${totalPending ? pendingRateCardNoteHtml : formatMoney(sumSell, quoteCurrency)}</strong></p>`;
  }

  const preview = document.getElementById("quote-preview");
  preview.innerHTML = `
    ${lh.companyName ? `<h2>${escapeHtml(lh.companyName)}</h2>` : ""}
    ${lh.slogan ? `<p>${escapeHtml(lh.slogan)}</p>` : ""}
    ${lh.address ? `<p>${escapeHtml(lh.address)}</p>` : ""}
    ${lh.contact ? `<p>${escapeHtml(lh.contact)}</p>` : ""}
    <hr />
    <p><strong>案件:</strong>${escapeHtml(caseData.ref || "")} ${escapeHtml(caseData.name || "")}</p>
    <p><strong>航線:</strong>${escapeHtml(caseData.origin || "")} → ${escapeHtml(caseData.destination || "")}(${MODE_LABELS[caseData.mode] || caseData.mode})</p>
    <p><strong>貨量:</strong>${escapeHtml(unitsText)}${cargo.chargeableWeightKg != null ? `,計費重量 ${cargo.chargeableWeightKg}KG` : ""}${cargo.shipmentQty != null ? `,${cargo.shipmentQty} 票` : ""}</p>
    ${bodyHtml}
    ${lh.terms ? `<hr /><p style="font-size: 12px; color: #555">${escapeHtml(lh.terms)}</p>` : ""}
  `;
}

// allinRateResult(選填,spec第50.2節):allin+rate輸出樣式時傳入,額外顯示費率本身(不受sumSell是否
// 可算影響——這正是rate樣式的意義:費率不強制需要知道最終總量,見computeAllinRate())
function renderProfitCards(ctx, sumCostQC, sumSellQC, profitQC, marginPct, sellMode, allinRateResult) {
  const caseData = ctx.caseData;
  const displayCurrency = quoteProfitCurrency && caseAvailableCurrencies(caseData).includes(quoteProfitCurrency) ? quoteProfitCurrency : caseData.quote_currency;
  const sumCost = convertCurrency(sumCostQC, caseData.quote_currency, displayCurrency, caseData.rate_table, caseData.quote_currency);
  // spec 50.2節:rate輸出樣式下,驅動數字未知時sumSellQC是null——這不是缺匯率,是這批貨的量還不確定,
  // 跟既有的missing(真的缺匯率)分開判斷,沿用46節pending中性提示,不套用⚠警示樣式
  const totalUnavailable = sumSellQC == null;
  const sumSell = totalUnavailable ? null : convertCurrency(sumSellQC, caseData.quote_currency, displayCurrency, caseData.rate_table, caseData.quote_currency);
  const missing = sumCost == null || (!totalUnavailable && sumSell == null);
  const profit = missing || totalUnavailable ? null : sumSell - sumCost;
  // 第46節統整版:markup模式下,選定組合裡只要有任一段驅動數字還沒填,總成本/報價總價/預期利潤這幾張卡片
  // 也不能顯示容易被誤解成算好的完整數字的金額——跟畫面下方報價明細的「依實際計費重量另計」是同一套判斷
  const pending = !missing && ((sellMode === "markup" && ctx.selectedCosts.pendingCount > 0) || totalUnavailable);
  const pendingHtml = `<span class="whatif-bracket-note">依實際計費重量另計</span>`;

  const rateLineHtml = allinRateResult
    ? `<div style="font-size: 13px; margin-top: 4px">${
        allinRateResult.rate == null
          ? pendingHtml
          : `費率 ${formatMoney(allinRateResult.rate, displayCurrency)}/${escapeHtml(ALLIN_RATE_UNIT_LABELS[allinRateResult.unit] || "")}`
      }</div>`
    : "";

  const currencies = caseAvailableCurrencies(caseData);
  document.getElementById("q-profit-cards").innerHTML = `
    <div class="overview-card"><div class="label">總成本</div><div class="value">${sumCost == null ? "⚠ 缺匯率" : formatMoney(sumCost, displayCurrency)}</div></div>
    <div class="overview-card"><div class="label">報價總價</div><div class="value">${missing ? "⚠ 缺匯率" : pending ? pendingHtml : formatMoney(sumSell, displayCurrency) + perKgHintHtml(sumSell, displayCurrency, ctx)}</div>${rateLineHtml}</div>
    <div class="overview-card profit">
      <div class="label">
        預期利潤
        <span class="currency-selector" style="display: inline-flex; margin-left: 8px">
          <select id="q-profit-currency-select">${currencies.map((c) => `<option value="${escapeHtml(c)}" ${c === displayCurrency ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        </span>
      </div>
      <div class="value">${missing ? "⚠ 缺匯率" : pending ? pendingHtml : `${formatMoney(profit, displayCurrency)}(${marginPct.toFixed(1)}%)`}</div>
    </div>
  `;
  document.getElementById("q-profit-currency-select").addEventListener("change", (event) => {
    quoteProfitCurrency = event.target.value;
    recomputeAndRenderCurrent();
  });
}

// spec 第50.2節:All-in報價選「費率」輸出樣式時的整體計算——回傳
// { unit, divisor, rate, missingRate, pending, excludedNames, estimatedTotal }。
// divisor(這批貨目前是否已知重量/材積/櫃數)決定走哪條路:
// - manual模式:rate直接是使用者打的固定費率,不受divisor影響(divisor有值時額外算estimatedTotal供參考)
// - markup模式+divisor已知:沿用既有markup算法算出sumSell(跟lumpSum模式完全一樣,只是不顯示成lumpSum),
//   rate = sumSell ÷ divisor(數學上跟48.2節逐段混合成本算法等價,規劃時已推導確認)
// - markup模式+divisor未知:只有perKg單位能靠weightIndependentRatePerKg()盡量算(pricing.js),
//   markupMode='fixed'的段落無法換算成per-unit影響,視為不可算(跟該段本身data不全是同一種pending狀態)
function computeAllinRate(ctx, formState) {
  const unit = formState.allinRateUnit;
  const caseData = ctx.caseData;
  const divisor = unit ? allinRateDivisor(unit, ctx.cargo) : null;

  if (formState.sellMode === "manual") {
    const rate = formState.manualAllinRateValue;
    return {
      unit,
      divisor,
      rate,
      missingRate: false,
      pending: rate == null,
      excludedNames: [],
      estimatedTotal: divisor != null && rate != null ? rate * divisor : null,
    };
  }

  if (divisor != null) {
    let sumSell = 0;
    let anyUsable = false;
    let pending = false;
    SEGMENT_TYPES.forEach((t) => {
      if (!isSegmentInQuoteScope(caseData, t) || !isSegmentUsable(ctx, t)) return;
      anyUsable = true;
      const opt = ctx.selectedCosts.perSegment[t];
      if (opt.cost.pendingCount > 0) pending = true;
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      const { markupMode, markupValue } = formState.perSegment[t] || { markupMode: "percent", markupValue: 0 };
      sumSell += markupMode === "fixed" ? cost + markupValue : cost * (1 + markupValue / 100);
    });
    pending = pending || !anyUsable;
    return {
      unit,
      divisor,
      rate: pending ? null : sumSell / divisor,
      missingRate: false,
      pending,
      excludedNames: [],
      estimatedTotal: pending ? null : sumSell,
    };
  }

  // 驅動數字未知:只有perKg單位有天生線性/固定比例的計價基礎可以嘗試算(見pricing.js的
  // weightIndependentRatePerKg註解),perCBM/perRevenueTon/perContainer目前沒有任何basis是這樣,
  // 沒有divisor就真的算不出來
  if (unit !== "perKg") {
    return { unit, divisor: null, rate: null, missingRate: false, pending: true, excludedNames: [], estimatedTotal: null };
  }
  let rate = 0;
  // 跟divisor已知那條路徑不同:這裡anyUsable不能只看「段落有沒有選定」,要看「這個段落最後真的有貢獻
  // 到rate」——整段markupMode='fixed'的段落雖然isSegmentUsable()是true,但完全無法換算成per-unit影響
  // (見上面註解),不能算「usable」,不然唯一段落被排除時rate會誤算成0(有算出東西)而不是null(未定)
  let anyContributed = false;
  let missingRate = false;
  const excludedNames = [];
  SEGMENT_TYPES.forEach((t) => {
    if (!isSegmentInQuoteScope(caseData, t) || !isSegmentUsable(ctx, t)) return;
    const opt = ctx.selectedCosts.perSegment[t];
    const { markupMode, markupValue } = formState.perSegment[t] || { markupMode: "percent", markupValue: 0 };
    if (markupMode === "fixed") {
      excludedNames.push(`${SEGMENT_TYPE_LABELS[t]}(整段固定加成,需知道實際貨量才能換算)`);
      return;
    }
    const r = weightIndependentRatePerKg(opt.feeLines, caseData.rate_table, caseData.quote_currency, caseData.quote_currency);
    if (r.missingRate) missingRate = true;
    excludedNames.push(...r.excludedNames);
    rate += r.ratePerKg * (1 + markupValue / 100);
    anyContributed = true;
  });
  return { unit, divisor: null, rate: anyContributed ? rate : null, missingRate, pending: !anyContributed, excludedNames, estimatedTotal: null };
}

// spec 第50.2節末段:若鎖定選用的段落含47.1節可能成本互斥家族,並排比較「這個家族選別的選項值」對
// 整體All-in費率的影響——只變動被比較的那個家族,其他段落/家族維持ctx.selectedCosts目前鎖定的real
// state不變,沿用comparison.js computeWhatIfTable既有的fan-out精神,套用在跨段落彙總後的單一費率上。
// opt.optionFamilies是segmentOptions()已經算好的現成資料(見pricing.js),不用重新掃一次feeLines。
function segmentCostWithFamilyOverride(ctx, segType, familyName, value) {
  const sel = ctx.selection[segType];
  const agent = sel && ctx.agents.find((a) => a.id === sel.agentId);
  const segment = agent && agent.segmentsByType[segType];
  if (!segment) return null;
  const excludedIds = sel.excludedFeeLineIds || [];
  const overrideState = { familyChoices: { [familyName]: value }, excludedIds };
  return segmentOptions(
    segment,
    ctx.cargo,
    ctx.caseData.rate_table,
    ctx.caseData.quote_currency,
    ctx.caseData.quote_currency,
    (laneId) => ((laneId || null) === (sel.laneId || null) ? overrideState : { familyChoices: {}, excludedIds: [] })
  ).find((o) => (o.laneId || null) === (sel.laneId || null));
}

// 回傳[{label, result}],result跟computeAllinRate()同形狀——只在有option family時才有內容,
// 呼叫端沒有資料時不顯示這個比較表,不干擾沒用到47.1節這個機制的一般案件
function computeAllinRateFamilyComparisonRows(ctx, formState) {
  const rows = [];
  SEGMENT_TYPES.forEach((segType) => {
    const opt = ctx.selectedCosts.perSegment[segType];
    if (!opt || !isSegmentInQuoteScope(ctx.caseData, segType)) return;
    const families = opt.optionFamilies || {};
    Object.keys(families).forEach((familyName) => {
      families[familyName].forEach((value) => {
        const overriddenOpt = segmentCostWithFamilyOverride(ctx, segType, familyName, value);
        if (!overriddenOpt) return;
        const overriddenCtx = {
          ...ctx,
          selectedCosts: { ...ctx.selectedCosts, perSegment: { ...ctx.selectedCosts.perSegment, [segType]: overriddenOpt } },
        };
        rows.push({ label: `${SEGMENT_TYPE_LABELS[segType]} — ${familyName}:${value}`, result: computeAllinRate(overriddenCtx, formState) });
      });
    });
  });
  return rows;
}

function renderAllinRateFamilyComparisonHtml(rows, quoteCurrency) {
  if (!rows.length) return "";
  return `
    <div style="margin-top: 10px">
      <div class="section-label">可能成本組合比較(依47.1節互斥選項)</div>
      <table style="width: 100%; font-size: 13px">
        <thead><tr><th style="text-align: left">組合</th><th style="text-align: left">All-in費率</th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const unitLabel = ALLIN_RATE_UNIT_LABELS[r.result.unit] || "";
              const rateText = r.result.rate == null ? `<span class="whatif-bracket-note">未定</span>` : `${formatMoney(r.result.rate, quoteCurrency)}/${escapeHtml(unitLabel)}`;
              return `<tr><td>${escapeHtml(r.label)}</td><td>${rateText}</td></tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// module-level 讓 renderProfitCards 的幣別切換能觸發重新計算,不用整包重繪 renderQuoteRoot
let recomputeAndRenderCurrent = () => {};

function recomputeAndRender(ctx, state) {
  const formState = readQuoteFormState();
  const sells = {};
  let sumCost = 0;
  let sumSell = 0;
  let allinRateResult = null;
  const isAllinRate = formState.quoteFormat === "allin" && formState.allinOutputStyle === "rate";
  const isAllinManual = formState.sellMode === "manual" && formState.quoteFormat === "allin" && !isAllinRate;
  const isItemsManual = formState.sellMode === "manual" && formState.quoteFormat === "items";

  if (isAllinRate) {
    // spec 第50.2節:成本一律照quoteScope+costBasis加總(跟lumpSum/其餘格式共用同一套邏輯,不受
    // 輸出樣式影響),賣價/總價則改用computeAllinRate()——estimatedTotal為null時sumSell维持null,
    // 下游(renderProfitCards/renderQuotePreview)要能處理「總價未定,但費率本身已知」這個狀態
    SEGMENT_TYPES.forEach((t) => {
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      if (isSegmentInQuoteScope(ctx.caseData, t) && isSegmentUsable(ctx, t)) sumCost += cost;
    });
    allinRateResult = computeAllinRate(ctx, formState);
    sumSell = allinRateResult.estimatedTotal;
  } else if (isAllinManual) {
    // allin 手動賣價:成本仍依 quoteScope 過濾加總(內部參考用),但賣價直接是使用者打的單一總數,
    // 不再依段落/quoteScope 拆算或過濾(spec 4節:這種情境下使用者已經自己決定好這個總數涵蓋的範圍)
    SEGMENT_TYPES.forEach((t) => {
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      if (isSegmentInQuoteScope(ctx.caseData, t) && isSegmentUsable(ctx, t)) sumCost += cost;
    });
    sumSell = formState.manualAllinValue || 0;
  } else if (isItemsManual) {
    // items 手動賣價(spec 4節/第32節新增):sells[t] = 該段所有FeeLine「各自輸入的金額+各自選定的幣別」
    // 逐筆透過rateTable換算成case.quote_currency後加總——逐筆明細維持原幣別顯示(見renderQuotePreview),
    // 這裡算出來的sells[t]只用於段落小計/總計/利潤計算,兩者不是同一件事(spec 4節說明)
    const itemsManualMissingRateBySeg = {};
    SEGMENT_TYPES.forEach((t) => {
      const usable = isSegmentUsable(ctx, t);
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      let sell = 0;
      let segMissingRate = false;
      if (usable) {
        const opt = ctx.selectedCosts.perSegment[t];
        (opt.feeLines || []).forEach((fl) => {
          const entry = formState.manualByItemValues[fl.id];
          if (entry && entry.byType) {
            // perContainer/perContainerPerDay(spec第33/40.1節):每個類型各自是「單價」,乘上該類型的登記數量才是這個類型的賣價小計
            entry.byType.forEach((bt) => {
              const qty = getUnitQty(ctx.cargo, bt.type);
              const lineAmount = Number(bt.amount || 0) * qty;
              const itemCurrency = bt.currency || fl.currency;
              const converted = convertCurrency(lineAmount, itemCurrency, ctx.caseData.quote_currency, ctx.caseData.rate_table, ctx.caseData.quote_currency);
              if (converted == null) segMissingRate = true;
              else sell += converted;
            });
            return;
          }
          const amount = entry ? Number(entry.amount || 0) : 0;
          const itemCurrency = (entry && entry.currency) || fl.currency;
          const converted = convertCurrency(amount, itemCurrency, ctx.caseData.quote_currency, ctx.caseData.rate_table, ctx.caseData.quote_currency);
          if (converted == null) segMissingRate = true;
          else sell += converted;
        });
      }
      sells[t] = sell;
      itemsManualMissingRateBySeg[t] = segMissingRate;
      if (isSegmentInQuoteScope(ctx.caseData, t) && usable) {
        sumCost += cost;
        sumSell += sell;
      }
      const subtotalEl = document.querySelector(`.q-item-segment-subtotal[data-segtype="${t}"]`);
      if (subtotalEl) {
        const displayCurrency = segmentDisplayCurrency(ctx.caseData, state, t);
        subtotalEl.innerHTML =
          convOrWarnHtml(sell, displayCurrency, ctx) + (segMissingRate ? ` <span class="cell-missing-rate">⚠ 部分項目缺匯率,未計入小計</span>` : "");
      }
    });
    formState.itemsManualMissingRateBySeg = itemsManualMissingRateBySeg;
  } else {
    SEGMENT_TYPES.forEach((t) => {
      const usable = isSegmentUsable(ctx, t);
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      // spec 3.1:段落還沒選定成本組合時,不管加成/手動賣價欄位打了什麼,賣價一律視為0(沒有成本基礎可加成),
      // 使用者打過的數字仍留在輸入框跟 autosave 存檔裡,等之後補上這段的選定成本,金額就會自動照原本邏輯算出來
      let sell;
      if (!usable) {
        sell = 0;
      } else if (formState.sellMode === "manual") {
        sell = formState.perSegment[t].manualValue;
      } else {
        const { markupMode, markupValue } = formState.perSegment[t];
        sell = markupMode === "fixed" ? cost + markupValue : cost * (1 + markupValue / 100);
      }
      sells[t] = sell;
      if (isSegmentInQuoteScope(ctx.caseData, t) && usable) {
        sumCost += cost;
        sumSell += sell;
      }
      const displayEl = document.querySelector(`.q-sell-display[data-segtype="${t}"]`);
      if (displayEl) {
        // 第46節統整版:markup模式下這個賣價是從cost(可能因pending而是0/部分)推算出來的,
        // 顯示邏輯要跟畫面其他地方一致,不能單獨顯示誤導的「0.00」;manual模式的數字是使用者自己打的,不受此限制
        const pendingCost = usable && formState.sellMode === "markup" ? ctx.selectedCosts.perSegment[t].cost : null;
        displayEl.innerHTML = formatCostAmount(sell, pendingCost, "");
      }
    });
  }

  // sumSell 在allin+rate樣式且驅動數字未知時是null(spec 50.2節,見computeAllinRate),
  // 不能直接用算術運算(null會被強制轉成0,算出誤導的profit/marginPct)
  const profit = sumSell != null ? sumSell - sumCost : null;
  const marginPct = sumSell ? (profit / sumSell) * 100 : 0;

  renderProfitCards(ctx, sumCost, sumSell, profit, marginPct, formState.sellMode, allinRateResult);
  renderQuotePreview(ctx, state, formState, sells, sumCost, sumSell, allinRateResult);
  return { formState, sells, sumCost, sumSell, allinRateResult };
}

async function exportQuotePdf(caseData) {
  const node = document.getElementById("quote-preview");
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;
  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(`${(caseData.ref || "quote").replace(/[\\/:*?"<>|]/g, "_")}-報價單.pdf`);
}

function exportQuoteExcel(ctx, state, formState, sells, sumCost, sumSell, allinRateResult) {
  const lh = readLetterheadForm();
  const caseData = ctx.caseData;
  const quoteCurrency = caseData.quote_currency;
  const rateTable = caseData.rate_table;
  const quoteRows = [];
  if (lh.companyName) quoteRows.push([lh.companyName]);
  if (lh.slogan) quoteRows.push([lh.slogan]);
  if (lh.address) quoteRows.push([lh.address]);
  if (lh.contact) quoteRows.push([lh.contact]);
  quoteRows.push([]);
  quoteRows.push(["案件", `${caseData.ref || ""} ${caseData.name || ""}`]);
  quoteRows.push(["航線", `${caseData.origin || ""} → ${caseData.destination || ""}`]);
  quoteRows.push([]);

  // 第46節統整版(取代原本第41節的「整段100%是perKgBreak」全有全無判斷):markup模式下,選定組合裡
  // 只要有任一段驅動數字還沒填,Excel的報價總價/總計也要比照畫面顯示「依實際計費重量另計」,
  // 不要匯出一個容易被誤解成算好的完整數字——跟畫面上「組合總成本」卡片是同一套判斷(comparison.js)
  const pendingExcel = formState.sellMode === "markup" && ctx.selectedCosts.pendingCount > 0;

  if (formState.quoteFormat === "allin" && formState.allinOutputStyle === "rate") {
    // spec 第50.2節:費率是報價主體,估計總金額(divisor已知時才有)是附加參考——跟畫面預覽同一套邏輯
    const r = allinRateResult || {};
    const unitLabel = ALLIN_RATE_UNIT_LABELS[r.unit] || "";
    quoteRows.push(["項目", "金額", "單位"]);
    quoteRows.push(["報價費率", r.rate == null ? "未定" : roundForDisplay(r.rate), `${quoteCurrency}/${unitLabel}`]);
    if (r.estimatedTotal != null) {
      quoteRows.push([`預估總金額(若本批貨為${r.divisor}${unitLabel})`, roundForDisplay(r.estimatedTotal), quoteCurrency]);
    }
    if (r.excludedNames && r.excludedNames.length) {
      quoteRows.push([`含${r.excludedNames.length}筆需知道實際貨量才能算入`, r.excludedNames.join("、"), ""]);
    }
  } else if (formState.quoteFormat === "allin") {
    quoteRows.push(["項目", "金額", "幣別"]);
    quoteRows.push(["報價總價", pendingExcel ? "依實際計費重量另計" : roundForDisplay(sumSell), quoteCurrency]);
  } else if (formState.quoteFormat === "segment") {
    quoteRows.push(["段落", "金額", "幣別"]);
    SEGMENT_TYPES.forEach((t) => {
      const opt = ctx.selectedCosts.perSegment[t];
      const notSelected = !opt;
      const label =
        SEGMENT_TYPE_LABELS[t] + (notSelected ? "(尚未選定)" : isSegmentInQuoteScope(caseData, t) ? "" : "(不計入本次報價)");
      const displayCurrency = segmentDisplayCurrency(caseData, state, t);
      const segPending = formState.sellMode === "markup" && opt && opt.cost.pendingCount > 0;
      const converted = convertCurrency(sells[t], quoteCurrency, displayCurrency, rateTable, quoteCurrency);
      quoteRows.push([label, segPending ? "依實際計費重量另計" : converted == null ? "缺匯率" : roundForDisplay(converted), displayCurrency]);
    });
    quoteRows.push([`總計(${quoteCurrency})`, pendingExcel ? "依實際計費重量另計" : roundForDisplay(sumSell), quoteCurrency]);
  } else {
    quoteRows.push(["段落", "費用項目", "Basis", "本次適用賣價", "幣別"]);
    const isManualItems = formState.sellMode === "manual";
    SEGMENT_TYPES.forEach((t) => {
      const opt = ctx.selectedCosts.perSegment[t];
      if (!opt) return;
      const label = SEGMENT_TYPE_LABELS[t] + (isSegmentInQuoteScope(caseData, t) ? "" : "(不計入本次報價)");
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      const ratio = cost !== 0 ? sells[t] / cost : 1;
      const displayCurrency = segmentDisplayCurrency(caseData, state, t);
      (opt.feeLines || []).forEach((fl) => {
        const displayRows = itemsDisplayRowsForFeeLine(fl, ctx.cargo);
        displayRows.forEach((dr) => {
          if (dr.type) {
            // perContainer/perContainerPerDay(spec第33/40.1節):一個貨櫃類型一列,Basis欄位具體化成「每40'HQ」而非代號
            if (isManualItems) {
              const entry = formState.manualByItemValues ? formState.manualByItemValues[fl.id] : null;
              const bt = entry && entry.byType ? entry.byType.find((x) => x.type === dr.type) : null;
              const rate = bt ? Number(bt.amount || 0) : 0;
              const itemCurrency = (bt && bt.currency) || fl.currency;
              quoteRows.push([label, fl.name, dr.basisLabel, roundForDisplay(rate * dr.qty), itemCurrency]);
              return;
            }
            const costForType = dr.unitAmount * dr.qty;
            const displayAmount = convertCurrency(costForType * ratio, quoteCurrency, displayCurrency, rateTable, quoteCurrency);
            quoteRows.push([label, fl.name, dr.basisLabel, displayAmount == null ? "缺匯率" : roundForDisplay(displayAmount), displayCurrency]);
            return;
          }
          if (isManualItems) {
            // items手動賣價(spec 4節/第32節):逐筆匯出使用者自己輸入的原幣別金額,不套用ratio換算
            const entry = formState.manualByItemValues ? formState.manualByItemValues[fl.id] : null;
            const amount = entry ? Number(entry.amount || 0) : 0;
            const itemCurrency = (entry && entry.currency) || fl.currency;
            quoteRows.push([label, fl.name, fl.basis, roundForDisplay(amount), itemCurrency]);
            return;
          }
          const r = feeLineAmountIn(fl, ctx.cargo, rateTable, quoteCurrency, quoteCurrency);
          // 第46節統整版:r.pending(驅動數字還沒填)時,perKgBreak逐級距匯出完整售價費率卡(每級距一列,
          // 呼應畫面上的呈現方式,讓標案報價這種常見情境的Excel也能拿到完整費率表,是既有做對的部分不用改),
          // 其餘basis(如perShipment缺票數)改成匯出中性的「未定:{原因}」,不是舊的紅色⚠警示文字
          if (r.pending && fl.basis === "perKgBreak") {
            const sortedBreaks = [...(fl.breaks || [])].sort((a, b) => Number(a.thresholdKg) - Number(b.thresholdKg));
            const minCharge = fl.min_charge != null ? Number(fl.min_charge) : 0;
            const minChargeConverted = convertCurrency(minCharge * ratio, quoteCurrency, displayCurrency, rateTable, quoteCurrency);
            quoteRows.push([
              label,
              `${fl.name}(Min charge,尚未提供本次計費重量,僅供費率參考)`,
              fl.basis,
              minChargeConverted == null ? "缺匯率" : roundForDisplay(minChargeConverted),
              displayCurrency,
            ]);
            sortedBreaks.forEach((b) => {
              const tierConverted = convertCurrency(Number(b.ratePerKg) * ratio, quoteCurrency, displayCurrency, rateTable, quoteCurrency);
              quoteRows.push([
                label,
                `${fl.name}(${b.thresholdKg}kg+)`,
                fl.basis,
                tierConverted == null ? "缺匯率" : roundForDisplay(tierConverted),
                `${displayCurrency}/kg`,
              ]);
            });
            return;
          }
          let cellValue;
          if (r.pending) {
            cellValue = `未定:${r.reason}`;
          } else if (r.incomplete) {
            cellValue = r.reason || "資料不完整,無法計算";
          } else if (r.missingRate) {
            cellValue = "缺匯率";
          } else {
            const displayAmount = convertCurrency(r.amount * ratio, quoteCurrency, displayCurrency, rateTable, quoteCurrency);
            cellValue = displayAmount == null ? "缺匯率" : roundForDisplay(displayAmount);
          }
          quoteRows.push([label, fl.name, fl.basis, cellValue, displayCurrency]);
        });
      });
      const segPending = !isManualItems && opt.cost.pendingCount > 0;
      const subtotalConverted = convertCurrency(sells[t], quoteCurrency, displayCurrency, rateTable, quoteCurrency);
      const subtotalLabel = isManualItems ? `小計(已換算為${displayCurrency})` : "小計";
      quoteRows.push([
        label,
        subtotalLabel,
        "",
        segPending ? "依實際計費重量另計" : subtotalConverted == null ? "缺匯率" : roundForDisplay(subtotalConverted),
        displayCurrency,
      ]);
    });
    quoteRows.push([`總計(${quoteCurrency})`, "", "", pendingExcel ? "依實際計費重量另計" : roundForDisplay(sumSell), quoteCurrency]);
  }

  quoteRows.push([]);
  quoteRows.push(["總成本", roundForDisplay(sumCost), quoteCurrency]);
  // spec 50.2節:allin+rate樣式驅動數字未知時sumSell是null(費率本身仍有算,見上面的報價費率列),
  // 不能直接roundForDisplay(null)當0元,也不能null-sumCost(算術會被強制轉型成誤導的負數)
  quoteRows.push(["報價總價", sumSell == null ? "未定(見報價費率)" : roundForDisplay(sumSell), quoteCurrency]);
  quoteRows.push(["預期利潤", sumSell == null ? "未定" : roundForDisplay(sumSell - sumCost), quoteCurrency]);

  const comparisonRows = [["代理", "段落", "Lane/Carrier", `Subtotal(${quoteCurrency})`, `Total(${quoteCurrency})`]];
  ctx.agents.forEach((agent) => {
    SEGMENT_TYPES.forEach((t) => {
      const segment = agent.segmentsByType[t];
      if (!segment) return;
      segmentOptions(segment, ctx.cargo, rateTable, quoteCurrency, quoteCurrency).forEach((opt) => {
        comparisonRows.push([
          agent.name,
          SEGMENT_TYPE_LABELS[t],
          opt.label || "(單一成本)",
          roundForDisplay(opt.cost.subtotal),
          roundForDisplay(opt.cost.total),
        ]);
      });
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(quoteRows), "報價單");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comparisonRows), "代理比較");
  XLSX.writeFile(wb, `${(caseData.ref || "quote").replace(/[\\/:*?"<>|]/g, "_")}-報價單.xlsx`);
}

// spec 47.1(修正版):報價頁直接重用比較分析頁做好的renderPossibleCostPicker/attachPossibleCostPickerListeners
// (定義在comparison.js,script載入順序在quote.js之前,同一個全域作用域可以直接呼叫)——報價頁沒有在比較多個
//候選agent,只是在調整已經鎖定那個agent/lane的成本組成,所以直接用selection裡已persist的狀態初始化畫面,
// 不像比較分析頁那樣需要comparisonPossibleCostChoice這層「選用前即時預覽」的狀態
function renderCostCompositionCard(ctx) {
  const rows = SEGMENT_TYPES.map((t) => {
    const opt = ctx.selectedCosts.perSegment[t];
    if (!opt) return "";
    const sel = ctx.selection[t] || {};
    const currentState = { familyChoices: sel.optionGroupChoices || {}, excludedIds: sel.excludedFeeLineIds || [] };
    const pickerHtml = renderPossibleCostPicker({
      segType: t,
      agentId: sel.agentId,
      opt,
      currentState,
      cargo: ctx.cargo,
      rateTable: ctx.caseData.rate_table,
      quoteCurrency: ctx.caseData.quote_currency,
      displayCurrency: ctx.caseData.quote_currency,
    });
    if (!pickerHtml) return "";
    return `
      <div class="quote-cost-composition-row">
        <h4>${SEGMENT_TYPE_LABELS[t]}${opt.agentName ? " — " + escapeHtml(opt.agentName) : ""}${opt.label ? "(" + escapeHtml(opt.label) + ")" : ""}</h4>
        ${pickerHtml}
      </div>
    `;
  }).join("");
  if (!rows) return "";
  return `
    <div class="card" id="quote-cost-composition-section">
      <h2>成本組合(可能成本選擇)</h2>
      <p style="font-size: 12px; color: var(--color-text-muted)">調整後會直接更新「比較分析」頁鎖定的選用內容,兩頁共用同一份選擇資料。</p>
      ${rows}
    </div>
  `;
}

function renderQuoteRoot(root, ctx) {
  const rawManualSell = ctx.caseData.manual_sell || {};
  // 向下相容:v4這次修訂前 manual_sell 直接就是 {export,intl,import},沒有 bySegment 這層包裝
  const legacyBySegment =
    rawManualSell.bySegment ||
    (rawManualSell.export != null || rawManualSell.intl != null || rawManualSell.import != null
      ? { export: rawManualSell.export, intl: rawManualSell.intl, import: rawManualSell.import }
      : {});

  const state = {
    sellMode: ctx.caseData.sell_mode || "markup",
    costBasis: ctx.caseData.cost_basis || "total",
    quoteFormat: ctx.caseData.quote_format || "segment",
    markup: ctx.caseData.markup || {},
    manualSellBySegment: legacyBySegment,
    manualSellAllin: rawManualSell.allin ?? null,
    manualSellAllinRate: rawManualSell.allinRate ?? null,
    manualSellByItem: rawManualSell.byItem || {},
    // spec 第50.2節:All-in報價輸出樣式(lumpSum現行行為|rate費率),只在quoteFormat='allin'時有意義
    allinOutputStyle: ctx.caseData.allin_output_style || "lumpSum",
    allinRateUnit: ctx.caseData.allin_rate_unit || null,
    letterhead: ctx.caseData.letterhead || {},
    quoteCurrencyBySegment: { ...(ctx.caseData.quote_currency_by_segment || {}) },
  };

  root.innerHTML = `
    ${renderCostCompositionCard(ctx)}
    <div class="card" id="quote-settings-section">
      <h2>計價設定</h2>
      <div class="form-grid">
        <div class="field-inline">
          <label>賣價輸入模式</label>
          <select id="q-sell-mode">
            <option value="markup">依成本加成(Markup)</option>
            <option value="manual">手動輸入賣價</option>
          </select>
        </div>
        <div class="field-inline">
          <label>成本基準</label>
          <select id="q-cost-basis">
            <option value="total">Total(含已選 possible 費用)</option>
            <option value="subtotal">Subtotal(僅 certain 費用)</option>
          </select>
        </div>
        <div class="field-inline">
          <label>報價格式</label>
          <select id="q-format">
            <option value="allin">All-in(單一總價)</option>
            <option value="segment">Segment(三段各一總數)</option>
            <option value="items">Items(完整明細)</option>
          </select>
        </div>
        <div class="field-inline" id="q-allin-style-field" style="display: none">
          <label>All-in輸出樣式</label>
          <select id="q-allin-style">
            <option value="lumpSum">總金額</option>
            <option value="rate">費率</option>
          </select>
        </div>
        <div class="field-inline" id="q-allin-rate-unit-field" style="display: none">
          <label>費率單位</label>
          <select id="q-allin-rate-unit"></select>
        </div>
      </div>

      <div id="q-sell-input-area"></div>

      <div id="q-save-status" class="save-status"></div>
    </div>

    <div class="card">
      <h2>公司抬頭(此案件覆蓋設定,留空則不顯示該欄位)</h2>
      <div class="form-grid">
        <div class="field-inline"><label>公司名稱</label><input type="text" id="q-lh-company" /></div>
        <div class="field-inline"><label>標語</label><input type="text" id="q-lh-slogan" /></div>
        <div class="field-inline field-full"><label>地址</label><input type="text" id="q-lh-address" /></div>
        <div class="field-inline"><label>聯絡方式</label><input type="text" id="q-lh-contact" /></div>
        <div class="field-inline field-full"><label>條款文字</label><input type="text" id="q-lh-terms" /></div>
      </div>
    </div>

    <div class="overview-cards" id="q-profit-cards"></div>

    <div class="quote-toolbar" id="quote-export-section">
      <button type="button" class="btn-small primary" id="q-export-pdf-btn">產生報價單 PDF</button>
      <button type="button" class="btn-small primary" id="q-export-excel-btn">產生報價單 Excel</button>
    </div>

    <div class="quote-preview" id="quote-preview-section">
      <div id="quote-preview"></div>
    </div>
  `;

  const compositionSection = document.getElementById("quote-cost-composition-section");
  if (compositionSection) {
    attachPossibleCostPickerListeners(compositionSection, async (key, partial) => {
      const segType = key.split("|")[0];
      const sel = ctx.selection[segType];
      if (!sel) return;
      const optionGroupChoices = { ...(sel.optionGroupChoices || {}) };
      const excludedSet = new Set(sel.excludedFeeLineIds || []);
      if ("family" in partial) {
        if (partial.value == null) delete optionGroupChoices[partial.family];
        else optionGroupChoices[partial.family] = partial.value;
      } else {
        if (partial.included) excludedSet.delete(partial.feeLineId);
        else excludedSet.add(partial.feeLineId);
      }
      const newSelection = { ...ctx.selection, [segType]: { ...sel, optionGroupChoices, excludedFeeLineIds: Array.from(excludedSet) } };
      await persistSelection(newSelection);
      loadQuoteTab();
    });
  }

  document.getElementById("q-sell-mode").value = state.sellMode;
  document.getElementById("q-cost-basis").value = state.costBasis;
  document.getElementById("q-format").value = state.quoteFormat;

  // spec 第50.2節:mode不支援任何費率單位時(land/rail/cross_border_trucking/multimodal),「費率」樣式
  // 這個選項本身就不該出現,不是只有下面的單位選單隱藏——維持只有lumpSum可選,防呆:模式不支援時強制退回lumpSum
  if (!allinRateUnitOptionsForMode(ctx.caseData.mode).length) {
    const rateOption = document.querySelector('#q-allin-style option[value="rate"]');
    if (rateOption) rateOption.remove();
    if (state.allinOutputStyle === "rate") state.allinOutputStyle = "lumpSum";
  }
  document.getElementById("q-allin-style").value = state.allinOutputStyle;

  // spec 第50.2節:輸出樣式/費率單位選單只在quoteFormat='allin'時顯示,費率單位選項依case.mode篩選
  // (見quote.js頂部allinRateUnitOptionsForMode)——preferredValue只在第一次填入選單時採用,
  // 之後呼叫沿用畫面上目前已選的值(使用者切換模式期間不要把已選的值悄悄蓋掉)
  function populateAllinRateUnitOptions(preferredValue) {
    const unitSelect = document.getElementById("q-allin-rate-unit");
    const options = allinRateUnitOptionsForMode(ctx.caseData.mode).map((u) => ({ value: u, label: `${ctx.caseData.quote_currency}/${ALLIN_RATE_UNIT_LABELS[u]}` }));
    const prior = preferredValue !== undefined ? preferredValue : unitSelect.value;
    unitSelect.innerHTML = options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("");
    unitSelect.value = options.some((o) => o.value === prior) ? prior : options[0] ? options[0].value : "";
    return options;
  }
  function updateAllinFieldVisibility() {
    const showStyle = document.getElementById("q-format").value === "allin";
    document.getElementById("q-allin-style-field").style.display = showStyle ? "" : "none";
    const style = document.getElementById("q-allin-style").value;
    const options = populateAllinRateUnitOptions();
    document.getElementById("q-allin-rate-unit-field").style.display = showStyle && style === "rate" && options.length ? "" : "none";
  }
  populateAllinRateUnitOptions(state.allinRateUnit);
  updateAllinFieldVisibility();

  document.getElementById("q-lh-company").value = state.letterhead.companyName || "";
  document.getElementById("q-lh-slogan").value = state.letterhead.slogan || "";
  document.getElementById("q-lh-address").value = state.letterhead.address || "";
  document.getElementById("q-lh-contact").value = state.letterhead.contact || "";
  document.getElementById("q-lh-terms").value = state.letterhead.terms || "";

  const sellInputArea = document.getElementById("q-sell-input-area");
  const preview = document.getElementById("quote-preview");
  let lastComputed = null;

  function recompute() {
    lastComputed = recomputeAndRender(ctx, state);
  }
  recomputeAndRenderCurrent = recompute;

  // 決定賣價輸入區要渲染成哪種形狀(三段表格 or allin單一輸入框),渲染完立刻重新計算一次
  function rerenderSellArea() {
    renderSellInputArea(sellInputArea, { ctx, state, top: readTopLevelQuoteControls() });
    recompute();
  }

  rerenderSellArea();

  document.getElementById("q-sell-mode").addEventListener("change", rerenderSellArea);
  document.getElementById("q-cost-basis").addEventListener("change", rerenderSellArea);
  // 切換報價格式(allin/segment/items)時,賣價輸入區跟下方報價預覽的結構都要整個換掉(spec 4節這次修的bug):
  // manual+allin ↔ manual+segment/items 是完全不同形狀的輸入區,markup 模式則維持三段表格不變但仍要重繪一次確保一致
  document.getElementById("q-format").addEventListener("change", () => {
    updateAllinFieldVisibility();
    rerenderSellArea();
  });
  // spec 第50.2節:輸出樣式lumpSum↔rate切換時,manual模式的輸入區形狀也要整個換掉(單一總價輸入框 vs 費率輸入框)
  document.getElementById("q-allin-style").addEventListener("change", () => {
    updateAllinFieldVisibility();
    rerenderSellArea();
  });
  document.getElementById("q-allin-rate-unit").addEventListener("change", recompute);

  // 賣價輸入區是動態切換內容的容器,監聽掛在容器本身(事件代理),不管裡面現在是表格還是單一輸入框都涵蓋得到
  sellInputArea.addEventListener("input", recompute);
  sellInputArea.addEventListener("change", recompute);

  ["q-lh-company", "q-lh-slogan", "q-lh-address", "q-lh-contact", "q-lh-terms"].forEach((id) =>
    document.getElementById(id).addEventListener("input", recompute)
  );

  // 每段幣別選擇器(spec 4節v4):切換時先就地更新 state、立即重繪預覽,讓使用者馬上看到換算結果;
  // 這個 change 事件之後還會繼續往上冒泡到 root 的 autosave 監聽(見下方 attachAutosaveListeners),
  // 觸發時 state.quoteCurrencyBySegment 已經是最新值,一次動作同時完成「畫面更新」跟「背景存檔」
  preview.addEventListener("change", (event) => {
    if (event.target.matches(".seg-currency-select")) {
      state.quoteCurrencyBySegment[event.target.dataset.segtype] = event.target.value;
      recompute();
    }
  });

  // 計價設定 + 公司抬頭 + 每段顯示幣別改為 autosave(spec 6.5.4):取消「儲存報價設定」按鈕,
  // blur/change 時觸發存檔;上面 input/change → recompute() 純粹是即時預覽,跟這裡的實際持久化是兩件事,並存不衝突
  const quoteTrigger = createAutosaveTrigger(
    document.getElementById("q-save-status"),
    async () => {
      const formState = readQuoteFormState();

      // markup 值只在目前正處於 markup 模式時才用畫面上的欄位覆蓋(manual 模式下這些欄位根本沒渲染在畫面上,
      // 讀到的會是舊值,不能拿來覆蓋);manualSellAllin/manualSellBySegment 同理,只覆蓋「目前這個模式+格式組合」
      // 對應的那一組,另一組維持原樣,兩者不互相覆蓋(spec 4節這次的重點)
      const markupPayload = { ...state.markup };
      if (formState.sellMode === "markup") {
        SEGMENT_TYPES.forEach((t) => {
          markupPayload[t] = { mode: formState.perSegment[t].markupMode, value: formState.perSegment[t].markupValue };
        });
      }

      let manualSellAllinPayload = state.manualSellAllin;
      let manualSellAllinRatePayload = state.manualSellAllinRate;
      const manualSellBySegmentPayload = { ...state.manualSellBySegment };
      let manualSellByItemPayload = { ...state.manualSellByItem };
      if (formState.sellMode === "manual") {
        // spec 50.2節:allin+rate樣式的手動輸入存到allinRate(獨立於lumpSum的allin),
        // 兩者互不覆蓋(比照既有allin/bySegment/byItem三組資料互相獨立的既有模式)
        if (formState.quoteFormat === "allin" && formState.allinOutputStyle === "rate") {
          manualSellAllinRatePayload = formState.manualAllinRateValue;
        } else if (formState.quoteFormat === "allin") {
          manualSellAllinPayload = formState.manualAllinValue;
        } else if (formState.quoteFormat === "items") {
          // items格式手動賣價(spec 4節/第32節新增):只合併目前這個模式+格式組合對應的byItem值,
          // allin/bySegment維持原樣,三組資料結構互相獨立、不覆蓋(呼應第4節的設計)
          manualSellByItemPayload = { ...manualSellByItemPayload, ...formState.manualByItemValues };
        } else {
          SEGMENT_TYPES.forEach((t) => {
            manualSellBySegmentPayload[t] = formState.perSegment[t].manualValue;
          });
        }
      }

      // spec 29.1:sell_mode/cost_basis/quote_format/markup/manual_sell/quote_currency_by_segment 這組是
      // 「情境範圍」的設定,project案件要存到目前作用中的情境(scenarios表),否則維持存在案件本身(cases表);
      // letterhead 不在Scenario結構裡(spec 29.1),不論project與否,一律是案件層級共用,固定存cases表
      const scenarioScopedPayload = {
        sell_mode: formState.sellMode,
        cost_basis: formState.costBasis,
        quote_format: formState.quoteFormat,
        // spec 第50.2節:只在quoteFormat='allin'時有意義,非allin格式維持既有值不動(存回原本的state值,
        // 不要因為畫面上沒渲染這兩個select就把設定悄悄清空)
        allin_output_style: formState.quoteFormat === "allin" ? formState.allinOutputStyle : state.allinOutputStyle,
        allin_rate_unit: formState.quoteFormat === "allin" && formState.allinOutputStyle === "rate" ? formState.allinRateUnit : state.allinRateUnit,
        markup: markupPayload,
        manual_sell: {
          allin: manualSellAllinPayload,
          allinRate: manualSellAllinRatePayload,
          bySegment: manualSellBySegmentPayload,
          byItem: manualSellByItemPayload,
        },
        quote_currency_by_segment: state.quoteCurrencyBySegment,
      };
      const letterheadPayload = { letterhead: readLetterheadForm() };

      const target = getActiveRecordTarget();
      const [{ error: scopedError }, { error: letterheadError }] = await Promise.all([
        supabaseClient.from(target.table).update(scenarioScopedPayload).eq("id", target.id),
        supabaseClient.from("cases").update(letterheadPayload).eq("id", caseId),
      ]);
      if (scopedError) throw scopedError;
      if (letterheadError) throw letterheadError;

      if (target.table === "scenarios") {
        const sc = activeScenario();
        if (sc) Object.assign(sc, scenarioScopedPayload);
      } else {
        Object.assign(currentCase, scenarioScopedPayload);
      }
      currentCase.letterhead = letterheadPayload.letterhead;

      state.markup = scenarioScopedPayload.markup;
      state.manualSellAllin = scenarioScopedPayload.manual_sell.allin;
      state.manualSellAllinRate = scenarioScopedPayload.manual_sell.allinRate;
      state.manualSellBySegment = scenarioScopedPayload.manual_sell.bySegment;
      state.manualSellByItem = scenarioScopedPayload.manual_sell.byItem;
      state.allinOutputStyle = scenarioScopedPayload.allin_output_style;
      state.allinRateUnit = scenarioScopedPayload.allin_rate_unit;
    },
    { sectionId: "quote-settings" }
  );
  attachAutosaveListeners(root, quoteTrigger);

  document.getElementById("q-export-pdf-btn").addEventListener("click", () => exportQuotePdf(ctx.caseData));
  document.getElementById("q-export-excel-btn").addEventListener("click", () => {
    if (!lastComputed) recompute();
    exportQuoteExcel(ctx, state, lastComputed.formState, lastComputed.sells, lastComputed.sumCost, lastComputed.sumSell, lastComputed.allinRateResult);
  });
}

async function loadQuoteTab() {
  const root = document.getElementById("quote-root");

  // 背景刷新前,如果使用者正在這個表單裡打字(還沒 blur、還沒真正存到 DB),先強制存一次目前畫面上的值,
  // 再重繪畫面,避免下面的 root.innerHTML 直接把還沒存的輸入蓋掉
  await flushFocusedAutosave(root);

  root.innerHTML = `<p class="empty-state">載入中...</p>`;

  let agents;
  try {
    agents = await fetchAgentsWithCosts(caseId, activeScenarioIdForQuery());
  } catch (error) {
    root.innerHTML = `<div class="message error" style="display:block">讀取失敗:${error.message}</div>`;
    return;
  }

  // spec 29.1:project案件讀目前作用中情境的cargo/selection/markup/quoteFormat等,否則維持讀案件本身
  const scope = getActiveScopeData();
  const cargo = scope.cargo || {};
  const selection = scope.selection || {};
  // 內部成本/賣價計算恆定以 case.quote_currency 為基準(維持既有 markup 語意不變),
  // 每段/利潤要顯示成別的幣別,是 renderQuotePreview/renderProfitCards 最後才做的顯示層換算
  const selectedCosts = computeSelectedCosts(agents, selection, cargo, scope, scope.quote_currency);

  // spec 3.1:不再要求三段都選定才能進報價分頁,只要至少一段有選定成本就能開始操作;
  // 還沒選定的段落在下面各種格式的呈現裡都當作「尚未選定」、金額0、不計入總價(見 isSegmentUsable)
  if (!selectedCosts.anySelected) {
    root.innerHTML = `<p class="empty-state">請先到「比較分析」分頁,至少為一段選定成本組合,才能開始建立報價。</p>`;
    return;
  }

  renderQuoteRoot(root, { agents, cargo, selection, selectedCosts, caseData: scope });
}
