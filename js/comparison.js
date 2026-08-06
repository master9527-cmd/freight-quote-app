// 比較分析分頁(spec 3):代理×三段矩陣、Lane 展開、警示、選段、成本總覽、匯出 Excel

function isWarned(opt, caseData) {
  if (!opt.lane) return null;
  const reasons = [];
  if (caseData.max_stops_allowed != null && opt.lane.stops_count != null && opt.lane.stops_count > caseData.max_stops_allowed) {
    reasons.push(`轉運${opt.lane.stops_count}站(上限${caseData.max_stops_allowed})`);
  }
  if (
    caseData.max_transit_days_allowed != null &&
    opt.lane.transit_days_max != null &&
    opt.lane.transit_days_max > caseData.max_transit_days_allowed
  ) {
    reasons.push(`運輸${opt.lane.transit_days_max}天(上限${caseData.max_transit_days_allowed})`);
  }
  return reasons.length ? reasons.join("、") : null;
}

function computeBestForSegmentType(agents, segType, cargo, caseData) {
  const all = [];
  agents.forEach((agent) => {
    const segment = agent.segmentsByType[segType];
    if (!segment) return;
    segmentOptions(segment, cargo, caseData.quote_currency).forEach((opt) => all.push({ opt, warn: isWarned(opt, caseData) }));
  });
  if (!all.length) return { subtotal: null, total: null };
  const unwarned = all.filter((o) => !o.warn);
  const pool = unwarned.length ? unwarned : all;
  return {
    subtotal: Math.min(...pool.map((o) => o.opt.cost.subtotal)),
    total: Math.min(...pool.map((o) => o.opt.cost.total)),
  };
}

function computeSelectedCosts(agents, selection, cargo, caseData) {
  const perSegment = {};
  let sumSubtotal = 0;
  let sumTotal = 0;
  let allSelected = true;

  SEGMENT_TYPES.forEach((segType) => {
    const sel = selection[segType];
    const agent = sel && agents.find((a) => a.id === sel.agentId);
    const segment = agent && agent.segmentsByType[segType];
    const opt = segment && segmentOptions(segment, cargo, caseData.quote_currency).find((o) => (o.laneId || null) === (sel.laneId || null));
    if (!opt) {
      allSelected = false;
      perSegment[segType] = null;
      return;
    }
    perSegment[segType] = { ...opt, agentName: agent.name };
    sumSubtotal += opt.cost.subtotal;
    sumTotal += opt.cost.total;
  });

  return { perSegment, sumSubtotal, sumTotal, allSelected };
}

function buildSegmentCell(segType, agent, segment, cargo, selection, caseData, best) {
  if (!segment) return `<td colspan="2">-</td>`;
  const options = segmentOptions(segment, cargo, caseData.quote_currency);
  if (!options.length) return `<td colspan="2">(尚無費用項目)</td>`;

  const currentSel = selection[segType];

  if (!segment.use_lanes) {
    const opt = options[0];
    const isSelected = currentSel && currentSel.agentId === agent.id && !currentSel.laneId;
    return `
      <td class="${best.subtotal === opt.cost.subtotal ? "cell-best" : ""}">${formatMoney(opt.cost.subtotal, "")}</td>
      <td class="${best.total === opt.cost.total ? "cell-best" : ""}">
        ${formatMoney(opt.cost.total, "")}
        <button type="button" class="select-btn ${isSelected ? "selected" : ""}" data-action="select" data-segtype="${segType}" data-agent-id="${agent.id}" data-lane-id="">${isSelected ? "已選用" : "選用"}</button>
      </td>
    `;
  }

  const rowId = `${agent.id}-${segType}`;
  const laneRows = options
    .map((opt) => {
      const isSelected = currentSel && currentSel.agentId === agent.id && currentSel.laneId === opt.laneId;
      const warn = isWarned(opt, caseData);
      return `
        <div class="lane-option-row">
          <span>${escapeHtml(opt.label)}${warn ? ` <span class="warning-badge">⚠ ${escapeHtml(warn)}</span>` : ""}</span>
          <span>${formatMoney(opt.cost.subtotal, "")} / ${formatMoney(opt.cost.total, "")}</span>
          <button type="button" class="select-btn ${isSelected ? "selected" : ""}" data-action="select" data-segtype="${segType}" data-agent-id="${agent.id}" data-lane-id="${opt.laneId}">${isSelected ? "已選用" : "選用"}</button>
        </div>
      `;
    })
    .join("");

  return `
    <td colspan="2">
      <button type="button" class="btn-link" data-action="toggle-lanes" data-row-id="${rowId}">${options.length} 條航線,點展開</button>
      <div class="lane-options" id="lane-options-${rowId}" style="display: none">${laneRows}</div>
    </td>
  `;
}

async function persistSelection(newSelection) {
  currentCase.selection = newSelection;
  const { error } = await supabaseClient.from("cases").update({ selection: newSelection }).eq("id", caseId);
  if (error) alert(`儲存選擇失敗:${error.message}`);
}

function exportComparisonExcel(agents, cargo, selection, caseData) {
  const rows = [["代理", "段落", "Lane/Carrier", "Subtotal", "Total", "轉運站數", "轉運天數(Max)", "警示", "已選用"]];

  SEGMENT_TYPES.forEach((segType) => {
    agents.forEach((agent) => {
      const segment = agent.segmentsByType[segType];
      if (!segment) return;
      segmentOptions(segment, cargo, caseData.quote_currency).forEach((opt) => {
        const sel = selection[segType];
        const isSelected = sel && sel.agentId === agent.id && (sel.laneId || null) === (opt.laneId || null);
        const warn = isWarned(opt, caseData);
        rows.push([
          agent.name,
          SEGMENT_TYPE_LABELS[segType],
          opt.label || "(單一成本)",
          Number(opt.cost.subtotal.toFixed(2)),
          Number(opt.cost.total.toFixed(2)),
          opt.lane ? (opt.lane.stops_count ?? "") : "",
          opt.lane ? (opt.lane.transit_days_max ?? "") : "",
          warn || "",
          isSelected ? "Y" : "",
        ]);
      });
    });
  });

  const selected = computeSelectedCosts(agents, selection, cargo, caseData);
  const summaryRows = [["段落", "代理", "Lane", "Subtotal", "Total"]];
  SEGMENT_TYPES.forEach((t) => {
    const opt = selected.perSegment[t];
    summaryRows.push([
      SEGMENT_TYPE_LABELS[t],
      opt ? opt.agentName : "(未選)",
      opt ? opt.label || "-" : "-",
      opt ? Number(opt.cost.subtotal.toFixed(2)) : "",
      opt ? Number(opt.cost.total.toFixed(2)) : "",
    ]);
  });
  summaryRows.push([]);
  summaryRows.push(["組合總成本(Subtotal)", "", "", "", Number(selected.sumSubtotal.toFixed(2))]);
  summaryRows.push(["組合總成本(Total)", "", "", "", Number(selected.sumTotal.toFixed(2))]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "選定組合總覽");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "代理比較");
  XLSX.writeFile(wb, `${(caseData.ref || "case").replace(/[\\/:*?"<>|]/g, "_")}-比較表.xlsx`);
}

function renderComparisonUI(root, { agents, cargo, selection, caseData }) {
  const selected = computeSelectedCosts(agents, selection, cargo, caseData);
  const bestByType = {};
  SEGMENT_TYPES.forEach((t) => (bestByType[t] = computeBestForSegmentType(agents, t, cargo, caseData)));

  const overviewHtml = `
    <div class="overview-cards">
      ${SEGMENT_TYPES.map(
        (t) => `
        <div class="overview-card">
          <div class="label">${SEGMENT_TYPE_LABELS[t]}(已選 Total)</div>
          <div class="value">${selected.perSegment[t] ? formatMoney(selected.perSegment[t].cost.total, caseData.quote_currency) : "未選"}</div>
        </div>`
      ).join("")}
      <div class="overview-card profit">
        <div class="label">組合總成本(Total)</div>
        <div class="value">${selected.allSelected ? formatMoney(selected.sumTotal, caseData.quote_currency) : "尚未選滿三段"}</div>
      </div>
    </div>
  `;

  const tableRows = agents
    .map(
      (agent) => `
    <tr>
      <td>${escapeHtml(agent.name)}</td>
      ${SEGMENT_TYPES.map((t) => buildSegmentCell(t, agent, agent.segmentsByType[t], cargo, selection, caseData, bestByType[t])).join("")}
    </tr>`
    )
    .join("");

  root.innerHTML = `
    ${overviewHtml}
    <div class="toolbar">
      <h2>代理成本比較</h2>
      <div style="display: flex; gap: 8px">
        <button type="button" class="btn-small" id="auto-best-combo-btn">套用最低成本組合</button>
        <button type="button" class="btn-small primary" id="export-comparison-btn">匯出比較表 Excel</button>
      </div>
    </div>
    <div class="comparison-table-wrap">
      <table class="comparison-table">
        <thead>
          <tr>
            <th rowspan="2">代理</th>
            <th colspan="2">${SEGMENT_TYPE_LABELS.export}</th>
            <th colspan="2">${SEGMENT_TYPE_LABELS.intl}</th>
            <th colspan="2">${SEGMENT_TYPE_LABELS.import}</th>
          </tr>
          <tr>
            <th>Subtotal</th>
            <th>Total</th>
            <th>Subtotal</th>
            <th>Total</th>
            <th>Subtotal</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;

  root.querySelector(".comparison-table").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    if (btn.dataset.action === "toggle-lanes") {
      const el = document.getElementById(`lane-options-${btn.dataset.rowId}`);
      el.style.display = el.style.display === "none" ? "block" : "none";
      return;
    }

    if (btn.dataset.action === "select") {
      const newSelection = {
        ...selection,
        [btn.dataset.segtype]: { agentId: btn.dataset.agentId, laneId: btn.dataset.laneId || null },
      };
      await persistSelection(newSelection);
      loadComparisonTab();
    }
  });

  document.getElementById("auto-best-combo-btn").addEventListener("click", async () => {
    const newSelection = {};
    SEGMENT_TYPES.forEach((t) => {
      let best = null;
      agents.forEach((agent) => {
        const segment = agent.segmentsByType[t];
        if (!segment) return;
        segmentOptions(segment, cargo, caseData.quote_currency).forEach((opt) => {
          const warn = isWarned(opt, caseData);
          const candidate = { agentId: agent.id, laneId: opt.laneId, cost: opt.cost.total, warn };
          if (!best || (best.warn && !candidate.warn) || (!!best.warn === !!candidate.warn && candidate.cost < best.cost)) {
            best = candidate;
          }
        });
      });
      if (best) newSelection[t] = { agentId: best.agentId, laneId: best.laneId };
    });
    await persistSelection(newSelection);
    loadComparisonTab();
  });

  document.getElementById("export-comparison-btn").addEventListener("click", () => {
    exportComparisonExcel(agents, cargo, selection, caseData);
  });
}

async function loadComparisonTab() {
  const root = document.getElementById("comparison-root");
  root.innerHTML = `<p class="empty-state">載入中...</p>`;

  let agents;
  try {
    agents = await fetchAgentsWithCosts(caseId);
  } catch (error) {
    root.innerHTML = `<div class="message error" style="display:block">讀取失敗:${error.message}</div>`;
    return;
  }

  if (!agents.length) {
    root.innerHTML = `<p class="empty-state">還沒有代理成本資料,請先在「代理成本」分頁新增。</p>`;
    return;
  }

  renderComparisonUI(root, {
    agents,
    cargo: currentCase.cargo || {},
    selection: currentCase.selection || {},
    caseData: currentCase,
  });
}
