// 貨櫃規格彈出視窗(spec 6.5.5/第35節):在貨量資訊、成本/報價的貨櫃類型欄位旁加一個ⓘ圖示,點擊查看規格卡片
// (外徑/內徑/最大負載/容積)。規格資料離線處理成靜態JSON(js/data/containerSpecs.json),比照 6.5.2 節機場/港口
// 資料的處理方式,不即時打外部API,一次讀取後快取供整個分頁重複使用——這份資料純供參考,不參與任何成本計算。

let containerSpecsCache = null;

function loadContainerSpecs() {
  if (!containerSpecsCache) {
    containerSpecsCache = fetch("js/data/containerSpecs.json")
      .then((r) => r.json())
      .catch(() => []);
  }
  return containerSpecsCache;
}

// 型別在清單裡但 hasSpec===false(如OT/PLT/CTN),或根本不在清單裡(自訂單位/空運ULD等),
// 都算「暫無詳細規格資料」,不留空白也不報錯(spec 第35節第3點)
function containerSpecCardHtml(spec, type) {
  if (!spec || spec.hasSpec === false) {
    return `
      <div class="container-spec-title">${escapeHtml(type || "-")}</div>
      <p class="empty-state" style="margin: 6px 0 0">此類型暫無詳細規格資料</p>
    `;
  }
  return `
    <div class="container-spec-title">${escapeHtml(spec.type)}${spec.label ? " — " + escapeHtml(spec.label) : ""}</div>
    <table class="container-spec-table">
      <tr><th>外徑(長×寬×高)</th><td>${escapeHtml(spec.outerDims || "-")}</td></tr>
      <tr><th>內徑(長×寬×高)</th><td>${escapeHtml(spec.innerDims || "-")}</td></tr>
      <tr><th>最大負載</th><td>${escapeHtml(spec.maxLoad || "-")}</td></tr>
      <tr><th>容積</th><td>${escapeHtml(spec.volume || "-")}</td></tr>
    </table>
    ${spec.note ? `<p class="container-spec-note">${escapeHtml(spec.note)}</p>` : ""}
    <p class="container-spec-disclaimer">僅供參考,實際以櫃門標示(Tare &amp; Payload)為準</p>
  `;
}

// fieldEl:貨櫃類型的輸入欄位(<select>或<input>),插在它後面一個ⓘ圖示。
// getType():每次點擊當下才呼叫,取得欄位目前的值(呼叫端負責正規化成標準代碼)——不能在建立當下就把值存死,
// 因為使用者可能開過一次卡片後又改了欄位內容,下次點擊要查到最新輸入的類型。
function attachContainerSpecInfoIcon(fieldEl, getType) {
  // 用一個 position:relative 的小容器包住圖示+彈出卡片,卡片才能穩定定位在圖示下方,
  // 不用去動 .dynamic-row 這種被其他版面規則共用的容器的 position
  const wrap = document.createElement("span");
  wrap.className = "container-spec-icon-wrap";
  fieldEl.insertAdjacentElement("afterend", wrap);

  const icon = document.createElement("button");
  icon.type = "button";
  icon.className = "container-spec-icon";
  icon.title = "查看貨櫃規格";
  icon.setAttribute("aria-label", "查看貨櫃規格");
  icon.textContent = "ⓘ";
  wrap.appendChild(icon);

  const popup = document.createElement("div");
  popup.className = "container-spec-popup";
  popup.style.display = "none";
  wrap.appendChild(popup);

  icon.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const wasOpen = popup.style.display !== "none";
    document.querySelectorAll(".container-spec-popup").forEach((p) => (p.style.display = "none"));
    if (wasOpen) return;
    const type = getType();
    popup.innerHTML = `<p class="empty-state">載入中...</p>`;
    popup.style.display = "block";
    const specs = await loadContainerSpecs();
    const spec = specs.find((s) => s.type === type);
    popup.innerHTML = containerSpecCardHtml(spec, type);
  });

  document.addEventListener("click", (event) => {
    if (popup.style.display !== "none" && !popup.contains(event.target) && event.target !== icon) {
      popup.style.display = "none";
    }
  });
}
