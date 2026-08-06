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

// 單筆 FeeLine 換算成報價幣別後的金額(spec 2.4:每筆費用自己的 currency/fxRate 各自換算,
// 不再假設整個 segment/lane 只有一種幣別)
// currency 與 quoteCurrency 相同時,不管 fx_rate 欄位存了什麼值都強制視為 1,
// 避免使用者把幣別改回跟報價幣別一樣、卻忘了把 fxRate 改回1 導致算錯(spec 2.4 公式)
function feeLineAmountInQuoteCurrency(fl, cargo, quoteCurrency) {
  const fx = quoteCurrency && fl.currency === quoteCurrency ? 1 : Number(fl.fx_rate || 1);
  return feeLineAmount(fl, cargo) * fx;
}

// { subtotal, total }:subtotal 只計 certain,total 額外加 possible(spec 2.4)
// 這裡加總的已經是每筆各自換算成報價幣別後的金額,不用再乘一次外層匯率
function feeLineTotals(feeLines, cargo, quoteCurrency) {
  let subtotal = 0;
  let total = 0;
  (feeLines || []).forEach((fl) => {
    const amt = feeLineAmountInQuoteCurrency(fl, cargo, quoteCurrency);
    total += amt;
    if (fl.certainty === "certain") subtotal += amt;
  });
  return { subtotal, total };
}

// 單一 segment 目前「可用選項」清單:useLanes=false 只有一個選項(整段本身),
// useLanes=true 則每條 lane 各是一個選項
function segmentOptions(segment, cargo, quoteCurrency) {
  if (!segment) return [];
  if (!segment.use_lanes) {
    const cost = feeLineTotals(segment.feeLines, cargo, quoteCurrency);
    return [{ laneId: null, label: null, cost, lane: null, feeLines: segment.feeLines || [] }];
  }
  return (segment.lanes || []).map((lane) => ({
    laneId: lane.id,
    label: `${lane.carrier || "(未命名)"}${lane.routing ? " — " + lane.routing : ""}`,
    cost: feeLineTotals(lane.feeLines, cargo, quoteCurrency),
    lane,
    feeLines: lane.feeLines || [],
  }));
}

// 讀取一個案件底下所有代理的完整成本資料(agents → segments → lanes → fee_lines 巢狀組好)
// caseDetail.js(代理成本分頁)、comparison.js、quote.js 共用同一份資料
async function fetchAgentsWithCosts(caseId) {
  const { data: agents, error: agentsError } = await supabaseClient
    .from("agents")
    .select("id, name, created_at")
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

function formatMoney(value, currency) {
  const n = Number(value || 0);
  return `${currency ? currency + " " : ""}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
