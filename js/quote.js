// 報價分頁(spec 4):markup / 手動賣價切換、即時利潤、quoteFormat 三選一、PDF/Excel 匯出
// v4(第21節):成本/賣價/加成的內部計算恆定用 case.quote_currency 為基準(維持既有 markup 語意不變),
// 每段顯示幣別(quoteCurrencyBySegment)、利潤顯示幣別純粹是「換算後另外呈現」的顯示層,不影響加成計算本身
// 本輪(spec 4節修訂):手動輸入賣價模式下,allin 格式只顯示一個總價輸入框,segment/items 格式維持三段各自輸入,
// 兩組數字分開存在 case.manual_sell = { allin, bySegment:{export,intl,import} },互不覆蓋;
// 空運模式下賣價總額旁邊附註換算後的每KG單價,海運不顯示

// 預期利潤卡片的顯示幣別:純畫面檢視偏好,不持久化(spec:跟報價分段幣別是獨立的兩件事,不用綁在一起)
let quoteProfitCurrency = null;

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
// 缺匯率時回傳警示 HTML,不回傳 0(spec 2.4/4節)。perKg=true 時,換算成功才附註每KG單價(空運限定)
function convOrWarnHtml(amountInQuoteCurrency, toCurrency, ctx, perKg = false) {
  const caseData = ctx.caseData;
  const v = convertCurrency(amountInQuoteCurrency, caseData.quote_currency, toCurrency, caseData.rate_table, caseData.quote_currency);
  if (v == null) return `<span class="cell-missing-rate">⚠ 缺匯率</span>`;
  return formatMoney(v, "") + (perKg ? perKgHintHtml(v, toCurrency, ctx) : "");
}

function feeLineDescriptionHtml(fl, cargo) {
  const w = Number((cargo && cargo.chargeableWeightKg) || 0);
  if (fl.basis === "perUnit") {
    return (fl.amount_by_type || []).map((t) => `${escapeHtml(t.type)}: ${t.amount} × ${getUnitQty(cargo, t.type)}`).join("<br/>") || "-";
  }
  if (fl.basis === "perKgBreak") {
    const applicable = applicableBreakRate(fl.breaks, w);
    const byWeight = applicable * w;
    const minCharge = fl.min_charge != null ? Number(fl.min_charge) : 0;
    const hitMinCharge = minCharge > byWeight;
    const basisBadge = hitMinCharge
      ? `<span class="fee-basis-badge min-charge">命中最低消費</span>`
      : `<span class="fee-basis-badge by-rate">依單價計算</span>`;
    const breaksHtml =
      [...(fl.breaks || [])]
        .sort((a, b) => Number(a.thresholdKg) - Number(b.thresholdKg))
        .map(
          (b) =>
            `<span style="${Number(b.ratePerKg) === applicable ? "font-weight:bold;text-decoration:underline" : ""}">${b.thresholdKg}kg+: ${b.ratePerKg}</span>`
        )
        .join(" / ") || "-";
    return `${basisBadge} Min charge: ${formatMoney(minCharge, "")} / 單價×重量: ${formatMoney(byWeight, "")}<br/>${breaksHtml}<br/>本次適用:${applicable}/kg × ${w}kg`;
  }
  const basisLabel = { flat: "固定", perShipment: `每票 × ${Number((cargo && cargo.shipmentQty) || 0)}`, perKg: `每KG × ${w}` }[fl.basis] || fl.basis;
  return `${fl.amount ?? 0}(${basisLabel})`;
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
  return {
    sellMode: document.getElementById("q-sell-mode").value,
    costBasis: document.getElementById("q-cost-basis").value,
    quoteFormat: document.getElementById("q-format").value,
  };
}

// 完整讀取目前畫面上的報價設定,包含下面動態輸入區(呼叫前輸入區必須已經渲染成跟 sellMode/quoteFormat 相符的形狀)
function readQuoteFormState() {
  const top = readTopLevelQuoteControls();
  const perSegment = {};
  let manualAllinValue = null;

  if (top.sellMode === "manual" && top.quoteFormat === "allin") {
    const input = document.querySelector(".q-manual-sell-allin");
    manualAllinValue = input ? Number(input.value || 0) : 0;
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

  return { ...top, perSegment, manualAllinValue };
}

function renderSegmentRows(tbody, { selectedCosts, sellMode, costBasis, markup, manualSell, caseData }) {
  tbody.innerHTML = SEGMENT_TYPES.map((t) => {
    const opt = selectedCosts.perSegment[t];
    const cost = costForSegment(selectedCosts.perSegment, t, costBasis);
    const included = isSegmentInQuoteScope(caseData, t);
    const rowClass = included ? "" : ' class="scope-excluded-row"';
    // 這裡的「缺匯率」是指這段裡有 FeeLine 的原始幣別在 case.rate_table 裡找不到匯率,換算不出 case.quote_currency 金額,
    // 表示下面的 cost/賣價/利潤已經是不完整的數字,不能讓使用者以為算出來的是完整總額(spec 2.4/4節)
    const missingBadge = opt && opt.cost.missingRate ? ` <span class="cell-missing-rate">⚠ 缺匯率,以下金額不完整</span>` : "";
    const label = SEGMENT_TYPE_LABELS[t] + (included ? "" : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`) + missingBadge;
    if (sellMode === "manual") {
      const val = manualSell[t] != null ? manualSell[t] : "";
      return `
        <tr${rowClass}>
          <td>${label}</td>
          <td>${formatMoney(cost, "")}</td>
          <td><input type="number" step="0.01" class="q-manual-sell" data-segtype="${t}" value="${val}" style="width: 120px" /></td>
          <td class="q-sell-display" data-segtype="${t}">-</td>
        </tr>`;
    }
    const setting = markup[t] || { mode: "percent", value: 0 };
    return `
      <tr${rowClass}>
        <td>${label}</td>
        <td>${formatMoney(cost, "")}</td>
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
        <div style="padding-top: 6px">${formatMoney(totalCost, "")}</div>
      </div>
      <div class="field-inline">
        <label>報價總價(手動輸入,${escapeHtml(quoteCurrency)})</label>
        <input type="number" step="0.01" class="q-manual-sell-allin" value="${state.manualSellAllin ?? ""}" style="width: 160px" />
      </div>
    </div>
  `;
}

// 依目前 sellMode/quoteFormat 組合,決定「賣價輸入區」要渲染成哪種形狀——
// markup 模式(不管哪種格式)、或 manual+segment/items:三段各自一列的表格(既有行為不變)
// manual+allin:單一總價輸入框(spec 4節這次修的bug)
function renderSellInputArea(container, { ctx, state, top }) {
  const isAllinManual = top.sellMode === "manual" && top.quoteFormat === "allin";
  if (isAllinManual) {
    renderAllinManualInput(container, { ctx, state, costBasis: top.costBasis });
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
function renderQuotePreview(ctx, state, formState, sells, sumCost, sumSell) {
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
      (t) => isSegmentInQuoteScope(caseData, t) && ctx.selectedCosts.perSegment[t] && ctx.selectedCosts.perSegment[t].cost.missingRate
    );

  let bodyHtml;
  if (formState.quoteFormat === "allin") {
    // allin 格式只有單一總數字,不適用分段幣別,統一用 case.quote_currency(spec 4節)
    bodyHtml = `
      <table>
        <tr><th>項目</th><th>金額</th></tr>
        <tr><td>報價總價${anyMissingRate ? ` <span class="cell-missing-rate">⚠ 部分費用缺匯率,此總價不完整</span>` : ""}</td><td>${formatMoney(sumSell, quoteCurrency)}${perKgHintHtml(sumSell, quoteCurrency, ctx)}</td></tr>
      </table>`;
  } else if (formState.quoteFormat === "segment") {
    bodyHtml = `
      <table>
        <tr><th>段落</th><th>幣別</th><th>金額</th></tr>
        ${SEGMENT_TYPES.map((t) => {
          const opt = ctx.selectedCosts.perSegment[t];
          const included = isSegmentInQuoteScope(caseData, t);
          const missingBadge = opt && opt.cost.missingRate ? ` <span class="cell-missing-rate">⚠ 缺匯率</span>` : "";
          const label = SEGMENT_TYPE_LABELS[t] + (included ? "" : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`) + missingBadge;
          const displayCurrency = segmentDisplayCurrency(caseData, state, t);
          // 空運每KG輔助顯示只加在國際運輸段(spec 4節:業界慣用每KG快速比較的是主運費這一段)
          return `<tr${included ? "" : ' class="scope-excluded-row"'}><td>${label}</td><td>${segCurrencySelectHtml(caseData, state, t)}</td><td>${convOrWarnHtml(sells[t], displayCurrency, ctx, t === "intl")}</td></tr>`;
        }).join("")}
        <tr><td colspan="2"><strong>總計(${escapeHtml(quoteCurrency)})</strong></td><td><strong>${formatMoney(sumSell, quoteCurrency)}</strong></td></tr>
      </table>`;
  } else {
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
          .map((fl) => {
            // 先算這筆 FeeLine 在 quote_currency 下的基準金額,乘上這段的加成比例(維持既有 markup 分攤邏輯),
            // 最後才換算成這段選定的顯示幣別——換算永遠是最後一步,不影響 ratio 本身怎麼算出來的
            const rawCostQC = feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, quoteCurrency);
            const displayHtml = rawCostQC == null ? `<span class="cell-missing-rate">⚠ 缺匯率</span>` : convOrWarnHtml(rawCostQC * ratio, displayCurrency, ctx);
            return `
              <tr>
                <td>${escapeHtml(fl.name)}${fl.certainty === "possible" ? " <em>(possible)</em>" : ""}</td>
                <td>${fl.basis}</td>
                <td>${feeLineDescriptionHtml(fl, cargo)}</td>
                <td>${displayHtml}</td>
              </tr>`;
          })
          .join("");
        return `
          <h4>${SEGMENT_TYPE_LABELS[t]}${opt.label ? " — " + escapeHtml(opt.label) : ""}${scopeBadge} ${segCurrencySelectHtml(caseData, state, t)}</h4>
          <table>
            <tr><th>費用項目</th><th>Basis</th><th>說明</th><th>本次適用賣價(${escapeHtml(displayCurrency)})</th></tr>
            ${rows}
            <tr><td colspan="3"><strong>小計</strong></td><td><strong>${convOrWarnHtml(sells[t], displayCurrency, ctx, t === "intl")}</strong></td></tr>
          </table>`;
      }).join("") + `<p><strong>總計(${escapeHtml(quoteCurrency)}):${formatMoney(sumSell, quoteCurrency)}</strong></p>`;
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

function renderProfitCards(ctx, sumCostQC, sumSellQC, profitQC, marginPct) {
  const caseData = ctx.caseData;
  const displayCurrency = quoteProfitCurrency && caseAvailableCurrencies(caseData).includes(quoteProfitCurrency) ? quoteProfitCurrency : caseData.quote_currency;
  const sumCost = convertCurrency(sumCostQC, caseData.quote_currency, displayCurrency, caseData.rate_table, caseData.quote_currency);
  const sumSell = convertCurrency(sumSellQC, caseData.quote_currency, displayCurrency, caseData.rate_table, caseData.quote_currency);
  const missing = sumCost == null || sumSell == null;
  const profit = missing ? null : sumSell - sumCost;

  const currencies = caseAvailableCurrencies(caseData);
  document.getElementById("q-profit-cards").innerHTML = `
    <div class="overview-card"><div class="label">總成本</div><div class="value">${missing ? "⚠ 缺匯率" : formatMoney(sumCost, displayCurrency)}</div></div>
    <div class="overview-card"><div class="label">報價總價</div><div class="value">${missing ? "⚠ 缺匯率" : formatMoney(sumSell, displayCurrency) + perKgHintHtml(sumSell, displayCurrency, ctx)}</div></div>
    <div class="overview-card profit">
      <div class="label">
        預期利潤
        <span class="currency-selector" style="display: inline-flex; margin-left: 8px">
          <select id="q-profit-currency-select">${currencies.map((c) => `<option value="${escapeHtml(c)}" ${c === displayCurrency ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        </span>
      </div>
      <div class="value">${missing ? "⚠ 缺匯率" : `${formatMoney(profit, displayCurrency)}(${marginPct.toFixed(1)}%)`}</div>
    </div>
  `;
  document.getElementById("q-profit-currency-select").addEventListener("change", (event) => {
    quoteProfitCurrency = event.target.value;
    recomputeAndRenderCurrent();
  });
}

// module-level 讓 renderProfitCards 的幣別切換能觸發重新計算,不用整包重繪 renderQuoteRoot
let recomputeAndRenderCurrent = () => {};

function recomputeAndRender(ctx, state) {
  const formState = readQuoteFormState();
  const sells = {};
  let sumCost = 0;
  let sumSell = 0;
  const isAllinManual = formState.sellMode === "manual" && formState.quoteFormat === "allin";

  if (isAllinManual) {
    // allin 手動賣價:成本仍依 quoteScope 過濾加總(內部參考用),但賣價直接是使用者打的單一總數,
    // 不再依段落/quoteScope 拆算或過濾(spec 4節:這種情境下使用者已經自己決定好這個總數涵蓋的範圍)
    SEGMENT_TYPES.forEach((t) => {
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      if (isSegmentInQuoteScope(ctx.caseData, t)) sumCost += cost;
    });
    sumSell = formState.manualAllinValue || 0;
  } else {
    SEGMENT_TYPES.forEach((t) => {
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      let sell;
      if (formState.sellMode === "manual") {
        sell = formState.perSegment[t].manualValue;
      } else {
        const { markupMode, markupValue } = formState.perSegment[t];
        sell = markupMode === "fixed" ? cost + markupValue : cost * (1 + markupValue / 100);
      }
      sells[t] = sell;
      if (isSegmentInQuoteScope(ctx.caseData, t)) {
        sumCost += cost;
        sumSell += sell;
      }
      const displayEl = document.querySelector(`.q-sell-display[data-segtype="${t}"]`);
      if (displayEl) displayEl.textContent = formatMoney(sell, "");
    });
  }

  const profit = sumSell - sumCost;
  const marginPct = sumSell !== 0 ? (profit / sumSell) * 100 : 0;

  renderProfitCards(ctx, sumCost, sumSell, profit, marginPct);
  renderQuotePreview(ctx, state, formState, sells, sumCost, sumSell);
  return { formState, sells, sumCost, sumSell };
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

function exportQuoteExcel(ctx, state, formState, sells, sumCost, sumSell) {
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

  if (formState.quoteFormat === "allin") {
    quoteRows.push(["項目", "金額", "幣別"]);
    quoteRows.push(["報價總價", Number(sumSell.toFixed(2)), quoteCurrency]);
  } else if (formState.quoteFormat === "segment") {
    quoteRows.push(["段落", "金額", "幣別"]);
    SEGMENT_TYPES.forEach((t) => {
      const label = SEGMENT_TYPE_LABELS[t] + (isSegmentInQuoteScope(caseData, t) ? "" : "(不計入本次報價)");
      const displayCurrency = segmentDisplayCurrency(caseData, state, t);
      const converted = convertCurrency(sells[t], quoteCurrency, displayCurrency, rateTable, quoteCurrency);
      quoteRows.push([label, converted == null ? "缺匯率" : Number(converted.toFixed(2)), displayCurrency]);
    });
    quoteRows.push([`總計(${quoteCurrency})`, Number(sumSell.toFixed(2)), quoteCurrency]);
  } else {
    quoteRows.push(["段落", "費用項目", "Basis", "本次適用賣價", "幣別"]);
    SEGMENT_TYPES.forEach((t) => {
      const opt = ctx.selectedCosts.perSegment[t];
      if (!opt) return;
      const label = SEGMENT_TYPE_LABELS[t] + (isSegmentInQuoteScope(caseData, t) ? "" : "(不計入本次報價)");
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      const ratio = cost !== 0 ? sells[t] / cost : 1;
      const displayCurrency = segmentDisplayCurrency(caseData, state, t);
      (opt.feeLines || []).forEach((fl) => {
        const rawCostQC = feeLineAmountIn(fl, ctx.cargo, rateTable, quoteCurrency, quoteCurrency);
        const displayAmount = rawCostQC == null ? null : convertCurrency(rawCostQC * ratio, quoteCurrency, displayCurrency, rateTable, quoteCurrency);
        quoteRows.push([label, fl.name, fl.basis, displayAmount == null ? "缺匯率" : Number(displayAmount.toFixed(2)), displayCurrency]);
      });
      const subtotalConverted = convertCurrency(sells[t], quoteCurrency, displayCurrency, rateTable, quoteCurrency);
      quoteRows.push([label, "小計", "", subtotalConverted == null ? "缺匯率" : Number(subtotalConverted.toFixed(2)), displayCurrency]);
    });
    quoteRows.push([`總計(${quoteCurrency})`, "", "", Number(sumSell.toFixed(2)), quoteCurrency]);
  }

  quoteRows.push([]);
  quoteRows.push(["總成本", Number(sumCost.toFixed(2)), quoteCurrency]);
  quoteRows.push(["報價總價", Number(sumSell.toFixed(2)), quoteCurrency]);
  quoteRows.push(["預期利潤", Number((sumSell - sumCost).toFixed(2)), quoteCurrency]);

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
          Number(opt.cost.subtotal.toFixed(2)),
          Number(opt.cost.total.toFixed(2)),
        ]);
      });
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(quoteRows), "報價單");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comparisonRows), "代理比較");
  XLSX.writeFile(wb, `${(caseData.ref || "quote").replace(/[\\/:*?"<>|]/g, "_")}-報價單.xlsx`);
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
    letterhead: ctx.caseData.letterhead || {},
    quoteCurrencyBySegment: { ...(ctx.caseData.quote_currency_by_segment || {}) },
  };

  root.innerHTML = `
    <div class="card">
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
            <option value="total">Total(含 possible 費用)</option>
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

    <div class="quote-toolbar">
      <button type="button" class="btn-small primary" id="q-export-pdf-btn">產生報價單 PDF</button>
      <button type="button" class="btn-small primary" id="q-export-excel-btn">產生報價單 Excel</button>
    </div>

    <div class="quote-preview" id="quote-preview"></div>
  `;

  document.getElementById("q-sell-mode").value = state.sellMode;
  document.getElementById("q-cost-basis").value = state.costBasis;
  document.getElementById("q-format").value = state.quoteFormat;
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
  document.getElementById("q-format").addEventListener("change", rerenderSellArea);

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
      const manualSellBySegmentPayload = { ...state.manualSellBySegment };
      if (formState.sellMode === "manual") {
        if (formState.quoteFormat === "allin") {
          manualSellAllinPayload = formState.manualAllinValue;
        } else {
          SEGMENT_TYPES.forEach((t) => {
            manualSellBySegmentPayload[t] = formState.perSegment[t].manualValue;
          });
        }
      }

      const payload = {
        sell_mode: formState.sellMode,
        cost_basis: formState.costBasis,
        quote_format: formState.quoteFormat,
        markup: markupPayload,
        manual_sell: { allin: manualSellAllinPayload, bySegment: manualSellBySegmentPayload },
        letterhead: readLetterheadForm(),
        quote_currency_by_segment: state.quoteCurrencyBySegment,
      };

      const { error } = await supabaseClient.from("cases").update(payload).eq("id", caseId);
      if (error) throw error;

      Object.assign(currentCase, payload);
      state.markup = payload.markup;
      state.manualSellAllin = payload.manual_sell.allin;
      state.manualSellBySegment = payload.manual_sell.bySegment;
    },
    { sectionId: "quote-settings" }
  );
  attachAutosaveListeners(root, quoteTrigger);

  document.getElementById("q-export-pdf-btn").addEventListener("click", () => exportQuotePdf(ctx.caseData));
  document.getElementById("q-export-excel-btn").addEventListener("click", () => {
    if (!lastComputed) recompute();
    exportQuoteExcel(ctx, state, lastComputed.formState, lastComputed.sells, lastComputed.sumCost, lastComputed.sumSell);
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
    agents = await fetchAgentsWithCosts(caseId);
  } catch (error) {
    root.innerHTML = `<div class="message error" style="display:block">讀取失敗:${error.message}</div>`;
    return;
  }

  const cargo = currentCase.cargo || {};
  const selection = currentCase.selection || {};
  // 內部成本/賣價計算恆定以 case.quote_currency 為基準(維持既有 markup 語意不變),
  // 每段/利潤要顯示成別的幣別,是 renderQuotePreview/renderProfitCards 最後才做的顯示層換算
  const selectedCosts = computeSelectedCosts(agents, selection, cargo, currentCase, currentCase.quote_currency);

  if (!selectedCosts.allSelected) {
    root.innerHTML = `<p class="empty-state">請先到「比較分析」分頁,為出口/國際/進口三段各選定一個成本組合,才能建立報價。</p>`;
    return;
  }

  renderQuoteRoot(root, { agents, cargo, selectedCosts, caseData: currentCase });
}
