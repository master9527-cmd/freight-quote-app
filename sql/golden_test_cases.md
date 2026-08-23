# 基準測試案例(Golden Test Cases)

對應 spec 第49.4節。這份文件記錄幾個**合成測試案件**(不含任何真實客戶資料)的關鍵金額,這些數字都已經過「讀程式碼手動核算」與「呼叫`js/pricing.js`/`js/comparison.js`實際函式」雙重交叉核對,寫入當下確認正確。

## 觸發規則(沿用第20節既有門檻,不另外定義新標準)

只有一次修改符合以下任一條件時,才需要額外拿這份文件核對:

- 牽涉**兩個以上檔案**
- 動到**資料庫欄位**
- 觸及**FeeLine/Segment 核心計算邏輯**(`js/pricing.js`、`js/comparison.js` 這類共用計算引擎)

單純的UI調整、文字修改、樣式異動,不需要觸發這個檢查。

**核對方式(優先輕量,不強制每次都開瀏覽器)**:

1. 優先讀程式碼,依下面記錄的FeeLine原始資料,對照 spec 48.2節公式表手動重算一次,跟這份文件記錄的數字比對
2. 手動核算對不上,才進一步用瀏覽器實際開案件核對(`case.html?id=<案件id>`),定位是哪一步的邏輯跟預期不一樣
3. 如果核對後發現這份文件記錄的數字本身是錯的(理論上不該發生,但不排除案件資料被意外改動),回頭查是資料被改了還是文件寫錯,修正後在下方「核對記錄」加一筆

---

## 案件1:BracketFloorTest — perKgBreak 級距下限機制

- **ref**:`AIR-TPELAX-260812-1` / **id**:`ad4d1125-65c8-46ab-bbf9-1af3c909a8a0`
- **mode**:air / **quote_type**:inquiry / **quote_currency**:USD
- **代理**:TestAgent(`9caa82bd-6f9d-4d4c-ad38-5cbb725c1b88`)
- **cargo**:`{ units: [], weightInputMode: "direct" }`——刻意不設定`chargeableWeightKg`/`shipmentQty`。這個案件的用途是驗證What-if情境重量表格本身的級距下限邏輯,不是驗證單一固定真實報價金額,情境重量是What-if表格自己指定的獨立輸入,不受案件cargo欄位影響。

### export 段(`303b53c5-4a4f-4b4d-96bb-46530cff4d88`)

| FeeLine | id | basis | amount | breaks |
|---|---|---|---|---|
| DOC Fee | `e0c253c4-328d-46a5-8e9e-b696649068ce` | perShipment | 30 | - |
| Air Freight | `ea077ca0-4b26-415e-bcd7-5a50243ea92a` | perKgBreak | - | `[{threshold:0,rate:10},{threshold:100,rate:8}]` |
| Handling Fee | `6c6d9579-b3bf-4402-9d0a-5c823758bea6` | flat | 50 | - |

### intl 段(`29b1b264-1833-49ad-a612-42c33259e09a`)

| FeeLine | id | basis | breaks |
|---|---|---|---|
| IntlSingleTier | `b24381dc-0936-4287-b814-ab3641fc8d36` | perKgBreak | `[{threshold:0,rate:5}]`(單階,行為等同固定每KG費率) |

### 正確數字

**真實金額**(案件目前沒有設定計費重量/票數,依46節「未定」中性狀態呈現,不是錯誤):
- export:`subtotal=total=50`(只有Handling Fee非pending;DOC Fee缺票數、Air Freight缺計費重量,都是pending)
- intl:`subtotal=total=0`(IntlSingleTier缺計費重量,pending)

**What-if情境**(`computeWhatIfCells`,w=情境重量):

| w | export Total | export mixedPerKg | export floor | intl Total | intl mixedPerKg | intl floor |
|---|---|---|---|---|---|---|
| 50 | 550 | 11 | 50 | 250 | 5 | 50 |
| 100 | 850 | 8.5 | 100 | 500 | 5 | 100 |
| 150 | 850 | 8.5 | 100 | 750 | 5 | 150 |

**驗證重點**:Air Freight兩階breaks在w=100跟w=150都收斂到同一個`floor=100`(因為breaks沒有150這個門檻,依規則退回小於等於w的最大門檻),所以這兩個情境重量的Total/mixedPerKg完全相同——這正是驗證「級距下限,不是直接代入w」這條規則的核心;IntlSingleTier只有單一門檻(0),floor永遠等於w本身,mixedPerKg在三個情境重量下都固定是5,驗證「單階perKgBreak退化成固定費率」這個邊界案例。

---

## 案件2:TEST-471-兩層框架驗證 — option_group 互斥選項組

- **ref**:`AIR-TPELAX-260821-1` / **id**:`903598fa-30ba-459d-9483-fad433012290`
- **mode**:air / **quote_type**:inquiry / **quote_currency**:USD
- **cargo**:`chargeableWeightKg=500`
- **代理**:(intl段代理,id `92a8e9e0-76b3-48b1-84a4-6cfc5aa03f07`)

### intl 段的6筆FeeLine(全部`certainty=possible`,刻意設計來驗證Subtotal只計certain=0、Total含全部possible這條規則)

| FeeLine | basis | amount/breaks | option_group | option_value |
|---|---|---|---|---|
| 可能雜費-單獨勾選 | flat | 100 | - | - |
| 重量級距運費 | perKgBreak(單階) | `[{threshold:0,rate:0.5}]` → 500×0.5=250 | - | - |
| 倉儲方案-保稅倉 | flat | 200 | 倉儲方案 | 保稅倉 |
| 倉儲方案-一般倉 | flat | 150 | 倉儲方案 | 一般倉 |
| 報關方式-快速報關 | flat | 80 | 報關方式 | 快速報關 |
| 報關方式-一般報關 | flat | 50 | 報關方式 | 一般報關 |

### 正確數字(`computeSelectedCosts`)

| optionGroupChoices | intl Total |
|---|---|
| 倉儲方案=保稅倉、報關方式=快速報關 | **630**(100+250+200+80) |
| 倉儲方案=一般倉、報關方式=一般報關 | **550**(100+250+150+50) |

`subtotal`兩種情況都是**0**(6筆全是possible,沒有certain項目)。

**驗證重點**:同一個互斥選項組裡,只有`optionGroupChoices`指定的那個選項值會計入Total,另一個選項的金額完全被排除,不是兩個都算或都不算;切換選項組的選擇,Total會正確地從630變成550(差額80,剛好是兩組選項各自的差額200-150=50跟80-50=30加總)。

---

## 案件3:TEST-GOLDEN-運費組合驗證 — perContainer/perPallet固定比例換算/perKg 混合引擎

案件1、2涵蓋了perKgBreak多階級距與option_group互斥選項組,但沒有涵蓋43+47.2節What-if每KG混合成本引擎裡`perContainer`(選擇性納入)、`perPallet`(固定比例換算,預設模式)這兩類計價基礎,所以49.4這批另外新建這個純合成案件補齊。

- **ref**:`AIR-TPESIN-260824-1` / **id**:`49c9e5f7-d6d6-4884-817f-fd5032c46cf0`
- **mode**:air / **quote_type**:inquiry / **quote_currency**:USD
- **cargo**:`chargeableWeightKg=800`,`units=[{type:"20GP",qty:2},{type:"PLT",qty:5}]`
- **代理**:GoldenAgent(`ba48103b-e281-45ef-867e-5ed5a46cd719`)

### export 段(`7875dfba-5c09-4a66-8965-ea3e8db600b2`)

| FeeLine | id | basis | amount | 其他欄位 |
|---|---|---|---|---|
| Container Handling | `1ed69cf8-0ec7-4b8b-82f6-b9382c91f213` | perContainer | - | `amount_by_type=[{type:"20GP",amount:150}]`,`include_in_whatif=true` |
| Warehouse In&Out | `94feee7f-4e39-4768-8e66-6f879afae75c` | perPallet | 20 | `conversion_weight_kg=100` |
| Air Freight | `c0d5b665-75cb-41e7-83a3-6213b007ac0d` | perKg | 0.5 | - |
| Documentation Fee | `0e29ec82-1bc2-4356-9040-62279892be4a` | flat | 50 | - |

全部`certainty=certain`。

### 正確數字

**真實金額**(用cargo.chargeableWeightKg=800、cargo.units實際登記數量):`subtotal=total=850`
= Container Handling `150×2(20GP數量)=300` + Warehouse In&Out `20×5(PLT數量)=100` + Air Freight `0.5×800=400` + Documentation Fee `50`

**What-if情境**(w=情境重量,這個案件沒有perKgBreak,floor直接等於w本身):

| w | Total | mixedPerKg |
|---|---|---|
| 500 | 700 | 1.4 |
| 1000 | 1050 | 1.05 |

推導公式(手動核算跟`computeWhatIfCells`交叉核對一致):`Total(w) = 0.7w + 350`,`mixedPerKg(w) = 0.7 + 350/w`——其中`0.7`來自perKg本身固定費率0.5+Warehouse In&Out固定比例貢獻`20÷100=0.2`;`350`來自Container Handling真實金額300(不隨w變動,`include_in_whatif=true`才會計入mixedPerKg)+Documentation Fee固定金額50。

**驗證重點**:
1. Warehouse In&Out(perPallet)的「真實金額」用`cargo.units`實際登記的PLT數量(5)算,跟「What-if預設模式」用`conversion_weight_kg`固定比例反推是兩套獨立算法,不能混用——真實100 vs. What-if在w=800時理論值`0.2×800=160`,刻意不同才能驗證兩套算法真的分開跑
2. Container Handling(perContainer)的金額完全不受情境重量w影響(300恆定),只有`include_in_whatif=true`才會把它按`金額÷floor`折算後計入mixedPerKg,這個開關只影響mixedPerKg指標,不影響Total本身

### 已知現象(這批發現、記錄下來但不修——不屬於49.4範圍)

案件3的`missingUnitTypes`會回傳`["PLT"]`,畫面上出現`⚠ 未提供 PLT 的報價,無法計算完整成本`這個警示訊息,但其實是誤判——PLT是靠獨立的Warehouse In&Out(perPallet)這筆FeeLine計價,不是缺報價。

根本原因:`js/pricing.js`的`computeMissingUnitTypes()`用`registeredUnitTypes(cargo)`(cargo.units裡所有qty>0的類型,**沒有排除PLT/CTN/CHASSIS**)去跟這個段落所有`perContainer`/`perContainerPerDay`類FeeLine的`amount_by_type`涵蓋類型比對,只要段落裡同時有perContainer類FeeLine(涵蓋20GP)又有cargo.units登記的PLT,PLT就會被歸類成「沒被涵蓋」。函式本身的註解已經寫明「範圍刻意不擴大到perPallet/perCarton——棧板/箱子是單一費率,沒有『代理沒報某個貨櫃類型』這種情境」,但`registeredUnitTypes()`實作沒有把PLT/CTN/CHASSIS從比對池排除,跟註解描述的意圖不一致。

這不影響Subtotal/Total金額本身(850這個數字是對的),只是一個誤導性的警示文字。是否要修(把`registeredUnitTypes()`或`computeMissingUnitTypes()`排除PLT/CTN/CHASSIS),留給使用者決定要不要排進下一批。

---

## 核對記錄

| 日期 | 核對人 | 結果 |
|---|---|---|
| 2026-08-24 | Claude Code | 三個案件的真實金額+What-if情境數字,均已用`feeLineTotals()`/`computeWhatIfCells()`/`computeSelectedCosts()`實際呼叫跟手動核算交叉比對一致,首次寫入 |
