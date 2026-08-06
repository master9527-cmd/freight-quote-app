// 報價分頁(spec 4):markup / 手動賣價切換、即時利潤、quoteFormat 三選一、PDF/Excel 匯出

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

function readQuoteFormState() {
  const sellMode = document.getElementById("q-sell-mode").value;
  const costBasis = document.getElementById("q-cost-basis").value;
  const quoteFormat = document.getElementById("q-format").value;
  const perSegment = {};

  SEGMENT_TYPES.forEach((t) => {
    if (sellMode === "manual") {
      const input = document.querySelector(`.q-manual-sell[data-segtype="${t}"]`);
      perSegment[t] = { manualValue: input ? Number(input.value || 0) : 0 };
    } else {
      const modeSel = document.querySelector(`.q-markup-mode[data-segtype="${t}"]`);
      const valInput = document.querySelector(`.q-markup-value[data-segtype="${t}"]`);
      perSegment[t] = { markupMode: modeSel ? modeSel.value : "percent", markupValue: valInput ? Number(valInput.value || 0) : 0 };
    }
  });

  return { sellMode, costBasis, quoteFormat, perSegment };
}

function renderSegmentRows(tbody, { selectedCosts, sellMode, costBasis, markup, manualSell, caseData }) {
  tbody.innerHTML = SEGMENT_TYPES.map((t) => {
    const cost = costForSegment(selectedCosts.perSegment, t, costBasis);
    const included = isSegmentInQuoteScope(caseData, t);
    const rowClass = included ? "" : ' class="scope-excluded-row"';
    const label = SEGMENT_TYPE_LABELS[t] + (included ? "" : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`);
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

function renderQuotePreview(ctx, formState, sells, sumCost, sumSell) {
  const lh = readLetterheadForm();
  const cargo = ctx.cargo || {};
  const currency = ctx.caseData.quote_currency;
  const unitsText = (cargo.units || []).map((u) => `${u.type} x${u.qty}`).join("、") || "-";

  let bodyHtml;
  if (formState.quoteFormat === "allin") {
    bodyHtml = `
      <table>
        <tr><th>項目</th><th>金額</th></tr>
        <tr><td>報價總價</td><td>${formatMoney(sumSell, currency)}</td></tr>
      </table>`;
  } else if (formState.quoteFormat === "segment") {
    bodyHtml = `
      <table>
        <tr><th>段落</th><th>金額</th></tr>
        ${SEGMENT_TYPES.map((t) => {
          const included = isSegmentInQuoteScope(ctx.caseData, t);
          const label = SEGMENT_TYPE_LABELS[t] + (included ? "" : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`);
          return `<tr${included ? "" : ' class="scope-excluded-row"'}><td>${label}</td><td>${formatMoney(sells[t], currency)}</td></tr>`;
        }).join("")}
        <tr><td><strong>總計</strong></td><td><strong>${formatMoney(sumSell, currency)}</strong></td></tr>
      </table>`;
  } else {
    bodyHtml =
      SEGMENT_TYPES.map((t) => {
        const opt = ctx.selectedCosts.perSegment[t];
        if (!opt) return `<p>${SEGMENT_TYPE_LABELS[t]}:尚未選定成本組合</p>`;
        const included = isSegmentInQuoteScope(ctx.caseData, t);
        const scopeBadge = included ? "" : ` <span class="scope-excluded-badge">(不計入本次報價)</span>`;
        const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
        const ratio = cost !== 0 ? sells[t] / cost : 1;
        const rows = (opt.feeLines || [])
          .map((fl) => {
            const rawCost = feeLineAmountInQuoteCurrency(fl, cargo, ctx.caseData.quote_currency);
            return `
              <tr>
                <td>${escapeHtml(fl.name)}${fl.certainty === "possible" ? " <em>(possible)</em>" : ""}</td>
                <td>${fl.basis}</td>
                <td>${feeLineDescriptionHtml(fl, cargo)}</td>
                <td>${formatMoney(rawCost * ratio, "")}</td>
              </tr>`;
          })
          .join("");
        return `
          <h4>${SEGMENT_TYPE_LABELS[t]}${opt.label ? " — " + escapeHtml(opt.label) : ""}${scopeBadge}</h4>
          <table>
            <tr><th>費用項目</th><th>Basis</th><th>說明</th><th>本次適用賣價</th></tr>
            ${rows}
            <tr><td colspan="3"><strong>小計</strong></td><td><strong>${formatMoney(sells[t], "")}</strong></td></tr>
          </table>`;
      }).join("") + `<p><strong>總計:${formatMoney(sumSell, currency)}</strong></p>`;
  }

  const preview = document.getElementById("quote-preview");
  preview.innerHTML = `
    ${lh.companyName ? `<h2>${escapeHtml(lh.companyName)}</h2>` : ""}
    ${lh.slogan ? `<p>${escapeHtml(lh.slogan)}</p>` : ""}
    ${lh.address ? `<p>${escapeHtml(lh.address)}</p>` : ""}
    ${lh.contact ? `<p>${escapeHtml(lh.contact)}</p>` : ""}
    <hr />
    <p><strong>案件:</strong>${escapeHtml(ctx.caseData.ref || "")} ${escapeHtml(ctx.caseData.name || "")}</p>
    <p><strong>航線:</strong>${escapeHtml(ctx.caseData.origin || "")} → ${escapeHtml(ctx.caseData.destination || "")}(${MODE_LABELS[ctx.caseData.mode] || ctx.caseData.mode})</p>
    <p><strong>貨量:</strong>${escapeHtml(unitsText)}${cargo.chargeableWeightKg != null ? `,計費重量 ${cargo.chargeableWeightKg}KG` : ""}${cargo.shipmentQty != null ? `,${cargo.shipmentQty} 票` : ""}</p>
    ${bodyHtml}
    ${lh.terms ? `<hr /><p style="font-size: 12px; color: #555">${escapeHtml(lh.terms)}</p>` : ""}
  `;
}

function recomputeAndRender(ctx) {
  const formState = readQuoteFormState();
  const sells = {};
  let sumCost = 0;
  let sumSell = 0;

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

  const profit = sumSell - sumCost;
  const marginPct = sumSell !== 0 ? (profit / sumSell) * 100 : 0;

  document.getElementById("q-profit-cards").innerHTML = `
    <div class="overview-card"><div class="label">總成本</div><div class="value">${formatMoney(sumCost, ctx.caseData.quote_currency)}</div></div>
    <div class="overview-card"><div class="label">報價總價</div><div class="value">${formatMoney(sumSell, ctx.caseData.quote_currency)}</div></div>
    <div class="overview-card profit"><div class="label">預期利潤</div><div class="value">${formatMoney(profit, ctx.caseData.quote_currency)}(${marginPct.toFixed(1)}%)</div></div>
  `;

  renderQuotePreview(ctx, formState, sells, sumCost, sumSell);
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

function exportQuoteExcel(ctx, formState, sells, sumCost, sumSell) {
  const lh = readLetterheadForm();
  const quoteRows = [];
  if (lh.companyName) quoteRows.push([lh.companyName]);
  if (lh.slogan) quoteRows.push([lh.slogan]);
  if (lh.address) quoteRows.push([lh.address]);
  if (lh.contact) quoteRows.push([lh.contact]);
  quoteRows.push([]);
  quoteRows.push(["案件", `${ctx.caseData.ref || ""} ${ctx.caseData.name || ""}`]);
  quoteRows.push(["航線", `${ctx.caseData.origin || ""} → ${ctx.caseData.destination || ""}`]);
  quoteRows.push([]);

  if (formState.quoteFormat === "allin") {
    quoteRows.push(["項目", "金額"]);
    quoteRows.push(["報價總價", Number(sumSell.toFixed(2))]);
  } else if (formState.quoteFormat === "segment") {
    quoteRows.push(["段落", "金額"]);
    SEGMENT_TYPES.forEach((t) => {
      const label = SEGMENT_TYPE_LABELS[t] + (isSegmentInQuoteScope(ctx.caseData, t) ? "" : "(不計入本次報價)");
      quoteRows.push([label, Number(sells[t].toFixed(2))]);
    });
    quoteRows.push(["總計", Number(sumSell.toFixed(2))]);
  } else {
    quoteRows.push(["段落", "費用項目", "Basis", "本次適用賣價"]);
    SEGMENT_TYPES.forEach((t) => {
      const opt = ctx.selectedCosts.perSegment[t];
      if (!opt) return;
      const label = SEGMENT_TYPE_LABELS[t] + (isSegmentInQuoteScope(ctx.caseData, t) ? "" : "(不計入本次報價)");
      const cost = costForSegment(ctx.selectedCosts.perSegment, t, formState.costBasis);
      const ratio = cost !== 0 ? sells[t] / cost : 1;
      (opt.feeLines || []).forEach((fl) => {
        const rawCost = feeLineAmountInQuoteCurrency(fl, ctx.cargo, ctx.caseData.quote_currency);
        quoteRows.push([label, fl.name, fl.basis, Number((rawCost * ratio).toFixed(2))]);
      });
      quoteRows.push([label, "小計", "", Number(sells[t].toFixed(2))]);
    });
    quoteRows.push(["總計", "", "", Number(sumSell.toFixed(2))]);
  }

  quoteRows.push([]);
  quoteRows.push(["總成本", Number(sumCost.toFixed(2))]);
  quoteRows.push(["報價總價", Number(sumSell.toFixed(2))]);
  quoteRows.push(["預期利潤", Number((sumSell - sumCost).toFixed(2))]);

  const comparisonRows = [["代理", "段落", "Lane/Carrier", "Subtotal", "Total"]];
  ctx.agents.forEach((agent) => {
    SEGMENT_TYPES.forEach((t) => {
      const segment = agent.segmentsByType[t];
      if (!segment) return;
      segmentOptions(segment, ctx.cargo, ctx.caseData.quote_currency).forEach((opt) => {
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
  XLSX.writeFile(wb, `${(ctx.caseData.ref || "quote").replace(/[\\/:*?"<>|]/g, "_")}-報價單.xlsx`);
}

function renderQuoteRoot(root, ctx) {
  const state = {
    sellMode: ctx.caseData.sell_mode || "markup",
    costBasis: ctx.caseData.cost_basis || "total",
    quoteFormat: ctx.caseData.quote_format || "segment",
    markup: ctx.caseData.markup || {},
    manualSell: ctx.caseData.manual_sell || {},
    letterhead: ctx.caseData.letterhead || {},
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

      <table style="width: 100%; margin-top: 12px; font-size: 13px">
        <thead>
          <tr><th style="text-align: left">段落</th><th style="text-align: left">成本</th><th style="text-align: left">加成設定 / 手動賣價</th><th style="text-align: left">賣價</th></tr>
        </thead>
        <tbody id="q-segment-rows"></tbody>
      </table>

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

  const tbody = document.getElementById("q-segment-rows");
  let lastComputed = null;

  function recompute() {
    lastComputed = recomputeAndRender(ctx);
  }

  function rerenderRows() {
    renderSegmentRows(tbody, {
      selectedCosts: ctx.selectedCosts,
      sellMode: document.getElementById("q-sell-mode").value,
      costBasis: document.getElementById("q-cost-basis").value,
      markup: state.markup,
      manualSell: state.manualSell,
      caseData: ctx.caseData,
    });
    recompute();
  }

  rerenderRows();

  document.getElementById("q-sell-mode").addEventListener("change", rerenderRows);
  document.getElementById("q-cost-basis").addEventListener("change", rerenderRows);
  document.getElementById("q-format").addEventListener("change", recompute);

  tbody.addEventListener("input", recompute);
  tbody.addEventListener("change", recompute);
  ["q-lh-company", "q-lh-slogan", "q-lh-address", "q-lh-contact", "q-lh-terms"].forEach((id) =>
    document.getElementById(id).addEventListener("input", recompute)
  );

  // 計價設定 + 公司抬頭改為 autosave(spec 6.5.4):取消「儲存報價設定」按鈕,
  // blur/change 時觸發存檔;上面 input/change → recompute() 純粹是即時預覽,跟這裡的實際持久化是兩件事,並存不衝突
  const quoteTrigger = createAutosaveTrigger(
    document.getElementById("q-save-status"),
    async () => {
      const formState = readQuoteFormState();
      const markupPayload = {};
      const manualSellPayload = {};
      SEGMENT_TYPES.forEach((t) => {
        if (formState.sellMode === "manual") {
          manualSellPayload[t] = formState.perSegment[t].manualValue;
        } else {
          markupPayload[t] = { mode: formState.perSegment[t].markupMode, value: formState.perSegment[t].markupValue };
        }
      });

      const payload = {
        sell_mode: formState.sellMode,
        cost_basis: formState.costBasis,
        quote_format: formState.quoteFormat,
        markup: formState.sellMode === "markup" ? markupPayload : ctx.caseData.markup || {},
        manual_sell: formState.sellMode === "manual" ? manualSellPayload : ctx.caseData.manual_sell || null,
        letterhead: readLetterheadForm(),
      };

      const { error } = await supabaseClient.from("cases").update(payload).eq("id", caseId);
      if (error) throw error;

      Object.assign(currentCase, payload);
      state.markup = payload.markup;
      state.manualSell = payload.manual_sell || {};
    },
    { sectionId: "quote-settings" }
  );
  attachAutosaveListeners(root, quoteTrigger);

  document.getElementById("q-export-pdf-btn").addEventListener("click", () => exportQuotePdf(ctx.caseData));
  document.getElementById("q-export-excel-btn").addEventListener("click", () => {
    if (!lastComputed) recompute();
    exportQuoteExcel(ctx, lastComputed.formState, lastComputed.sells, lastComputed.sumCost, lastComputed.sumSell);
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
  const selectedCosts = computeSelectedCosts(agents, selection, cargo, currentCase);

  if (!selectedCosts.allSelected) {
    root.innerHTML = `<p class="empty-state">請先到「比較分析」分頁,為出口/國際/進口三段各選定一個成本組合,才能建立報價。</p>`;
    return;
  }

  renderQuoteRoot(root, { agents, cargo, selectedCosts, caseData: currentCase });
}
