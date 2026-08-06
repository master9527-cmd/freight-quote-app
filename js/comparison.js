// 比較分析分頁(spec 3):代理×三段矩陣、Lane 展開、警示、選段、成本總覽、匯出 Excel
// v4(第21節):比較幣別可切換(不再固定用 case.quote_currency)、可依 Agent.role 篩選分組

// 這兩個是這個分頁自己的顯示狀態(不影響資料庫,只影響這個分頁畫面呈現),重新載入分頁時延續上次選擇,
// 除非選定的幣別已經不在案件目前的可用清單裡(如 quote_currency 被改掉),才會重置回 quote_currency
let comparisonDisplayCurrency = null;
let comparisonRoleFilter = "all";

function filterAgentsByRole(agents, roleFilter) {
  if (roleFilter === "all") return agents;
  return agents.filter((a) => (a.role || "both") === roleFilter || (a.role || "both") === "both");
}

// 金額 + 缺匯率警示樣式的共用呈現(spec 2.4/3節:缺匯率不能顯示成0或誤導的數字,要明確標示)
function formatMoneyWithMissingRate(amount, missingRate, currency) {
  const moneyHtml = formatMoney(amount, currency || "");
  return missingRate ? `${moneyHtml} <span class="cell-missing-rate">⚠ 缺匯率(不完整)</span>` : moneyHtml;
}

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

function computeBestForSegmentType(agents, segType, cargo, caseData, displayCurrency) {
  const all = [];
  agents.forEach((agent) => {
    const segment = agent.segmentsByType[segType];
    if (!segment) return;
    segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency).forEach((opt) =>
      all.push({ opt, warn: isWarned(opt, caseData) })
    );
  });
  if (!all.length) return { subtotal: null, total: null };
  const unwarned = all.filter((o) => !o.warn);
  const pool = unwarned.length ? unwarned : all;
  return {
    subtotal: Math.min(...pool.map((o) => o.opt.cost.subtotal)),
    total: Math.min(...pool.map((o) => o.opt.cost.total)),
  };
}

function computeSelectedCosts(agents, selection, cargo, caseData, displayCurrency) {
  const perSegment = {};
  let sumSubtotal = 0;
  let sumTotal = 0;
  let allSelected = true;

  SEGMENT_TYPES.forEach((segType) => {
    const sel = selection[segType];
    const agent = sel && agents.find((a) => a.id === sel.agentId);
    const segment = agent && agent.segmentsByType[segType];
    const opt =
      segment &&
      segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency).find(
        (o) => (o.laneId || null) === (sel.laneId || null)
      );
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

function buildSegmentCell(segType, agent, segment, cargo, selection, caseData, best, displayCurrency) {
  if (!segment) return `<td colspan="2">-</td>`;
  const options = segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency);
  if (!options.length) return `<td colspan="2">(尚無費用項目)</td>`;

  const currentSel = selection[segType];

  if (!segment.use_lanes) {
    const opt = options[0];
    const isSelected = currentSel && currentSel.agentId === agent.id && !currentSel.laneId;
    return `
      <td class="${best.subtotal === opt.cost.subtotal ? "cell-best" : ""}">${formatMoneyWithMissingRate(opt.cost.subtotal, opt.cost.missingRate)}</td>
      <td class="${best.total === opt.cost.total ? "cell-best" : ""}">
        ${formatMoneyWithMissingRate(opt.cost.total, opt.cost.missingRate)}
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
          <span>${formatMoneyWithMissingRate(opt.cost.subtotal, opt.cost.missingRate)} / ${formatMoneyWithMissingRate(opt.cost.total, opt.cost.missingRate)}</span>
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

function exportComparisonExcel(agents, cargo, selection, caseData, displayCurrency) {
  const rows = [["代理", "段落", "Lane/Carrier", `Subtotal(${displayCurrency})`, `Total(${displayCurrency})`, "轉運站數", "轉運天數(Max)", "警示", "缺匯率", "已選用"]];

  SEGMENT_TYPES.forEach((segType) => {
    agents.forEach((agent) => {
      const segment = agent.segmentsByType[segType];
      if (!segment) return;
      segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency).forEach((opt) => {
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
          opt.cost.missingRate ? "Y" : "",
          isSelected ? "Y" : "",
        ]);
      });
    });
  });

  const selected = computeSelectedCosts(agents, selection, cargo, caseData, displayCurrency);
  const summaryRows = [[`比較幣別:${displayCurrency}`], []];
  summaryRows.push(["段落", "代理", "Lane", "Subtotal", "Total", "缺匯率"]);
  SEGMENT_TYPES.forEach((t) => {
    const opt = selected.perSegment[t];
    summaryRows.push([
      SEGMENT_TYPE_LABELS[t],
      opt ? opt.agentName : "(未選)",
      opt ? opt.label || "-" : "-",
      opt ? Number(opt.cost.subtotal.toFixed(2)) : "",
      opt ? Number(opt.cost.total.toFixed(2)) : "",
      opt && opt.cost.missingRate ? "Y" : "",
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
  const currencies = caseAvailableCurrencies(caseData);
  if (!comparisonDisplayCurrency || !currencies.includes(comparisonDisplayCurrency)) {
    comparisonDisplayCurrency = caseData.quote_currency;
  }
  const displayCurrency = comparisonDisplayCurrency;

  const filteredAgents = filterAgentsByRole(agents, comparisonRoleFilter);

  const selected = computeSelectedCosts(agents, selection, cargo, caseData, displayCurrency);
  const bestByType = {};
  SEGMENT_TYPES.forEach((t) => (bestByType[t] = computeBestForSegmentType(filteredAgents, t, cargo, caseData, displayCurrency)));

  const overviewHtml = `
    <div class="overview-cards">
      ${SEGMENT_TYPES.map(
        (t) => `
        <div class="overview-card">
          <div class="label">${SEGMENT_TYPE_LABELS[t]}(已選 Total)</div>
          <div class="value">${selected.perSegment[t] ? formatMoneyWithMissingRate(selected.perSegment[t].cost.total, selected.perSegment[t].cost.missingRate, displayCurrency) : "未選"}</div>
        </div>`
      ).join("")}
      <div class="overview-card profit">
        <div class="label">組合總成本(Total)</div>
        <div class="value">${selected.allSelected ? formatMoney(selected.sumTotal, displayCurrency) : "尚未選滿三段"}</div>
      </div>
    </div>
  `;

  const tableRows = filteredAgents
    .map(
      (agent) => `
    <tr>
      <td>${escapeHtml(agent.name)}${agent.role && agent.role !== "both" ? ` <span class="warning-badge" style="color:var(--color-text-muted)">(${escapeHtml(AGENT_ROLE_LABELS[agent.role])})</span>` : ""}</td>
      ${SEGMENT_TYPES.map((t) => buildSegmentCell(t, agent, agent.segmentsByType[t], cargo, selection, caseData, bestByType[t], displayCurrency)).join("")}
    </tr>`
    )
    .join("");

  root.innerHTML = `
    ${overviewHtml}
    <div class="toolbar">
      <h2>代理成本比較</h2>
      <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
        <div class="currency-selector">
          <label for="comparison-currency-select">比較幣別</label>
          <select id="comparison-currency-select">
            ${currencies.map((c) => `<option value="${escapeHtml(c)}" ${c === displayCurrency ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
          </select>
        </div>
        <div class="role-filter">
          <label for="comparison-role-filter">代理角色</label>
          <select id="comparison-role-filter">
            <option value="all" ${comparisonRoleFilter === "all" ? "selected" : ""}>全部</option>
            <option value="export" ${comparisonRoleFilter === "export" ? "selected" : ""}>出口地代理</option>
            <option value="import" ${comparisonRoleFilter === "import" ? "selected" : ""}>進口地代理</option>
          </select>
        </div>
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
            <th>Subtotal(${escapeHtml(displayCurrency)})</th>
            <th>Total(${escapeHtml(displayCurrency)})</th>
            <th>Subtotal(${escapeHtml(displayCurrency)})</th>
            <th>Total(${escapeHtml(displayCurrency)})</th>
            <th>Subtotal(${escapeHtml(displayCurrency)})</th>
            <th>Total(${escapeHtml(displayCurrency)})</th>
          </tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="7">此篩選條件下沒有符合的代理</td></tr>`}</tbody>
      </table>
    </div>
  `;

  document.getElementById("comparison-currency-select").addEventListener("change", (event) => {
    comparisonDisplayCurrency = event.target.value;
    renderComparisonUI(root, { agents, cargo, selection, caseData });
  });

  document.getElementById("comparison-role-filter").addEventListener("change", (event) => {
    comparisonRoleFilter = event.target.value;
    renderComparisonUI(root, { agents, cargo, selection, caseData });
  });

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
      filteredAgents.forEach((agent) => {
        const segment = agent.segmentsByType[t];
        if (!segment) return;
        segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency).forEach((opt) => {
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
    exportComparisonExcel(filteredAgents, cargo, selection, caseData, displayCurrency);
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
