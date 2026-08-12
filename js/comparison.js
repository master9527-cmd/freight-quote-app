// 比較分析分頁(spec 3):代理×三段矩陣、Lane 展開、警示、選段、成本總覽、匯出 Excel
// v4(第21節):比較幣別可切換(不再固定用 case.quote_currency)、可依 Agent.role 篩選分組

// 這兩個是這個分頁自己的顯示狀態(不影響資料庫,只影響這個分頁畫面呈現),重新載入分頁時延續上次選擇,
// 除非選定的幣別已經不在案件目前的可用清單裡(如 quote_currency 被改掉),才會重置回 quote_currency
let comparisonDisplayCurrency = null;
let comparisonRoleFilter = "all";
// 段落篩選(spec 3.1):只影響代理×段矩陣表格與匯出要看哪幾段,不影響底層資料/其他段位的正常運作
let comparisonSegmentFilter = "all";
// 自訂重量情境分析狀態(spec 3.2):純畫面分析用途,不持久化、不影響案件實際計費重量
let comparisonWhatIf = null;

function visibleSegmentTypesFor(filter) {
  return filter === "all" ? SEGMENT_TYPES : [filter];
}

function filterAgentsByRole(agents, roleFilter) {
  if (roleFilter === "all") return agents;
  return agents.filter((a) => (a.role || "both") === roleFilter || (a.role || "both") === "both");
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
    // spec 3節(第32節修正):role不涵蓋這段的代理,結構性不適用,不能拿去比「最低成本」
    if (!roleCoversSegment(agent.role, segType)) return;
    const segment = agent.segmentsByType[segType];
    if (!segment) return;
    segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency).forEach((opt) =>
      all.push({ opt, warn: isWarned(opt, caseData) })
    );
  });
  if (!all.length) return { subtotal: null, total: null };
  // 第46節統整版:有pending費用(驅動數字未定)的選項,total不計入該筆費用,金額會顯得「異常便宜」,
  // 不能被誤判成真的最低成本——比照既有warn的分級退回邏輯,優先選「沒警示且沒pending」的,
  // 都沒有才依序放寬到「沒警示」「全部」
  const unwarned = all.filter((o) => !o.warn);
  const unwarnedCertain = unwarned.filter((o) => !o.opt.cost.pendingCount);
  const pool = unwarnedCertain.length ? unwarnedCertain : unwarned.length ? unwarned : all;
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
  let anySelected = false;
  let missingRate = false;
  let incompleteCount = 0;
  let pendingCount = 0;

  SEGMENT_TYPES.forEach((segType) => {
    // spec 38節:quoteScope=false的段落(如三角貿易的出口段)依貿易條件不需要跟客戶收費,不需要選定代理,
    // 直接跳過——不能讓這種段落也去檢查allSelected,否則「組合總成本」會被卡在「尚未選滿三段」
    const scopeIncluded = caseData.quote_scope ? caseData.quote_scope[segType] !== false : true;
    if (!scopeIncluded) {
      perSegment[segType] = null;
      return;
    }
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
    anySelected = true;
    perSegment[segType] = { ...opt, agentName: agent.name };
    sumSubtotal += opt.cost.subtotal;
    sumTotal += opt.cost.total;
    if (opt.cost.missingRate) missingRate = true;
    incompleteCount += opt.cost.incompleteCount || 0;
    pendingCount += opt.cost.pendingCount || 0;
  });

  return { perSegment, sumSubtotal, sumTotal, allSelected, anySelected, missingRate, incompleteCount, pendingCount };
}

function buildSegmentCell(segType, agent, segment, cargo, selection, caseData, best, displayCurrency) {
  // spec 3節(第32節修正):role不涵蓋這段業務,是結構性「不適用」,不是「0元」——不顯示金額、不給選用按鈕,
  // 避免使用者誤把這個代理根本不承接的段落當成一筆可比較、可選用的報價
  if (!roleCoversSegment(agent.role, segType)) return `<td colspan="2" class="cell-not-applicable">－不適用</td>`;

  // spec 38節:quoteScope=false是案件層級的設定(這段依貿易條件不需要跟客戶收費),跟上面role結構性不適用是
  // 兩種不同原因——role檢查優先(代理本來就做不到這段業務,無關這個案件的貿易條件)。這裡的成本資料仍可顯示供內部
  // 參考(畢竟使用者可能還是想知道這段大概多少錢),但不给「選用」按鈕,不要求使用者選擇
  const scopeIncluded = caseData.quote_scope ? caseData.quote_scope[segType] !== false : true;

  if (!segment) return `<td colspan="2">${scopeIncluded ? "-" : '<span class="cell-scope-excluded">－依貿易條件不需報價</span>'}</td>`;
  const options = segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency);
  if (!options.length) return `<td colspan="2">(尚無費用項目)</td>`;

  if (!scopeIncluded) {
    if (!segment.use_lanes) {
      const opt = options[0];
      return `
        <td colspan="2" class="cell-scope-excluded">
          ${formatCostAmount(opt.cost.subtotal, opt.cost, "")} / ${formatCostAmount(opt.cost.total, opt.cost, "")}
          <div class="cell-scope-note">－依貿易條件不需報價</div>
        </td>
      `;
    }
    return `
      <td colspan="2" class="cell-scope-excluded">
        ${options.length} 條航線
        <div class="cell-scope-note">－依貿易條件不需報價</div>
      </td>
    `;
  }

  const currentSel = selection[segType];

  if (!segment.use_lanes) {
    const opt = options[0];
    const isSelected = currentSel && currentSel.agentId === agent.id && !currentSel.laneId;
    return `
      <td class="${best.subtotal === opt.cost.subtotal ? "cell-best" : ""}">${formatCostAmount(opt.cost.subtotal, opt.cost, "")}</td>
      <td class="${best.total === opt.cost.total ? "cell-best" : ""}">
        ${formatCostAmount(opt.cost.total, opt.cost, "")}
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
          <span>${formatCostAmount(opt.cost.subtotal, opt.cost, "")} / ${formatCostAmount(opt.cost.total, opt.cost, "")}</span>
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

// ============================================================
// 自訂重量情境分析(spec 3.2,What-if):純粹分析用途,把 cargo.chargeableWeightKg 換成使用者輸入的假設重量,
// 重新套用 segmentOptions/feeLineTotals 算出該段所有代理/Lane 在這個假設重量下的 Subtotal/Total——
// 不改案件真正的 cargo、不寫回資料庫,跟報價頁實際算出來的金額是兩件互不影響的事
// ============================================================

function parseWeightList(text) {
  return Array.from(
    new Set(
      (text || "")
        .split(/[,，\s]+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ).sort((a, b) => a - b);
}

// rows: [{ agentName, label, cells: [{subtotal,total,missingRate,bracketFloor}, ...同 weights 順序] }]
// spec 第39.2節:每個情境重量w先判斷落在哪個級距(bracketFloor),改用bracketFloor(不是w本身)代入計算+當除數,
// 業界慣例是「還沒確定最終重量落在哪一階時,用該階下限反推保守估價」,不是直接用使用者輸入值算
function computeWhatIfTable(agents, segType, cargo, caseData, displayCurrency, weights) {
  const baseOptions = [];
  agents.forEach((agent) => {
    const segment = agent.segmentsByType[segType];
    if (!segment) return;
    segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency).forEach((opt) => {
      baseOptions.push({ agentId: agent.id, agentName: agent.name, laneId: opt.laneId || null, label: opt.label, feeLines: opt.feeLines });
    });
  });

  return baseOptions.map((base) => {
    const agent = agents.find((a) => a.id === base.agentId);
    const segment = agent.segmentsByType[segType];
    // 同一個選項(段落本身或某條Lane)通常只有一筆代表主運費的perKgBreak費用,取第一筆當代表——
    // 範圍克制:不逐筆處理「同一個選項裡有多筆perKgBreak各自級距不同」這種少見情況
    const breakLine = (base.feeLines || []).find((fl) => fl.basis === "perKgBreak" && (fl.breaks || []).length);
    const cells = weights.map((w) => {
      // 級距下限算出來是0時,不能直接拿去當chargeableWeightKg代入——會被feeLineAmountDetailed()的hasWeight判斷
      // (chargeableWeightKg>0)誤判成「缺計費重量」。這在兩種情況下都會發生,不是只有「只有一階」才會:
      // (1) 簡單模式,只有一階、thresholdKg固定是0——任何w都落在這階,floor必然是0;
      // (2) 多階,但w剛好落在「門檻是0」的第一階範圍內(還沒到第二階門檻)——floor一樣算出0。
      // 這兩種情況的0都不是「沒填」,是「這一階本來就從0kg開始適用」,應該直接用情境重量w本身代入計算。
      // 只有w真的落在門檻>0的較高階時,floor才有「反推保守估價」的意義,這時才套用applicableBreakFloor的結果。
      const rawBracketFloor = breakLine ? applicableBreakFloor(breakLine.breaks, w) : w;
      const bracketFloor = rawBracketFloor > 0 ? rawBracketFloor : w;
      const cargoAtWeight = { ...cargo, chargeableWeightKg: bracketFloor };
      const opts = segmentOptions(segment, cargoAtWeight, caseData.rate_table, caseData.quote_currency, displayCurrency);
      const match = opts.find((o) => (o.laneId || null) === base.laneId);
      return match
        ? { ...match.cost, bracketFloor }
        : { subtotal: 0, total: 0, missingRate: false, incompleteCount: 0, pendingCount: 0, bracketFloor };
    });
    return { agentName: base.agentName, label: base.label, cells };
  });
}

// 情境重量下的「換算每KG單價」= 該情境Total ÷ bracketFloor(spec 39.2節修正,不是原始情境重量):
// 跟 3.3 節「混合換算成單一單位」是同一個概念,套用到每一個自訂情境重量上,
// 讓使用者不用自己心算就能看出「貨量越重,單位成本是不是越划算」。缺匯率/資料不完整時不換算,沿用既有警示樣式。
function whatIfPerKgHtml(cost, displayCurrency) {
  if (cost.missingRate || cost.incompleteCount || cost.pendingCount) return "";
  // 用 == null 明確排除「沒有bracketFloor可用」,再另外擋 <=0 防除以零——不用 !cost.bracketFloor 這種寫法,
  // 因為那會把「合法算出來是0」跟「根本没有值」混在一起判斷,跟39.2節其他函式(如whatIfBracketNoteHtml)的判斷方式不一致
  if (cost.bracketFloor == null || cost.bracketFloor <= 0) return "";
  return ` <span class="per-kg-hint">(≈ ${formatMoney(cost.total / cost.bracketFloor, displayCurrency)}/KG)</span>`;
}

// spec 第39.2節第3點:畫面要清楚標示「此情境對應級距下限:Xkg」,讓使用者知道系統實際計算用的是哪個數字,
// 不是他原始輸入的重量——只在下限跟原始輸入不同時才顯示,兩者相同時(輸入值本來就剛好是某個門檻)不用多此一舉
function whatIfBracketNoteHtml(cost, weight) {
  if (cost.missingRate || cost.incompleteCount || cost.pendingCount || cost.bracketFloor == null) return "";
  if (cost.bracketFloor === weight) return "";
  return `<div class="whatif-bracket-note">此情境對應級距下限:${cost.bracketFloor}kg</div>`;
}

// spec 45.1:改成一次畫一個段落的表格,外層(renderWhatIfResultHtml)迴圈呼叫,三段同時並排呈現,
// 不再是「選一段、切換著看」——共用同一組weights(情境重量橫向比較用同一組數字)
function renderWhatIfTableHtml(segType, rows, weights, displayCurrency) {
  if (!rows.length) return `<p class="empty-state">此段落目前沒有代理/Lane 資料可供分析</p>`;
  return `
    <div class="comparison-table-wrap">
      <table class="comparison-table">
        <thead>
          <tr><th>代理/Lane</th>${weights.map((w) => `<th>${w}KG(Total／換算每KG單價)</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${escapeHtml(r.agentName)}${r.label ? " — " + escapeHtml(r.label) : ""}</td>
              ${r.cells
                .map(
                  (c, i) =>
                    `<td>${formatCostAmount(c.total, c, "")}${whatIfPerKgHtml(c, displayCurrency)}${whatIfBracketNoteHtml(c, weights[i])}</td>`
                )
                .join("")}
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// spec 45.1:三段(出口/國際/進口,只列有perKgBreak資料的段落)同時呈現,各自一張表但共用同一組情境重量,
// 讓使用者橫向比較同一批貨在不同段落、不同重量假設下的表現,不用來回切換段落
function renderWhatIfResultHtml(eligibleTypes, whatIf, displayCurrency) {
  if (!whatIf.weights.length) return "";
  const sections = eligibleTypes
    .map((t) => {
      const rows = whatIf.bySegType[t] || [];
      return `<h3 style="margin-top: 16px">${SEGMENT_TYPE_LABELS[t]}</h3>${renderWhatIfTableHtml(t, rows, whatIf.weights, displayCurrency)}`;
    })
    .join("");
  return `
    ${sections}
    <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 6px">
      金額單位:${escapeHtml(displayCurrency)},為套用假設重量後的 Total(含 possible 費用)與換算後的每KG單價,純供分析比較,不影響案件實際計費重量與報價金額
    </p>
  `;
}

function renderWhatIfSection(container, { agents, cargo, caseData, displayCurrency }) {
  // 只有段落底下存在 perKgBreak 費用時才顯示這個區塊(spec 3.2),避免對用不到這個功能的案件造成干擾——
  // spec 45.1:這裡決定的是「要並排顯示哪幾段的表格」,不是「目前選哪一段」,不再有單一active segType的概念
  const eligibleTypes = SEGMENT_TYPES.filter((t) => agents.some((a) => segmentHasPerKgBreak(a.segmentsByType[t])));
  if (!eligibleTypes.length) {
    container.innerHTML = "";
    comparisonWhatIf = null;
    return;
  }
  if (!comparisonWhatIf) {
    comparisonWhatIf = { weightsText: "", weights: [], bySegType: {} };
  }
  const whatIf = comparisonWhatIf;

  container.innerHTML = `
    <div class="card">
      <h2>自訂重量情境分析(What-if,僅供分析用途,不影響案件實際計費重量)</h2>
      <div class="form-grid">
        <div class="field-inline field-full">
          <label for="whatif-weights">情境重量(KG,以逗號或空白分隔,如 100,300,500,1000)</label>
          <input type="text" id="whatif-weights" value="${escapeHtml(whatIf.weightsText)}" placeholder="100,300,500,1000" />
          <button type="button" class="btn-link" id="whatif-fill-thresholds-btn">帶入此費用的級距下限</button>
        </div>
      </div>
      <button type="button" class="btn-small" id="whatif-run-btn">套用情境重量</button>
      <div id="whatif-result" style="margin-top: 12px">${renderWhatIfResultHtml(eligibleTypes, whatIf, displayCurrency)}</div>
    </div>
  `;

  // spec 第39.2節第4點,45.1延伸:抓「所有並排顯示段落」底下所有代理/Lane的perKgBreak費用實際定義的門檻值
  // (聯集、去重、排序),讓使用者不用自己猜著打數字——一鍵帶入所有已定義的級距門檻當情境重量,
  // 填完還是要按「套用情境重量」才會真的跑分析
  document.getElementById("whatif-fill-thresholds-btn").addEventListener("click", () => {
    const thresholds = new Set();
    agents.forEach((agent) => {
      eligibleTypes.forEach((t) => {
        const segment = agent.segmentsByType[t];
        if (!segment) return;
        const allFeeLines = segment.use_lanes ? (segment.lanes || []).flatMap((l) => l.feeLines || []) : segment.feeLines || [];
        allFeeLines.forEach((fl) => {
          if (fl.basis !== "perKgBreak") return;
          (fl.breaks || []).forEach((b) => {
            const t2 = Number(b.thresholdKg);
            if (Number.isFinite(t2)) thresholds.add(t2);
          });
        });
      });
    });
    const sorted = Array.from(thresholds).sort((a, b) => a - b);
    document.getElementById("whatif-weights").value = sorted.join(",");
  });

  document.getElementById("whatif-run-btn").addEventListener("click", () => {
    const text = document.getElementById("whatif-weights").value;
    const weights = parseWeightList(text);
    whatIf.weightsText = text;
    whatIf.weights = weights;
    whatIf.bySegType = {};
    if (weights.length) {
      eligibleTypes.forEach((t) => {
        whatIf.bySegType[t] = computeWhatIfTable(agents, t, cargo, caseData, displayCurrency, weights);
      });
    }
    document.getElementById("whatif-result").innerHTML = weights.length
      ? renderWhatIfResultHtml(eligibleTypes, whatIf, displayCurrency)
      : `<p class="empty-state">請輸入至少一個有效的情境重量</p>`;
  });
}

// 一個段落的情境重量分析結果轉成一張Excel工作表的內容(spec 3.2/39.2);沒資料回傳null,呼叫端不加這張表
function buildWhatIfExcelSheet(segType, rows, weights, displayCurrency) {
  if (!rows.length) return null;
  // spec 第39.2節:每KG單價的除數改用bracketFloor(級距下限),不是原始輸入的情境重量,並多附一欄實際採用的下限值
  const header = [
    "代理/Lane",
    ...weights.flatMap((w) => [`${w}KG Total(${displayCurrency})`, `${w}KG 換算每KG單價(${displayCurrency})`, `${w}KG 實際採用級距下限(kg)`]),
  ];
  const sheet = [[`情境重量分析 — ${SEGMENT_TYPE_LABELS[segType]}(比較幣別:${displayCurrency})`], [], header];
  rows.forEach((r) => {
    sheet.push([
      `${r.agentName}${r.label ? " — " + r.label : ""}`,
      ...r.cells.flatMap((c) => {
        if (c.missingRate || c.incompleteCount) return ["缺匯率/資料不完整", "", ""];
        if (c.pendingCount) return ["依實際計費重量另計", "", ""];
        const floor = c.bracketFloor;
        return [Number(c.total.toFixed(2)), floor ? Number((c.total / floor).toFixed(2)) : "", floor ?? ""];
      }),
    ]);
  });
  return sheet;
}

// spec 45.1:三段(有perKgBreak資料的段落)各自產生一張工作表,只有該段有資料時才附上——
// 呼叫端(exportComparisonExcel)用comparisonWhatIf目前的weights,對每個eligible段落各跑一次computeWhatIfTable
function buildWhatIfExcelSheets(agents, whatIf, cargo, caseData, displayCurrency) {
  if (!whatIf || !whatIf.weights.length) return [];
  const eligibleTypes = SEGMENT_TYPES.filter((t) => agents.some((a) => segmentHasPerKgBreak(a.segmentsByType[t])));
  return eligibleTypes
    .map((t) => {
      const rows = computeWhatIfTable(agents, t, cargo, caseData, displayCurrency, whatIf.weights);
      const sheet = buildWhatIfExcelSheet(t, rows, whatIf.weights, displayCurrency);
      return sheet ? { name: `情境重量分析-${SEGMENT_TYPE_LABELS[t]}`, sheet } : null;
    })
    .filter(Boolean);
}

// spec 29.1:project案件的selection存在目前作用中的情境(scenarios表),否則維持存在案件本身(cases表)——
// getActiveRecordTarget()(caseDetail.js)統一判斷要寫哪張表哪一列,這裡不用另外判斷是否為project案件
async function persistSelection(newSelection) {
  const target = getActiveRecordTarget();
  if (target.table === "scenarios") {
    const sc = activeScenario();
    if (sc) sc.selection = newSelection;
  } else {
    currentCase.selection = newSelection;
  }
  const { error } = await supabaseClient.from(target.table).update({ selection: newSelection }).eq("id", target.id);
  if (error) alert(`儲存選擇失敗:${error.message}`);
}

// segmentTypes(spec 3.1):只匯出目前篩選出來的段落,預設(未傳入時)沿用完整三段,向下相容既有呼叫端
function exportComparisonExcel(agents, cargo, selection, caseData, displayCurrency, segmentTypes) {
  const types = segmentTypes && segmentTypes.length ? segmentTypes : SEGMENT_TYPES;
  const isFullExport = types.length === SEGMENT_TYPES.length;
  const rows = [
    ["代理", "段落", "Lane/Carrier", `Subtotal(${displayCurrency})`, `Total(${displayCurrency})`, "轉運站數", "轉運天數(Max)", "警示", "缺匯率", "無法計算項目數(spec27.2)", "未定項目數(依實際計費重量另計)", "已選用"],
  ];

  types.forEach((segType) => {
    agents.forEach((agent) => {
      // spec 3節(第32節修正):role不涵蓋這段的代理不列入匯出比較,避免匯出檔裡出現結構性不適用的0.00
      if (!roleCoversSegment(agent.role, segType)) return;
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
          opt.cost.incompleteCount || "",
          opt.cost.pendingCount || "",
          isSelected ? "Y" : "",
        ]);
      });
    });
  });

  const selected = computeSelectedCosts(agents, selection, cargo, caseData, displayCurrency);
  const summaryRows = [
    [`比較幣別:${displayCurrency}`],
    [isFullExport ? "範圍:完整三段" : `範圍:僅 ${types.map((t) => SEGMENT_TYPE_LABELS[t]).join("、")}`],
    [],
  ];
  summaryRows.push(["段落", "代理", "Lane", "Subtotal", "Total", "缺匯率", "無法計算項目數", "未定項目數(依實際計費重量另計)"]);
  types.forEach((t) => {
    const opt = selected.perSegment[t];
    const scopeIncluded = caseData.quote_scope ? caseData.quote_scope[t] !== false : true;
    summaryRows.push([
      SEGMENT_TYPE_LABELS[t],
      opt ? opt.agentName : scopeIncluded ? "(未選)" : "(依貿易條件不需報價)",
      opt ? opt.label || "-" : "-",
      opt ? Number(opt.cost.subtotal.toFixed(2)) : "",
      opt ? Number(opt.cost.total.toFixed(2)) : "",
      opt && opt.cost.missingRate ? "Y" : "",
      opt && opt.cost.incompleteCount ? opt.cost.incompleteCount : "",
      opt && opt.cost.pendingCount ? opt.cost.pendingCount : "",
    ]);
  });
  summaryRows.push([]);
  // 篩選成只看單一/兩段時,「組合總成本」是完整三段加總,對只匯出的段落來說沒有意義,只在匯出完整三段時附上(spec 3.1)
  if (isFullExport) {
    // 第46節統整版:組合裡若有段落是「依實際計費重量另計」(pendingCount>0且沒有真的incomplete/missingRate),
    // 不能讓Subtotal/Total看起來像是算好的完整數字(呼應spec45.2第3點),用文字註記取代
    const partiallyPending = selected.pendingCount && !selected.incompleteCount && !selected.missingRate;
    summaryRows.push([
      "組合總成本(Subtotal)",
      "",
      "",
      "",
      partiallyPending ? "部分依實際計費重量另計" : Number(selected.sumSubtotal.toFixed(2)),
    ]);
    summaryRows.push([
      "組合總成本(Total)",
      "",
      "",
      "",
      partiallyPending ? "部分依實際計費重量另計" : Number(selected.sumTotal.toFixed(2)),
    ]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "選定組合總覽");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "代理比較");
  // spec 45.1:情境重量分析改成一段一張工作表(不再只匯出目前選定的單一段),沒資料的段落不附上
  buildWhatIfExcelSheets(agents, comparisonWhatIf, cargo, caseData, displayCurrency).forEach(({ name, sheet }) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), name);
  });
  XLSX.writeFile(wb, `${(caseData.ref || "case").replace(/[\\/:*?"<>|]/g, "_")}-比較表.xlsx`);
}

function renderComparisonUI(root, { agents, cargo, selection, caseData }) {
  const currencies = caseAvailableCurrencies(caseData);
  if (!comparisonDisplayCurrency || !currencies.includes(comparisonDisplayCurrency)) {
    comparisonDisplayCurrency = caseData.quote_currency;
  }
  const displayCurrency = comparisonDisplayCurrency;

  const filteredAgents = filterAgentsByRole(agents, comparisonRoleFilter);
  // spec 3.1:段落篩選純粹是畫面呈現層級,只影響下面矩陣表格要顯示/匯出哪幾欄,不影響 selection/成本資料本身
  const visibleTypes = visibleSegmentTypesFor(comparisonSegmentFilter);

  const selected = computeSelectedCosts(agents, selection, cargo, caseData, displayCurrency);
  const bestByType = {};
  SEGMENT_TYPES.forEach((t) => (bestByType[t] = computeBestForSegmentType(filteredAgents, t, cargo, caseData, displayCurrency)));

  const overviewHtml = `
    <div class="overview-cards" id="comparison-overview">
      ${SEGMENT_TYPES.map((t) => {
        // spec 38節:三種「空白」原因要分開標示——quoteScope=false是案件層級設定,不是「還沒選」
        const scopeIncluded = caseData.quote_scope ? caseData.quote_scope[t] !== false : true;
        const valueHtml = !scopeIncluded
          ? '<span class="cell-scope-excluded">－依貿易條件不需報價</span>'
          : selected.perSegment[t]
          ? formatCostAmount(selected.perSegment[t].cost.total, selected.perSegment[t].cost, displayCurrency)
          : "未選";
        return `
        <div class="overview-card">
          <div class="label">${SEGMENT_TYPE_LABELS[t]}(已選 Total)</div>
          <div class="value">${valueHtml}</div>
        </div>`;
      }).join("")}
      <div class="overview-card profit">
        <div class="label">組合總成本(Total)</div>
        <div class="value">${
          !selected.allSelected
            ? "尚未選滿三段"
            : selected.pendingCount && !selected.incompleteCount && !selected.missingRate
            ? `<span class="whatif-bracket-note">部分依實際計費重量另計</span>`
            : formatMoney(selected.sumTotal, displayCurrency) + costWarningBadgeHtml(selected)
        }</div>
      </div>
    </div>
  `;

  const tableRows = filteredAgents
    .map(
      (agent) => `
    <tr>
      <td>${escapeHtml(agent.name)}${agent.role && agent.role !== "both" ? ` <span class="warning-badge" style="color:var(--color-text-muted)">(${escapeHtml(AGENT_ROLE_LABELS[agent.role])})</span>` : ""}</td>
      ${visibleTypes.map((t) => buildSegmentCell(t, agent, agent.segmentsByType[t], cargo, selection, caseData, bestByType[t], displayCurrency)).join("")}
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
        <div class="role-filter">
          <label for="comparison-segment-filter">段落篩選</label>
          <select id="comparison-segment-filter">
            <option value="all" ${comparisonSegmentFilter === "all" ? "selected" : ""}>全部顯示</option>
            <option value="export" ${comparisonSegmentFilter === "export" ? "selected" : ""}>只顯示出口段</option>
            <option value="intl" ${comparisonSegmentFilter === "intl" ? "selected" : ""}>只顯示國際運輸段</option>
            <option value="import" ${comparisonSegmentFilter === "import" ? "selected" : ""}>只顯示進口段</option>
          </select>
        </div>
        <button type="button" class="btn-small" id="auto-best-combo-btn">套用最低成本組合</button>
        <button type="button" class="btn-small primary" id="export-comparison-btn">匯出比較表 Excel</button>
      </div>
    </div>
    <div class="comparison-table-wrap" id="comparison-table-section">
      <table class="comparison-table">
        <thead>
          <tr>
            <th rowspan="2">代理</th>
            ${visibleTypes.map((t) => `<th colspan="2">${SEGMENT_TYPE_LABELS[t]}</th>`).join("")}
          </tr>
          <tr>
            ${visibleTypes.map((t) => `<th>Subtotal(${escapeHtml(displayCurrency)})</th><th>Total(${escapeHtml(displayCurrency)})</th>`).join("")}
          </tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="${1 + visibleTypes.length * 2}">此篩選條件下沒有符合的代理</td></tr>`}</tbody>
      </table>
    </div>
    <div id="comparison-whatif-root"></div>
  `;

  document.getElementById("comparison-currency-select").addEventListener("change", (event) => {
    comparisonDisplayCurrency = event.target.value;
    renderComparisonUI(root, { agents, cargo, selection, caseData });
  });

  document.getElementById("comparison-role-filter").addEventListener("change", (event) => {
    comparisonRoleFilter = event.target.value;
    renderComparisonUI(root, { agents, cargo, selection, caseData });
  });

  document.getElementById("comparison-segment-filter").addEventListener("change", (event) => {
    comparisonSegmentFilter = event.target.value;
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
        // spec 3節(第32節修正):套用最低成本組合時,只能在role涵蓋該段的代理裡比較,
        // 不能把role不涵蓋這段(結構性不適用)的0.00誤判成「最低成本」
        if (!roleCoversSegment(agent.role, t)) return;
        const segment = agent.segmentsByType[t];
        if (!segment) return;
        segmentOptions(segment, cargo, caseData.rate_table, caseData.quote_currency, displayCurrency).forEach((opt) => {
          const warn = isWarned(opt, caseData);
          // 第46節統整版:有pending費用的選項total偏低(該筆費用沒算進去),比照warn的分級退回邏輯,
          // 不能讓「剛好驅動數字沒填」的選項被誤判成真的最低成本
          const pending = !!opt.cost.pendingCount;
          const candidate = { agentId: agent.id, laneId: opt.laneId, cost: opt.cost.total, warn, pending };
          const better =
            !best ||
            (best.warn && !candidate.warn) ||
            (!!best.warn === !!candidate.warn && best.pending && !candidate.pending) ||
            (!!best.warn === !!candidate.warn && !!best.pending === !!candidate.pending && candidate.cost < best.cost);
          if (better) best = candidate;
        });
      });
      if (best) newSelection[t] = { agentId: best.agentId, laneId: best.laneId };
    });
    await persistSelection(newSelection);
    loadComparisonTab();
  });

  document.getElementById("export-comparison-btn").addEventListener("click", () => {
    exportComparisonExcel(filteredAgents, cargo, selection, caseData, displayCurrency, visibleTypes);
  });

  // What-if 情境分析沿用跟主表格一樣的代理角色篩選(spec 3.2 沒有另外規定,維持跟頁面其他篩選一致的行為)
  renderWhatIfSection(document.getElementById("comparison-whatif-root"), { agents: filteredAgents, cargo, caseData, displayCurrency });
}

async function loadComparisonTab() {
  const root = document.getElementById("comparison-root");
  root.innerHTML = `<p class="empty-state">載入中...</p>`;

  let agents;
  try {
    agents = await fetchAgentsWithCosts(caseId, activeScenarioIdForQuery());
  } catch (error) {
    root.innerHTML = `<div class="message error" style="display:block">讀取失敗:${error.message}</div>`;
    return;
  }

  if (!agents.length) {
    root.innerHTML = `<p class="empty-state">還沒有代理成本資料,請先在「代理成本」分頁新增。</p>`;
    return;
  }

  // spec 29.1:project案件讀目前作用中情境的cargo/selection,否則(inquiry/tender)維持讀案件本身,
  // getActiveScopeData()統一處理這個判斷
  const scope = getActiveScopeData();
  renderComparisonUI(root, {
    agents,
    cargo: scope.cargo || {},
    selection: scope.selection || {},
    caseData: scope,
  });
}
