const MODE_LABELS = {
  air: "空運",
  sea_fcl: "海運 FCL",
  sea_lcl: "海運 LCL",
  land: "陸運",
  rail: "跨境鐵路",
  cross_border_trucking: "跨境卡車",
  multimodal: "多聯式",
};

const QUOTE_TYPE_LABELS = {
  inquiry: "單次詢價",
  tender: "標案",
  project: "Project(多情境)",
};

// Incoterm 是參考標籤,不直接綁死成本計算邏輯(spec 2.1);選擇時可依此建議一組 quoteScope 預設值,
// 使用者隨時可手動覆蓋(如三角貿易情境)
const INCOTERM_OPTIONS = ["EXW", "FOB", "FCA", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

const INCOTERM_SUGGESTED_SCOPE = {
  EXW: { export: false, intl: false, import: false },
  FOB: { export: true, intl: false, import: false },
  FCA: { export: true, intl: false, import: false },
  CFR: { export: true, intl: true, import: false },
  CIF: { export: true, intl: true, import: false },
  CPT: { export: true, intl: true, import: false },
  CIP: { export: true, intl: true, import: false },
  DAP: { export: true, intl: true, import: true },
  DPU: { export: true, intl: true, import: true },
  DDP: { export: true, intl: true, import: true },
};

const SEGMENT_TYPES = ["export", "intl", "import"];

const SEGMENT_TYPE_LABELS = {
  export: "出口段 Export",
  intl: "國際運輸段 Intl",
  import: "進口段 Import",
};

// 收折摘要列用的簡短版本(spec 6.5.1節A:「代理名稱｜出口段小計｜...」這種一行摘要,長版標籤放不下)
const SEGMENT_TYPE_SHORT_LABELS = { export: "出口", intl: "國際", import: "進口" };

const AGENT_ROLE_LABELS = { export: "出口地代理", import: "進口地代理", both: "出口/進口皆可" }; // spec 2.2(第21節)

// spec 第40.1節(全文取代規則):perUnit拆成perContainer/perPallet/perCarton,
// perUnitPerDay拆成perContainerPerDay/perPalletPerDay/perChassisPerDay,perUnit/perUnitPerDay不再是合法值
const BASIS_LABELS = {
  flat: "flat 固定金額",
  perShipment: "perShipment 每票/BL/MAWB/HAWB",
  perKg: "perKg 每KG(不分級距)",
  perContainer: "perContainer 每貨櫃(依貨櫃類型)",
  perPallet: "perPallet 每棧板",
  perCarton: "perCarton 每箱",
  perKgBreak: "perKgBreak 級距報價",
  perContainerPerDay: "perContainerPerDay 每貨櫃每天(如延滯費/留滯費)",
  perPalletPerDay: "perPalletPerDay 每棧板每天(如倉租)",
  perChassisPerDay: "perChassisPerDay 每底盤每天(Chassis Per Diem)",
};

// Segment.fromLocation/toLocation 的標籤依 case.mode + segmentType 動態決定(spec 2.3/第10節修正2)
function getLocationLabels(mode, segmentType) {
  if (segmentType !== "intl") {
    return { from: "起點(選填,預設同案件起運地)", to: "訖點(選填,預設同案件目的地)" };
  }
  switch (mode) {
    case "air":
      return { from: "AOL 起運機場", to: "AOD 目的機場" };
    case "sea_fcl":
    case "sea_lcl":
      return { from: "POL 起運港", to: "POD 目的港" };
    case "land":
    case "rail":
    case "cross_border_trucking":
      return { from: "Pickup from(取貨地點)", to: "Delivery to(送達地點)" };
    case "multimodal":
    default:
      return { from: "From", to: "To" };
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

// ============================================================
// 收折卡片共用邏輯(spec 6.5.1節A):Agent/Segment/Lane卡片預設收折成一行摘要,點擊展開,
// 同一層級的卡片彼此是accordion行為(展開一個、收折其他同層兄弟)。不強制重組DOM結構——
// 呼叫端自己的HTML樣板裡固定放好 .collapsible-header(標題列,含摘要)跟 .collapsible-body(詳細內容)
// 兩個直屬子元素,這裡只負責綁定「點頭部展開/收折、同層兄弟互斥」的行為。
// ============================================================

// levelClass 用來辨識「同一層級」的兄弟卡片(例如同一個agent底下的3個segment卡片都給 collapsible-segment),
// accordion互斥只會比對同一個父層容器下、帶有同一個levelClass的其他卡片,不會誤觸不同層級/不同容器的卡片
function initCollapsible(card, { levelClass, defaultCollapsed = true } = {}) {
  card.classList.add("collapsible-item");
  if (levelClass) card.classList.add(levelClass);
  if (defaultCollapsed) card.classList.add("collapsed");

  const header = card.querySelector(":scope > .collapsible-header");
  if (!header) return;
  header.addEventListener("click", (event) => {
    // 標題列上如果有互動元件(如代理角色下拉、刪除按鈕),點它們只做它們自己的事,不要連帶觸發展開/收折
    if (event.target.closest("select, button, input, a")) return;
    toggleCollapsible(card);
  });
}

function toggleCollapsible(card, expand) {
  const shouldExpand = expand === undefined ? card.classList.contains("collapsed") : expand;
  card.classList.toggle("collapsed", !shouldExpand);
  if (shouldExpand) {
    const parent = card.parentElement;
    const levelClass = Array.from(card.classList).find((c) => c !== "collapsible-item" && c.startsWith("collapsible-"));
    if (parent && levelClass) {
      Array.from(parent.children)
        .filter((el) => el !== card && el.classList && el.classList.contains(levelClass))
        .forEach((sibling) => sibling.classList.add("collapsed"));
    }
  }
}

// 展開這張卡片跟它所有屬於collapsible-item的祖先——案件導覽側欄(spec 6.5.1節B)點某個Segment/Lane項目時,
// 要連同外層的Agent卡片一起展開,不然使用者點了卻因為外層還收折著而看不到
function expandCollapsibleAncestors(card) {
  let el = card;
  const chain = [];
  while (el) {
    if (el.classList && el.classList.contains("collapsible-item")) chain.unshift(el);
    el = el.parentElement;
  }
  chain.forEach((c) => toggleCollapsible(c, true));
}

// 案件明細頁最上方「全部展開/全部收折」切換按鈕用(spec 6.5.1節A)
function setAllCollapsed(root, collapsed) {
  root.querySelectorAll(".collapsible-item").forEach((card) => card.classList.toggle("collapsed", collapsed));
}

// ============================================================
// Autosave 共用機制(spec 6.5.4):全站表單取消手動「儲存」按鈕,改成 blur/change 觸發存檔,
// 用狀態文字(儲存中…/已儲存 ✓/儲存失敗/有未填完整的項目)取代按鈕。
// 與第17節驗證規則銜接:欄位還沒填完整時不阻斷存檔、不跳錯誤,只顯示提示文字,
// 等使用者補完自然存入;只有在使用者要離開頁面/切分頁時才明確示警(見下方 hasIncompleteAutosave)。
// ============================================================

const incompleteAutosaveSections = new Set();

function setAutosaveIncomplete(sectionId, incomplete) {
  if (!sectionId) return;
  if (incomplete) incompleteAutosaveSections.add(sectionId);
  else incompleteAutosaveSections.delete(sectionId);
}

function hasIncompleteAutosave() {
  return incompleteAutosaveSections.size > 0;
}

window.addEventListener("beforeunload", (event) => {
  if (hasIncompleteAutosave()) {
    event.preventDefault();
    event.returnValue = "";
  }
});

// statusEl:顯示狀態文字的元素
// saveFn:async () => ({ incomplete?: boolean } | void)
//   - 存檔動作本身。可能同時存了「已經填完整的部分」跟略過「還沒填完整的部分」——
//     這是刻意的:autosave 不該因為某一列還沒填完就整包擋下不存,該存的先存,
//     只是回傳 incomplete:true 讓狀態文字誠實反映「還有東西沒存到」,而不是騙使用者說已經全部存好了
//   - throw 代表真正的存檔失敗(如網路/權限問題),會顯示「儲存失敗」
// options.sectionId:用來在 incompleteAutosaveSections 登記這個區塊目前是否處於「未填完整」狀態,
//   供離開頁面/切分頁時判斷要不要示警(見 hasIncompleteAutosave)
//
// 回傳的 run() 一定要能被正確 await 到「這次呼叫當下的資料真的存完」為止,不能提早 resolve——
// 這是為了讓其他地方(如報價分頁背景刷新前)可以強制 flush 目前畫面上的資料再重繪,不會把使用者
// 打到一半、還沒 blur 的輸入被整包重繪蓋掉。因此這裡用一條 promise chain 把每次觸發依序串接執行,
// 不用「存檔中就丟棄/合併這次觸發」的做法,寧可多打幾次 API 也不要有任何一次觸發被提早結束、沒真的存到。
function createAutosaveTrigger(statusEl, saveFn, { sectionId, incompleteMessage = "有未填完整的項目,尚未儲存" } = {}) {
  let chain = Promise.resolve();

  async function performOnce() {
    statusEl.textContent = "儲存中…";
    statusEl.className = "save-status";
    try {
      const result = await saveFn();
      if (result && result.incomplete) {
        setAutosaveIncomplete(sectionId, true);
        statusEl.textContent = incompleteMessage;
        statusEl.className = "save-status pending";
      } else {
        setAutosaveIncomplete(sectionId, false);
        statusEl.textContent = "已儲存 ✓";
        statusEl.className = "save-status success";
      }
    } catch (error) {
      statusEl.textContent = `儲存失敗:${(error && error.message) || "請重試"}`;
      statusEl.className = "save-status error";
    }
  }

  function run() {
    chain = chain.then(performOnce);
    return chain;
  }

  return run;
}

// 每個掛過 autosave 的容器 → 對應的 trigger,供 flushFocusedAutosave 往上找「目前 focus 屬於哪個 autosave 區塊」
const autosaveTriggerByContainer = new WeakMap();

// 把 trigger 掛在一個容器底下,涵蓋容器內(含動態新增的)欄位:
// 文字/數字/日期輸入用 blur(該事件不冒泡,需要用 capture 階段監聽),select/checkbox/radio 用 change(會冒泡)
function attachAutosaveListeners(container, trigger) {
  autosaveTriggerByContainer.set(container, trigger);
  container.addEventListener(
    "blur",
    (event) => {
      if (event.target.matches('input[type="text"], input[type="number"], input[type="date"], textarea')) trigger();
    },
    true
  );
  container.addEventListener("change", (event) => {
    if (event.target.matches('select, input[type="checkbox"], input[type="radio"]')) trigger();
  });
}

// 在某個範圍(scopeEl,如整個代理成本區塊或報價分頁)要清空/整包重繪之前呼叫:
// 如果目前 focus 落在這個範圍底下,沿著 DOM 往上找到最近一層有掛 autosave 的容器,強制 await 它把
// 「這次呼叫當下畫面上的值」存一次,確保使用者正在打字、還沒 blur 的內容不會被接下來的重繪悄悄蓋掉——
// 這個工具是拿來算報價金額的,遺失掉的輸入沒被使用者發現,可能會用錯的金額報價給客戶,不能只靠機率小就不管。
async function flushFocusedAutosave(scopeEl) {
  const active = document.activeElement;
  if (!scopeEl || !active || active === document.body || !scopeEl.contains(active)) return;
  let el = active;
  while (el && el !== scopeEl.parentElement) {
    const trigger = autosaveTriggerByContainer.get(el);
    if (trigger) {
      await trigger();
      return;
    }
    el = el.parentElement;
  }
}

// ============================================================
// 貨櫃類型標準參考(spec 6.5.5第27節修正):內部儲存與比對一律用不帶「'」符號的標準代碼,
// 這是這次 ATE bug 的根本解法之一——cargo.units.type 存檔前正規化成標準代碼,
// FeeLine.amountByType 的單位類型改成從 cargo.units 選(見 segmentForm.js),兩處自然對得起來。
// ============================================================

const CONTAINER_TYPE_LABELS = {
  "20GP": "20GP(20呎一般櫃/乾貨櫃)",
  "40GP": "40GP(40呎一般櫃/乾貨櫃)",
  "40HQ": "40HQ(40呎高櫃)",
  "45HQ": "45HQ(45呎高櫃)",
  "20DG": "20DG(20呎危險品櫃)",
  "40DG": "40DG(40呎危險品櫃)",
  "20RF": "20RF(20呎冷凍櫃)",
  "40RF": "40RF(40呎冷凍高櫃)",
  "20FR": "20FR(20呎平架櫃)",
  "40FR": "40FR(40呎平架櫃)",
  "20ISOTANK": "20ISOTANK(20呎罐式貨櫃)",
  "40ISOTANK": "40ISOTANK(40呎罐式貨櫃)",
  "20OT": "20OT(20呎開頂櫃)",
  "40OT": "40OT(40呎開頂櫃)",
  PLT: "PLT(棧板)",
  CTN: "CTN(箱)",
  CHASSIS: "CHASSIS(底盤)",
};

// 第40.1節:perContainer/perContainerPerDay 的類型下拉選單只列「真正的貨櫃代碼」,
// 不包含PLT/CTN/CHASSIS(這三者各自是perPallet/perCarton/perChassisPerDay的隱含單位,不是貨櫃)
const REAL_CONTAINER_CODES = Object.keys(CONTAINER_TYPE_LABELS).filter((t) => !["PLT", "CTN", "CHASSIS"].includes(t));

// 常見同義寫法 → 標準代碼(spec 6.5.5):使用者打 20'GP/20DC/40HC 等業界慣用寫法時,自動正規化成同一個標準代碼再存檔
const CONTAINER_TYPE_ALIASES = {
  "20DC": "20GP",
  "40DC": "40GP",
  "40HC": "40HQ",
  "45HC": "45HQ",
  "20REEFER": "20RF",
  "20RE": "20RF",
  "40REEFER": "40RF",
  "40RH": "40RF",
  "20ISO": "20ISOTANK",
  "40ISO": "40ISOTANK",
  CARTON: "CTN", // 第40.1節migration發現真實資料裡有代理報價寫"carton"(非標準CTN),補進別名表,跟migration_v9的SQL端分類邏輯保持一致
};

// 正規化一個使用者輸入的貨櫃類型字串:去除英尺符號(含直引號/彎引號/全形變體)、多餘空白,轉大寫後比對別名表。
// 空運/認不出的類型(如 PLT/CTN 本身、或使用者自訂的其他單位)維持原樣(僅去頭尾空白),不強制套進這份清單。
function normalizeContainerType(raw) {
  if (!raw) return raw;
  const trimmed = String(raw).trim();
  if (!trimmed) return trimmed;
  const stripped = trimmed
    .replace(/['’‘＇`]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (CONTAINER_TYPE_ALIASES[stripped]) return CONTAINER_TYPE_ALIASES[stripped];
  if (CONTAINER_TYPE_LABELS[stripped]) return stripped;
  return trimmed;
}

// 貨櫃類型的「人類可讀簡短格式」(spec 6.5.5/第33節):內部比對值仍是不帶符號的標準代碼(如 40HQ),
// 這裡只負責顯示時加回英尺符號(如 40'HQ),供items格式Basis欄位等需要精簡呈現的地方使用——
// 跟 CONTAINER_TYPE_LABELS(含中文說明的完整版,用於下拉選單)是兩種不同用途的顯示格式
function containerTypeShortLabel(type) {
  if (!type) return type;
  const m = /^(\d+)([A-Z]+)$/.exec(String(type).toUpperCase());
  if (!m) return type;
  return `${m[1]}'${m[2]}`;
}
