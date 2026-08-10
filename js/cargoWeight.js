// 空運計費重量雙模式輸入 + 海運LCL材積輸入(spec 2.1節 cargo模型擴充,第27節):
// - 空運 weightInputMode: 'direct'(直接輸入計費重量) | 'calculated'(尺寸+重量帶入計算,含多筆 dimensions)
// - 海運LCL: volumeCBM(總材積)
// 新增案件(cases.js)、編輯案件(caseDetail.js)表單共用同一份渲染+收集邏輯,避免兩處各自維護一份容易不同步。

// cargo.units 列的共用渲染/收集(spec 29.2):新增 qtyMin/qtyMax,記錄客戶給的約略月量範圍(Bidding案件常見),
// 純資訊用途、不參與費率計算——qty 本身才是算「每櫃」混合費率用的實際數量(通常設1,見3.3/29.2節)。
// 新增案件(cases.js)、編輯案件(caseDetail.js)、編輯情境(caseDetail.js Project情境表單)三處共用,避免各自維護一份容易不同步。
function addCargoUnitRow(container, { type = "", qty = "", qtyMin = "", qtyMax = "" } = {}) {
  const row = document.createElement("div");
  row.className = "dynamic-row cargo-unit-row";
  row.innerHTML = `
    <input type="text" class="cu-type" placeholder="類型,如 20GP / PLT / CTN" value="${escapeHtml(String(type))}" />
    <input type="number" class="cu-qty" placeholder="數量" min="0" step="1" value="${qty}" />
    <input type="number" class="cu-qty-min" placeholder="約略月量下限(選填)" min="0" step="1" value="${qtyMin}" />
    <input type="number" class="cu-qty-max" placeholder="約略月量上限(選填)" min="0" step="1" value="${qtyMax}" />
    <button type="button" class="remove-row" title="刪除">×</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  container.appendChild(row);
  // spec 6.5.5/第35節:貨櫃類型欄位旁的ⓘ圖示,點擊查規格卡片——先正規化(去符號/比對別名)再查表,
  // 這樣使用者打「20'GP」也能查到「20GP」的規格,不用跟存檔格式一模一樣才查得到
  const typeInput = row.querySelector(".cu-type");
  attachContainerSpecInfoIcon(typeInput, () => normalizeContainerType(typeInput.value));
}

// 從畫面收集 cargo.units 陣列(含正規化,空運不套用,見27.1節)。qtyMin/qtyMax 沒填就是 null,
// 純資訊用途不強制填寫,也不影響費率計算(spec 29.2)
function collectCargoUnits(container, mode) {
  const units = [];
  container.querySelectorAll(".cargo-unit-row").forEach((row) => {
    const raw = row.querySelector(".cu-type").value.trim();
    const type = mode === "air" ? raw : normalizeContainerType(raw);
    const qty = row.querySelector(".cu-qty").value;
    if (!type || !qty) return;
    const qtyMinVal = row.querySelector(".cu-qty-min").value;
    const qtyMaxVal = row.querySelector(".cu-qty-max").value;
    units.push({
      type,
      qty: Number(qty),
      qtyMin: qtyMinVal ? Number(qtyMinVal) : null,
      qtyMax: qtyMaxVal ? Number(qtyMaxVal) : null,
    });
  });
  return units;
}

function defaultVolumetricDivisor(dimensionUnit) {
  return dimensionUnit === "mm" ? 6000000 : 6000;
}

function computeVolumetricWeight(dimensions, divisor) {
  const total = (dimensions || []).reduce((sum, d) => {
    const l = Number(d.length || 0);
    const w = Number(d.width || 0);
    const h = Number(d.height || 0);
    const qty = Number(d.qty || 0);
    return sum + l * w * h * qty;
  }, 0);
  return divisor ? total / divisor : 0;
}

// container.dataset.mode 記錄目前渲染的是哪個 case.mode,collectCargoWeightVolume 依此決定要收集哪些欄位。
// 非空運模式(含海運LCL)維持一個簡單的「計費重量」直接輸入欄位——perKg/perKgBreak 計價的 FeeLine
// 不限空運才能用(spec 9.7,鐵路/卡車情境同樣適用這套費率表邏輯),不能只有空運能填這個欄位;
// 空運才用「直接輸入/尺寸+重量帶入計算」雙模式(spec第27節);海運LCL額外多一個總材積 volumeCBM 欄位。
function renderCargoWeightSection(container, mode, existing) {
  const cargo = existing || {};
  container.dataset.mode = mode;

  if (mode !== "air") {
    const isLcl = mode === "sea_lcl";
    container.innerHTML = `
      <div class="form-grid">
        <div class="field-inline">
          <label>計費重量(KG,perKg/perKgBreak計價費用適用)</label>
          <input type="number" step="0.01" min="0" class="cw-chargeable-weight" value="${cargo.chargeableWeightKg ?? ""}" />
        </div>
        ${
          isLcl
            ? `<div class="field-inline">
                 <label>總材積 volumeCBM(CBM,海運LCL適用)</label>
                 <input type="number" step="0.001" min="0" class="cw-volume-cbm" value="${cargo.volumeCBM ?? ""}" />
               </div>`
            : ""
        }
      </div>
    `;
    return;
  }

  const weightInputMode = cargo.weightInputMode || "direct";
  const dimensionUnit = cargo.dimensionUnit || "cm";
  const dims = cargo.dimensions && cargo.dimensions.length ? cargo.dimensions : [];

  container.innerHTML = `
    <div class="field-inline field-full">
      <label>計費重量輸入方式</label>
      <div class="checkbox-field" style="gap: 16px">
        <label><input type="radio" name="${container.id}-wim" class="cw-mode-direct" value="direct" ${weightInputMode === "direct" ? "checked" : ""} /> 直接輸入計費重量</label>
        <label><input type="radio" name="${container.id}-wim" class="cw-mode-calculated" value="calculated" ${weightInputMode === "calculated" ? "checked" : ""} /> 由尺寸+重量帶入計算</label>
      </div>
    </div>
    <div class="cw-direct-fields field-inline" style="${weightInputMode === "direct" ? "" : "display:none"}">
      <label>計費重量(KG)</label>
      <input type="number" step="0.01" min="0" class="cw-chargeable-weight" value="${cargo.chargeableWeightKg ?? ""}" />
    </div>
    <div class="cw-calculated-fields" style="${weightInputMode === "calculated" ? "" : "display:none"}">
      <div class="form-grid">
        <div class="field-inline">
          <label>實際毛重 grossWeightKg(KG)</label>
          <input type="number" step="0.01" min="0" class="cw-gross-weight" value="${cargo.grossWeightKg ?? ""}" />
        </div>
        <div class="field-inline">
          <label>長寬高輸入單位</label>
          <select class="cw-dimension-unit">
            <option value="cm" ${dimensionUnit === "cm" ? "selected" : ""}>cm</option>
            <option value="mm" ${dimensionUnit === "mm" ? "selected" : ""}>mm</option>
          </select>
        </div>
        <div class="field-inline">
          <label>材積除數(可覆蓋,cm預設6000/mm預設6000000)</label>
          <input type="number" step="1" min="1" class="cw-divisor" value="${cargo.volumetricDivisor ?? defaultVolumetricDivisor(dimensionUnit)}" />
        </div>
        <div class="field-inline">
          <label>計費重量(自動計算,唯讀)</label>
          <input type="text" class="cw-computed-weight" readonly />
        </div>
      </div>
      <div class="field-inline field-full">
        <label>尺寸明細(可多筆,不同尺寸的貨品分開輸入)</label>
        <div class="dynamic-rows cw-dimension-rows"></div>
        <button type="button" class="btn-link cw-add-dimension-btn">+ 新增尺寸</button>
      </div>
    </div>
  `;

  const dimensionRowsEl = container.querySelector(".cw-dimension-rows");

  function collectDimensions() {
    return Array.from(dimensionRowsEl.querySelectorAll(".cw-dimension-row")).map((row) => ({
      length: Number(row.querySelector(".cw-dim-length").value || 0),
      width: Number(row.querySelector(".cw-dim-width").value || 0),
      height: Number(row.querySelector(".cw-dim-height").value || 0),
      qty: Number(row.querySelector(".cw-dim-qty").value || 0),
    }));
  }

  function recompute() {
    const grossWeight = Number(container.querySelector(".cw-gross-weight").value || 0);
    const divisorInput = container.querySelector(".cw-divisor");
    const divisor = Number(divisorInput.value || defaultVolumetricDivisor(container.querySelector(".cw-dimension-unit").value));
    const volumetricWeight = computeVolumetricWeight(collectDimensions(), divisor);
    const chargeable = Math.max(grossWeight, volumetricWeight);
    container.querySelector(".cw-computed-weight").value = chargeable ? chargeable.toFixed(2) : "";
  }

  function addDimensionRow(d = {}) {
    const row = document.createElement("div");
    row.className = "dynamic-row cw-dimension-row";
    row.innerHTML = `
      <input type="number" step="0.01" min="0" class="cw-dim-length" placeholder="長" value="${d.length ?? ""}" />
      <input type="number" step="0.01" min="0" class="cw-dim-width" placeholder="寬" value="${d.width ?? ""}" />
      <input type="number" step="0.01" min="0" class="cw-dim-height" placeholder="高" value="${d.height ?? ""}" />
      <input type="number" step="1" min="0" class="cw-dim-qty" placeholder="數量" value="${d.qty ?? ""}" />
      <button type="button" class="remove-row" title="刪除">×</button>
    `;
    row.querySelector(".remove-row").addEventListener("click", () => {
      row.remove();
      recompute();
    });
    row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", recompute));
    dimensionRowsEl.appendChild(row);
  }

  (dims.length ? dims : [{}]).forEach(addDimensionRow);

  container.querySelector(".cw-add-dimension-btn").addEventListener("click", () => addDimensionRow());
  container.querySelector(".cw-gross-weight").addEventListener("input", recompute);
  container.querySelector(".cw-divisor").addEventListener("input", recompute);

  container.dataset.dimensionUnit = dimensionUnit;
  container.querySelector(".cw-dimension-unit").addEventListener("change", (event) => {
    // 換單位時,除數如果還是「換單位前那個單位」的預設值,才自動跟著換成新單位的預設值,
    // 若使用者已經手動覆蓋過除數(不等於預設值),就不動它,避免蓋掉使用者刻意設定的自訂除數
    const divisorInput = container.querySelector(".cw-divisor");
    const prevUnit = container.dataset.dimensionUnit || "cm";
    const wasDefault = Number(divisorInput.value) === defaultVolumetricDivisor(prevUnit);
    const newUnit = event.target.value;
    if (wasDefault) divisorInput.value = defaultVolumetricDivisor(newUnit);
    container.dataset.dimensionUnit = newUnit;
    recompute();
  });

  function syncModeVisibility() {
    const isCalculated = container.querySelector(".cw-mode-calculated").checked;
    container.querySelector(".cw-direct-fields").style.display = isCalculated ? "none" : "flex";
    container.querySelector(".cw-calculated-fields").style.display = isCalculated ? "block" : "none";
  }
  container
    .querySelectorAll('input[type="radio"].cw-mode-direct, input[type="radio"].cw-mode-calculated')
    .forEach((r) => r.addEventListener("change", syncModeVisibility));

  recompute();
}

// 從畫面收集目前的 weightInputMode/volumeCBM 等欄位,合併進 cargo payload(新增/編輯案件表單存檔時呼叫)。
// 依 container.dataset.mode(渲染當下的 case.mode)決定要收集哪一組欄位,跟 renderCargoWeightSection 保持一致。
function collectCargoWeightVolume(container) {
  const mode = container.dataset.mode;

  if (mode !== "air") {
    const weightInput = container.querySelector(".cw-chargeable-weight");
    const result = { chargeableWeightKg: weightInput && weightInput.value ? Number(weightInput.value) : null };
    if (mode === "sea_lcl") {
      const v = container.querySelector(".cw-volume-cbm");
      result.volumeCBM = v && v.value ? Number(v.value) : null;
    }
    return result;
  }

  const weightInputMode = container.querySelector(".cw-mode-calculated").checked ? "calculated" : "direct";
  if (weightInputMode === "direct") {
    const v = container.querySelector(".cw-chargeable-weight");
    return { weightInputMode, chargeableWeightKg: v && v.value ? Number(v.value) : null };
  }

  const dims = Array.from(container.querySelectorAll(".cw-dimension-row"))
    .map((row) => ({
      length: Number(row.querySelector(".cw-dim-length").value || 0),
      width: Number(row.querySelector(".cw-dim-width").value || 0),
      height: Number(row.querySelector(".cw-dim-height").value || 0),
      qty: Number(row.querySelector(".cw-dim-qty").value || 0),
    }))
    .filter((d) => d.length && d.width && d.height && d.qty);
  const dimensionUnit = container.querySelector(".cw-dimension-unit").value;
  const divisor = Number(container.querySelector(".cw-divisor").value || defaultVolumetricDivisor(dimensionUnit));
  const grossWeightKg = Number(container.querySelector(".cw-gross-weight").value || 0) || null;
  const volumetricWeight = computeVolumetricWeight(dims, divisor);
  const chargeableWeightKg = Math.max(Number(grossWeightKg || 0), volumetricWeight) || null;

  return {
    weightInputMode,
    grossWeightKg,
    dimensionUnit,
    dimensions: dims,
    volumetricDivisor: divisor,
    chargeableWeightKg,
  };
}
