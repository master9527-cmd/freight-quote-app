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

const BASIS_LABELS = {
  flat: "flat 固定金額",
  perShipment: "perShipment 每票/BL/MAWB/HAWB",
  perKg: "perKg 每KG(不分級距)",
  perUnit: "perUnit 每單位(依貨量單位)",
  perKgBreak: "perKgBreak 級距報價",
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
// 文字/數字/日期輸入用 blur(該事件不冒泡,需要用 capture 階段監聽),select/checkbox 用 change(會冒泡)
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
    if (event.target.matches('select, input[type="checkbox"]')) trigger();
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
