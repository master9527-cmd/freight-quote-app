// AI 智慧匯入(spec 第5節/第36節):兩個入口共用這份邏輯——
// A. 案件層級精靈(主要入口,caseDetail.js openAiImportWizard):貼資料→解析→選擇建立新代理或併入既有代理→分層預覽→套用
// B. 代理卡片內嵌(次要入口,caseDetail.js openAiImportForAgent):貼資料→解析→分層預覽→套用(代理已固定)
// 兩者的「解析」「分層預覽」「寫入資料庫」共用同一套函式,只有「套用」前是否要先決定/建立代理不同。

// 第40.1節(全文取代規則):perUnit拆成perContainer/perPallet/perCarton,perUnitPerDay拆成
// perContainerPerDay/perPalletPerDay/perChassisPerDay,perUnit/perUnitPerDay不再是合法值
const AI_IMPORT_BASIS_VALUES = [
  "flat",
  "perShipment",
  "perKg",
  "perContainer",
  "perPallet",
  "perCarton",
  "perKgBreak",
  "perContainerPerDay",
  "perPalletPerDay",
  "perChassisPerDay",
];
const AI_IMPORT_ARRAY_TYPE_BASIS = new Set(["perContainer", "perContainerPerDay"]);
const AI_IMPORT_PER_DAY_BASIS = new Set(["perContainerPerDay", "perPalletPerDay", "perChassisPerDay"]);

// ============================================================
// 檔案 → Edge Function 請求 payload
// ============================================================

async function aiImportFileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// 把一個使用者上傳的檔案轉成 edge function 看得懂的其中一種 part:
// PDF/圖片直接轉 base64(Claude原生支援,不用額外OCR/文字抽取);Excel/Word在瀏覽器端先轉成純文字
async function aiImportFileToPart(file) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return { kind: "pdf", base64: await aiImportFileToBase64(file), label: file.name };
  }
  if (file.type.startsWith("image/")) {
    return { kind: "image", mediaType: file.type || "image/png", base64: await aiImportFileToBase64(file), label: file.name };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const text = wb.SheetNames.map((sheetName) => `【${sheetName}】\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])}`).join("\n\n");
    return { kind: "text", value: text, label: file.name };
  }
  if (name.endsWith(".docx")) {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { kind: "text", value: result.value, label: file.name };
  }
  throw new Error(`不支援的檔案格式:${file.name}(僅支援 PDF/Excel/Word/圖片)`);
}

function aiImportBuildPayload(items, mode) {
  const payload = { mode: mode || null, textInputs: [], images: [], pdfs: [] };
  items.forEach((item) => {
    if (item.kind === "text") payload.textInputs.push(item.value);
    else if (item.kind === "image") payload.images.push({ mediaType: item.mediaType, base64: item.base64 });
    else if (item.kind === "pdf") payload.pdfs.push({ base64: item.base64 });
  });
  return payload;
}

async function aiImportCallParse(payload) {
  const { data, error } = await supabaseClient.functions.invoke("ai-parse-costs", { body: payload });
  if (error) {
    let message = error.message || "AI 解析失敗,請確認 Edge Function 是否已部署";
    if (error.context && typeof error.context.json === "function") {
      try {
        const body = await error.context.json();
        if (body && body.error) message = body.error;
      } catch (_) {
        // 讀不到就用預設訊息
      }
    }
    throw new Error(message);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ============================================================
// 分層預覽(mode → segment → FeeLine/Lane,spec 5.4):每筆可編輯/刪除,Lane可勾選要不要匯入
// ============================================================

function aiImportNumOrNull(v) {
  return v === "" || v === undefined || v === null ? null : Number(v);
}

function aiRenderFeeLineRow(feeLine) {
  const row = document.createElement("div");
  row.className = "ai-feeline-row";
  row.innerHTML = `
    <div class="ai-feeline-main">
      <input type="text" class="ai-fl-name" placeholder="費用名稱" value="${escapeHtml(feeLine.name || "")}" />
      <select class="ai-fl-basis">${AI_IMPORT_BASIS_VALUES.map((b) => `<option value="${b}">${escapeHtml(BASIS_LABELS[b])}</option>`).join("")}</select>
      <input type="text" class="ai-fl-currency" placeholder="幣別" value="${escapeHtml(feeLine.currency || "")}" />
      <select class="ai-fl-certainty">
        <option value="certain">確定</option>
        <option value="possible">待確認</option>
      </select>
      <button type="button" class="btn-danger-link ai-fl-remove">刪除</button>
    </div>
    <div class="ai-fl-basis-detail"></div>
    <input type="text" class="ai-fl-remark" placeholder="備註(原文摘要/條件說明)" value="${escapeHtml(feeLine.remark || "")}" />
  `;
  row.querySelector(".ai-fl-basis").value = AI_IMPORT_BASIS_VALUES.includes(feeLine.basis) ? feeLine.basis : "flat";
  row.querySelector(".ai-fl-certainty").value = feeLine.certainty === "possible" ? "possible" : "certain";
  row.querySelector(".ai-fl-remove").addEventListener("click", () => row.remove());

  const detailEl = row.querySelector(".ai-fl-basis-detail");
  function renderDetail() {
    const basis = row.querySelector(".ai-fl-basis").value;
    detailEl.innerHTML = "";
    if (AI_IMPORT_ARRAY_TYPE_BASIS.has(basis)) {
      const rowsEl = document.createElement("div");
      rowsEl.className = "dynamic-rows ai-fl-amount-by-type-rows";
      (feeLine.amountByType || []).forEach((t) => addDynamicRow(rowsEl, { colAValue: t.type, colBValue: t.amount, colAPlaceholder: "貨櫃類型代碼", colBPlaceholder: "金額" }));
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-link";
      addBtn.textContent = "+ 新增單位";
      addBtn.addEventListener("click", () => addDynamicRow(rowsEl, { colAPlaceholder: "貨櫃類型代碼", colBPlaceholder: "金額" }));
      detailEl.appendChild(rowsEl);
      detailEl.appendChild(addBtn);
      if (AI_IMPORT_PER_DAY_BASIS.has(basis)) {
        const daysWrap = document.createElement("div");
        daysWrap.className = "field-inline";
        daysWrap.innerHTML = `<label>天數</label><input type="number" step="1" class="ai-fl-days" value="${feeLine.days ?? ""}" />`;
        detailEl.appendChild(daysWrap);
      }
    } else if (basis === "perPalletPerDay" || basis === "perChassisPerDay") {
      const amountLabel = basis === "perPalletPerDay" ? "每棧板每天單價" : "每底盤每天單價";
      detailEl.innerHTML = `
        <div class="field-inline"><label>${amountLabel}</label><input type="number" step="any" class="ai-fl-amount" value="${feeLine.amount ?? ""}" /></div>
        <div class="field-inline"><label>天數</label><input type="number" step="1" class="ai-fl-days" value="${feeLine.days ?? ""}" /></div>
      `;
    } else if (basis === "perKgBreak") {
      const minWrap = document.createElement("div");
      minWrap.className = "field-inline";
      minWrap.innerHTML = `<label>最低消費</label><input type="number" step="any" class="ai-fl-min-charge" value="${feeLine.minCharge ?? ""}" />`;
      const rowsEl = document.createElement("div");
      rowsEl.className = "dynamic-rows ai-fl-breaks-rows";
      (feeLine.breaks || []).forEach((b) =>
        addDynamicRow(rowsEl, { colAValue: b.thresholdKg, colBValue: b.ratePerKg, colAPlaceholder: "級距(KG)", colBPlaceholder: "每KG費率", colAType: "number" })
      );
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-link";
      addBtn.textContent = "+ 新增級距";
      addBtn.addEventListener("click", () => addDynamicRow(rowsEl, { colAPlaceholder: "級距(KG)", colBPlaceholder: "每KG費率", colAType: "number" }));
      detailEl.appendChild(minWrap);
      detailEl.appendChild(rowsEl);
      detailEl.appendChild(addBtn);
    } else {
      detailEl.innerHTML = `<input type="number" step="any" class="ai-fl-amount" placeholder="金額" value="${feeLine.amount ?? ""}" />`;
    }
  }
  row.querySelector(".ai-fl-basis").addEventListener("change", renderDetail);
  renderDetail();
  return row;
}

function aiCollectFeeLineRow(row) {
  const name = row.querySelector(".ai-fl-name").value.trim();
  if (!name) return null;
  const basis = row.querySelector(".ai-fl-basis").value;
  const payload = {
    name,
    certainty: row.querySelector(".ai-fl-certainty").value,
    currency: row.querySelector(".ai-fl-currency").value.trim() || "USD",
    remark: row.querySelector(".ai-fl-remark").value.trim() || null,
    // spec 47.1:互斥選項組是需要人工判斷的結構性關係,AI匯入不嘗試從文字推論,一律留空讓使用者事後手動指定
    option_group: null,
    basis,
    amount: null,
    amount_by_type: null,
    min_charge: null,
    breaks: null,
    days: null,
  };
  if (AI_IMPORT_ARRAY_TYPE_BASIS.has(basis)) {
    const rowsEl = row.querySelector(".ai-fl-amount-by-type-rows");
    payload.amount_by_type = rowsEl ? collectRows(rowsEl, "type", "amount") : [];
    if (AI_IMPORT_PER_DAY_BASIS.has(basis)) {
      const daysEl = row.querySelector(".ai-fl-days");
      payload.days = daysEl && daysEl.value !== "" ? Number(daysEl.value) : null;
    }
  } else if (basis === "perKgBreak") {
    const minEl = row.querySelector(".ai-fl-min-charge");
    payload.min_charge = minEl && minEl.value !== "" ? Number(minEl.value) : null;
    const rowsEl = row.querySelector(".ai-fl-breaks-rows");
    payload.breaks = rowsEl ? collectRows(rowsEl, "thresholdKg", "ratePerKg", { keyAType: "number" }) : [];
  } else {
    const amountEl = row.querySelector(".ai-fl-amount");
    payload.amount = amountEl && amountEl.value !== "" ? Number(amountEl.value) : 0;
    if (AI_IMPORT_PER_DAY_BASIS.has(basis)) {
      const daysEl = row.querySelector(".ai-fl-days");
      payload.days = daysEl && daysEl.value !== "" ? Number(daysEl.value) : null;
    }
  }
  return payload;
}

function aiRenderLanePreview(lane) {
  const laneWrap = document.createElement("div");
  laneWrap.className = "ai-preview-lane";
  laneWrap.innerHTML = `
    <label class="ai-lane-include-label">
      <input type="checkbox" class="ai-lane-include" checked />
      <strong>要匯入這條航線</strong>
    </label>
    <div class="ai-lane-meta">
      <input type="text" class="ai-lane-carrier" placeholder="船/航空公司" value="${escapeHtml(lane.carrier || "")}" />
      <input type="text" class="ai-lane-routing" placeholder="路由" value="${escapeHtml(lane.routing || "")}" />
      <input type="number" class="ai-lane-transit-min" placeholder="最短天數" value="${lane.transitDaysMin ?? ""}" />
      <input type="number" class="ai-lane-transit-max" placeholder="最長天數" value="${lane.transitDaysMax ?? ""}" />
    </div>
  `;
  const rowsEl = document.createElement("div");
  rowsEl.className = "dynamic-rows ai-feeline-rows";
  (lane.feeLines || []).forEach((fl) => rowsEl.appendChild(aiRenderFeeLineRow(fl)));
  laneWrap.appendChild(rowsEl);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn-link";
  addBtn.textContent = "+ 新增費用項目";
  addBtn.addEventListener("click", () => rowsEl.appendChild(aiRenderFeeLineRow({ basis: "flat", certainty: "certain" })));
  laneWrap.appendChild(addBtn);
  return laneWrap;
}

function aiRenderSegmentPreview(container, segment) {
  const wrap = document.createElement("div");
  wrap.className = "ai-preview-segment";
  const hasLanes = Array.isArray(segment.lanes) && segment.lanes.length > 0;
  wrap.dataset.segmentType = segment.segmentType;
  wrap.dataset.useLanes = hasLanes ? "1" : "0";
  wrap.innerHTML = `<h4>${escapeHtml(SEGMENT_TYPE_LABELS[segment.segmentType] || segment.segmentType)}</h4>`;
  if (hasLanes) {
    const lanesWrap = document.createElement("div");
    lanesWrap.className = "ai-preview-lanes";
    segment.lanes.forEach((lane) => lanesWrap.appendChild(aiRenderLanePreview(lane)));
    wrap.appendChild(lanesWrap);
  } else {
    const rowsEl = document.createElement("div");
    rowsEl.className = "dynamic-rows ai-feeline-rows";
    (segment.feeLines || []).forEach((fl) => rowsEl.appendChild(aiRenderFeeLineRow(fl)));
    wrap.appendChild(rowsEl);
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-link";
    addBtn.textContent = "+ 新增費用項目";
    addBtn.addEventListener("click", () => rowsEl.appendChild(aiRenderFeeLineRow({ basis: "flat", certainty: "certain" })));
    wrap.appendChild(addBtn);
  }
  container.appendChild(wrap);
}

function renderAiParsePreview(container, result) {
  container.innerHTML = "";
  if (result.mode) {
    const modeLine = document.createElement("div");
    modeLine.className = "ai-preview-mode-line";
    modeLine.textContent = `AI 判讀運輸模式:${MODE_LABELS[result.mode] || result.mode}(僅供參考,不會改變案件設定)`;
    container.appendChild(modeLine);
  }
  const segments = Array.isArray(result.segments) ? result.segments : [];
  if (!segments.length) {
    container.insertAdjacentHTML("beforeend", `<p class="empty-state">AI 沒有判讀出任何費用項目,請確認貼上的內容是否為報價相關資料。</p>`);
    return;
  }
  segments.forEach((seg) => aiRenderSegmentPreview(container, seg));
}

function collectAiParsePreview(container) {
  const segments = [];
  container.querySelectorAll(":scope > .ai-preview-segment").forEach((segEl) => {
    const segmentType = segEl.dataset.segmentType;
    const useLanes = segEl.dataset.useLanes === "1";
    if (useLanes) {
      const lanes = [];
      segEl.querySelectorAll(":scope > .ai-preview-lanes > .ai-preview-lane").forEach((laneEl) => {
        if (!laneEl.querySelector(".ai-lane-include").checked) return;
        const feeLines = [];
        laneEl.querySelectorAll(":scope > .ai-feeline-rows > .ai-feeline-row").forEach((rowEl) => {
          const fl = aiCollectFeeLineRow(rowEl);
          if (fl) feeLines.push(fl);
        });
        if (!feeLines.length) return;
        lanes.push({
          carrier: laneEl.querySelector(".ai-lane-carrier").value.trim() || null,
          routing: laneEl.querySelector(".ai-lane-routing").value.trim() || null,
          transit_days_min: aiImportNumOrNull(laneEl.querySelector(".ai-lane-transit-min").value),
          transit_days_max: aiImportNumOrNull(laneEl.querySelector(".ai-lane-transit-max").value),
          feeLines,
        });
      });
      if (lanes.length) segments.push({ segmentType, useLanes: true, lanes });
    } else {
      const feeLines = [];
      segEl.querySelectorAll(":scope > .ai-feeline-rows > .ai-feeline-row").forEach((rowEl) => {
        const fl = aiCollectFeeLineRow(rowEl);
        if (fl) feeLines.push(fl);
      });
      if (feeLines.length) segments.push({ segmentType, useLanes: false, feeLines });
    }
  });
  return { segments };
}

// ============================================================
// 套用:寫入 segments/lanes/fee_lines(沿用 segmentForm.js 已經在用的資料表結構/upsert寫法)
// ============================================================

async function aiImportInsertFeeLines(feeLines, parentRef) {
  if (!feeLines.length) return;
  const payloads = feeLines.map((fl) => ({ ...parentRef, ...fl }));
  const { error } = await supabaseClient.from("fee_lines").insert(payloads);
  if (error) throw error;
}

async function applyAiParsedResultToAgent(agentId, editedResult) {
  for (const seg of editedResult.segments) {
    const { data: segRow, error: segError } = await supabaseClient
      .from("segments")
      .upsert({ agent_id: agentId, segment_type: seg.segmentType, use_lanes: seg.useLanes }, { onConflict: "agent_id,segment_type" })
      .select()
      .single();
    if (segError) throw segError;
    if (seg.useLanes) {
      for (const lane of seg.lanes) {
        const { data: laneRow, error: laneError } = await supabaseClient
          .from("lanes")
          .insert({
            segment_id: segRow.id,
            carrier: lane.carrier,
            routing: lane.routing,
            transit_days_min: lane.transit_days_min,
            transit_days_max: lane.transit_days_max,
          })
          .select()
          .single();
        if (laneError) throw laneError;
        await aiImportInsertFeeLines(lane.feeLines, { lane_id: laneRow.id });
      }
    } else {
      await aiImportInsertFeeLines(seg.feeLines, { segment_id: segRow.id });
    }
  }
  if (typeof loadAgentsAndSegments === "function") await loadAgentsAndSegments();
  // spec 49.3節A:AI匯入寫入新費用後,若使用者當下停留在比較分析/報價分頁,那兩個分頁原本不會自動反映——
  // 這是新增代理跟併入既有代理兩種AI匯入流程共用的寫入點,補這一行涵蓋兩種情境
  if (typeof refreshComparisonAndQuoteTabs === "function") refreshComparisonAndQuoteTabs();
}

// 案件層級精靈(spec 5.1-A)選「建立為新代理」時呼叫——先建代理拿到 id,再沿用同一套寫入邏輯
async function applyAiParsedResultAsNewAgent(caseId, scenarioId, agentName, role, editedResult) {
  const { data: agent, error } = await supabaseClient
    .from("agents")
    .insert({ case_id: caseId, scenario_id: scenarioId, name: agentName, role: role || "both" })
    .select()
    .single();
  if (error) throw error;
  await applyAiParsedResultToAgent(agent.id, editedResult);
  return agent;
}

// ============================================================
// 共用 modal 骨架 + 輸入步驟(貼文字/拖拉上傳)
// ============================================================

let aiImportItemSeq = 0;

function aiImportItemLabel(item) {
  if (item.label) return item.label;
  const preview = (item.value || "").trim().slice(0, 24);
  return preview ? `文字段落:${preview}${item.value.trim().length > 24 ? "…" : ""}` : "文字段落";
}

// 建立modal的共用骨架(overlay+視窗),回傳 { overlay, modal, body, close }
function aiImportCreateModalShell(title) {
  const overlay = document.createElement("div");
  overlay.className = "ai-import-modal-overlay";
  overlay.innerHTML = `
    <div class="ai-import-modal">
      <div class="ai-import-modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="btn-link ai-import-modal-close">關閉</button>
      </div>
      <div class="ai-import-modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  function close() {
    overlay.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector(".ai-import-modal-close").addEventListener("click", close);
  return { overlay, modal: overlay.querySelector(".ai-import-modal"), body: overlay.querySelector(".ai-import-modal-body"), close };
}

// 在 body 裡渲染「貼資料」輸入步驟,解析成功後呼叫 onParsed(result);失敗顯示錯誤訊息,使用者可重試
function aiImportRenderInputStep(body, mode) {
  const items = [];
  body.innerHTML = `
    <div class="ai-import-input-step">
      <div class="field-inline field-full">
        <label>貼上文字(Email 內文、聊天訊息、或直接描述)</label>
        <textarea class="ai-import-textarea" rows="4" placeholder="把代理報價的文字內容貼在這裡"></textarea>
        <button type="button" class="btn-link ai-import-add-text-btn">+ 加入這段文字</button>
      </div>
      <div class="ai-import-dropzone">
        拖曳檔案到這裡,或
        <button type="button" class="btn-link ai-import-choose-file-btn">選擇檔案</button>
        <input type="file" class="ai-import-file-input" multiple accept=".pdf,.xlsx,.xls,.csv,.docx,image/*" style="display:none" />
        <div class="field-hint">支援 PDF / Excel(.xlsx/.xls/.csv) / Word(.docx) / 圖片,可一次選多個</div>
      </div>
      <div class="ai-import-items"></div>
      <div class="ai-import-input-message message"></div>
      <div class="form-actions">
        <button type="button" class="btn-small primary ai-import-start-btn">開始解析</button>
      </div>
    </div>
  `;
  const itemsEl = body.querySelector(".ai-import-items");
  const messageEl = body.querySelector(".ai-import-input-message");
  const dropzone = body.querySelector(".ai-import-dropzone");
  const fileInput = body.querySelector(".ai-import-file-input");
  const startBtn = body.querySelector(".ai-import-start-btn");

  function renderItems() {
    itemsEl.innerHTML = items
      .map(
        (item) => `
        <div class="ai-import-item" data-item-id="${item.id}">
          <span>${escapeHtml(aiImportItemLabel(item))}</span>
          <button type="button" class="btn-danger-link ai-import-item-remove" data-item-id="${item.id}">移除</button>
        </div>`
      )
      .join("");
  }
  itemsEl.addEventListener("click", (event) => {
    const btn = event.target.closest(".ai-import-item-remove");
    if (!btn) return;
    const id = Number(btn.dataset.itemId);
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) items.splice(idx, 1);
    renderItems();
  });

  body.querySelector(".ai-import-add-text-btn").addEventListener("click", () => {
    const textarea = body.querySelector(".ai-import-textarea");
    const value = textarea.value.trim();
    if (!value) return;
    items.push({ id: ++aiImportItemSeq, kind: "text", value });
    textarea.value = "";
    renderItems();
  });

  async function addFiles(fileList) {
    messageEl.textContent = "";
    messageEl.className = "ai-import-input-message message";
    for (const file of Array.from(fileList)) {
      try {
        const part = await aiImportFileToPart(file);
        items.push({ id: ++aiImportItemSeq, ...part });
      } catch (err) {
        messageEl.textContent = err.message || `無法讀取檔案:${file.name}`;
        messageEl.className = "ai-import-input-message message error";
      }
    }
    renderItems();
  }

  body.querySelector(".ai-import-choose-file-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (event) => {
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  });

  return new Promise((resolve) => {
    startBtn.addEventListener("click", async () => {
      // 純文字textarea裡還沒按「加入」的內容,一併視為要解析的段落,避免使用者忘記按加入卻以為已經送出
      const pendingText = body.querySelector(".ai-import-textarea").value.trim();
      const allItems = pendingText ? [...items, { kind: "text", value: pendingText }] : items;
      if (!allItems.length) {
        messageEl.textContent = "請至少貼上一段文字或加入一個檔案";
        messageEl.className = "ai-import-input-message message error";
        return;
      }
      startBtn.disabled = true;
      messageEl.textContent = "AI 解析中,請稍候…";
      messageEl.className = "ai-import-input-message message";
      try {
        const payload = aiImportBuildPayload(allItems, mode);
        const result = await aiImportCallParse(payload);
        resolve(result);
      } catch (err) {
        messageEl.textContent = `解析失敗:${err.message}`;
        messageEl.className = "ai-import-input-message message error";
        startBtn.disabled = false;
      }
    });
  });
}

// ============================================================
// 入口 B(次要):代理卡片內嵌——代理已固定,解析完直接分層預覽+套用
// ============================================================

function openAiImportForAgent(agent, caseMode) {
  const { body, close } = aiImportCreateModalShell(`AI 智慧匯入 — ${agent.name}`);
  aiImportRenderInputStep(body, caseMode).then((result) => {
    body.innerHTML = `
      <div class="ai-preview-root"></div>
      <div class="form-actions">
        <button type="button" class="btn-small primary ai-import-apply-btn">套用</button>
        <button type="button" class="btn-small ai-import-cancel-btn">取消</button>
      </div>
      <div class="ai-import-apply-message message"></div>
    `;
    renderAiParsePreview(body.querySelector(".ai-preview-root"), result);
    body.querySelector(".ai-import-cancel-btn").addEventListener("click", close);
    body.querySelector(".ai-import-apply-btn").addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      const messageEl = body.querySelector(".ai-import-apply-message");
      const edited = collectAiParsePreview(body.querySelector(".ai-preview-root"));
      if (!edited.segments.length) {
        messageEl.textContent = "沒有可套用的費用項目";
        messageEl.className = "ai-import-apply-message message error";
        return;
      }
      btn.disabled = true;
      try {
        await applyAiParsedResultToAgent(agent.id, edited);
        close();
      } catch (err) {
        messageEl.textContent = `套用失敗:${err.message}`;
        messageEl.className = "ai-import-apply-message message error";
        btn.disabled = false;
      }
    });
  });
}

// ============================================================
// 入口 A(主要,spec 5.1-A/第36節):案件層級精靈——貼資料→解析→選擇建立新代理/併入既有代理→分層預覽→套用
// ============================================================

function openAiImportWizard({ caseId, scenarioId, mode, existingAgents }) {
  const { body, close } = aiImportCreateModalShell("AI 智慧匯入精靈");
  aiImportRenderInputStep(body, mode).then((result) => {
    const detectedName = result.detectedAgentName || "";
    body.innerHTML = `
      <div class="ai-import-agent-choice">
        ${
          detectedName
            ? `<p class="field-hint">AI 判讀這份報價可能來自:<strong>${escapeHtml(detectedName)}</strong>(僅供參考,請確認下方選擇)</p>`
            : ""
        }
        <div class="ai-import-agent-mode-tabs">
          <label><input type="radio" name="ai-import-agent-mode" value="new" checked /> 建立為新代理</label>
          <label><input type="radio" name="ai-import-agent-mode" value="existing" ${existingAgents.length ? "" : "disabled"} /> 併入案件內已存在的代理${existingAgents.length ? "" : "(這個案件還沒有代理)"}</label>
        </div>
        <div class="ai-import-agent-new-fields">
          <div class="field-inline">
            <label>新代理名稱</label>
            <input type="text" class="ai-import-new-agent-name" value="${escapeHtml(detectedName)}" placeholder="如 XX Logistics" />
          </div>
          <div class="field-inline">
            <label>角色</label>
            <select class="ai-import-new-agent-role">
              <option value="both">出口/進口皆可</option>
              <option value="export">出口地代理</option>
              <option value="import">進口地代理</option>
            </select>
          </div>
        </div>
        <div class="ai-import-agent-existing-fields" style="display:none">
          <div class="field-inline">
            <label>選擇既有代理</label>
            <select class="ai-import-existing-agent-select">
              ${existingAgents.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>
      <div class="ai-preview-root"></div>
      <div class="form-actions">
        <button type="button" class="btn-small primary ai-import-apply-btn">套用</button>
        <button type="button" class="btn-small ai-import-cancel-btn">取消</button>
      </div>
      <div class="ai-import-apply-message message"></div>
    `;
    renderAiParsePreview(body.querySelector(".ai-preview-root"), result);

    const newFields = body.querySelector(".ai-import-agent-new-fields");
    const existingFields = body.querySelector(".ai-import-agent-existing-fields");
    body.querySelectorAll('input[name="ai-import-agent-mode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const isNew = body.querySelector('input[name="ai-import-agent-mode"]:checked').value === "new";
        newFields.style.display = isNew ? "" : "none";
        existingFields.style.display = isNew ? "none" : "";
      });
    });

    body.querySelector(".ai-import-cancel-btn").addEventListener("click", close);
    body.querySelector(".ai-import-apply-btn").addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      const messageEl = body.querySelector(".ai-import-apply-message");
      const edited = collectAiParsePreview(body.querySelector(".ai-preview-root"));
      if (!edited.segments.length) {
        messageEl.textContent = "沒有可套用的費用項目";
        messageEl.className = "ai-import-apply-message message error";
        return;
      }
      const isNewAgent = body.querySelector('input[name="ai-import-agent-mode"]:checked').value === "new";
      btn.disabled = true;
      try {
        if (isNewAgent) {
          const name = body.querySelector(".ai-import-new-agent-name").value.trim();
          if (!name) throw new Error("請輸入新代理名稱");
          const role = body.querySelector(".ai-import-new-agent-role").value;
          await applyAiParsedResultAsNewAgent(caseId, scenarioId, name, role, edited);
        } else {
          const agentId = body.querySelector(".ai-import-existing-agent-select").value;
          if (!agentId) throw new Error("請選擇要併入的代理");
          await applyAiParsedResultToAgent(agentId, edited);
        }
        close();
      } catch (err) {
        messageEl.textContent = `套用失敗:${err.message}`;
        messageEl.className = "ai-import-apply-message message error";
        btn.disabled = false;
      }
    });
  });
}
