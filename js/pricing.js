// 共用成本計算引擎(對應 spec 2.4 公式),比較分析分頁與報價分頁共用
// 輸入的 FeeLine / Segment 物件都是 Supabase 原始 row(snake_case 欄位)

function getUnitQty(cargo, type) {
  const units = (cargo && cargo.units) || [];
  return units.filter((u) => u.type === type).reduce((sum, u) => sum + Number(u.qty || 0), 0);
}

// cargo.units 裡「有登記數量」(qty>0)的類型清單——spec 27.1節v2:代理報的成本是「費率表」,
// 報了這批貨用不到的類型是正常現象,只有反過來(貨有的類型代理沒報價)才需要注意
function registeredUnitTypes(cargo) {
  return Array.from(
    new Set(((cargo && cargo.units) || []).filter((u) => Number(u.qty || 0) > 0).map((u) => u.type))
  );
}

// 一組 FeeLine(同一個代理同一段/同一條Lane的小計單位)裡,cargo 有登記數量、但沒有任何 perContainer/
// perContainerPerDay FeeLine 提供報價的類型清單(spec 27.1節v2 + 27.2節,第40.1節basis拆分後範圍不變,
// 只是判斷條件從舊的perUnit改成新的perContainer/perContainerPerDay):只在這組 FeeLine 裡「真的有用逐貨櫃
// 類型計價」時才檢查,沒有的話代表這個代理/Lane 根本沒有用逐類型報價(可能整段用 flat/perShipment all-in),
// 不該被當成「缺報價」警示。範圍刻意不擴大到perPallet/perCarton——棧板/箱子是單一費率,沒有「代理沒報某個
// 貨櫃類型」這種情境。
function computeMissingUnitTypes(feeLines, cargo) {
  const arrayTypeLines = (feeLines || []).filter(
    (fl) => (fl.basis === "perContainer" || fl.basis === "perContainerPerDay") && (fl.amount_by_type || []).length
  );
  if (!arrayTypeLines.length) return [];
  const covered = new Set();
  arrayTypeLines.forEach((fl) => (fl.amount_by_type || []).forEach((t) => t.type && covered.add(t.type)));
  return registeredUnitTypes(cargo).filter((t) => !covered.has(t));
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

// spec 第39.2節:What-if情境重量分析專用——回傳「w落在哪個級距」的級距下限本身(thresholdKg),不是費率。
// 業界慣例:還沒確定最終重量落在哪個級距時,用該級距的下限去反推保守估算,不是直接用使用者輸入值。
// 邏輯結構比照 applicableBreakRate(取<=w的最大threshold,w小於所有threshold時退回最低一階),只是回傳threshold本身。
// 注意:這是 js/comparison.js 的 What-if 分析專屬邏輯,不能用在 feeLineAmountDetailed() 的正式報價計算——
// 正式報價一律用實際計費重量,只有這個「還沒確定重量、想抓保守估價」的分析情境才用下限代入。
function applicableBreakFloor(breaks, w) {
  const sorted = [...(breaks || [])]
    .map((b) => Number(b.thresholdKg))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!sorted.length) return w;
  let floor = sorted[0];
  for (const t of sorted) {
    if (t <= w) floor = t;
  }
  return floor;
}

// spec 第27.2節核心原則(第46節統整版):「算出來是0」「驅動數字還沒填」「缺少必要的貨量資訊、根本沒辦法算」
// 三者不能在畫面上長得一樣。回傳 { amount, incomplete, pending, reason }:
// pending=true 時 amount 固定是0,代表「這個驅動數字(如計費重量/票數)當下沒有值」——這不是錯誤,是這個案件
// 現在這個階段的正常狀態(第46節),呼叫端不能把這個0當真正金額用,但也不能當成警示去擋任何操作(選用/情境試算
// 都要正常可用),要用中性的「未定/依實際計費重量另計」呈現,不是紅色⚠。
// incomplete=true 語意保留給真正「資料錯誤/結構性缺漏」的情況(目前所有basis都不會觸發,是為未來例如perCBM等
// 新basis萬一有真正算不出來的情況預留),兩者都不計入加總,但呼叫端要用不同視覺語言分開呈現。
function feeLineAmountDetailed(fl, cargo) {
  const hasWeight = cargo && cargo.chargeableWeightKg != null && Number(cargo.chargeableWeightKg) > 0;
  const w = Number((cargo && cargo.chargeableWeightKg) || 0);
  const hasShipmentQty = cargo && cargo.shipmentQty != null && Number(cargo.shipmentQty) > 0;
  const shipmentQty = Number((cargo && cargo.shipmentQty) || 0);

  switch (fl.basis) {
    case "flat":
      return { amount: Number(fl.amount || 0), incomplete: false, pending: false };
    case "perShipment":
      if (!hasShipmentQty) return { amount: 0, incomplete: false, pending: true, reason: "缺票數/BL數" };
      return { amount: Number(fl.amount || 0) * shipmentQty, incomplete: false, pending: false };
    case "perKg":
      if (!hasWeight) return { amount: 0, incomplete: false, pending: true, reason: "缺計費重量" };
      return { amount: Number(fl.amount || 0) * w, incomplete: false, pending: false };
    case "perContainer": {
      // spec 27.1節v2/27.2節:代理報了這批貨 cargo.units 沒有的類型是正常現象(費率表本來就可能涵蓋更多類型),
      // 這種多餘類型安靜地不計入金額即可,不標記警示、也不是「這筆FeeLine本身不完整」——
      // 真正該警示的「這個代理沒提供某類型報價」是段落層級的整體判斷(見 computeMissingUnitTypes),不掛在單筆FeeLine上
      const types = fl.amount_by_type || [];
      if (!types.length) return { amount: 0, incomplete: false, pending: false };
      let sum = 0;
      types.forEach((t) => {
        sum += Number(t.amount || 0) * getUnitQty(cargo, t.type);
      });
      return { amount: sum, incomplete: false, pending: false };
    }
    case "perPallet":
      return { amount: Number(fl.amount || 0) * getUnitQty(cargo, "PLT"), incomplete: false, pending: false };
    case "perCarton":
      return { amount: Number(fl.amount || 0) * getUnitQty(cargo, "CTN"), incomplete: false, pending: false };
    case "perContainerPerDay": {
      // 跟perContainer同樣道理:cargo沒登記的類型安靜不計入,days未填時視同0(FeeLine本身還沒填完整,
      // 不是缺cargo資料,所以不標記incomplete——這跟flat的amount未填是同一種既有慣例)
      const types = fl.amount_by_type || [];
      if (!types.length) return { amount: 0, incomplete: false, pending: false };
      const days = Number(fl.days || 0);
      let sum = 0;
      types.forEach((t) => {
        sum += Number(t.amount || 0) * getUnitQty(cargo, t.type) * days;
      });
      return { amount: sum, incomplete: false, pending: false };
    }
    case "perPalletPerDay":
      return { amount: Number(fl.amount || 0) * getUnitQty(cargo, "PLT") * Number(fl.days || 0), incomplete: false, pending: false };
    case "perChassisPerDay":
      // spec 2.4節:若未在貨量資訊登記底盤(CHASSIS)數量,預設視為1
      return {
        amount: Number(fl.amount || 0) * (getUnitQty(cargo, "CHASSIS") || 1) * Number(fl.days || 0),
        incomplete: false,
        pending: false,
      };
    case "perKgBreak": {
      if (!hasWeight) return { amount: 0, incomplete: false, pending: true, reason: "缺計費重量" };
      const rate = applicableBreakRate(fl.breaks, w);
      const minCharge = fl.min_charge != null ? Number(fl.min_charge) : 0;
      return { amount: Math.max(minCharge, rate * w), incomplete: false, pending: false };
    }
    default:
      return { amount: 0, incomplete: false, pending: false };
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
// 且可以換算成不一定等於 case.quoteCurrency 的任意 displayCurrency)。
// 回傳 { amount, missingRate, incomplete, pending, reason }——pending/incomplete 優先於 missingRate 判斷
// (驅動數字都還沒填,連要不要查匯率都無意義),兩者都代表這筆金額不能拿來用,amount 這時固定是0,
// 呼叫端要看 pending(中性未定,不擋操作)/incomplete(真正缺資料)/missingRate 分別呈現。
function feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency) {
  const detail = feeLineAmountDetailed(fl, cargo);
  if (detail.pending) return { amount: 0, missingRate: false, incomplete: false, pending: true, reason: detail.reason };
  if (detail.incomplete) return { amount: 0, missingRate: false, incomplete: true, pending: false, reason: detail.reason };
  const converted = convertCurrency(detail.amount, fl.currency, displayCurrency, rateTable, quoteCurrency);
  if (converted == null) return { amount: 0, missingRate: true, incomplete: false, pending: false, reason: null };
  return { amount: converted, missingRate: false, incomplete: false, pending: false, reason: null };
}

// { subtotal, total, missingRate, incompleteCount, incompleteItems, pendingCount, pendingItems, missingUnitTypes }:
// subtotal 只計 certain,total 額外加 possible(spec 2.4)
// missingRate:任一筆費用因為 rateTable 缺該幣別匯率而換算不出來
// pendingCount/pendingItems(第46節統整版):任一筆費用因為驅動數字(票數/計費重量)當下還沒填而無法算——這是
// 中性的「未定」狀態,不是警示,呼叫端要用「依實際計費重量另計」這類措辭呈現,不能擋選用/情境試算等操作
// incompleteCount/incompleteItems(spec第27.2節):真正缺少必要資訊、算錯/算不出來的情況(目前沒有任何basis
// 會觸發,保留給未來可能的情況),跟pending是不同性質,要用不同視覺語言分開呈現
// missingUnitTypes(spec 27.1節v2/27.2節):這組 FeeLine(該代理該段落/Lane 的小計)裡,cargo 有登記數量但沒有任何
// perContainer/perContainerPerDay FeeLine 提供報價的類型——代表這個代理沒辦法給這批貨的完整報價,警示掛在這個小計層級,不是單筆FeeLine
function feeLineTotals(feeLines, cargo, rateTable, quoteCurrency, displayCurrency) {
  let subtotal = 0;
  let total = 0;
  let missingRate = false;
  let incompleteCount = 0;
  let pendingCount = 0;
  const incompleteItems = [];
  const pendingItems = [];
  (feeLines || []).forEach((fl) => {
    const r = feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency);
    if (r.pending) {
      pendingCount += 1;
      pendingItems.push({ name: fl.name, reason: r.reason });
      return;
    }
    if (r.incomplete) {
      incompleteCount += 1;
      incompleteItems.push({ name: fl.name, reason: r.reason });
      return;
    }
    if (r.missingRate) {
      missingRate = true;
      return;
    }
    total += r.amount;
    if (fl.certainty === "certain") subtotal += r.amount;
  });
  const missingUnitTypes = computeMissingUnitTypes(feeLines, cargo);
  return { subtotal, total, missingRate, incompleteCount, incompleteItems, pendingCount, pendingItems, missingUnitTypes };
}

// spec 第49.2節:同一個選項的FeeLine可能要分成好幾組、各自用不同的cargo.chargeableWeightKg呼叫feeLineTotals
// (例如同段落多筆perKgBreak門檻不同,各自要代入自己的bracketFloor),算完再合併成單一cost物件——
// subtotal/total加總,missingRate取OR(任一組缺匯率就算缺),count/items陣列串接,missingUnitTypes聯集去重
function mergeFeeLineTotals(partials) {
  const merged = { subtotal: 0, total: 0, missingRate: false, incompleteCount: 0, incompleteItems: [], pendingCount: 0, pendingItems: [], missingUnitTypes: [] };
  const unitTypeSet = new Set();
  (partials || []).forEach((p) => {
    merged.subtotal += p.subtotal;
    merged.total += p.total;
    if (p.missingRate) merged.missingRate = true;
    merged.incompleteCount += p.incompleteCount;
    merged.incompleteItems.push(...p.incompleteItems);
    merged.pendingCount += p.pendingCount;
    merged.pendingItems.push(...p.pendingItems);
    (p.missingUnitTypes || []).forEach((t) => unitTypeSet.add(t));
  });
  merged.missingUnitTypes = Array.from(unitTypeSet);
  return merged;
}

// spec 第43/47.2/48.2節:非perKgBreak的成本項目要能併入What-if「混合每KG成本」分析——
// - perPallet/perCarton/perPalletPerDay:只在使用者填了conversion_weight_kg(每單位換算重量)時才適用
// - perContainer/perContainerPerDay/perChassisPerDay:另外用include_in_whatif布林開關決定(見下方whatIfMixedCost)
const CONVERSION_WEIGHT_BASIS = new Set(["perPallet", "perCarton", "perPalletPerDay"]);
const WHATIF_TOGGLE_BASIS = new Set(["perContainer", "perContainerPerDay", "perChassisPerDay"]);

// spec 43/47.2節預設模式(第48.2節公式表):這個FeeLine在情境重量weight(通常是bracketFloor,見
// whatIfMixedCost)下的估計總成本/每KG貢獻——用conversion_weight_kg反推,不是cargo.units實際登記數量
// (那是feeLineAmountDetailed()的真實成本算法,兩者刻意分開,What-if不能污染真實金額計算)。
// 總成本 = amount × (weight ÷ conversion_weight_kg) [×days,僅perPalletPerDay]
// 每KG貢獻 = amount ÷ conversion_weight_kg [×days] ——線性比例關係,化簡後不受weight影響,是個恆定值,
// 這正是47.2節「固定比例換算為預設做法」的核心:不用逐級距重新估算。
// conversion_weight_kg未填或<=0時回傳null,呼叫端視為不併入分析(維持既有真實金額計算,不受這批影響)
function whatIfConversionAmount(fl, weight) {
  if (!CONVERSION_WEIGHT_BASIS.has(fl.basis)) return null;
  const conversionWeight = fl.conversion_weight_kg != null ? Number(fl.conversion_weight_kg) : null;
  if (!conversionWeight || conversionWeight <= 0) return null;
  const amount = Number(fl.amount || 0);
  const days = fl.basis === "perPalletPerDay" ? Number(fl.days || 0) : 1;
  const perKg = (amount * days) / conversionWeight;
  return { total: perKg * weight, perKg };
}

// spec 第48.2節公式表的完整實作(取代舊版otherLines直接代入原始情境重量w的粗略算法)——
// 供comparison.js的computeWhatIfCells對每個floorGroup分別呼叫一次(跟perKgBreakLines同一套floor邏輯)。
// floor為null時(49.2節多筆perKgBreak門檻不一致,沒有單一乾淨下限):perKg/flat/perShipment/
// conversionLines的金額計算全部退回用w本身代入(優雅降級,金額照樣算得出來,只是不產出mixedPerKg——
// 呼叫端沿用resolveUniformBracketFloor既有的「不一致就不顯示per-KG提示」規則)。
//
// 三種處理方式(對應spec 48.2節表格):
// 1. perKg/flat/perShipment:沿用feeLineAmountDetailed()既有公式,只是把cargo.chargeableWeightKg換成
//    floor(找不到floor時退回w)代入——這是這批唯一「改動既有金額行為」的地方(perKg原本用w,現在用floor)
// 2. perPallet/perCarton/perPalletPerDay(conversion_weight_kg有填):金額本身就是whatIfConversionAmount()
//    算出的「這個情境下」估計值,不是真實cargo.units數字——這樣Total才會隨情境重量變動,不是每個情境都
//    顯示同一個真實登記數量算出的固定金額(這是43/47.2節整批要解決的問題)
//    沒填conversion_weight_kg的維持現狀:金額用真實cargo.units登記數量照算,但不納入mixedPerKg
// 3. perContainer/perContainerPerDay/perChassisPerDay:金額沿用feeLineTotals()真實公式(cargo.units實際
//    登記數量,不受情境重量影響),一律計入Subtotal/Total;只有include_in_whatif=true時才把
//    (該線金額÷floor)加進mixedPerKg——這個開關只影響混合每KG指標,不影響金額本身
function whatIfMixedCost(feeLines, cargo, rateTable, quoteCurrency, displayCurrency, floor, w) {
  const effectiveWeight = floor != null && floor > 0 ? floor : w;
  const mixedAvailable = floor != null && floor > 0;

  const rateLines = feeLines.filter((fl) => fl.basis === "perKg" || fl.basis === "flat" || fl.basis === "perShipment");
  const conversionLines = feeLines.filter(
    (fl) => CONVERSION_WEIGHT_BASIS.has(fl.basis) && fl.conversion_weight_kg != null && Number(fl.conversion_weight_kg) > 0
  );
  const plainConversionLines = feeLines.filter(
    (fl) => CONVERSION_WEIGHT_BASIS.has(fl.basis) && !(fl.conversion_weight_kg != null && Number(fl.conversion_weight_kg) > 0)
  );
  const containerLines = feeLines.filter((fl) => WHATIF_TOGGLE_BASIS.has(fl.basis));

  const rateCost = feeLineTotals(rateLines, { ...cargo, chargeableWeightKg: effectiveWeight }, rateTable, quoteCurrency, displayCurrency);
  // 沒填換算重量的perPallet/perCarton/perPalletPerDay + 全部perContainer類:金額維持既有算法(真實cargo.units
  // 登記數量,不受情境重量影響),不能因為這批新功能讓它們從Subtotal/Total消失
  const dollarOnlyCost = feeLineTotals([...plainConversionLines, ...containerLines], cargo, rateTable, quoteCurrency, displayCurrency);

  // whatIfConversionAmount()的.perKg欄位不受weight參數影響(線性比例關係,見函式註解),
  // 這裡每筆只算一次,金額(.total)用effectiveWeight換算,每KG貢獻(.perKg)兩種用途共用同一次結果
  let conversionSubtotal = 0;
  let conversionTotal = 0;
  const conversionEstimates = new Map();
  conversionLines.forEach((fl) => {
    const est = whatIfConversionAmount(fl, effectiveWeight);
    if (!est) return;
    conversionEstimates.set(fl, est);
    const converted = convertCurrency(est.total, fl.currency, displayCurrency, rateTable, quoteCurrency);
    if (converted == null) return;
    conversionTotal += converted;
    if (fl.certainty === "certain") conversionSubtotal += converted;
  });

  let mixedPerKg = 0;
  if (mixedAvailable) {
    rateLines.forEach((fl) => {
      const r = feeLineAmountIn(fl, { ...cargo, chargeableWeightKg: effectiveWeight }, rateTable, quoteCurrency, displayCurrency);
      if (r.pending || r.incomplete || r.missingRate) return;
      mixedPerKg += r.amount / floor;
    });
    conversionLines.forEach((fl) => {
      const est = conversionEstimates.get(fl);
      if (!est) return;
      const converted = convertCurrency(est.perKg, fl.currency, displayCurrency, rateTable, quoteCurrency);
      if (converted == null) return;
      mixedPerKg += converted;
    });
    containerLines.forEach((fl) => {
      if (!fl.include_in_whatif) return;
      const r = feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency);
      if (r.pending || r.incomplete || r.missingRate) return;
      mixedPerKg += r.amount / floor;
    });
  }

  const merged = mergeFeeLineTotals([rateCost, dollarOnlyCost]);
  merged.subtotal += conversionSubtotal;
  merged.total += conversionTotal;
  merged.mixedPerKg = mixedAvailable ? mixedPerKg : null;
  return merged;
}

// spec 3.3/50.2節:海運LCL「計費噸(Revenue Ton / W/M)」= max(重量噸數, 材積CBM)。LCL的cargo沒有獨立的
// grossWeightKg欄位(那個欄位只有空運calculated模式才有),重量側沿用cargo.chargeableWeightKg——
// 那個欄位本來就是這批貨的計費重量輸入,不重複開一個欄位。兩個輸入都缺時回傳null(未定,不是0)
function revenueTon(cargo) {
  const w = Number((cargo && cargo.chargeableWeightKg) || 0) / 1000;
  const v = Number((cargo && cargo.volumeCBM) || 0);
  if (!w && !v) return null;
  return Math.max(w, v);
}

// spec 3.3節FCL既有公式:Σ cargo.units 裡貨櫃類型的數量(只算真正的貨櫃代碼,不含PLT/CTN/CHASSIS)
function containerCount(cargo) {
  const total = ((cargo && cargo.units) || [])
    .filter((u) => REAL_CONTAINER_CODES.includes(u.type))
    .reduce((sum, u) => sum + Number(u.qty || 0), 0);
  return total > 0 ? total : null;
}

// spec 第50.2節:allin_rate_unit對應的實際驅動數字(這批貨目前是否已知重量/材積/櫃數),null代表未定
function allinRateDivisor(unit, cargo) {
  if (unit === "perKg") return Number((cargo && cargo.chargeableWeightKg) || 0) || null;
  if (unit === "perCBM") return Number((cargo && cargo.volumeCBM) || 0) || null;
  if (unit === "perRevenueTon") return revenueTon(cargo);
  if (unit === "perContainer") return containerCount(cargo);
  return null;
}

// spec 第50.2節:All-in報價選「費率」輸出樣式、且驅動數字(計費重量等)還沒填時,仍要嘗試算出一個
// 「不需要知道總量」就能確定的每KG費率——只有天生線性/固定比例的計價基礎才做得到:
// - perKg:amount本身就是單價
// - perKgBreak且只有一階(breaks.length<=1):那一階是唯一適用的rate,不受重量影響(跟多階不同,
//   多階要先知道重量落在哪一階,沒有重量就沒有答案)
// - perPallet/perCarton/perPalletPerDay且有填conversion_weight_kg(47.2節):固定比例本來就恆定,
//   重用whatIfConversionAmount()的.perKg欄位(該欄位不受傳入的weight參數影響,見該函式註解)
// 其餘(flat/perShipment/多階perKgBreak/沒填換算重量的perPallet類/perContainer類)天生需要知道實際
// 總量才能分攤成單位成本,排除計算,回傳excludedNames供呼叫端顯示中性提示(46節「未定不是0」的既有哲學,
// 不是紅色警示——這不是資料缺漏,是這個算法對這些計價基礎的本質限制)。
// min_charge(perKgBreak)不計入:那是對「總金額」的下限保護,沒有總量無法換算成對每KG費率的影響,
// 忽略它是這個近似算法刻意的簡化,不是遺漏。
function weightIndependentRatePerKg(feeLines, rateTable, quoteCurrency, displayCurrency) {
  let ratePerKg = 0;
  let missingRate = false;
  const excludedNames = [];
  (feeLines || []).forEach((fl) => {
    let contribution = null; // fl.currency下的每KG貢獻,null代表這筆算不出來
    if (fl.basis === "perKg") {
      contribution = Number(fl.amount || 0);
    } else if (fl.basis === "perKgBreak" && (fl.breaks || []).length <= 1) {
      const only = (fl.breaks || [])[0];
      contribution = only ? Number(only.ratePerKg || 0) : 0;
    } else if (CONVERSION_WEIGHT_BASIS.has(fl.basis) && fl.conversion_weight_kg != null && Number(fl.conversion_weight_kg) > 0) {
      const est = whatIfConversionAmount(fl, 1);
      contribution = est ? est.perKg : null;
    }
    if (contribution == null) {
      excludedNames.push(fl.name);
      return;
    }
    const converted = convertCurrency(contribution, fl.currency, displayCurrency, rateTable, quoteCurrency);
    if (converted == null) {
      missingRate = true;
      return;
    }
    ratePerKg += converted;
  });
  return { ratePerKg, missingRate, excludedCount: excludedNames.length, excludedNames };
}

// spec 第47.1節(修正版,兩層框架)過濾:
// - certain費用不受任一層影響,一律保留
// - possible且有option_group(屬於某個互斥家族):只有familyChoices[家族]剛好等於這筆的option_value才保留,
//   這個家族還沒選、或選了別的值,都排除——這是「互斥」的實作方式:同一家族同時間只有一個option_value會通過
// - possible且沒有option_group(不屬於任何家族):第一層逐筆勾選控制,只有不在excludedIds裡才保留
//   (預設保留,使用者要主動勾掉才排除——對應「預設全部勾選,向下相容」)
function filterFeeLinesForSelection(feeLines, selectionState) {
  const familyChoices = (selectionState && selectionState.familyChoices) || {};
  const excludedIds = new Set((selectionState && selectionState.excludedIds) || []);
  return (feeLines || []).filter((fl) => {
    if (fl.certainty !== "possible") return true;
    if (fl.option_group) return familyChoices[fl.option_group] != null && familyChoices[fl.option_group] === fl.option_value;
    return !excludedIds.has(fl.id);
  });
}

// 這組feeLines(某個agent/lane)裡存在哪些互斥家族、每個家族各自有哪些選項值(spec 47.1修正版)——
// 只看possible且有option_group的費用,依陣列出現順序去重,回傳{家族名: [選項值,...]}——
// 每個家族是彼此獨立的「幾選一」決策,不是全部塞進同一組(如倉儲方案/報關方式可以各自獨立選)
function distinctOptionFamilies(feeLines) {
  const families = {};
  (feeLines || []).forEach((fl) => {
    if (fl.certainty !== "possible" || !fl.option_group || !fl.option_value) return;
    if (!families[fl.option_group]) families[fl.option_group] = [];
    if (!families[fl.option_group].includes(fl.option_value)) families[fl.option_group].push(fl.option_value);
  });
  return families;
}

// 缺匯率/資料不完整的共用警示 badge(spec第27.2節:樣式比照既有的「缺匯率」警示),
// 給 comparison.js/quote.js 顯示 Subtotal/Total 旁邊用,可以同時出現多種警示
function costWarningBadgeHtml(cost) {
  if (!cost) return "";
  const parts = [];
  if (cost.missingRate) parts.push("缺匯率");
  if (cost.incompleteCount) parts.push(`含${cost.incompleteCount}筆無法計算的項目`);
  if (cost.missingUnitTypes && cost.missingUnitTypes.length) {
    parts.push(`未提供 ${cost.missingUnitTypes.join("、")} 的報價,無法計算完整成本`);
  }
  if (!parts.length) return "";
  return ` <span class="cell-missing-rate">⚠ ${parts.join("、")}</span>`;
}

// 第46節統整版:「驅動數字還沒填」的中性提示,不是警示——沿用第41節報價費率卡已經在用的
// .whatif-bracket-note 樣式(灰色,非紅色的.cell-missing-rate)跟「依實際計費重量另計」措辭,
// 成本輸入頁/比較分析頁/報價頁三個畫面共用同一個函式跟同一句話,不各自發明說法
function pendingNoteHtml(cost) {
  if (!cost || !cost.pendingCount) return "";
  return `<span class="whatif-bracket-note">依實際計費重量另計</span>`;
}

// 金額 + pending/警示提示的共用呈現(第46節統整版,取代單純顯示金額或單純顯示警示 badge 的舊寫法):
// 完全沒有可算的金額(amount是0且有pending項目)時,只顯示中性提示,不顯示容易誤解成「真的是0元」的0.00;
// 有部分可算的金額(如段落混合flat+pending的perKgBreak)時,金額照樣顯示,後面再附加提示,不會整段被蓋掉
function formatCostAmount(amount, cost, currency) {
  const note = pendingNoteHtml(cost);
  if (note && !amount) return note;
  return formatMoney(amount, currency) + note + costWarningBadgeHtml(cost);
}

// spec 3節(第32節修正):代理的role決定他業務上「本來就不承接」哪些段——出口地代理涵蓋出口+國際運輸段
// (通常是出口代理負責訂艙),進口地代理只涵蓋進口段(國際運輸的訂艙不是他們負責的);role='both'涵蓋全部三段。
// 用來判斷比較表某代理某段是否該顯示「－不適用」,不能把這個代理結構性不承接的段落的0.00當成一筆可比較的報價。
function roleCoversSegment(role, segType) {
  const r = role || "both";
  if (r === "export") return segType === "export" || segType === "intl";
  if (r === "import") return segType === "import";
  return true;
}

// 單一 segment 目前「可用選項」清單:useLanes=false 只有一個選項(整段本身),
// useLanes=true 則每條 lane 各是一個選項
//
// resolveSelection(第47.1節修正版,選填):(laneId) => {familyChoices, excludedIds},決定這個選項底下
// possible成本要怎麼過濾才算cost——預設()=>({familyChoices:{},excludedIds:[]})(安全預設:沒指定時,
// 所有屬於某個互斥家族的possible費用一律不計入,避免互斥方案成本悄悄漏進呼叫端沒特別處理過這層的既有邏輯,
// 如報價頁費率卡;沒有家族的possible費用維持全部計入,向下相容)。
// cost.total/cost.subtotal是套用這次選擇後的結果,不是「certain+全部possible」的參考上限——
// 呼叫端如果需要顯示那個上限參考值,自己另外對feeLines呼叫一次不做任何過濾的feeLineTotals。
// feeLines欄位維持回傳未過濾的原始陣列(What-if引擎需要看到全部,自己決定要不要fan out),
// optionFamilies/ungroupedPossibleLines供UI組件直接使用,不用每個呼叫端自己重新篩選一次
function segmentOptions(segment, cargo, rateTable, quoteCurrency, displayCurrency, resolveSelection) {
  const resolve = resolveSelection || (() => ({ familyChoices: {}, excludedIds: [] }));
  if (!segment) return [];
  const optionFor = (rawFeeLines, selectionState) => ({
    cost: feeLineTotals(filterFeeLinesForSelection(rawFeeLines, selectionState), cargo, rateTable, quoteCurrency, displayCurrency),
    feeLines: rawFeeLines,
    optionFamilies: distinctOptionFamilies(rawFeeLines),
    ungroupedPossibleLines: rawFeeLines.filter((fl) => fl.certainty === "possible" && !fl.option_group),
  });
  if (!segment.use_lanes) {
    const rawFeeLines = segment.feeLines || [];
    return [{ laneId: null, label: null, lane: null, ...optionFor(rawFeeLines, resolve(null)) }];
  }
  return (segment.lanes || []).map((lane) => {
    const rawFeeLines = lane.feeLines || [];
    return {
      laneId: lane.id,
      label: `${lane.carrier || "(未命名)"}${lane.routing ? " — " + lane.routing : ""}`,
      lane,
      ...optionFor(rawFeeLines, resolve(lane.id)),
    };
  });
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

// spec 27.1節v2:normalizeContainerType() 先前只套用在「新輸入」的資料,資料庫裡既有的舊資料(如帶`'`符號的
// "40'HQ")從沒被回頭處理過,導致跟 cargo.units 的標準代碼比對不到、被誤判成「這個類型沒人報價」。
// 這裡在每次讀取 FeeLine 時「自我修復」:用同一套 normalizeContainerType() 檢查 perContainer/perContainerPerDay
// (第40.1節從perUnit拆分而來)的 amount_by_type.type,值不同就直接寫回資料庫——等同於隨著使用者/系統的正常
// 讀取操作,自然跑過一輪一次性批次正規化,不需要額外執行遷移腳本;對已經是標準代碼的資料完全是no-op,可安全重複呼叫。
async function healStaleUnitTypeNormalization(feeLines) {
  const updates = [];
  (feeLines || []).forEach((fl) => {
    if ((fl.basis !== "perContainer" && fl.basis !== "perContainerPerDay") || !(fl.amount_by_type || []).length) return;
    let changed = false;
    const normalized = fl.amount_by_type.map((t) => {
      const normType = normalizeContainerType(t.type);
      if (normType !== t.type) changed = true;
      return { ...t, type: normType };
    });
    if (changed) {
      fl.amount_by_type = normalized; // 修正記憶體內這份資料,這次讀取當下就能算對,不用等下次重新整理
      updates.push({ id: fl.id, amount_by_type: normalized });
    }
  });
  if (updates.length) {
    await Promise.all(
      updates.map((u) => supabaseClient.from("fee_lines").update({ amount_by_type: u.amount_by_type }).eq("id", u.id))
    );
  }
}

// 讀取一個案件底下所有代理的完整成本資料(agents → segments → lanes → fee_lines 巢狀組好)
// caseDetail.js(代理成本分頁)、comparison.js、quote.js 共用同一份資料
// scenarioId(spec 29.1,選填):Project案件的代理掛在情境底下,傳入時只抓該情境的代理;
// 不傳(inquiry/tender案件,或project案件內部呼叫時忘了傳)一律當作「非情境」範圍,只抓 scenario_id 為 null 的代理,
// 避免project案件不小心把所有情境的代理混在一起算
async function fetchAgentsWithCosts(caseId, scenarioId) {
  let agentsQuery = supabaseClient.from("agents").select("id, name, role, created_at").eq("case_id", caseId);
  agentsQuery = scenarioId ? agentsQuery.eq("scenario_id", scenarioId) : agentsQuery.is("scenario_id", null);
  const { data: agents, error: agentsError } = await agentsQuery.order("created_at", { ascending: true });
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

  await healStaleUnitTypeNormalization([...segmentFeeLines, ...laneFeeLines]);

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

// spec 第49.1節:全站統一的四捨五入規則——中間運算全程維持完整精度,不四捨五入;只有寫進Excel/PDF儲存格
// 這種需要真正Number值(不是像formatMoney()那樣的顯示字串)的「最終呈現」時刻,才統一捨到小數點後2位。
// 這條規則不分金額類或比率類,全站共用這一顆函式,不要各自重寫Number(x.toFixed(2))
function roundForDisplay(value) {
  return Number(Number(value || 0).toFixed(2));
}
