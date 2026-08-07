// 共用成本計算引擎(對應 spec 2.4 公式),比較分析分頁與報價分頁共用
// 輸入的 FeeLine / Segment 物件都是 Supabase 原始 row(snake_case 欄位)

function getUnitQty(cargo, type) {
  const units = (cargo && cargo.units) || [];
  return units.filter((u) => u.type === type).reduce((sum, u) => sum + Number(u.qty || 0), 0);
}

// 取 <= w 的最大 threshold 對應費率;若 w 小於所有 threshold,退回最低一階的費率
function applicableBreakRate(breaks, w) {
  const sorted = [...(breaks || [])]
    .map((b) => ({ thresholdKg: Number(b.thresholdKg), ratePerKg: Number(b.ratePerKg) }))
    .sort((a, b) => a.thresholdKg - b.thresholdKg);
  if (!sorted.length) return 0;
  let rate = sorted[0].ratePerKg;
  for (const b of sorted) {
    if (b.thresholdKg <= w) rate = b.ratePerKg;
  }
  return rate;
}

function feeLineAmount(fl, cargo) {
  const w = Number((cargo && cargo.chargeableWeightKg) || 0);
  const shipmentQty = Number((cargo && cargo.shipmentQty) || 0);

  switch (fl.basis) {
    case "flat":
      return Number(fl.amount || 0);
    case "perShipment":
      return Number(fl.amount || 0) * shipmentQty;
    case "perKg":
      return Number(fl.amount || 0) * w;
    case "perUnit":
      return (fl.amount_by_type || []).reduce((sum, t) => sum + Number(t.amount || 0) * getUnitQty(cargo, t.type), 0);
    case "perKgBreak": {
      const rate = applicableBreakRate(fl.breaks, w);
      const minCharge = fl.min_charge != null ? Number(fl.min_charge) : 0;
      return Math.max(minCharge, rate * w);
    }
    default:
      return 0;
  }
}

// 幣別查表(spec 2.4 v4,第21節):rateTable 裡每筆 rate 定義為「1單位這個currency ＝ 多少單位case.quoteCurrency」,
// 找不到匯率時回傳 null,呼叫端要處理成「缺匯率」的警示,不能靜默當作 1(那會把金額算錯又不讓使用者發現)
function rateToQuoteCurrency(currency, rateTable, quoteCurrency) {
  if (currency === quoteCurrency) return 1;
  const entry = (rateTable || []).find((r) => r.currency === currency);
  return entry && entry.rate != null && entry.rate !== "" ? Number(entry.rate) : null;
}

// 把任意一筆金額從 fromCurrency 換算成 toCurrency(透過 case.quoteCurrency 當中介做跨幣別換算,spec 2.4 v4)。
// 不限於 FeeLine——報價分頁的每段賣價、預期利潤等「已經算好的金額」要換算成使用者選的顯示幣別時也共用這個函式。
// 找不到匯率時回傳 null(缺匯率),不回傳原始值或 0,避免呼叫端誤把「缺匯率」當成「換算後金額不變/是0」
function convertCurrency(amount, fromCurrency, toCurrency, rateTable, quoteCurrency) {
  if (fromCurrency === toCurrency) return amount;
  const rateFrom = rateToQuoteCurrency(fromCurrency, rateTable, quoteCurrency); // fromCurrency → quoteCurrency
  const rateTo = rateToQuoteCurrency(toCurrency, rateTable, quoteCurrency); // toCurrency → quoteCurrency
  if (rateFrom == null || rateTo == null) return null;
  return (amount * rateFrom) / rateTo;
}

// 單筆 FeeLine 換算成任意顯示幣別後的金額(spec 2.4 v4:不再存 fxRate,透過 case.rateTable 查表換算,
// 且可以換算成不一定等於 case.quoteCurrency 的任意 displayCurrency)
function feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency) {
  return convertCurrency(feeLineAmount(fl, cargo), fl.currency, displayCurrency, rateTable, quoteCurrency);
}

// { subtotal, total, missingRate }:subtotal 只計 certain,total 額外加 possible(spec 2.4)
// missingRate:只要有任一筆費用因為 rateTable 缺該幣別的匯率而換算不出來,就標記 true,
// 呼叫端應該顯示「缺匯率」警示,而不是讓那筆金額悄悄從總額裡消失卻不告訴使用者
function feeLineTotals(feeLines, cargo, rateTable, quoteCurrency, displayCurrency) {
  let subtotal = 0;
  let total = 0;
  let missingRate = false;
  (feeLines || []).forEach((fl) => {
    const amt = feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency);
    if (amt == null) {
      missingRate = true;
      return;
    }
    total += amt;
    if (fl.certainty === "certain") subtotal += amt;
  });
  return { subtotal, total, missingRate };
}

// 單一 segment 目前「可用選項」清單:useLanes=false 只有一個選項(整段本身),
// useLanes=true 則每條 lane 各是一個選項
function segmentOptions(segment, cargo, rateTable, quoteCurrency, displayCurrency) {
  if (!segment) return [];
  if (!segment.use_lanes) {
    const cost = feeLineTotals(segment.feeLines, cargo, rateTable, quoteCurrency, displayCurrency);
    return [{ laneId: null, label: null, cost, lane: null, feeLines: segment.feeLines || [] }];
  }
  return (segment.lanes || []).map((lane) => ({
    laneId: lane.id,
    label: `${lane.carrier || "(未命名)"}${lane.routing ? " — " + lane.routing : ""}`,
    cost: feeLineTotals(lane.feeLines, cargo, rateTable, quoteCurrency, displayCurrency),
    lane,
    feeLines: lane.feeLines || [],
  }));
}

// 這個 segment(或其底下任一 Lane)是否存在 perKgBreak 費用(spec 3.2:情境重量分析只在有這種費用的段落才顯示)
function segmentHasPerKgBreak(segment) {
  if (!segment) return false;
  if ((segment.feeLines || []).some((fl) => fl.basis === "perKgBreak")) return true;
  return (segment.lanes || []).some((lane) => (lane.feeLines || []).some((fl) => fl.basis === "perKgBreak"));
}

// 可切換的顯示幣別清單(比較分析/報價分頁的幣別選擇器共用):case.quote_currency 本身 + rate_table 裡已經有匯率的幣別
function caseAvailableCurrencies(caseData) {
  const set = new Set([caseData.quote_currency]);
  (caseData.rate_table || []).forEach((r) => r.currency && set.add(r.currency));
  return Array.from(set);
}

// 掃描一個案件底下所有 FeeLine 目前用到的幣別(agents→segments→lanes 巢狀資料),
// 供 6.6 節「匯率設定」區塊自動偵測案件目前用到哪些幣別
function collectUsedCurrencies(agents) {
  const set = new Set();
  (agents || []).forEach((agent) => {
    SEGMENT_TYPES.forEach((t) => {
      const s = agent.segmentsByType && agent.segmentsByType[t];
      if (!s) return;
      (s.feeLines || []).forEach((fl) => fl.currency && set.add(fl.currency));
      (s.lanes || []).forEach((lane) => (lane.feeLines || []).forEach((fl) => fl.currency && set.add(fl.currency)));
    });
  });
  return Array.from(set);
}

// 讀取一個案件底下所有代理的完整成本資料(agents → segments → lanes → fee_lines 巢狀組好)
// caseDetail.js(代理成本分頁)、comparison.js、quote.js 共用同一份資料
async function fetchAgentsWithCosts(caseId) {
  const { data: agents, error: agentsError } = await supabaseClient
    .from("agents")
    .select("id, name, role, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (agentsError) throw agentsError;
  if (!agents.length) return [];

  const agentIds = agents.map((a) => a.id);
  const { data: segments, error: segmentsError } = await supabaseClient.from("segments").select("*").in("agent_id", agentIds);
  if (segmentsError) throw segmentsError;

  const segmentIds = segments.map((s) => s.id);
  const { data: lanes, error: lanesError } = segmentIds.length
    ? await supabaseClient.from("lanes").select("*").in("segment_id", segmentIds)
    : { data: [], error: null };
  if (lanesError) throw lanesError;

  const laneIds = lanes.map((l) => l.id);
  const [{ data: segmentFeeLines, error: sflError }, { data: laneFeeLines, error: lflError }] = await Promise.all([
    segmentIds.length
      ? supabaseClient.from("fee_lines").select("*").in("segment_id", segmentIds)
      : Promise.resolve({ data: [], error: null }),
    laneIds.length ? supabaseClient.from("fee_lines").select("*").in("lane_id", laneIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (sflError || lflError) throw sflError || lflError;

  segments.forEach((s) => {
    s.feeLines = segmentFeeLines.filter((fl) => fl.segment_id === s.id);
    s.lanes = lanes
      .filter((l) => l.segment_id === s.id)
      .map((l) => ({ ...l, feeLines: laneFeeLines.filter((fl) => fl.lane_id === l.id) }));
  });

  return agents.map((agent) => {
    const segmentsByType = {};
    segments
      .filter((s) => s.agent_id === agent.id)
      .forEach((s) => {
        segmentsByType[s.segment_type] = s;
      });
    return { ...agent, segmentsByType };
  });
}

// 呼叫免費匯率 API(frankfurter.app,以歐洲央行參考匯率為準)抓即時匯率(spec 6.6節「抓即時匯率」按鈕),
// 回傳「1單位 fromCurrency = 多少單位 toCurrency」;抓不到時(網路問題,或該幣別不在ECB參考清單裡,
// 如人民幣等部分幣別 frankfurter.app 並未提供)回傳 null,呼叫端要讓使用者自己手動輸入,不要假裝成功
async function fetchLiveRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(toCurrency)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data && data.rates && data.rates[toCurrency];
    return typeof rate === "number" ? rate : null;
  } catch {
    return null;
  }
}

function formatMoney(value, currency) {
  const n = Number(value || 0);
  return `${currency ? currency + " " : ""}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
