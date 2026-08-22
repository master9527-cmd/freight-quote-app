# 國際貨運報價作業台 — 產品規格書 (Spec for Claude Code)

## 0. 專案目標

國際運輸承攬業務用的報價輔助工具。使用者向多家海外代理詢價，取得成本後需要：
1. 依「出口地費用 / 國際運輸段 / 進口地費用」三段分類整理
2. 支援多種原始報價的計價基礎（All-in、細項、每櫃、每票/BL、每KG級距、以及任意換算基礎的複合費用）
3. 跨代理比較、混搭選出最優成本組合
4. 加成後產生報價單（All-in 或 Breakdown 皆可），輸出 PDF / Excel
5. 資料跨裝置保存，同一使用者換裝置登入仍可看到

### 0.1 核心設計哲學（實測多輪後提煉，之後任何新功能/修法都要先對照這條）

> 「把拿到的所有成本，依照不同的需求及角度去整理，能夠不要讓使用者手動填入的就盡量不要，都以下拉式選單去代替，讓輸入更為簡便，海空運各自有不同的整理模式。」

具體展開成四個原則：

1. **代理給的成本是「費率表」，不是「這批貨的專屬帳單」**：代理可能報了比這批貨實際需要更多的品項/類型（例如同時報20GP跟40HQ，但這批貨只用到一種），這是正常現象，系統不該把「用不到的費率」當成錯誤警示。真正該關注的是反過來的情況：「這批貨有的東西，卻沒有任何代理給報價」，這才是真正需要提醒使用者的資訊落差
2. **能選就不要打字**：任何有固定詞彙可循的欄位（貨櫃類型、費用名稱、承運人、港口/機場）都應該是下拉選單或帶建議清單的輸入框，不是純文字輸入，從根本避免打字誤差造成的靜默bug（這正是ATE案例反覆出現的教訓）；更進一步，選單本身也要**限定成該情境真正合理的選項**，不能用一個大而化之的通用選項（如原本的perUnit）讓使用者自己亂填任意類型，這樣才能從結構上杜絕誤用（第40節的perUnit拆分就是這個原則的延伸）
3. **海運、空運的整理邏輯本來就不一樣，不要用同一套思維硬套**：海運常以貨櫃為單位整理、混合換算成每櫃；空運常以重量級距整理、混合換算成每KG，且常需要在不同假設重量下比較單位成本；系統的呈現方式（3.3節三種模式、3.2節情境分析）要順著這個業界慣性設計，不是先做出一套通用邏輯再讓使用者將就
4. **「實際金額」跟「情境試算」永遠並存，不互斥，不看案件類型（第46節統整版，取代原本分散的說法）**：業務工作常常是「還不確定最終貨量/重量，但需要先把成本/報價整理出來、之後再對應套用」。這條原則**不是**依案件類型（spot/tender/project）去決定要不要支援情境分析——那會走進死胡同（例如spot案件填了實際重量後，難道就不能再看不同重量情境的表現嗎？顯然還是需要）。正確的分界線是**「這個驅動數字（如計費重量）現在有沒有值」，而且兩種視角永遠同時存在，不是二選一**：
   - **實際金額**：用案件當下真正填入的驅動數字去算，填了就算得出來，沒填就是「未定」——這不是錯誤、不是需要警示卡住流程的「資料不完整」，就是誠實反映「這個數字現在還不知道」
   - **情境試算**：不管實際金額算不算得出來，**永遠都可以使用**，讓使用者輸入假設數字去看不同情境下的結果，這個功能不因為「已經有實際金額了」就被關閉或視為多餘——兩者是互補的視角，使用者自己決定要看哪個、或兩個一起看
   - 這條原則要套用到**每一個相關畫面，行為保持一致**：成本輸入（FeeLine只顯示費率結構，算不算得出金額看當下有沒有驅動數字）、比較分析（「選用」永遠可操作，選的是費率結構不是鎖定金額；情境分析永遠可用）、報價（費率卡設計，第41節）——不能有些畫面支援這個彈性、有些畫面又卡死要求先有固定數字才能繼續

## 1. 建議技術棧（新手友善、避開 Node.js 建置流程）

| 項目 | 選擇 | 原因 |
|---|---|---|
| 前端 | 純 HTML + CSS + Vanilla JS（不用 React/Next.js，不用 npm build） | 無需學 build 工具鏈，寫完就能部署 |
| 資料庫 + 登入 | Supabase（透過 CDN 引入 `@supabase/supabase-js`） | 免費、有 Postgres + Auth，前端直接呼叫 SDK 即可 |
| AI 解析成本 | Supabase Edge Function（Deno）作為後端代理，內部呼叫 Claude API；圖片/表格截圖直接以圖片形式送給 Claude（原生支援讀圖，不需另外接 OCR 服務） | 保護 API 金鑰不外洩到瀏覽器 |
| 檔案解析（PDF/Excel/Word） | 前端用 SheetJS（xlsx）、mammoth.js（docx）、pdf.js（pdf）從 CDN 引入 | 不需要後端也能擷取文字 |
| PDF/Excel 匯出 | jsPDF + html2canvas（PDF）、SheetJS（Excel），CDN 引入 | 同上 |
| 部署 | Netlify 或 Cloudflare Pages（純靜態站） | 拖檔案上傳或連 GitHub 自動部署即可，無需設定 build command |

> 注意：安裝 Claude Code 這個 CLI 工具本身仍需要電腦裝有 Node.js 18+，這跟上面「前端不用 Node.js 建置」是兩件事。

---

## 2. 核心資料模型

### 2.1 Case（詢價案件）

```
Case {
  id
  ref                 // 自動產生的報價編號，如 SEA-TPELAX-260725-42
  name                // 案件名稱/客戶
  origin, destination // 提貨地城市或郵遞區號／實際目的地城市或郵遞區號（不是港口/機場，港口/機場在各 Segment 內填，見 2.3）
  mode                // air | sea | land | multimodal
  quoteType           // inquiry(單次詢價) | tender(標案/月標) | project(專案，見29.1節：單一案件可包含多個運輸情境並列比較)
  quoteCurrency       // 報價幣別（案件的基準幣別，比較分析預設用這個，也是 rateTable 的換算基準）

  rateTable: [{ currency, rate }]   // v4 幣別架構：案件層級共用一張匯率表，rate = 「1單位這個currency，等於多少單位quoteCurrency」，
                                     // 案件內所有 FeeLine 只要用到某個幣別，都從這張表換算，不用每筆自己存匯率。可手動輸入，也可用既有的
                                     // 免費匯率API（frankfurter.app）一鍵帶入，之後費率有變動只要改這張表一處，所有頁面自動反映最新值

  quoteCurrencyBySegment { export, intl, import }  // 選填，報價頁用：每一段報價要秀給客戶看的幣別，預設都等於 quoteCurrency，
                                                     // 可個別覆蓋（例如中國出口到歐洲，出口段給客戶看人民幣、國際運輸+進口段看美金），
                                                     // 換算一樣查 rateTable

  cargo {
    units: [{ type, qty, qtyMin, qtyMax }]   // 通用貨量單位：20GP/40GP/40HQ/45HQ 等貨櫃，也可以是 PLT/CTN 等
                                              // qtyMin/qtyMax 選填，月標案件常用（見29.2節）：客戶只給約略月量範圍（如10-20個20GP），
                                              // qty 則是這次實際拿來算費率用的代表數量（通常設1，用來算出「每櫃」的費率本身，不是總金額）

    weightInputMode                  // 空運：'direct'(直接輸入計費重量) | 'calculated'(由尺寸+重量帶入計算)，兩種是使用者主動選擇的情境，不是系統自動判斷：
                                      //   情境1(direct)：使用者已經知道最終計費重量（例如代理已經算好告訴他），直接輸入 chargeableWeightKg 即可
                                      //   情境2(calculated)：使用者手上是客戶給的原始資料（尺寸+數量+實重），由系統帶入公式算出計費重量

    // weightInputMode === 'calculated' 時使用：
    grossWeightKg                    // 實際毛重
    dimensionUnit                    // 'cm' | 'mm'，長寬高的輸入單位
    dimensions: [{ length, width, height, qty }]  // 逐件輸入長寬高＋數量(qty可以是件數/棧板數/箱數)，可多筆(不同尺寸的貨品分開輸入)
    volumetricDivisor                // 材積換算除數：dimensionUnit=cm時預設6000，dimensionUnit=mm時預設6000000（同一個比例只是單位換算，兩者換算結果一致），
                                      // 國際空運普遍慣例是6000，但部分航線/快遞公司可能用5000，使用者可覆蓋
    // 材積重 = Σ(length × width × height × qty) ÷ volumetricDivisor
    // chargeableWeightKg = max(grossWeightKg, 材積重)，計算結果即時顯示，使用者可以看到但不需要自己心算

    // weightInputMode === 'direct' 時使用：
    chargeableWeightKg               // 直接輸入的計費重量，calculated模式下這個欄位變成唯讀，顯示系統算出來的結果

    volumeCBM                        // 海運LCL：總材積(立方米)，用於 perCBM 計價與混合換算（第27節新增）
    shipmentQty                      // 通用：票數/BL數/MAWB/HAWB數
    declaredValue                    // 選填（第30節新增）：貨物申報價值，供 percentValue 計價基礎使用（如保險費、押匯手續費等從價費用），
                                      // 需搭配一個幣別欄位(declaredValueCurrency)，換算邏輯比照FeeLine走rateTable
    declaredValueCurrency            // declaredValue 對應的幣別
    distanceKm                       // 選填（第30節新增）：內陸配送距離(公里)，供 perKm 計價基礎使用（陸運/跨境卡車/內陸配送常見）
  }

  agents: [Agent]

  incoterm              // 貿易條件標籤，選填：EXW/FOB/FCA/CFR/CIF/CPT/CIP/DAP/DDP/DPU 等，僅供參考與報價單顯示用，
                         // 不直接綁死成本計算邏輯（見下方「Incoterm 與報價範圍的關係」）
  quoteScope { export: boolean, intl: boolean, import: boolean }  // 這次報價實際要涵蓋哪些段（不影響成本輸入，只影響第4節報價要不要把該段算進總價），
                                                                    // 選定 incoterm 時系統可依常見慣例預帶入建議值，但永遠可手動覆蓋

  selection { export: {agentId, laneId?}, intl: {agentId, laneId?}, import: {agentId, laneId?} }  // 混搭選段，laneId 僅在該段 useLanes=true 時需要
  markup { export: {mode,value}, intl: {...}, import: {...} }
  quoteFormat          // allin | segment | items
  letterhead           // 我方公司抬頭，可個別覆蓋，否則繼承使用者的預設抬頭
  customerInfo         // 收件客戶抬頭資訊：{ companyName, contactPerson, address, contact }，顯示在報價單上「報價對象」欄位，
                        // 跟 letterhead（我方資訊）是兩組獨立欄位，不要共用同一組資料結構
}
```

**Incoterm 與報價範圍的關係（重要，處理三角貿易等例外狀況）**

> 使用者提出的實務問題：Incoterm 會影響該向客戶收哪幾段的錢，但不是死板的對應關係——例如三角貿易情境下，出口地/進口地之間走的可能是 FOB（買賣雙方認知），但實際付運費給你的第三地客戶，只需要付「國際運輸段＋進口地」兩段，既不是標準 FOB 的對應（只收出口段），也不能直接套用哪個標準 Incoterm 去自動決定。

**設計原則：Incoterm 是參考標籤，`quoteScope` 才是實際控制報價要收哪幾段錢的開關，兩者分開，不強制綁死。**

- 選擇 `incoterm` 時，系統可依常見慣例**建議**一組 `quoteScope` 預設值（僅供參考，不是強制）：
  - `EXW` → 建議都不收（貨主自理，forwarder 通常不太會用這個報價，僅供完整性）
  - `FOB`/`FCA` → 建議只收 export 段
  - `CFR`/`CIF`/`CPT`/`CIP` → 建議收 export + intl 兩段
  - `DAP`/`DPU`/`DDP` → 建議三段全收
- 使用者**隨時可以手動勾選/取消每一段的 `quoteScope`**，不受上面建議值限制——三角貿易的情境就是把 `incoterm` 標成 "FOB"（給文件/單據參考用），但手動把 `quoteScope` 設成 `{export:false, intl:true, import:true}`，反映實際這筆報價只收國際運輸+進口段的錢
- 案件明細頁建議加一個備註欄位（可用既有的 letterhead 條款欄位，或另開一個 `tradeRemark` 自由文字），讓使用者可以寫「三角貿易：出口地對貨主FOB，本報價對象僅收國際運輸+進口段」這類說明，供日後回顧
- `quoteScope=false` 的段落，成本輸入與比較分析頁面**仍然正常運作**（你可能還是想知道那段大概多少錢，只是不放進這次的報價總額），只有第4節「報價」在加總時會依 `quoteScope` 決定要不要把該段金額算進客戶看到的總價

**案件必須可編輯**：Case 的所有欄位（含 `mode`、`incoterm`、`quoteScope`）建立後都必須能再修改，不可為一次性設定。案件明細頁需提供「編輯案件」功能，修改 `mode` 後，畫面上 fromLocation/toLocation 的標籤（AOL/AOD、POL/POD…）與 cargo 欄位的顯示邏輯要跟著切換。

**新增案件表單必須有「取消/返回列表」的操作**：目前建立案件的表單只有「建立」按鈕，沒有放棄輸入、返回案件列表的方式，需要補上一個「取消」按鈕（不儲存、直接關閉表單回到列表）。

### 2.2 Agent（代理報價）

```
Agent {
  id, name
  role                // 'export' | 'import' | 'both'（選填，預設 both）——標示這家代理是出口地代理還是進口地代理，
                       // 比較分析頁可依此篩選/分組，避免案件內代理一多，把出口地跟進口地的成本混在一起比較
  export: Segment
  intl:   Segment
  import: Segment
}
```

### 2.3 Segment（單一運輸段的成本）— v2：統一 FeeLine 清單（取代原本互斥的 pricingType）

> **修訂原因**：實測發現同一段成本裡常常同時存在好幾種計價基礎，例如出口段可能同時有「每櫃計價的吊櫃費」+「每票計價的文件費/傳輸費/報關費」，不能只選一種 pricingType 就把其他鎖住。因此 Segment 不再是「選一種計價方式」，而是「一份費用清單，清單裡每一筆費用各自決定自己的計價基礎」。

```
Segment {
  defaultCurrency               // v3 修訂：不再是計算用的欄位，只是「新增費用項目時預帶入的幣別」，方便輸入（大部分費用同一段常是同一幣別），
                                 // 實際計算一律用每筆 FeeLine 自己的 currency/fxRate（見 2.4），不會用 Segment 層級的幣別去算

  fromLocation, toLocation     // 本段起訖點，依 segment 種類與 case.mode 有不同的預帶入/鎖定規則，見下方「起訖點鏈式帶入規則」

  useLanes                     // boolean，預設 false。當同一段需要比較「多家船公司/多條轉機路線」
                                // （見 2.4 Lane）時開啟，開啟後改用 lanes 而非直接用 feeLines

  feeLines: [FeeLine]          // useLanes = false 時使用（大多數情況）
  lanes: [Lane]                // useLanes = true 時使用
}
```

**起訖點鏈式帶入規則（v2 修正：減少重複輸入）**

`Case.origin`／`Case.destination` 明確定義為「提貨地城市或郵遞區號」／「實際目的地城市或郵遞區號」（不是港口/機場）。三段的起訖點應該像鏈條一樣自動銜接，使用者只需要輸入「port/airport」這種代理才知道的資訊，城市端不用重複打：

- **export 段**：`fromLocation` 直接帶入 `case.origin`，**唯讀鎖定**，不用使用者再輸入；`toLocation` 由使用者輸入該代理實際使用的出口港/機場（因為不同代理可能走不同港口/機場）。標籤：空運「Export Airport (AOL)」、海運「Export Port (POL)」、陸運類「出口關口/交接點」
- **intl 段**：`fromLocation` **預設帶入該 Agent 的 export 段 toLocation**（同一代理照理是同一個出口港/機場），使用者可覆蓋；`toLocation` 由使用者輸入進口港/機場。標籤依 mode 顯示 AOL/AOD、POL/POD 等
- **import 段**：`fromLocation` **預設帶入該 Agent 的 intl 段 toLocation**，使用者可覆蓋；`toLocation` 直接帶入 `case.destination`，**唯讀鎖定**
- 鏈式帶入只在「使用者尚未手動改過」的欄位上生效：一旦使用者手動編輯過某段的某個欄位，之後上游變動不再覆蓋該欄位，避免使用者的手動修正被自動邏輯蓋掉
- `useLanes = true` 時，鏈式帶入邏輯改成套用在每一條 Lane 各自的 fromLocation/toLocation 上，規則相同

### 2.4 FeeLine（費用項目）— 每一筆費用自己決定計價基礎「與」自己的幣別

這是整個成本模型的核心單位，Segment 直接用、Lane 內部也用同一種結構，兩處共用同一份邏輯與 UI 元件。

> **v4 修訂（取代第15節的設計）**：第15節原本把 `fxRate` 也下放到每一筆 FeeLine 自己存，但實測後使用者提出更好的方式——**輸入成本時只填幣別，不用填匯率**，匯率統一交給 2.1 節新增的 `Case.rateTable`（案件層級共用一張匯率表）管理，比較分析、報價、利潤頁面各自從這張表挑幣別、即時換算，不用把匯率寫死在每一筆資料上。好處：(1) 輸入成本時少填一個欄位，更快；(2) 匯率如果之後有調整，只要改 `rateTable` 一處，所有頁面自動反映最新結果，不用逐筆去改；(3) 同一筆成本可以在不同頁面用不同的顯示幣別呈現（見第3/4/6.6節），不會被寫死的匯率綁住。

```
FeeLine {
  id
  name                         // 例如 "吊櫃費"、"文件費"、"Airline import svs fee"
  certainty                    // 'certain'（算入 Subtotal） | 'possible'（僅算入 Total，供使用者自行決定要不要用於報價）
  remark                       // 自由文字備註（如條件性附加費的觸發條件）

  currency                     // 這筆費用的原始幣別，預設帶入 Segment.defaultCurrency，可個別覆蓋。
                                // 不再有 fxRate 欄位——匯率一律從 case.rateTable 查，不存在 FeeLine 上

  basis                        // 'flat' | 'perShipment' | 'perKg' | 'perCBM' | 'perContainer' | 'perPallet' | 'perCarton' | 'perKgBreak'
                                // | 'perContainerPerDay' | 'perPalletPerDay' | 'perChassisPerDay' | 'perKgPerDay' | 'perCBMPerDay' | 'percentValue' | 'perKm'
                                // 第40節v5修正：原本的 perUnit/perUnitPerDay 已拆成上面這幾種更具體的計價基礎，見下方說明

  // basis === 'flat'：一次性金額，不隨任何數量變動（如 All-in 總價、或單一固定雜費）
  amount

  // basis === 'perShipment'：乘以 case.cargo.shipmentQty（每票/BL/MAWB/HAWB 計價，如文件費、傳輸費、報關費）
  amount

  // basis === 'perKg'：乘以 case.cargo.chargeableWeightKg（直接每KG報價，不分級距）
  amount

  // basis === 'perCBM'：乘以 case.cargo.volumeCBM（海運LCL常用，直接每CBM報價，第27節新增）
  amount

  // basis === 'perContainer'（第40節v5修正，取代原本的perUnit）：依 case.cargo.units 裡「貨櫃類型」的各 type 分別報單價 × 對應數量加總
  // type 欄位的下拉選單只會列出 6.5.5 節「貨櫃類型標準參考」裡的貨櫃代碼（20GP/40GP/40HQ/45HQ/20DG/40DG/20RF/40RF/20FR/40FR/20ISOTank/40ISOTank/20OT/40OT），
  // 不會出現棧板、箱、或任何非貨櫃的選項，也不允許輸入非標準/自訂字串——這樣使用者就不可能誤選成貨櫃以外的東西
  amountByType: [{ type, amount }]   // 保留陣列結構，因為同一筆費用常見同時涵蓋好幾種貨櫃尺寸（如THC同時報20GP跟40HQ的價格）

  // basis === 'perPallet'（第40節v5修正，取代原本用perUnit硬塞PLT類型的做法）：乘以 case.cargo.units 裡 type='PLT' 的加總數量
  // 單一費率即可，不需要像貨櫃那樣的陣列結構（棧板通常不會像貨櫃一樣同時有好幾種不同尺寸各自報價的情況）
  amount

  // basis === 'perCarton'（第40節v5修正）：乘以 case.cargo.units 裡 type='CTN' 的加總數量，單一費率
  amount

  // basis === 'perKgBreak'：「每KG單價 + 最低消費」或「多級距費率表」，兩種其實是同一套資料結構，差別只在 breaks 有幾筆，見下方「perKgBreak 的簡單模式」說明
  minCharge
  breaks: [{ thresholdKg, ratePerKg }]

  // basis === 'perContainerPerDay'（第40節v5修正，取代原本perUnitPerDay用貨櫃類型的情況）：如貨櫃延滯費Demurrage、留滯費Detention
  // type 下拉選單同樣只列貨櫃代碼，天數是這筆費用自己的屬性
  amountByType: [{ type, amount }]   // 每貨櫃每天的費率
  days

  // basis === 'perPalletPerDay'（第40節v5修正，這正是使用者這次遇到、原本被迫用perUnit硬塞「PLT/Week」表達的情境：每棧板每週/每天的倉租費）
  amount                              // 每棧板每天的費率（若代理是用「每週」報價，換算成每天輸入，或在UI提供「輸入每週費率、系統自動除以7」的便利轉換，兩種都可以，由實作決定）
  days

  // basis === 'perChassisPerDay'（第40節v5修正，取代原本perUnitPerDay用CHASSIS類型的情況）：底盤Chassis Per Diem
  amount                              // 每底盤每天的費率，數量來源為 case.cargo.units 裡 type='CHASSIS' 的加總數量，若使用者沒有在貨量資訊登記底盤數量，預設視為1
  days

  // basis === 'perKgPerDay'：數量(KG)×天數的複合計價，如以重量計費的倉租
  amount                              // 每KG每天的費率
  days

  // basis === 'perCBMPerDay'：材積×天數的複合計價（第30節新增），如海運LCL/多式聯運常見的「每CBM每天」倉儲費
  amount                              // 每CBM每天的費率
  days

  // basis === 'percentValue'：貨物申報價值的百分比計價（第30節新增），如保險費、押匯手續費等從價計費項目
  percentRate                         // 百分比數值，如1.2代表1.2%
  // 金額 = case.cargo.declaredValue × (percentRate / 100)，declaredValue需在2.1節cargo新增，選填欄位

  // basis === 'perKm'：依距離計價（第30節新增），內陸配送/跨境卡車常見
  amount                              // 每公里費率
  // 金額 = amount × case.cargo.distanceKm，distanceKm需在2.1節cargo新增，選填欄位
}
```

**單筆 FeeLine 金額計算（先算原幣別金額，換算成任意顯示幣別時才查匯率表，不是存檔時就換算好）：**
```
feeLineBaseAmount(fl, cargo):     // 原幣別金額，尚未換算，basis邏輯不變
  flat               → fl.amount
  perShipment        → fl.amount * cargo.shipmentQty
  perKg              → fl.amount * cargo.chargeableWeightKg
  perCBM             → fl.amount * cargo.volumeCBM
  perContainer       → Σ (t.amount * getUnitQty(cargo, t.type)) for t in fl.amountByType
  perPallet          → fl.amount * getUnitQty(cargo, 'PLT')
  perCarton          → fl.amount * getUnitQty(cargo, 'CTN')
  perKgBreak         → max(fl.minCharge, applicableRate(fl.breaks, cargo.chargeableWeightKg) * cargo.chargeableWeightKg)
  perContainerPerDay → Σ (t.amount * getUnitQty(cargo, t.type) * fl.days) for t in fl.amountByType
  perPalletPerDay    → fl.amount * getUnitQty(cargo, 'PLT') * fl.days
  perChassisPerDay   → fl.amount * (getUnitQty(cargo, 'CHASSIS') || 1) * fl.days
  perKgPerDay        → fl.amount * cargo.chargeableWeightKg * fl.days
  perCBMPerDay       → fl.amount * cargo.volumeCBM * fl.days
  percentValue       → cargo.declaredValue * (fl.percentRate / 100)
  perKm              → fl.amount * cargo.distanceKm

// 匯率換算查表：rateTable 裡每筆 rate 定義為「1單位這個currency ＝ 多少單位case.quoteCurrency」
rateToQuoteCurrency(currency, rateTable, quoteCurrency):
  if currency == quoteCurrency: return 1
  entry = rateTable.find(r => r.currency == currency)
  return entry ? entry.rate : null   // 找不到匯率時回傳 null，呼叫端要處理成「缺匯率」的警示，不能靜默當作1

// 換算到任意目標顯示幣別 displayCurrency（不一定等於 case.quoteCurrency，見3/4/6.6節的幣別選擇器）
feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency):
  base = feeLineBaseAmount(fl, cargo)
  if fl.currency == displayCurrency: return base
  rateFrom = rateToQuoteCurrency(fl.currency, rateTable, quoteCurrency)   // fl.currency → quoteCurrency
  rateTo   = rateToQuoteCurrency(displayCurrency, rateTable, quoteCurrency)  // displayCurrency → quoteCurrency
  return base * rateFrom / rateTo   // 透過 quoteCurrency 當中介做跨幣別換算
```

**Segment / Lane 總額（依呼叫端指定的 displayCurrency 計算，不是寫死的 quoteCurrency）：**
```
subtotal(feeLines, cargo, rateTable, quoteCurrency, displayCurrency) =
  Σ feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency) for fl where fl.certainty == 'certain'
total(feeLines, cargo, rateTable, quoteCurrency, displayCurrency) =
  subtotal(...) + Σ feeLineAmountIn(fl, cargo, rateTable, quoteCurrency, displayCurrency) for fl where fl.certainty == 'possible'
segmentCost = useLanes ? total(selectedLane.feeLines, ..., displayCurrency) : total(feeLines, ..., displayCurrency)
```

**`perKgBreak` 的簡單模式（實務上最常見的「單價+最低消費」組合）**

> 使用者實測提出的例子：機場 Terminal Handling 常以「0.2 CNY/KG，最低消費 200 CNY/shipment (or HAWB)」這種方式報價——這不是多級距費率表，只是單純的「一個KG單價 + 一個最低消費金額」，如果照原本的設計要求使用者先建一整張級距表（如之前空運範例的 min/100kg+/300kg+...）才能輸入，會顯得多餘、增加不必要的操作步驟。

- `perKgBreak` 這個 basis 其實同時服務「單純每KG單價+最低消費」跟「完整多級距費率表」兩種情境，數學上是同一套公式（`max(minCharge, applicableRate(breaks, weight) * weight)`），差別只在於 `breaks` 陣列裡放幾筆：
  - 只有 1 筆（`thresholdKg = 0`）時，就是最簡單的「單一KG單價 + 最低消費」情境，等同於使用者舉的例子：`breaks = [{thresholdKg: 0, ratePerKg: 0.2}]`、`minCharge = 200`
  - 有多筆不同 `thresholdKg` 時，才是完整的多級距費率表（如之前空運範例的 100kg+/300kg+/500kg+...）
- **UI 設計要求（避免不必要的操作負擔）**：選這個 basis 時，預設只顯示兩個欄位——「每KG單價」與「最低消費 Minimum」，**不要**預先生成一整排空的級距輸入列（之前版本可能會預帶入 100/300/500/700/1000/2000/3000/4000 這種多筆預設級距，這對只需要單一單價+最低消費的情境是干擾）。畫面上另外放一個「+ 新增級距（適用於不同重量有不同單價的情況）」的按鈕，使用者需要多級距時才自己加，不用的話畫面就保持最簡單的兩欄輸入

**`thresholdKg` 的意義：「起始點」，不是「上限」（實測發現使用者容易誤解，必須在 UI 上講清楚）**

> 使用者實測時把「0-300kg用6/kg，超過300kg用2/kg」這個需求，誤填成 `{thresholdKg:300, rate:6}` + `{thresholdKg:1000(隨便填的數字), rate:2}`——因為介面沒有清楚呈現「這個門檻代表『從這個重量開始』，不是『到這個重量為止』」，使用者以為每一段都要自己畫出上下限，因此發明了一個不存在的「1000」當作假的分界點。

- `thresholdKg` 的正確意義是「從這個重量（含）開始，套用這筆的單價，一路套用到下一個更高的門檻出現為止」。也就是「0-300kg用6/kg，超過300kg用2/kg」這個需求，正確輸入應該是**兩筆**：`{thresholdKg:0, rate:6}` + `{thresholdKg:300, rate:2}`，不需要、也不應該填一個假的「上限」數字
- **第一筆的 `thresholdKg` 規定固定填 0**，代表「這個級距表最基礎的單價，從0公斤起算」，UI 上可以把第一筆的門檻欄位直接鎖定顯示「0（基礎）」不給使用者改，减少填錯的機會
- **最後一筆（門檻最高的那筆）代表「這個重量以上都適用這個單價，沒有上限」**，UI 上該筆旁邊要清楚標示「（以上，無上限）」，讓使用者知道不需要再往後加一筆假的門檻去「封頂」
- **每一筆輸入完，UI 應該即時算出並顯示這筆實際涵蓋的重量範圍**（例如使用者輸入 0/300/1000 三個門檻，介面就該自動在每一列旁邊顯示「適用於 0~299kg」「適用於 300~999kg」「適用於 1000kg以上」），讓使用者不用自己腦補範圍、能一眼核對級距設定得對不對，這也能大幅降低這次遇到的誤填問題再次發生的機率
- `minCharge` 的計算基準是「這筆 FeeLine 對應這次貨量計算出來的總金額」，因為 `case.cargo.chargeableWeightKg` 本來就是這一整批貨的計費重量，所以 `minCharge` 效果上就等同於「每票/每shipment/每HAWB 的最低消費」，不需要另外設定「這個最低消費是算哪個單位」——與使用者範例中「minimum 200 CNY/shipment or HAWB」的意思一致
- 比較分析與報價頁面呈現這類費用時，應標示目前是「命中最低消費」還是「依單價計算」，讓使用者清楚知道這筆費用在目前的貨量下是哪種情況觸發的（例如貨量很輕時通常會是最低消費生效，貨量重時才是單價 × 重量生效）

這樣一來，出口段可以同時放「吊櫃費（perUnit）+ 文件費（perShipment）+ 報關費（perShipment）+ 臨時倉租（flat，certainty=possible）」，彼此不互斥，符合實務上一段成本本來就是好幾種計價基礎混在一起的狀況。

### 2.5 Lane（多航線/多船公司比較，僅在 Segment.useLanes = true 時使用）

實務上一家代理常常同時給多條可選航線（如：LAX 主線 / SEA 備援、ONE/YML/COSCO 等多家船公司報同一段），需要在同一段成本內比較好幾組選項時才用 Lane，一般情況（只有一組成本）直接在 Segment.feeLines 填就好，不用開 useLanes。

```
Lane {
  id
  carrier                      // 船/航空公司代號，如 ONE / YML / COSCO / BR / KE
  fromPort, toPort              // 這條航線的起訖港/機場，結構化欄位，套用 6.5.2 節同一套自動完成元件（跟 Segment.fromLocation/toLocation 同規格）
  routing                      // 路由描述（含中間轉機/轉運節點的完整路線），如 "HAN-IST-(YYZ)-YVR"、"IPI via WC"——
                                // 這個欄位維持自由文字，因為中間轉運節點可能不只一個，沒辦法用單一自動完成欄位結構化，
                                // 但起訖點（fromPort/toPort）本身仍然要能用下拉建議快速填入
  transitDaysMin, transitDaysMax
  isDirect                     // boolean：是否為直航/直飛
  transshipPoints: [portCode]  // 非直航時，轉運/轉機站點清單（可能不只一個），套用同一套港口/機場自動完成
  stopsCount                   // 轉運/轉機站點數（可由 transshipPoints 陣列長度自動推算，也保留手動覆蓋）
  validityStart, validityEnd
  incoterm                     // 選填
  remark

  // 海運專屬附加資訊（第29節新增，選填，供內部參考與報價單附註用，不參與成本計算）：
  vesselName, voyageNumber     // 船名/航次
  siCutoff, vgmCutoff, cyCutoff // SI截止／VGM截止／CY截止時間
  etd, eta                     // 預計開航／預計到達時間

  // 空運專屬附加資訊（第29節新增，選填）：
  weeklyFrequency               // 每週班次，格式如業界慣例："D1234567"或"Daily"代表每天都有班，"D135"代表週一三五有班
                                 // （數字1-7對應星期一到星期日），若為多段轉機航線，各航段班次可個別在remark說明，不強制逐段結構化

  feeLines: [FeeLine]          // 同 2.4，該 Lane 專屬的一份費用清單
}
```

比較分析頁面在 useLanes=true 的段落，需要能展開看每條 Lane 的 subtotal/total，並選定其中一條作為該段最終採用的成本。這些附加資訊（船名航次、船期、班次頻率等）屬於參考/附註用途，不影響成本計算，但建議在報價頁使用 Lane 時，能選擇性地把這些資訊也印在報價單上（例如標案報價常需要附上transit time、是否直航等資訊供客戶評估），是否顯示由使用者決定，不強制。

---

## 3. 比較分析邏輯

- 同一案件下，列出所有代理 × 三段的 Subtotal（certain）與 Total（含 possible）成本，兩者並列供使用者判斷要不要把條件性費用算進報價
- 若某段 `useLanes = true`，比較表要能展開看每條 Lane 的結果，使用者選定「代理＋該代理下的哪條 Lane」作為該段的最終選擇
- 標示各段最低成本，並可跨代理／跨 Lane 混搭出最優組合（`selection.export / selection.intl / selection.import` 各自指向 `{agentId, laneId?}`）
- 套用第9.3節的警示邏輯（轉運站點數/總運輸天數超過門檻時標示警示，不強制排除）
- **成本整理總覽**：案件層級需要一個總覽區塊，把三段目前選定的成本加總顯示，讓使用者一眼看到「這個案件目前選定組合的總成本是多少」，不用自己心算三段數字
- **比較幣別選擇器（v4）**：比較分析頁最上方需要一個幣別下拉選單，預設帶入 `case.quoteCurrency`，使用者可切換成任意 `case.rateTable` 裡有匯率的幣別，切換後整張比較表（含 Subtotal/Total/各段小計/組合總成本）都要用選定的幣別重新計算顯示，換算邏輯依 2.4 節的 `feeLineAmountIn`。若某筆費用的幣別在 `rateTable` 裡找不到匯率，該筆金額顯示為「缺匯率」的警示樣式，不要顯示成 0 或誤導的數字
- **代理角色篩選（v4）**：比較表上方提供篩選/分組選項，依 `Agent.role`（出口地代理/進口地代理/皆可）篩選要看哪些代理，避免案件內代理一多時，出口地跟進口地的代理混在同一張表格裡難以比較。預設不篩選（全部顯示），使用者可依需要切換
- **「不適用」跟「0元」要區分開來，「套用最低成本組合」不能誤選（第32節新增，修正實測發現的邏輯錯誤）**：出口地代理（`role='export'`）的進口段、進口地代理（`role='import'`）的出口/國際段，這些顯示的0.00**不是「這段免費」，是「這個代理本來就不承接這段業務，不適用」**，跟27.2節「資料不完整無法計算」也不是同一回事（不完整是「應該有資料但缺了」，這裡是「這個代理根本不會有這段的資料，是結構性的不適用）：
  - 比較表格上，若某代理的 `role` 不涵蓋某段（例如`role='export'`的代理對應到進口段），該段儲存格顯示**「－不適用」**，不顯示「0.00」，「選用」按鈕也要隱藏或停用，避免使用者誤選
  - **「套用最低成本組合」按鈕的邏輯必須修正**：每一段找最低價時，只能在 `role` 涵蓋該段的代理之中比較（例如進口段只在 `role='import'`或`role='both'`的代理裡找最低價），不能把「不適用」的0.00也拿去比較、誤判成「最低成本」
- **`quoteScope=false` 的段落不該卡住「組合總成本」的計算（第38節新增，實測發現的三角貿易情境bug）**：三角貿易等情境下，某段（通常是出口段）依貿易條件本來就不需要使用者的客戶負擔、也不需要選定任何代理成本，這是**第三種「空白」的原因**，跟前兩種都不一樣，要分開標示：
  - 「－不適用」（role不涵蓋）：這個**代理**做不到這段業務
  - 「⚠ 資料不完整」（27.2節）：**這段本來該有資料，但缺了必要的貨量資訊**
  - **「－依貿易條件不需報價」（第38節新增）**：這段依 `case.quoteScope` 設定，**不在本次要跟客戶收費的範圍內**，不需要選定任何代理成本，這是案件層級的設定，不是特定代理的問題
  - 比較分析頁最上方的段落總覽卡片、以及「組合總成本」，遇到 `quoteScope[segment]===false` 的段落時，**不能顯示「未選」也不能因此卡住總成本計算**——`quoteScope=false` 的段落直接跳過，不需要選定代理，「組合總成本」只加總 `quoteScope=true` 的段落，不會出現「尚未選滿三段」這種阻擋性文字
  - 比較表格裡，`quoteScope=false` 的整欄可以整段用淡化樣式呈現（例如降低透明度、標示「本次不需報價」），欄位裡的代理成本仍然可以顯示供內部參考（畢竟使用者可能還是想知道這段大概多少錢），但不會出現「選用」按鈕、不會被要求選擇

- **這一節必須產出的具體畫面/元件（避免只做資料邏輯、沒有對應的可操作介面）**：
  1. 案件明細頁要有一個獨立的「比較分析」分頁或區塊，用表格呈現代理×三段矩陣
  2. 表格上方要有一個明確的按鈕「匯出比較表 Excel」，按下直接下載一份 .xlsx，內容包含每家代理三段的 Subtotal/Total、目前選定的組合、組合總成本，並註明匯出當下使用的比較幣別
  3. 這個匯出跟第4節報價單的匯出是兩份不同的檔案（一份是「內部看的成本比較」，一份是「給客戶看的報價單」），不要合併成同一顆按鈕

### 3.1 支援「只有部分段落有資料」的工作流程（實測回饋新增）

實務上使用者不會三段成本同時到齊才開始分析，常常是先拿到某一段（例如進口地）的報價就想先看看，其他段還在詢價中。目前系統的問題是：一定要三段都有選定代理，才能往下走到報價步驟，這不符合實際工作節奏。

- **報價頁面不應該被「三段都要選定」卡住**：只要案件裡至少有一段有資料，就應該能進到報價分頁操作。還沒有資料/還沒選定的段落，在報價畫面上清楚標示「尚未選定」，金額視為0且不計入總價，而不是直接擋住整個報價功能不給進入
- **比較分析頁要能只看/只匯出單一段落**：表格上方（或段落標題旁）提供篩選選項，讓使用者選擇「只顯示出口段」「只顯示國際運輸段」「只顯示進口段」或「全部顯示」；「匯出比較表 Excel」也要能只匯出目前篩選出來的段落內容，不強制每次都要匯出完整三段
- **這個篩選純粹是畫面呈現層級的操作，不影響底層資料**：切換只看某段、或只有某段有資料，都不會影響其他段之後補資料進來時的正常運作，使用者隨時可以回頭把其他段的代理補上

### 3.2 自訂重量情境分析（What-if，僅適用於有 perKgBreak 費用的段落）

使用者提出的需求：想針對某個用「每KG級距」計價的段落，自己輸入一組情境重量（例如 100kg、300kg、500kg、1000kg），看不同代理/航線在**這些假設重量**下各自的成本會是多少，用來輔助決策（例如評估湊到多少重量能拿到比較好的單價），而不是被綁死在案件目前設定的單一 `cargo.chargeableWeightKg`。

- 比較分析頁，若該段（或該段底下某個 Lane）存在 `basis === 'perKgBreak'` 的 FeeLine，提供一個「情境重量」輸入區，使用者可自訂輸入多個重量數字（自由輸入，非固定選項）
- **級距下限計算規則（第39節修正，取代原本直接用輸入值計算的錯誤邏輯）**：業界慣例是「只知道概略貨量、還沒確定最終總重量落在哪個級距時，用該級距的下限去反推保守估算的每KG單價」，不是用使用者隨手打的重量數字直接除。計算方式：
  1. 使用者輸入的每個情境重量，先判斷它落在哪個級距（找出 `breaks` 裡 ≤ 該輸入值的最大 `thresholdKg`，稱為 `bracketFloor`）
  2. **用 `bracketFloor`（不是使用者原始輸入的數字）代入 perKgBreak 公式算總成本，也用 `bracketFloor` 當除數算每KG單價**——確保「算金額用的重量」跟「除法分母」永遠是同一個數字，才會符合業界「同一級距內不管實際重量多少，都用下限去抓保守估價」的邏輯。例如級距門檻是1000跟2000，使用者輸入1500，系統要判斷1500落在「1000這個級距」，改用1000去算總成本、也除以1000，不能直接拿1500去算或去除
  3. 畫面上要清楚標示「此情境對應級距下限：1000kg」，讓使用者知道系統實際計算用的是哪個數字，不是他原始輸入的1500
  4. 提供「帶入此費用的級距下限」快速按鈕，直接抓該FeeLine自己`breaks`裡設定的門檻值，讓使用者不用自己猜著打數字，一鍵帶入所有已定義的級距門檻當情境重量
- **每個情境重量，除了顯示「這個重量下的總成本」，也要同時顯示「換算後的每KG單價」（= 該情境總成本 ÷ bracketFloor），兩個數字並列**（實測回饋新增）——這樣才能一眼看出「貨量越重，單位成本是不是越划算」，不用使用者自己心算，這其實是把3.3節「混合換算成單一單位」的概念套用到每一個情境重量上
- **這個功能純粹是分析用途，不會修改 `case.cargo.chargeableWeightKg` 這個實際案件的計費重量**，兩者是分開的——情境分析結果不會影響報價頁面實際算出來的金額，報價依然只根據案件真正設定的計費重量計算
- 這張情境對照表建議也能包含在「匯出比較表 Excel」裡，作為額外的一個工作表（如果使用者有用到這個功能的話）

### 3.3 成本呈現模式：分項列示 / 混合換算成單一單位 / 純小計（第27節新增）

實務上同一段成本常常混合好幾種計價基礎（如海運FCL同時有「每櫃」的吊櫃費跟「每票」的文件費），使用者希望比較分析頁能依運輸模式，用不同方式呈現這些混合的費用，而不是只有一種固定的呈現方式。三種模式，使用者可切換：

1. **分項列示（itemized）**：不同計價基礎的費用各自列一行，不合併計算（例如「每櫃費用小計」跟「每票費用小計」分開顯示）
2. **混合換算成單一單位（blended）**：把該段所有費用（不論原本是 flat/perShipment/perUnit/perKg/perCBM/perKgBreak）全部加總後，除以對應運輸模式的總量單位，換算成一個統一單位的數字：
   - 海運FCL：÷ 總櫃數（`Σ cargo.units` 裡貨櫃類型的數量），得到「混合每櫃成本」
   - 空運：÷ `cargo.chargeableWeightKg`，得到「混合每KG成本」；若使用者同時有用 3.2 節的自訂情境重量，這個混合每KG成本也應該能依每個情境重量分別算一次（因為 flat/perShipment 這類不隨重量變動的費用，攤到不同重量情境下，換算出來的每KG成本會不同，重量越重、固定費用攤得越薄），呈現成一張「情境重量 × 混合每KG成本」的對照表
   - 海運LCL：÷ **計費噸（Revenue Ton / W/M, Weight or Measurement）**，不是單純除以 `cargo.volumeCBM`——LCL業界慣例是取「重量(噸)」與「材積(CBM)」兩者較大值，換算基準通常是 1 CBM = 1 噸（部分航線/代理可能用其他比例，如1:1不是絕對值，代理報價單上通常會註明），即 `revenueTon = max(cargo.grossWeightKg / 1000, cargo.volumeCBM)`，「混合每CBM成本」實際上應該是「混合每計費噸成本」= 總費用 ÷ revenueTon，這樣才符合LCL代理實際報價與收費的邏輯
3. **純小計（subtotal）**：不拆分、不換算，就是該段的 Subtotal/Total 總金額（也就是目前既有的呈現方式，維持不變）

- 這個切換是比較分析頁面的顯示選項，不影響底層資料，也不影響報價頁面的實際金額計算——報價頁面永遠是用該段所有 FeeLine 加總的實際金額，不會因為比較分析頁選了「混合換算」模式就跟著把報價金額也換算成單位成本
- 陸運/多聯式模式，目前沒有明確提出對應的混合換算單位需求，先維持只有「分項列示」跟「純小計」兩種可選，「混合換算」選項在這兩種模式下不顯示（或顯示為停用），不用勉強套一個不適用的計算方式

## 4. 報價單產生邏輯

**這一節是使用者輸入「賣客戶多少錢」並產生報價單的功能，跟前面代理成本輸入是分開的兩塊，必須有獨立的輸入介面，不是只把 markup 加成算出來就結束。**

- 加成（markup）：對每段選定的 Subtotal 或 Total 套用「% 或固定金額」加成：
  - percent: `sell = cost * (1 + value/100)`
  - fixed: `sell = cost + value`（此為該段總額一次性加，若該段用 perUnit/perKgBreak 且想依單位加值，可在對應 FeeLine 層級直接把 markup 反映進 amount，而非在段落層級的 fixed 上處理）
- **必須有一個獨立的「報價」分頁/區塊**，讓使用者針對已選定的成本組合輸入賣價，支援兩種輸入模式：
  1. 用 markup（% 或固定金額）自動算出賣價（上面公式），此模式下不管報價格式選哪一種，畫面都是照三段分別設定加成，`allin` 格式只是把三段算出來的賣價加總顯示成一個數字，這部分邏輯不變
  2. 或使用者直接手動輸入賣價金額（不透過 markup 反推）
- **手動輸入賣價模式，輸入欄位數量要依報價格式而變（實測發現目前沒有做到，需修正）**：
  - 報價格式選 `allin` 時：手動輸入賣價模式**只能顯示一個輸入框**，讓使用者直接打「這次要跟客戶收多少錢」的單一總數，不能像 markup 模式那樣還是列出出口/國際/進口三段各自的輸入框——這正是使用者這次抓到的bug，畫面沒有依格式切換輸入框數量
  - 報價格式選 `segment` 時：手動輸入賣價模式維持三段各自一個輸入框
  - **報價格式選 `items` 時：手動輸入賣價要細到每一筆 FeeLine 各自一個輸入框，且每筆各自可選幣別（第32節新增）**——實務上同一段內不同費用常常要用不同幣別報給客戶（例如出口段的報關費想用TWD報、AMS傳輸費想用USD報），這是`items`格式手動賣價模式獨有的行為，`allin`/`segment`格式不適用（因為那兩種格式本來就是要匯總成一個或三個數字，不會拆到單筆層級）
  - **`perUnit`/`perUnitPerDay` 的 FeeLine，賣價輸入要比照成本端的 `amountByType` 結構，一個貨櫃類型一個輸入列，不能是單一脫勾的空白輸入框（第33節修正，實測發現的問題）**：
    - 只列出這批貨 `cargo.units` 裡**實際有數量（qty>0）**的類型，qty=0的類型（代理報了費率但這批貨用不到的）不要出現在賣價輸入區——呼應0.1節「代理費率表 vs 這批貨實際帳單」的原則，成本端可以看到完整費率表，但報價端只需要處理這批貨真的會用到的部分
    - 資料結構：`byItem[feeLineId].byType: [{ type, amount, currency }]`，取代單一 `amount/currency`
  - 資料結構（完整版）：
    ```
    Case.manualSellPrice {
      allin: number
      bySegment: {export, intl, import}
      byItem: {
        [feeLineId]: {
          amount, currency              // basis 不是 perUnit/perUnitPerDay 時使用（單一金額）
          byType: [{ type, amount, currency }]   // basis 是 perUnit/perUnitPerDay 時使用，只列 cargo.units 裡 qty>0 的類型
        }
      }
    }
    ```
    依目前的 `quoteFormat` 決定要讀/寫哪一組值，三組互相獨立、不要互相覆蓋
  - **Basis 顯示文字要具體化，不要顯示生硬的計價基礎代號（第33節修正）**：`items` 格式明細裡，`perUnit`/`perUnitPerDay` 這類費用不要顯示「perUnit」這種代號字樣，改顯示「每40HQ」「每20GP」這種具體單位描述（若同一筆有多個類型，各類型各自標示，如「每40HQ（USD 300）」「每20GP（USD 280）」分開列）；貨櫃類型的顯示文字沿用6.5.5節「貨櫃類型標準參考」的人類可讀格式（如顯示「40'HQ」，內部比對值仍是不帶符號的`40HQ`）
  - **`items`格式下段落小計的呈現方式**：明細逐筆顯示各自選定的原幣別金額（例如「報關費 NTD 500」「AMS傳輸費 USD 15」並列不合併），段落小計/總金額則透過 `case.rateTable` 把該段所有項目換算成同一個幣別（預設 `quoteCurrencyBySegment[segment]` 或 `quoteCurrency`）加總顯示，並標示「（小計已換算為XXX）」的說明文字，讓使用者清楚知道逐筆明細是原幣別、小計數字是換算後的結果，兩者不是同一件事
  - 利潤計算：`allin` 手動賣價模式下，`profit = manualSellPrice.allin - 選定組合總成本`；`segment`模式沿用三段分別加總再減總成本；`items`模式則是把每筆`byItem`（含`byType`情況下要展開每個類型）換算成報價幣別後加總，再減總成本
- **報價總額需依 `case.quoteScope` 決定要不要把該段算進去**：`totalSellPrice = Σ sellPrice(segment) for segment where quoteScope[segment] == true`。三角貿易等情境下 `quoteScope.export=false` 時，報價頁面仍可顯示該段成本/賣價供內部參考，但不計入最終要跟客戶收的總額，畫面上建議用「（不計入本次報價）」之類的樣式區隔（`allin` 手動賣價模式下，這個過濾邏輯不適用，因為使用者是直接打一個已經決定好範圍的總數，不需要再依quoteScope過濾）
- 報價格式三選一：
  - `allin`：單一總價
  - `segment`：三段各一個總數
  - `items`：完整明細，依 FeeLine 的 basis 分別呈現（perUnit 列出各單位單價×數量、perKgBreak 列出完整級距表並標示本次適用級距、perShipment/perKg/flat 直接列金額），手動賣價模式下每筆可各自選幣別（見上方說明）
- **`perKgBreak` 報價要把「費率卡」跟「本次實際金額」拆成兩件事，不能綁死要先知道計費重量（第41節新增，實測反映的重要情境）**：使用者實務上常常需要**先出一張完整的級距報價費率卡**（例如1000+/2000+/3000+…各級距各自的售價），還不知道、也不需要知道客戶最終貨量精確落在哪一格，等客戶實際出貨時才對應套用——這在標案報價尤其常見，不能要求案件一開始就鎖定一個計費重量才能報價：
  - **費率卡本身的計算完全不依賴 `cargo.chargeableWeightKg`**：每個級距的售價 = 該級距的成本單價 × 加成比例，只需要成本資料跟markup設定就能算出完整表格，不需要知道這次貨物實際多重
  - `items` 格式的 `perKgBreak` 明細，**永遠都要顯示完整的級距費率卡**（不管 `cargo.chargeableWeightKg` 有沒有填），這部分不受27.2節「缺計費重量無法計算」規則限制——27.2節那條規則管的是「這批貨的實際成本/總金額算不算得出來」，不是「費率卡能不能生成」，兩者要分開判斷
  - **只有「本次實際適用哪一級距、實際總金額多少」這件事才需要 `cargo.chargeableWeightKg`**：有填就正常標示適用級距、算出實際金額；沒填則費率卡照常完整顯示，但在旁邊用文字註明「尚未提供本次計費重量，暫無法標示適用級距或算出實際總金額，此表僅供費率參考」，不要因此擋住整張費率卡的呈現
  - 若整個報價都用這種「純費率卡、未定案重量」的方式，`allin`/`segment` 格式需要的單一總數字會沒有著落，這種情況下 `totalSellPrice` 該段顯示「依實際計費重量另計」而不是顯示0或報錯，`allin` 總價也要能反映「部分金額待實際重量確定」的狀態，不要顯示一個誤導性的數字
  - 這種「費率卡」呈現方式，也要能完整包含在報價單PDF/Excel匯出裡（第6節），這正是使用者常需要交給標案客戶的正式文件格式，不是只有畫面上看得到
- **實測發現的bug（優先修）**：切換到 `allin` 格式時，下方的報價結構畫面沒有跟著改變，仍停留在原本的格式呈現。`allin` 格式應該只顯示單一總價數字（如 4.3 節設計），三種格式切換時畫面內容要確實跟著切換，不能维持同一種呈現方式
- **空運每KG賣價輔助顯示（新增需求）**：當 `case.mode === 'air'` 且 `cargo.chargeableWeightKg > 0` 時，空運業界習慣用「每公斤多少錢」快速比較報價，畫面上任何呈現賣價總額的地方（`allin` 總價、`segment` 格式的國際運輸段賣價、報價總覽區塊）都應該在金額旁邊附註換算後的「每KG單價」，公式為 `該金額 ÷ cargo.chargeableWeightKg`，不用使用者自己心算。海運（`sea`）情境則不適用這個輔助顯示，因為海運業界慣用每櫃計價，不是每KG
- **每段報價幣別選擇器（v4，對應 `case.quoteCurrencyBySegment`）**：報價分頁裡，`segment` 與 `items` 格式下，每一段（出口/國際運輸/進口）標題旁邊要有一個幣別下拉選單，預設帶入 `case.quoteCurrency`，可個別切換成 `case.rateTable` 裡有匯率的任意幣別——這是因應客戶要求「不同段用不同幣別報價」的情境（例如中國出口到歐洲，出口段給客戶看人民幣、國際運輸+進口段看美金）。`allin` 格式因為只有單一總數字，不適用分段幣別，統一用 `case.quoteCurrency`
- **預期利潤資訊**：報價分頁需即時顯示「總成本／報價總價／預期利潤（金額＋毛利率%）」三項並列，利潤 = 報價總價 − 選定組合總成本，隨使用者調整 markup 或手動賣價即時重新計算，不用按按鈕才更新
- **利潤幣別選擇器（v4）**：預期利潤資訊區塊旁邊也要有幣別下拉選單（同樣選項來自 `case.rateTable`），讓使用者可以切換成自己習慣的幣別查看利潤金額，不受報價分段幣別設定影響（報價單給客戶看的幣別，跟業務自己想用哪個幣別檢視利潤，是兩件事，不用綁在一起）
- 公司抬頭（letterhead）：使用者可設定「預設抬頭」，每個案件可個別覆蓋（公司名稱、標語、地址、聯絡方式、條款文字皆為自由輸入欄位，保留彈性給不同客戶/標案調整用）
- **客戶抬頭（customerInfo）**：報價單需要有明確的「報價對象」欄位區塊（公司名稱、聯絡人、地址、聯絡方式），跟我方的 letterhead 分開顯示（一份報價單上同時要看得出「誰報的」跟「報給誰」），這組資訊沒有「預設值」的概念，每個案件各自輸入
- 貨量資訊（cargo）顯示在報價單上，讓客戶清楚報價對應的貨量基礎
- **必須有兩個明確的匯出按鈕**：「產生報價單 PDF」與「產生報價單 Excel」，各自直接觸發下載，不要求使用者自己另外操作列印或另存

## 5. AI 智慧匯入成本（多格式自動判讀）

**目標**：使用者手上會累積各種格式的代理報價來源——Email 內文、PDF 附件、Excel 報價表、簡單表格截圖、甚至純文字描述——希望能直接把這些「原始格式」丟進系統，不用自己手動拆解、分類、輸入，系統就能判讀並自動歸類成整理好的成本資訊。

### 5.1 支援的輸入格式
- 貼上純文字（複製 Email 內文、聊天訊息、或直接打字描述）
- 上傳檔案：PDF、Excel（.xlsx/.xls/.csv）、Word（.docx）
- 圖片/表格截圖（可用 Claude 的圖像理解直接讀取表格內容，不需額外 OCR 服務）
- 允許一次上傳多個檔案／多段文字，系統應能個別解析後合併成同一次的匯入結果供使用者一次確認

**這一節必須產出的具體畫面/元件**：

**A. 案件層級的「AI智慧匯入精靈」入口（第36節新增，主要入口）**
- 「代理成本」分頁最上方，跟「+新增代理報價」並列，要有一個同樣明顯的**「AI智慧匯入」**按鈕——這是主要入口，因為使用者收到一封新代理的報價信件時，通常還沒建立那個代理，不應該強迫使用者先手動建立空的代理卡片，才能開始用AI匯入
- 點擊後開啟引導式流程（精靈/Wizard），步驟：
  1. 貼上文字/上傳檔案（同5.1節支援格式）
  2. AI解析（同5.2節判讀流程），額外嘗試從原文判斷這是「哪一家代理」（例如信件署名、寄件公司資訊），若判斷得出來則預帶入代理名稱
  3. 使用者選擇「建立為新代理」或「併入案件內已存在的某個代理」（下拉選擇既有代理清單）
  4. 分層預覽解析結果（依5.4節），逐項確認/修改
  5. 「套用」— 依步驟3的選擇，建立新代理或把資料寫入既有代理

**B. 代理卡片內嵌的AI匯入入口（既有設計，保留，作為次要/快速入口）**
- 每個代理卡片內仍保留原本的AI智慧匯入入口，用於「已經有這個代理，只是想再貼一段新資料補進這個代理」的情境，不用跳出案件層級的精靈流程，至少包含：
1. 一個文字貼上區（textarea），供貼 Email 內文
2. 一個檔案拖拉上傳區（drag-and-drop 區域）＋一個點擊選檔按鈕，兩種方式都要能用，接受 PDF/Excel/Word/圖片
3. 一個「開始解析」按鈕，觸發 AI 判讀
4. 解析完成後顯示分層預覽（依 5.4 節），並有「套用」「取消」兩顆按鈕

### 5.2 判讀流程（多層次分類，對應新版 FeeLine 資料模型）

AI 解析需要依序判斷以下幾層，而不是只做「歸屬三段」這一步：

1. **運輸模式判斷**：從內容判斷這份報價是 air／sea(FCL/LCL)／land／rail／cross_border_trucking／multimodal 中的哪一種（依關鍵字如 "vessel/ETD/POL"、"flight/AWB/kg"、"container/truck" 等判斷），供使用者確認要匯入到哪個案件，或用來建議建立新案件時預帶入的 mode
2. **段落歸屬判斷**（export / intl / import）：依貨運術語語意判斷（THC、報關、拖車、文件費 → export；Ocean/Air Freight、船公司/航空公司運費 → intl；目的港雜費、進口報關、送貨 → import）
3. **單筆費用的計價基礎判斷**（對應 2.4 節 FeeLine.basis）：
   - 固定總額、沒有明確單位 → `flat`
   - 每票/BL/MAWB/HAWB 計價 → `perShipment`
   - 每KG直接報價（無級距）→ `perKg`
   - 每貨櫃尺寸/每Pallet等單位報價 → `perUnit`，並嘗試把 amountByType 依單位類型拆出來
   - 級距報價 → `perKgBreak`。若原文只給「單一KG單價 + 最低消費」（如「0.2 CNY/KG, minimum 200 CNY/shipment」），產生 `breaks` 陣列時只放 1 筆（`thresholdKg: 0`）即可，不要自己腦補生成一堆不存在的級距；只有原文真的列出多個重量級距（如 min/100kg+/300kg+/500kg+…）時才產生對應筆數的 `breaks`
   - 判斷不出明確基礎時，寧可先歸類為 `flat` 並在 remark 註明原文，交由使用者人工調整，不要硬套錯誤的計價基礎
4. **逐筆幣別判斷**：不要假設整份報價/整段只有單一幣別——同一段常常混合多種幣別（如出口段大部分是人民幣，其中文件費單獨用美金），每一筆 FeeLine 的 `currency` 要各自從原文判斷，不要用整份文件偵測到的「主要幣別」套用到所有項目上
5. **金額區間處理**：遇到區間（如 "150.00 – 225.00"）時，回傳區間兩端，交由使用者自行決定採用哪個數字，不自行假設或取平均
6. **多航線/多船公司偵測**（對應 2.5 節 Lane）：若同一份報價裡出現多組 carrier/routing/From-To 組合，各自產生一條 Lane，並嘗試帶出 transitDays、stopsCount（可從 routing 文字數轉機站數）、validity 區間
7. **條件性備註**：無法結構化的條件文字（如 "23噸以上加收 overweight surcharge"），原文放進對應 FeeLine 或 Lane 的 `remark`，不要求 AI 自動判斷觸發與否

### 5.3 案件比對（避免重複建立或誤植入錯誤案件）

上傳解析前，若使用者是在既有案件內操作，解析結果預設匯入該案件對應的代理/段落；若是從案件列表外的「總覽匯入」入口上傳（尚未規劃在第一版，屬未來擴充），系統應：
- 依判讀出的 mode/origin/destination，比對是否已有相似的既有案件，若有則提示「是否併入既有案件 X」
- 若找不到相似案件，提示「建立新案件」並預帶入判讀出的 mode/origin/destination/cargo 等欄位供使用者確認

### 5.4 使用者確認流程（不可省略）

- 解析結果一律先分層預覽（依 mode → segment → FeeLine 階層顯示，而非一長串平面清單），使用者可對每一筆判讀結果individually 修改或刪除
- 按下「套用」才寫入資料庫，不可自動覆蓋既有資料
- 若同一份原始資料判讀出多個 Lane，也要能個別勾選要不要匯入

## 6. 匯出

- PDF：畫面截圖轉圖片內嵌 PDF（因中文字型在 jsPDF 原生文字模式下會缺字），或提供瀏覽器「列印/另存 PDF」作為備援
- Excel：至少包含「報價單」與「代理比較」兩個工作表；perKgBreak 段要把 Lane、Subtotal、Total 都列出

## 6.5 介面設計原則（實測回饋新增）

實測發現目前介面「一路往下展開」，視覺動線太長、找東西要一直捲動，且港口/機場用純文字輸入容易打錯，需要調整：

### 6.5.1 可收折結構 + 案件導覽側欄（解決「捲動迷路」問題，第24節升級）

> 使用者反映：案件成本輸入頁面內容一多，不斷往上往下捲動找東西，常常搞不清楚自己目前在看哪個代理、哪一段，這已經影響到日常操作效率，視為急迫項目。單靠「收折」還不夠，需要額外一個「導覽」機制。

**A. 收折（減少畫面雜亂）**
- 代理卡片（Agent card）、Segment 卡片、Lane 卡片、FeeLine 清單都應該預設**收折成一行摘要**（例如「代理名稱｜出口段小計｜國際段小計｜進口段小計」），點擊才展開詳細內容
- 展開時建議只展開使用者當下要編輯的那一個，其餘保持收折（accordion 行為，而非全部同時展開）
- 案件明細頁最上方放一個「全部展開/全部收折」的切換按鈕

**B. 案件導覽側欄（快速跳轉 + 隨時知道自己在哪，這是解決迷路問題的核心）**
- 案件明細頁（代理成本分頁）需要一個**固定顯示的導覽面板**：
  - 桌機版：畫面左側或右側固定一個窄側欄（不隨內容捲動而消失），列出這個案件的結構樹，例如：
    ```
    代理 A
      ├ 出口段
      ├ 國際運輸段
      └ 進口段
    代理 B
      ├ 出口段（3條Lane）
      ├ ...
    ```
  - 點側欄裡任何一個項目，畫面直接捲動並展開跳轉到對應區塊，不用使用者自己滑鼠捲找
  - 側欄要**跟著目前捲動到的位置自動高亮對應項目**，讓使用者隨時清楚知道「我現在在看代理A的進口段」，這是解決「捲動迷路」最直接的做法
  - 手機/平板版：側欄收成一個可點開的選單（漢堡選單/抽屜式選單），點開後是同一份結構樹，點擊後選單自動收合、畫面跳轉到對應位置（跟 6.5.3 節的響應式一起實作，兩者互相依賴）
- 比較分析、報價分頁也適用同樣的導覽概念，但因為這兩頁內容結構相對單純（不像代理成本頁那樣層層疊很多卡片），導覽側欄在這兩頁可以簡化成頁內錨點連結（例如「跳到成本總覽／跳到比較表／跳到匯出按鈕」），不用做到像代理成本頁那麼複雜的樹狀結構

### 6.5.2 港口/機場改為下拉選單（自動完成），不要純文字輸入

> **關於「用航空公司/船公司 point-to-point 網站當資料庫」的可行性說明**：這類頁面（如各航空公司/船公司網站上查詢「A地到B地有沒有直飛/直航」的工具）是拿來查「兩點之間有沒有航班/航線」的查詢工具，不是港口/機場的清單資料庫——它們通常沒有提供可下載、可整批取用的完整港口清單，而是要一次輸入兩個地點才查得到結果，沒辦法反過來「整批列出這家公司飛/開哪些港口機場」。而且每家公司只涵蓋自己有營運的航線，要湊出「全球港口/機場清單」得逐一爬幾十家公司的網站，等於每家格式都要另外處理，長期維護成本很高。真正要的是「有哪些港口/機場存在」這種靜態清單，不是「哪條航線有開」，兩者是不同的資料，公開資料集（機場：OurAirports；海港：UN/LOCODE）才是提供第一種資料的正確來源，涵蓋全球、免費、一次下載就能長期使用，不用管特定承運人有沒有飛。

**這是全站規則，不是逐一補漏——任何欄位只要語意上代表「一個港口/機場/地點」，就必須套用同一個自動完成元件，不能有些地方做、有些地方是純文字輸入。目前已知的所有觸點：**
- Segment.fromLocation / toLocation（已完成）
- **Case.origin / Case.destination**（「新增案件」「編輯案件」表單，目前缺漏，需要補上）——雖然 2.1 節定義這兩個欄位概念上是「提貨地/實際目的地城市」而非嚴格意義的機場/港口，但套用同一個自動完成元件當作「快速填入」的便利工具是合理的（使用者選建議選項後，就是把該機場/港口所在城市＋代碼填進這個文字欄位，本質上還是一個可自由編輯的文字欄位，不是強制外鍵關聯），可以直接重用同一份 airports.json/seaports.json 資料源與同一套元件，不用另外設計
- **Lane.fromPort / toPort**（2.5節新增的結構化欄位，目前缺漏，需要補上，`routing` 那個自由文字欄位不受影響，維持原樣、不套用自動完成，因為裡面可能包含多個轉運節點無法結構化）
- **之後任何新增的功能，只要欄位是「代表一個港口/機場/地點」，一律預設要套用這個元件，不用等實測抓到才補**——這條規則本身比任何一個具體欄位清單都重要，請 Claude Code 往後開發新功能時主動檢查，不用每次都靠使用者測出來才發現漏掉

- **建議做法**：改用現成的公開開放資料集，一次性下載後包進專案當作靜態參考資料（不需要每次連外部 API）：
  - 機場：IATA/ICAO 機場代碼清單，可從 [OurAirports](https://ourairports.com/data/) 取得公開 CSV（免費、資料量涵蓋全球機場，含代碼與城市名稱）
  - 海港：UN/LOCODE 港口代碼清單（聯合國公開資料，涵蓋全球港口）
  - 陸運交接點/邊境口岸：資料較零散，沒有像機場/海港那麼標準化的公開清單，建議這部分維持文字輸入 + 使用者自建常用清單（見下方）
- 前端用**可搜尋的自動完成輸入框**（輸入時即時篩選，例如打 "TPE" 或 "Taipei" 都能篩出對應機場），資料量大時不要用傳統 `<select>` 下拉全部塞進去（機場超過上萬筆，載入與操作都會很慢），建議用輕量的前端搜尋元件或 `<datalist>`（資料量許可的話）
- 依 `case.mode` 篩選要顯示機場清單還是海港清單（air → 機場、sea → 海港）
- 使用者選過的港口/機場，建議額外存一份「使用者常用清單」（依帳號記錄最近用過的幾個），下拉時優先顯示常用項目在最上面，加快之後輸入速度，陸運的交接點也可以透過這個「常用清單」機制讓使用者自己逐漸建立起自己的清單，不依賴公開資料集
- **優先順序更新**：這項功能被反覆提出，代表輸入港口/機場是使用者實際操作中最常卡住、最花時間的地方，優先順序上調到與第3、4節同一批處理，不用等到最後才做。

**海運內陸鐵路站點（Rail Ramp / Inland Point Intermodal）補充需求**：船公司常提供「一站式訂艙可直接訂到內陸點」的服務（例如貨物從 Vancouver 港以鐵路接駁到 Calgary 這種內陸 Ramp 站），這種情況下**訂艙本身仍算海運（不拆成單獨的海運+鐵路兩段去訂）**，只是目的地/起點是內陸城市而非港口。UN/LOCODE 本身除了純海港，也涵蓋不少內陸鐵路轉運點（LOCODE 的 Function 分類碼裡有標示「鐵路轉運站」的地點），建立 `seaports.json` 時篩選條件不要只留「有海港功能」的地點，應一併納入「有鐵路轉運/內陸轉運功能」標記的地點，讓 Calgary 這類站點能出現在海運模式的自動完成清單裡；若資料集篩選後仍有遺漏的站點，靠既有的「使用者常用清單」機制讓使用者手動輸入一次後被記住即可，不用強求公開資料集要100%涵蓋。

### 6.5.3 手機/平板響應式介面

- 需偵測裝置螢幕寬度（不需要特別判斷裝置種類，用 CSS breakpoint 依畫面寬度自動調整即可），窄螢幕下：
  - 案件比較表格、報價表格改為可橫向滑動，或改用卡片式堆疊呈現，避免表格被壓縮到看不清楚
  - 6.5.1 節的收折結構在手機上特別重要（單欄 accordion 本來就適合小螢幕操作），優先確保這個先做完，手機版體驗會直接受惠
  - 表單欄位、按鈕的點擊區域要夠大，避免手機上誤觸
- 這項優先順序可以排在其他核心功能之後，等桌機版功能都穩定了再做

### 6.5.4 儲存機制改為自動儲存（Autosave），取消個別的「儲存」按鈕

> 使用者實測反映：目前一個 Segment 卡片裡有「儲存段落設定」跟「儲存費用清單」兩顆分開的儲存按鈕，功能上有重疊、容易漏按其中一顆，而且每個 Segment/Lane 卡片都各自有這兩顆按鈕，操作負擔大。

- **取消所有手動「儲存」按鈕**，改成自動儲存：欄位失去焦點（blur）或下拉選單值改變時即觸發儲存，使用者不用主動做任何動作
- **段落設定與費用清單合併成同一次儲存**（同一個 Segment 底下的資料視為一個整體，不要拆成「設定」跟「清單」兩個獨立的儲存單位），避免「一半存了、一半沒存」的中間狀態
- 畫面上以小型狀態文字取代按鈕，例如「儲存中…」→「已儲存 ✓」，儲存失敗時明確顯示「儲存失敗，請重試」（紅字），讓使用者隨時知道目前狀態但不用主動觸發
- **與第17節資料驗證規則銜接**：若某一列費用項目正在編輯中、必填欄位還不完整（例如多級距的某列只填了 threshold 沒填單價），自動儲存**不強制跳出阻斷式錯誤**（畢竟使用者可能還在打字中途），而是狀態文字顯示類似「有未填完整的項目，尚未儲存」，等使用者補完自然存入；只有在使用者要離開這個 Segment（切分頁、切代理、切案件）時，才需要明確跳出提示「還有項目未填完整，確定要離開嗎」，避免使用者帶著沒存到的資料離開卻不自知
- 這個機制建議套用到全站所有原本有「儲存」按鈕的表單（案件編輯、代理成本、Lane 設定、報價設定、公司抬頭等），統一用同一套 autosave 模式，不要只改 Segment 卡片這一處，維持全站行為一致

### 6.5.5 常用費用名稱與其他欄位的建議清單（跟港口自動完成同概念，不同資料）

使用者提出：所有需要手動輸入的成本項目欄位，是不是都能有基本的參考清單協助輸入。跟6.5.2節港口/機場一樣的邏輯——**用參考清單降低重複打字、順便讓命名習慣統一**（不同代理對同一種費用可能命名不同，統一後比較表跟AI匯入判讀都會更準確）。盤點哪些欄位適合、哪些不適合套用這個模式：

**適合套用「參考清單自動完成 + 使用者常用清單累積」的欄位：**
- **FeeLine.name（費用項目名稱）**：內建一份完整的常見貨運費用名稱庫，依運輸模式與段落（export/intl/import）分類建議，並附上典型計價基礎供系統預帶入預設值（使用者仍可改）。名稱一律採業界慣用縮寫，不用完整落落長的名稱：

  **通用（不分運輸模式，出口/進口段常見）**
  | 段落 | 常見費用（縮寫） | 典型計價基礎 |
  |---|---|---|
  | export | 報關費 Customs Clearance | flat / perShipment |
  | export | 文件費 DOC Fee | perShipment |
  | export | 驗貨費 Inspection Fee | perShipment |
  | export | 產證費 C/O Fee | perShipment |
  | export | 出口許可證費 Export License Fee | flat |
  | export | 貨物保險費 Insurance Premium | percentValue |
  | export | 押匯手續費 L/C Bank Charge | percentValue / flat |
  | import | 進口報關費 Customs Clearance | flat / perShipment |
  | import | 查驗費 Inspection Fee | perShipment |
  | import | 進口許可證費 Import License Fee | flat |
  | import | 貨物保險費 Insurance Premium | percentValue |
  | import | 關稅保證金手續費 Bond Fee | flat / percentValue |

  **海運 Sea**（第40.1節v5修正:perUnit全文取代成perContainer/perPallet/perCarton,perUnitPerDay取代成perContainerPerDay/perPalletPerDay/perChassisPerDay,以下對應更新)
  | 段落 | 常見費用（縮寫） | 典型計價基礎 |
  |---|---|---|
  | export | THC | perContainer |
  | export | 拖車費 Trucking | perContainer / flat |
  | export | 封條費 Seal Fee | perContainer / flat |
  | export | 燻蒸費 Fumigation | flat / perContainer |
  | export | 併裝費 CFS Charge（LCL） | perCBM / perContainer |
  | export | 裝櫃費 Stuffing Fee | perContainer |
  | export | 暫存倉租 Storage | perContainerPerDay / perPalletPerDay / perCBMPerDay |
  | intl | 海運費 O/F（Ocean Freight） | perContainer（FCL）／Revenue Ton（LCL，見3.3節） |
  | intl | 燃油附加費 BAF | perContainer |
  | intl | 幣值附加費 CAF | perContainer / percentValue |
  | intl | 旺季附加費 PSS | perContainer |
  | intl | 低硫燃油附加費 LSS | perContainer |
  | intl | 排放附加費 ETS（歐線常見） | perContainer |
  | intl | 戰爭險附加費 War Risk | perContainer / flat |
  | import | 目的港THC | perContainer |
  | import | 換單費 D/O Fee | flat / perShipment |
  | import | 延滯費 Demurrage（船公司計） | perContainerPerDay |
  | import | 留滯費 Detention（貨主計） | perContainerPerDay |
  | import | 底盤費 Chassis Per Diem（北美常見） | perChassisPerDay |
  | import | 拆櫃費 Devanning Fee | perContainer |
  | import | 提貨/送貨 Delivery | perContainer / flat / perKm |
  | import | 目的地倉租 Storage | perContainerPerDay / perPalletPerDay / perCBMPerDay |

  **空運 Air**
  | 段落 | 常見費用（縮寫） | 典型計價基礎 |
  |---|---|---|
  | export | 地勤操作費 Terminal Handling | perKg / perKgBreak |
  | export | 傳輸費 EDI Fee | perShipment |
  | export | 拖車/機場接駁 Trucking | flat / perKg |
  | export | 安檢費 SSC（出口段） | perKg / perShipment |
  | export | 暫存倉租 Storage | perKgPerDay |
  | intl | 空運費 Air Freight | perKgBreak（含Min charge + 級距，Pivot Weight見29.3節） |
  | intl | 燃油附加費 FSC | perKg |
  | intl | 安檢附加費 SSC（國際段） | perKg |
  | import | 進口服務費 Import Service Fee | perShipment（常以HAWB/MAWB計）／perKgBreak |
  | import | 操作費 Handling Charge | perShipment / perKg |
  | import | 機場接駁 Airport Transfer | perKg |
  | import | 目的地倉租 Storage（常有免費期間） | perKgPerDay / perPalletPerDay（若以Pallet計） |
  | import | 派送 Delivery | flat / perKg / perKm |

  **鐵路 Rail**
  | 段落 | 常見費用（縮寫） | 典型計價基礎 |
  |---|---|---|
  | intl | 鐵路運費 Rail Freight | perContainer |
  | intl | 場站操作費 Rail THC | perContainer |
  | intl | 過境/轉關費 Transit Fee | perContainer / perShipment |
  | intl | 換軌費 Bogie Change Fee（跨軌距路線） | perContainer |
  | import | 鐵路提單費 Rail Waybill Fee | perShipment |

  **多式聯運 Multimodal**
  | 段落 | 常見費用（縮寫） | 典型計價基礎 |
  |---|---|---|
  | intl | 全程運費 Through Freight（門到門） | perContainer / perShipment |
  | intl | 轉運費 Transshipment Fee | perContainer / perShipment |
  | intl | 聯運提單費 MTD Fee | perShipment |
  | intl | 中轉倉儲費 Transit Storage | perCBMPerDay |
  | intl | 聯運經營人管理費 MTO Handling Fee | perShipment / percentValue |

  - 這份清單是**建議預帶入**，不是限制，使用者仍可自由輸入清單以外的名稱、修改預帶入的計價基礎，輸入過的自訂名稱會存進「使用者常用清單」，下次同模式同段落打字時優先建議
  - **刻意排除的項目**：進口關稅（Import Duty）、加值稅/營業稅（VAT/GST）不列入這份清單——這是進口商對海關的稅務義務，不是貨運代理報價的常規範疇，加進來會模糊這個系統的核心定位（貨運相關成本），若之後有DDP稅金估算的需求，建議另外討論設計方式，不要混進這份費用名稱庫
- **cargo.units.type（貨量單位類型）**：內建標準海運貨櫃代碼參考表（見下方「貨櫃類型標準參考」），同樣允許自由輸入+自訂常用清單累積，也包含 `CHASSIS`（底盤，供 perUnitPerDay 的 Chassis Per Diem 使用）

**成本輸入階段的 perUnit/perUnitPerDay 編輯要跟報價階段同步優化（第34節新增，補齊「報價端只填相關類型」對應的成本端加速輸入）**：

- **「自動加入本案貨量單位」快速按鈕**：`perUnit`/`perUnitPerDay` 費用的編輯區提供一個快速按鈕，讀取這個案件 `cargo.units` 裡數量（qty）大於0的所有類型，自動各生一列空白費率（type已帶入、amount留空待填），使用者不用每次都自己從下拉選單一個一個手動挑選加入
- **視覺標示「本批貨適用」**：`amountByType` 清單裡，凡是對應到 `cargo.units` 有數量的類型，加一個淡色小標籤（例如「本批貨適用」），跟其他額外輸入的類型（代理費率表涵蓋、但這批貨用不到的）視覺上區分開——**這不是警示，兩種都是合法輸入**，純粹幫助使用者快速辨識「這幾列是這次真正要用的」，呼應報價階段（第33節）只顯示相關類型的邏輯，形成前後一致的體驗
- 這個快速按鈕跟標籤純粹是**輸入效率上的加速**，不限制使用者仍然可以透過下拉選單手動新增任何標準類型的費率列（維持代理費率表可以涵蓋比這批貨更多類型的彈性，不受限制）
- **Lane.carrier（船/航空公司代號）**：可以先放一份常見承運人代號（航空：BR/CI/KE/CX/JL/NH等；船公司：ONE/YML/COSCO/MSC/MAERSK/CMA CGM/EVERGREEN等）當初始建議，但這類資料沒有像機場/港口那樣有現成、完整、免費的公開清單可以一次涵蓋全部，所以**主要還是依賴「使用者常用清單」隨使用過程自然累積**，初始清單只是給個開頭，不用花時間找到最完整的承運人資料源

**貨櫃類型標準參考（第35節擴充：加入危險品櫃/罐櫃，並附完整規格資料供彈出視窗使用）**

`20'`／`40'`／`45'` 裡的「`'`」是英尺符號（20呎/40呎/45呎長），`GP`（General Purpose）與 `DC`（Dry Container）是同一種標準乾貨櫃的兩種業界慣用稱呼，代表的是同一種櫃型：

| 標準代碼（內部比對用，不帶符號） | 常見同義寫法 | 說明 | 外徑長×寬×高(m) | 內徑長×寬×高(m) | 最大負載(kg) | 容積(CBM) |
|---|---|---|---|---|---|---|
| `20GP` | 20DC、20' | 20呎標準乾貨櫃 | 6.058×2.438×2.591 | 5.898×2.352×2.393 | 28,200 | 33.2 |
| `40GP` | 40DC、40' | 40呎標準乾貨櫃 | 12.192×2.438×2.591 | 12.032×2.352×2.393 | 26,600 | 67.7 |
| `40HQ` | 40HC | 40呎高櫃 | 12.192×2.438×2.896 | 12.032×2.352×2.698 | 26,580 | 76.4 |
| `45HQ` | 45HC | 45呎高櫃 | 13.716×2.438×2.896 | 13.556×2.352×2.698 | 27,700 | 86.0 |
| `20DG` | — | 20呎危險品櫃（規格通常同20GP，防爆/防漏需求可能略有差異） | 6.058×2.438×2.591 | 5.898×2.352×2.393 | 28,000 | 33.0 |
| `40DG` | — | 40呎危險品櫃 | 12.192×2.438×2.591/2.896 | 12.032×2.352×2.393/2.698 | 26,500 | 67.0-76.0 |
| `20RF` | 20REEFER、20RE | 20呎冷凍櫃 | 6.058×2.438×2.591 | 5.444×2.268×2.272 | 27,280 | 28.3 |
| `40RF` | 40REEFER、40RH | 40呎冷凍高櫃 | 12.192×2.438×2.896 | 11.563×2.286×2.505 | 29,580 | 67.3 |
| `20FR` | — | 20呎平架櫃 | 6.058×2.438×2.591 | 5.940×2.350×2.350 | 31,000 | 開放式，依實際超限貨物而定 |
| `40FR` | — | 40呎平架櫃 | 12.192×2.438×2.591 | 12.080×2.370×2.005 | 39,000 | 開放式，依實際超限貨物而定 |
| `20ISOTANK` | 20ISO | 20呎罐式貨櫃（液體/氣體） | 6.058×2.438×2.591 | 罐體結構，無標準內徑 | 31,000 | 21.0-26.0 千升(KL) |
| `40ISOTANK` | 40ISO | 40呎罐式貨櫃 | 12.192×2.438×2.591 | 罐體結構，無標準內徑 | 31,000 | 30.0-46.0 千升(KL) |
| `20OT` | — | 20呎開頂櫃 | — | — | — | — |
| `40OT` | — | 40呎開頂櫃 | — | — | — | — |
| `PLT` | — | 棧板（Pallet，非貨櫃，海運LCL/空運常用） | — | — | — | — |
| `CTN` | — | 箱（Carton） | — | — | — | — |

> 規格資料來源：使用者提供的貨櫃規格對照表。各船公司/製造商的實際櫃體規格可能有 ±1~3cm 及載重些微差異，這份資料僅供**參考**用途，不參與任何成本計算，實際請以櫃門標示（Tare & Payload）為準——這點務必在彈出視窗裡註明，避免使用者誤把參考數字當成保證值

**貨櫃規格彈出視窗（第35節新增）**

- 在以下兩個位置的貨櫃類型欄位旁加一個「ⓘ」小圖示，點擊彈出該類型的規格卡片（外徑/內徑尺寸、最大負載、容積），不用預設展開、不佔版面：
  1. 案件「貨量資訊」裡輸入 `cargo.units` 的貨櫃類型欄位（規劃訂幾個櫃、容量夠不夠時查閱）
  2. 成本/報價輸入 `perUnit`/`perUnitPerDay` 費用的貨櫃類型欄位（確認費率對應哪種規格的櫃）
- 彈出視窗內容依當下選定的類型顯示對應規格；若類型是`OT`/`PLT`/`CTN`這種目前沒有完整規格資料的，顯示「此類型暫無詳細規格資料」，不要顯示空白或錯誤
- 規格資料建議存成一份靜態參考資料（JSON，比照 6.5.2 節機場/港口資料的處理方式），不需要外部 API，一次建置後長期使用

- **內部儲存與比對一律用「標準代碼」（不帶`'`符號），畫面上可以顯示「20GP（20呎一般櫃/乾貨櫃）」這種好讀的完整說明，但實際存進 `cargo.units.type` 跟 FeeLine 的 `amountByType[].type` 的值必須是同一份標準代碼，不能一個存 `20'GP`、一個存 `20GP`** ——這正是這次 ATE 那個bug最可能的根因，兩處欄位如果各自讓使用者手打、沒有共用同一份標準清單跟同一套正規化邏輯，就會發生「看起來是同一個櫃型，字串却對不起來」的問題
- 使用者輸入時若打了帶 `'` 符號或其他常見寫法（如 `20DC`、`40HC`），系統應該要能正規化辨識成對應的標準代碼，而不是要求使用者一定要打成一模一樣的格式
- 空運沒有貨櫃概念，不適用這份清單，空運的計費單位是KG（見2.4節perKg/perKgBreak）

**不適合套用這個模式的欄位（維持純自由文字輸入，不要畫蛇添足）：**
- **Agent.name（代理名稱）**：這是使用者自己合作的代理公司名稱，屬於使用者的專屬商業資料，不是通用詞彙，套用建議清單沒有意義
- **Case.name（案件名稱/客戶）**：同理，是使用者自訂的案件識別方式，不需要建議清單
- letterhead、customerInfo 這類公司/聯絡資訊欄位：都是使用者自己或客戶的專屬資料，不適用

## 6.6 匯率表管理介面（v4，對應 Case.rateTable）

- 案件明細頁需要一個「匯率設定」區塊（建議放在「貨量資訊」卡片附近，因為都是案件層級、影響全案計算的共用設定），列出這個案件目前用到的所有幣別（自動偵測：掃描所有 FeeLine 目前使用的 `currency` 值），每個幣別一列，可輸入「1[幣別] = 多少 `case.quoteCurrency`」
- `case.quoteCurrency` 本身固定顯示「1 = 1」，不用輸入
- 每一列旁邊提供「抓即時匯率」按鈕（沿用既有的免費匯率API機制），也可以手動輸入/覆蓋
- 新增一筆 FeeLine 時，若用到 `rateTable` 裡還沒出現過的新幣別，該幣別要自動加入這張表（顯示為「尚未設定匯率」的警示狀態），提醒使用者記得補上匯率，否則比較分析/報價頁面遇到這個幣別會顯示「缺匯率」警示而非誤算成其他數字
- 這張表是 autosave（比照6.5.4節），不需要額外的儲存按鈕

## 6.7 視覺設計系統 v2（第31節修正：色塊分區加強、移除刺眼的螢光強調色）

> 使用者實測第一版色票後反映：顏色太淺，區塊分區不明顯；強調色 `#0f9b8e` 直接當文字色使用時，在小字體/白底情境下顯得像螢光色，長時間看容易疲勞。已產出視覺預覽（桌機/平板/手機三種尺寸）確認新方向，這是**定案版本**，取代第一版色票。

```css
:root {
  /* 主色：深藍/靛藍，商務、專業感 */
  --color-primary: #1d3a5f;
  --color-primary-dark: #132a45;   /* 用於側欄、頂部bar等需要強烈分區的深色底 */
  --color-primary-light: #2c5282;

  /* 強調色：改用更深的墨綠，且只能用在背景色塊/圖示/邊框，絕對不能直接當大面積文字顏色使用 */
  --color-accent: #0b7d6f;
  --color-accent-bg: #dcf3ef;

  /* 成功/最低價：色塊樣式，不用彩色文字直接呈現 */
  --color-success-bg: #dcfce7;
  --color-success-text: #166534;

  /* 警示色 */
  --color-danger: #b91c1c;
  --color-warning: #b45309;
  --color-warning-bg: #fdecd2;

  /* 三段專屬區塊色（第31節新增）：出口/國際/進口段落各自的淡色調背景，讓使用者光看色塊背景就能分辨目前在哪個工作區 */
  --zone-export: #eaf6f4;         --zone-export-line: #0b7d6f;
  --zone-intl: #eef1fb;           --zone-intl-line: #3f4fa8;
  --zone-import: #fdf3e6;         --zone-import-line: #b45309;

  /* 中性色階：文字/邊框/背景層次 */
  --color-text-primary: #1a202c;
  --color-text-secondary: #4a5568;
  --color-text-muted: #94a3b8;
  --color-border: #dbe2ea;
  --color-bg: #f4f6f9;
  --color-surface: #ffffff;

  /* 字體層級：全站標題/內文/輔助文字只用這三種大小，不要每頁不一致 */
  --font-size-heading: 18px;
  --font-size-body: 14px;
  --font-size-caption: 12px;
  /* 統一圓角、陰影 */
  --radius: 8px;
  --shadow-card: 0 1px 3px rgba(0,0,0,0.08);
}
```

**強制規則（不是建議，這兩條是實測後修正出來的教訓，務必遵守）：**
1. `--color-accent` 只能用在背景色塊、圖示、邊框，**絕對不可以直接設成文字的 `color`**，尤其是小字體/白底情境下會顯得刺眼。需要用顏色強調金額或狀態時，一律做成「淡色底+深色文字」的色塊/徽章樣式（例如比較分析頁的最低價，用 `--color-success-bg` 底 + `--color-success-text` 文字），不要用單純的彩色文字
2. **案件明細頁需要強烈的區域分區**：
   - 側欄（6.5.1節的案件導覽側欄）改用 `--color-primary-dark` 深色底，跟白色主內容區形成強對比，不要用跟主內容區同樣淺色調的側欄
   - 出口/國際/進口三段的表單區塊，各自套用 `--zone-export`／`--zone-intl`／`--zone-import` 淡色背景 + 對應的 line 色當邊框/選中狀態的描邊色，讓使用者不用細看文字，光看背景色就能分辨自己在哪一段

- 全站套用同一套變數、不要每個頁面各自寫死顏色，之後要統一調整才不用每個檔案都改一次
- 金額數字統一用等寬字體（如 `monospace` 或 `"SFMono-Regular"`），數字對齊、易讀，這在報價單、比較表這種數字密集的畫面尤其重要

- 這次是**定案色票**，不是建議起始值，要求全站確實套用這組色碼與變數，不要再各自寫死顏色
- 「命中最低消費」「依單價計算」這類狀態標籤（第16節提到的橘色/綠色badge）延用同樣「淡色底+深色文字」的色塊邏輯，不用重新設計

## 7. 非功能需求

- 資料保存：Supabase（Postgres），依登入帳號隔離資料，換裝置登入同帳號可看到全部案件
- 貨幣：支援手動輸入匯率，也可選擇呼叫免費匯率 API（如 frankfurter.app）自動帶入
- 案件複製：可整案複製（含代理、Lane、抬頭設定）用於類似航線快速重新報價

## 7.5 首頁 Dashboard（第36節新增，登入後的第一個入口，跟案件內導覽側欄互補）

> 目前登入後直接進案件列表，沒有更高層級的總覽入口。案件內部的導覽側欄（6.5.1節）管的是「單一案件內部」的結構，Dashboard 要管的是「跨案件」的整體掌握，兩者是不同層級、互補不互相取代。

- **登入後的第一個畫面改成 Dashboard**，不是直接進案件列表；Dashboard 提供以下區塊：
  1. **待處理事項**：列出需要使用者留意的案件——含 27.2節「資料不完整無法計算」警示的案件、月標案件（9.1節）報價有效期間即將到期或已過期的案件，每項可直接點擊跳轉到對應案件
  2. **快速統計**：目前活躍案件總數、依案件類型（單次詢價/月標/專案）分類的數量、依運輸模式分類的數量，純資訊呈現，不用做成複雜圖表
  3. **最近案件**：依最後更新時間列出近期處理過的案件，快速點擊進入
  4. **快速建立案件**：明顯的「+新增案件」入口
  5. **市場行情參考小工具**（見7.6節）
- 主導覽（不是案件內側欄，是全站層級的導覽，例如頂部或最外層側欄）要能在「首頁 Dashboard」跟「案件列表」之間切換，兩個是平行的兩個進入點

## 7.6 市場行情參考（衔接第13節，這次確定顯示位置）

第13節已經說明：完整即時運價指數大多是付費資料，這裡維持「使用者自行記錄、系統畫趨勢」的簡易版本做法（見13節細節），這次補齊要顯示在哪些地方：

1. **Dashboard 首頁**：一個小工具區塊，顯示使用者自己記錄過的運價指數最新幾筆數字+簡單趨勢
2. **成本輸入/報價階段的可收合參考面板**：案件明細頁提供一個可以收合/展開的「市場行情參考」側邊面板或彈出面板，預設收合不佔空間，展開後顯示同一份自行記錄的運價指數資料，方便使用者輸入成本或報價時，順手比對「這個報價合不合理」

兩個顯示位置**共用同一份資料來源**（使用者自行記錄的運價指數），不是各自獨立的兩套系統。

## 7.7 報價行事曆（第37節新增，追蹤報價期限與月標週期性交件）

> 使用者實務情境：月標客戶通常會約定固定週期（如每月固定日期前）要求提供更新報價，單次詢價也常有明確的報價截止時間（第9.1節提過但先前沒有正式做成欄位），需要一個機制追蹤「這個案件下一次該交報價是什麼時候」「交了沒」，避免漏交。

**Case 新增排程欄位**：
```
Case.schedule {
  quotationDeadline           // 單次詢價/專案：本次報價需在此時間前送出，選填
  recurrence                  // 'none' | 'monthly' | 'weekly' | 'custom'，月標案件常用週期性交件
  recurrenceDay                // recurrence='monthly'時，指定每月第幾天要交報價（如25號）；'weekly'時指定星期幾
  nextDueDate                  // 依recurrence規則算出的下一次應交報價日期，使用者可手動覆蓋
  quotedStatus                 // 'pending'（待處理）| 'submitted'（已交）| 'overdue'（已逾期），系統依nextDueDate與目前時間自動判斷pending/overdue，使用者手動標記submitted
  lastSubmittedAt              // 最近一次標記為「已交」的時間戳記
}
```

- **週期性案件的運作方式**：`recurrence`不是`none`時，使用者標記「本輪已交報價」後，系統依規則自動算出下一輪的`nextDueDate`、狀態重置回`pending`，形成持續追蹤的循環，不用每個月手動重新設定一次
- **報價行事曆頁面**：新增一個月曆檢視畫面（跟Dashboard、案件列表平行的一個進入點），把所有案件的`nextDueDate`/`quotationDeadline`點在對應日期上，依`quotedStatus`用不同顏色區分（待處理/已交/逾期，沿用6.7節警示色系統），點日期看當天有哪些案件、點案件直接跳轉過去
- **與Dashboard整合**：7.5節「待處理事項」區塊要納入即將到期（例如未來3天內）跟已逾期的報價，不用等使用者自己點進行事曆才發現
- **範圍限制（誠實說明）**：這個版本是**畫面上的視覺追蹤**（行事曆、Dashboard提醒），不包含主動推播通知（Email/簡訊提醒）——真正的主動通知需要後端排程機制（例如Supabase Edge Function搭配排程觸發），是更大的工程，這次先不做，之後有需要可以再評估

---

## 8. 開發階段建議（給 Claude Code 的分階段提示）

1. 初始化純 HTML/JS 專案骨架 + Supabase 連線 + 帳號登入
2. 依本文件 2.1–2.4 建立 Supabase 資料表結構
3. 成本輸入頁面：先做 lumpsum / perContainer / perShipment，再做 perKgBreak（含多 Lane、FeeLine 換算邏輯）
4. 比較分析頁面（含 Lane 展開比較與混搭選擇）
5. 報價單頁面（三種格式 + Subtotal/Total 切換 + 抬頭設定）+ PDF/Excel 匯出
6. AI 智慧匯入（Supabase Edge Function + Claude API，含解析預覽/套用流程）
7. 部署到 Netlify/Cloudflare Pages

---

## 9. 依實際詢價信件案例補充的需求

這裡整理自使用者提供的真實案例（Air Spot inquiry 信件、Sea Bidding 信件、代理 Ocean rate Excel），把規格補齊到更貼近實務。

### 9.1 案件類型差異：Spot Inquiry vs Monthly Bidding

- **Spot inquiry**：單次詢價，通常有明確 quotation deadline、cargo ready date、貨量（PLT數/KGS）。詢問代理後就是一次性報價。
- **Monthly bidding（月標）**：
  - 代理報價會標注 **Validity（有效期間）**，如 "16 Jul - 31 Jul 2026"，過期需重新詢價，同一航線在不同期間可能不同價
  - 常伴隨**承諾月量**（如 "20 FEUs"、"30 FEUs"、或每週 forecast 貨量），費率依承諾量分級
  - 議價常有**多輪來回**（R1 → R2 → R3…），需保留歷史紀錄以觀察價格趨勢，也方便跟代理對帳

**Case 需新增欄位：**
```
Case {
  ...（既有欄位）
  biddingRound              // 目前議價輪次，如 "R2"（僅 tender 案件使用）
  validityStart, validityEnd
  committedVolume           // 承諾月量，如 "20 FEUs"
}
```

**RateSnapshot（報價歷史紀錄，供月標議價回溯）：**
```
RateSnapshot { id, agentId, laneId?, capturedAt, roundLabel, summary }
```
每次更新某代理/Lane 的成本，若案件為 tender 類型，可提示是否存一筆快照，供日後檢視價格趨勢。

### 9.2 Lane 模型擴充：實務上是「船/航空公司 + Routing」的組合，不只是港口

同一份 Ocean rate 表裡 ONE/YML/OOCL/COSCO/ZIM/PIL/MSC 等多家船公司報同一段航線；空運範例裡同一代理給 BR/KE 經 IST/TPE/ICN/NRT 等不同轉機路線。Lane 需要更豐富的欄位，完整定義已併入 2.5 節（`carrier`、`routing`、`transitDaysMin/Max`、`stopsCount`、`validityStart/End`、`incoterm`、`remark`、`feeLines`）。原本另外設計的 `truckingBreaks` 獨立欄位已取消，改成 Lane.feeLines 裡直接放一筆 `basis='perKgBreak'` 的 FeeLine 即可，跟 Segment 直接用 feeLines 的邏輯完全一致，不用學兩套結構。

### 9.3 「最佳方案 ≠ 總成本最低」的評估邏輯

使用者明確指出：總成本最低不一定是最佳方案，還要考慮轉運站點數與總運輸時間，且最終判斷由使用者自己來，系統只能輔助標示，不能自動幫使用者做決定。

**建議實作方式（警示而非強制排除）：**
- 使用者可設定門檻：`maxStopsAllowed`、`maxTransitDaysAllowed`（例：轉機超過2站、總運輸超過10天）
- 比較分析頁面：任何 Lane 若超過門檻，以警示樣式標示（如「⚠ 超過轉機站點限制」），但仍保留在列表中可被選用，不強制隱藏
- 「最低成本組合」自動建議邏輯，優先在未觸發警示的選項中挑最低價；若全部觸發警示，仍顯示最低價選項並註明警示原因，交由使用者最終決定

### 9.4 貨量單位一般化：cargo.units 取代 cargo.containers

目的地費用常以「每 Pallet」計價（如 Gate in/out charge USD 15/pallet、Storage USD 3/pallet/day），不是只有貨櫃或KG：

```
Case.cargo { units: [{ type, qty }], chargeableWeightKg, shipmentQty }
```
type 可以是 20GP/40GP/40HQ/45HQ，也可以是 PLT、CTN 等任意單位。`perContainer` 計價方式相應改名為 `perUnit`，邏輯不變，只是 type 對應到 `cargo.units`。

### 9.5 FeeLine 延伸：依「單位尺寸」分別報價的附加費

Ocean rate 範例中 ETS/EFS 這類附加費常是「每20尺一個數字、每40尺另一個數字」（如 `ETS = EUR 89/178 per 20'/40'`），不是單一 flat 金額：

```
FeeLine.amountByType: [{ type, amount }]   // 取代單一 amount，依貨櫃/單位尺寸報價時使用
```

### 9.6 條件性備註（remark）欄位

很多費用有難以結構化的條件文字（如「23噸以上加收 overweight surcharge」），不強求系統自動判斷是否觸發。FeeLine／Lane 都應保留 `remark` 自由文字欄位；AI 智慧匯入時應盡量把這類文字原封不動填進 remark，而不是硬要結構化成數字。

### 9.7 運輸模式涵蓋範圍（再次明確列出）

`mode` 需涵蓋：air／sea（含 FCL 與 LCL）／land（境內陸運）／跨境鐵路（rail）／跨境卡車（cross-border trucking）／多聯式（如海空聯運 sea-air、鐵海聯運等組合）。鐵路/卡車情境下，Lane 的 `carrier`/`routing` 可填班次代號或路線名稱，週期性/分級距費率表邏輯（`basis='perKgBreak'` 的 FeeLine）同樣適用，不限空運。

---

## 10. 實測回饋修正（v2 資料模型調整，重要）

實際測試第一輪成品（案件列表、代理管理、Segment 的 lumpsum/perUnit/perShipment 輸入）後，發現以下 4 個問題，已反映在前面章節的修訂內容中，整理成給 Claude Code 的修正清單：

1. **同一段成本無法混合多種計價基礎**（如出口段要同時有「每櫃」的吊櫃費和「每票」的文件費/報關費）
   → 已改為 2.3/2.4 節的統一 FeeLine 清單模型：Segment 不再是「選一種 pricingType」，而是「一份費用清單，每筆費用自己選 basis（flat/perShipment/perKg/perUnit/perKgBreak）」。**這是本次最關鍵的架構調整，需要重構既有的 Segment 表單與資料表（`segments`/`fee_lines` 相關 schema 與 UI）**，不是新增功能而已。

2. **國際運輸段缺少起訖點欄位，且應依運輸方式顯示不同標籤**（空運 AOL/AOD、海運 POL/POD、陸運 Pickup from/Delivery to、多聯式 From/To）
   → 已加入 2.3 節的 `Segment.fromLocation` / `toLocation`，標籤依 `case.mode` 動態切換。

3. **案件建立後無法編輯**（例如要把運輸方式從空運改成海運）
   → 已在 2.1 節註明：案件所有欄位（含 mode）建立後都必須可再修改，需要在案件明細頁補上「編輯案件」功能。

4. **案件內缺少成本整理總覽、同類型比較分析、報價建立、預期利潤等頁面**
   → 這對應規格書第 3/4 節（比較分析頁面、報價單頁面），屬於 Claude Code 原本就規劃在「下一輪」要做的範圍，不是遺漏，只是這次先做了案件/代理/成本輸入的基礎功能。第 4 節已補上「預期利潤（金額＋毛利率%）」的明確顯示需求，請確認做這兩個頁面時一併涵蓋。

**建議跟 Claude Code 說的下一步**：先處理第1、2、3點（資料模型與表單調整，動作較大，建議先做完並測試過，因為第4點的比較/報價頁面會直接依賴新的 FeeLine 結構），確認 lumpsum/perShipment/perUnit/perKg/perKgBreak 五種 basis 都能在同一段混用、存檔、重新整理後正確讀回，再繼續做第4點的比較分析與報價單頁面。

---

## 11. 實測回饋修正（第二輪）

v2 架構重構完成並測試後，發現以下 4 點：

1. **還沒有比較分析頁面** → 非 bug，是規格書第3節本來就規劃、原本排在下一輪要做的功能，維持原順序即可。
2. **同一案件內還無法產生報價、依成本組合算利潤** → 非 bug，對應規格書第4節，同樣是下一輪要做的功能（已在前一輪回饋中補上「預期利潤」的明確顯示需求）。
3. **代理的段落起訖點沒有自動帶入案件的出口地/進口地，還要重複手動輸入** → 已修訂 2.1/2.3 節：新增「起訖點鏈式帶入規則」，`case.origin`／`case.destination` 明確定義為提貨地/實際目的地城市或郵遞區號並鎖定帶入 export 段起點與 import 段終點；export→intl→import 三段的港口/機場銜接處自動鏈式帶入前一段的值，使用者只需要在每個代理下輸入「自己實際使用的港口/機場」，不用重複打城市名稱。
4. **介面視覺動線太長、找東西要一直捲動；港口/機場應該用下拉選單而非文字輸入** → 新增第6.5節：
   - 代理卡片／Segment 卡片／Lane 卡片／FeeLine 清單改為預設收折、點擊展開的 accordion 結構
   - 港口/機場改用可搜尋自動完成輸入框，資料來源建議用公開資料集（機場：OurAirports 開放資料；海港：UN/LOCODE），而不是即時爬各家航空/船公司網站（不可靠也難維護），並加上「使用者常用清單」機制加速常用港口的輸入，陸運交接點因無標準化公開清單，維持文字輸入＋常用清單機制

**建議跟 Claude Code 說的下一步**：第3點（起訖點鏈式帶入）建議與第4節的 Segment 表單一起處理，因為都動到同一批表單元件；第4點的 UI 收折與自動完成屬於體驗優化，可以晚一點做，不影響資料正確性，優先順序上可以放在比較分析頁面（第3節）跟報價單頁面（第4節）之後，等核心功能都跑得動了再回頭優化操作體驗，避免這階段來回切換导致進度分散。

---

## 12. 實測回饋修正（第三輪）

比較分析頁面、報價頁面實測後發現還是沒有做出來（或只做了資料邏輯、沒有對應的可操作畫面），加上港口自動完成第二次被提出，代表這幾項需要更明確地要求：

1. **沒有一鍵匯出成本比較表 Excel 的按鈕** → 已在第3節補上明確條列：比較分析要有獨立分頁/區塊、要有「匯出比較表 Excel」按鈕，且跟報價單匯出是分開的兩顆按鈕、兩份檔案。
2. **沒有讓使用者輸入報價（賣價）的頁面，也沒有一鍵產生報價單、看不到利潤** → 已在第4節補上明確條列：報價必須是獨立分頁/區塊，支援「markup 自動算」與「手動輸入賣價」兩種模式切換，利潤要即時顯示（不用按按鈕才更新），且要有「產生報價單 PDF」「產生報價單 Excel」兩顆明確按鈕。
3. **港口/機場自動完成仍未做**，且提出用航空/船公司的 point-to-point 網站當資料庫 → 已在第6.5.2節說明這類網站是「查特定兩點有沒有航線」的查詢工具，不是可整批取用的港口清單資料庫，不適合當清單來源；維持用 OurAirports／UN/LOCODE 這類公開資料集的建議，但**優先順序上調**，跟第3、4節一起處理，不用等到最後。

**建議跟 Claude Code 說的下一步（這次講清楚要「看得到、按得到」的畫面，不要只有資料模型）**：
> 請依照規格書第3、4節「這一節必須產出的具體畫面/元件」條列的內容，實際把「比較分析」跟「報價」做成案件明細頁裡兩個可以點進去的分頁，各自要有對應的匯出按鈕（比較表 Excel、報價單 PDF、報價單 Excel 共三顆），完成後我要能實際點開這些分頁、按這些按鈕看到結果，而不是只有後端資料算得出來而已。同時麻煩把第6.5.2節的港口/機場自動完成一併排進這一輪。

---

## 13. 未來規劃（低優先，先不用做）：市場運價指數參考

使用者希望未來能在輸入成本/報價時，旁邊有個參考視窗顯示當前各區域航線的市場運價指數（海運、空運），幫助判斷代理報價是不是合理、報價給客戶的價格有沒有競爭力。

**先誠實說明資料取得的現實限制**：市面上主要的運價指數（如海運的 SCFI 上海出口集裝箱運價指數、FBX Freightos Baltic Index、Drewry World Container Index；空運的 TAC Index、Baltic Air Freight Index）大多是**付費訂閱資料**，完整的即時/歷史數據需要跟資料商簽約付費取得 API 授權，不像機場/港口代碼那樣有現成的免費公開資料集可以直接包進專案。少數指數有**免費的公開摘要**（例如上海航運交易所會公開發布 SCFI 每週摘要數字，但通常是週更、幾條主要航線的概略值，不是完整明細），可以先用這種免費摘要當作「參考」等級的資訊，但不能當作精確報價依據。

**建議的實作方向（等真的要做的時候再細化）**：
- 第一階段可以先做「使用者自己手動記錄」的簡易版本：讓使用者自己定期把看到的市場指數數字（不管從哪裡看到的）登打進系統存成一個簡單的時間序列，系統只負責顯示趨勢圖表，不負責抓取
- 若之後要做到自動更新，需要另外評估是否要訂閱付費資料源（有 API 可接的，如 Freightos 有提供付費 API），這會產生額外的訂閱費用，需要使用者自己評估是否值得
- 這一項目前列為未來規劃，不排進現在的開發階段

---

## 14. 實測回饋修正（第四輪）

這輪一次提出 8 點，整理如下，並附上建議的處理優先順序：

1. **需要 Incoterm 欄位，且要能處理三角貿易等例外狀況** → 已在 2.1 節加入 `Case.incoterm`（參考標籤）與 `Case.quoteScope`（實際控制報價要收哪幾段錢的開關）兩個分開的欄位，選 incoterm 時建議預帶入 quoteScope，但使用者隨時可手動覆蓋，不會被卡死在標準對應關係裡。
2. **新增案件表單沒有取消/返回列表** → 已在 2.1 節註明需要補上「取消」按鈕。
3. **空運的港口自動完成還沒生效** → 上一輪 Claude Code 說已建置機場/海港資料集，但實測空運段仍未生效，這是**需要回頭檢查/除錯**的項目，不是新規格，麻煩請 Claude Code 確認是資料綁定錯欄位、還是 mode 判斷邏輯有誤。
4. **海運需要涵蓋內陸鐵路轉運站（如 Vancouver 接 Calgary 的 Ramp）** → 已在 6.5.2 節補充：`seaports.json` 篩選時不要只留純海港功能的地點，UN/LOCODE 裡有鐵路轉運功能標記的內陸點也要一併納入，缺漏的部分靠使用者常用清單補齊。
5. **卡片收折 + 需要清楚標示目前在編輯哪個代理** → 已在 6.5.1 節補充「目前所在位置提示」（sticky 分頁標籤/麵包屑）。
6. **AI 智慧匯入還沒看到上傳按鈕/區域** → 已在 5.1 節補上明確條列的具體元件需求（貼上區、拖拉上傳區、解析按鈕、預覽套用/取消）。
7. **手機/平板響應式** → 新增 6.5.3 節，用 CSS breakpoint 依螢幕寬度調整，優先順序排在其他核心功能之後。
8. **市場運價指數參考（使用者自己說可以晚點做）** → 新增第13節，說明真實資料源大多是付費訂閱，先規劃「使用者手動記錄」的簡易版本，暫不排入現在的開發階段。

**建議跟 Claude Code 說的下一步（含優先順序）**：
> 規格書更新了，這次照優先順序分批說明，麻煩依序處理：
> 1. 先修第3點的bug（空運港口自動完成沒生效，麻煩檢查一下）
> 2. 再做第2點（新增案件表單加取消按鈕，改動很小）
> 3. 接著做第1點（2.1節的 incoterm + quoteScope，這會影響第4節報價總額怎麼算，記得一併更新報價頁面的加總邏輯）
> 4. 然後是第5、6點（6.5.1節的收折+目前位置提示、5.1節AI匯入的上傳按鈕，這兩個之前都還沒做出畫面）
> 5. 第4點（海運內陸鐵路站點，調整 seaports.json 的篩選條件）
> 6. 第7點（手機響應式）跟第13節（市場運價指數）先不用做，之後再說

---

## 15. 實測回饋修正（第五輪）：幣別必須是每筆費用自己的屬性，不是整段一個幣別

使用者指出實務上的真實狀況：同一個案件裡，不只是「不同代理用不同幣別」，**同一個代理、同一段成本內部，就可能同時混用好幾種幣別**——例如中國出口到歐洲的案子：出口地當地費用主要用人民幣，但其中文件/傳輸費可能單獨用美金報；國際運費代理可能給人民幣、港幣、或美金；目的地歐洲的費用用歐元或美金；最後付款客戶又是用美金付款。

**修訂內容**：已將 `currency`／`fxRate` 從 2.3 節的 Segment 層級**下移到 2.4 節的 FeeLine 層級**，每一筆費用自己決定自己的原始幣別跟換算匯率，互不影響。Segment 層級改保留一個 `defaultCurrency` 純粹當作「新增費用時預帶入的幣別」，只是省打字用，不參與實際計算。計算公式也對應調整：每筆 FeeLine 先算出原幣別金額，再各自乘上自己的匯率換算成報價幣別，Segment/Lane 總額則是直接加總已經換算好的各筆金額，不再需要外層再乘一次匯率。

第5節 AI 智慧匯入的判讀流程也同步補上「逐筆幣別判斷」，避免 AI 誤判整份文件用單一幣別、忽略了其中個別用不同幣別報的項目（如例子中「主要人民幣、文件費美金」這種混合情況）。

**這是資料庫層級的異動**（`fee_lines` 表要新增 `currency`／`fx_rate` 欄位，`segments` 表原本的幣別欄位若有的話要挪過去或棄用），跟第10節那次的架構調整同一等級，需要跑一次新的 migration，並且要重新檢查現有測試資料的幣別換算邏輯有沒有跟著正確搬過去。

**建議跟 Claude Code 說的下一步**：
> 規格書第15節是這次的重點，把幣別欄位從 Segment 層級搬到 FeeLine 層級了，因為實務上同一段成本常常混合好幾種幣別。這需要跑一次新的 migration（`fee_lines` 表加 `currency`/`fx_rate` 欄位），並更新所有讀取/計算成本的地方（成本輸入表單、比較分析、報價頁面）改成用每筆 FeeLine 自己的幣別去換算，不要再假設整段是同一個幣別。麻煩先做這個，再繼續處理第14節排定的優先順序清單。

---

## 16. 實測回饋修正（第六輪）：perKgBreak 的「單價+最低消費」簡單模式

使用者實測發現：像機場 Terminal Handling 這種「0.2 CNY/KG，最低消費 200 CNY/shipment」的常見報價方式，如果系統要求一定要先建一整張多級距費率表才能輸入，會很不方便，這種其實只是最簡單的「單價+最低消費」，跟之前空運範例那種一路到 4000kg+ 的完整費率表是不同複雜度的兩種情境。

**修訂內容**：已在 2.4 節說明 `perKgBreak` 這個 basis 本來就同時涵蓋這兩種情境（数學上是同一條公式，`breaks` 只有 1 筆時就是最簡單的單價+最低消費），並明確要求 UI 預設只顯示「每KG單價」跟「最低消費」兩個欄位，不要預先生成一整排空的級距列，多級距只在使用者自己按「+ 新增級距」時才出現。同步更新了第5節 AI 匯入的判讀規則：原文只提到單一單價+最低消費時，不要自己腦補生成不存在的多級距。

**建議跟 Claude Code 說的下一步**：
> 規格書第2.4節補充了 perKgBreak 的「簡單模式」說明，這個 basis 選下去預設應該只顯示「每KG單價」跟「最低消費」兩個欄位就好，不要像之前那樣預先帶出一整排空的級距輸入列，使用者需要多級距時再自己按「+ 新增級距」加。麻煩檢查一下目前的表單有沒有符合這個行為，順便看一下比較分析/報價頁面呈現這類費用時，能不能標示出「這次是命中最低消費、還是照單價計算」。

---

## 17. 實測回饋修正（第七輪）：perKgBreak 加總算錯 + threshold 語意誤解

實測 incoterm+quoteScope（需先跑對應 migration 補齊 `cases` 表欄位）後，發現進口段加總金額明顯算少了，往回追查出兩個問題：

1. **`thresholdKg` 的意義沒有在 UI 上講清楚，導致使用者誤填**：使用者想表達「0-300kg用6/kg、超過300kg用2/kg」，但因為不確定 `thresholdKg` 是「起點」還是「終點」，誤填成兩筆 `{300:6}` + `{1000(隨便掰的數字):2}`。已在 2.4 節加入明確規則：`thresholdKg` 代表「起始點」（從這個重量開始套用，一路到下一個更高門檻為止），第一筆固定填 0，最高那筆代表「以上、無上限」，並要求 UI 即時算出每筆的有效範圍顯示出來（如「適用於 0~299kg」），從源頭避免這類誤填。
2. **`perKgBreak` 多級距的實際計算結果不正確**：即使排除掉第1點的誤填因素，系統算出來的金額（只等於 minCharge）明顯比正確公式該有的結果更低，代表 `breaks` 陣列在存檔或讀取時很可能沒有正確保存/還原，需要 Claude Code 直接檢查程式碼，這很可能跟上一輪（第16節）簡單模式/多級距模式來回切換的重構有關，需要確認切換邏輯有沒有不小心把 `breaks` 清空或存錯格式。
3. 同時也發現清單中「最後一筆費用項目」在畫面顯示「已儲存」的情況下，實際沒有被計入總額，這是另一個獨立的存檔/加總 bug，需要一併檢查。

**建議跟 Claude Code 說的下一步**：
> 規格書第17節記錄了這次發現的 bug。第2.4節也補充了 `thresholdKg` 的語意說明（起始點、不是上限，第一筆固定0，最後一筆代表無上限），並要求 UI 即時顯示每筆的有效範圍，麻煩先做這個 UI 澄清。另外有兩個實測算錯的問題需要查：(1) perKgBreak 多級距的情況，算出來的金額不對，看起來 `breaks` 沒有正確存檔或讀取，懷疑跟上一輪簡單模式/多級距切換的重構有關；(2) 費用清單裡最後一筆項目，畫面顯示已儲存但沒有被算進總額。麻煩先重現這兩個問題、定位原因，抓到根因後再動手修，不要用猜的直接改。

**根因已確認並修復（更新）**：上述兩個症狀其實是同一個根本原因——多級距模式按「+ 新增級距」新增的空白列，如果使用者只填了單價、忘記填 threshold（或反過來），存檔時 `collectRows` 邏輯會**靜默跳過**這種只填一半的列，不會有任何錯誤提示，資料就這樣悄悄不見。這解釋了「最後一筆沒被算進總額」（那筆根本沒存進去）與「多級距金額算錯」（缺了最高階的費率，退回套用次高階）兩個症狀。已修復：第一筆 threshold 鎖定顯示0、每列即時顯示有效範圍、threshold 重複會警告，以及**最重要的**——存檔前若有列只填一半，直接擋下存檔並明確提示是哪個費用項目、哪裡沒填完，不再靜默丟棄。

**衍生的通用原則（適用於全站所有清單型輸入，不限 perKgBreak）**：任何「一列有多個欄位」的清單型輸入（費用清單 FeeLine、級距列表 breaks、貨量單位 cargo.units、perUnit 的 amountByType 等），存檔前都應該驗證每一列的必填欄位是否完整，不完整時要擋下存檔並明確提示是哪一列、缺什麼欄位，**絕不能靜默捨棄不完整的資料**——這次的 bug 之所以難查，就是因為系統完全沒有告訴使用者資料不見了，看起來像存成功了，實際上悄悄少了一筆。建議 Claude Code 順便檢查一下其他清單型輸入的表單，有沒有同樣「靜默丟棄不完整列」的寫法，一併加上驗證與提示，不要只修 perKgBreak 這一處。

---

## 18. 實測回饋修正（第八輪）：取消個別儲存按鈕，改為自動儲存

使用者反映「儲存段落設定」「儲存費用清單」兩顆按鈕功能重疊、每個卡片都有、容易漏按。已在 6.5.4 節加入新規則：取消手動儲存按鈕，改為 blur/選單改變時自動儲存，段落設定與費用清單合併成同一次儲存，畫面用狀態文字（儲存中/已儲存/儲存失敗）取代按鈕，並與第17節的驗證規則銜接（未填完整時不強制報錯，離開該區塊時才提示）。這個模式建議套用到全站所有原本有儲存按鈕的表單，不只 Segment 卡片。

**建議跟 Claude Code 說的下一步**：
> 規格書第6.5.4節是這次重點：取消「儲存段落設定」「儲存費用清單」這種個別的儲存按鈕，改成自動儲存（欄位失去焦點就存，設定跟清單合併成同一次儲存），用「儲存中/已儲存/儲存失敗」的狀態文字取代按鈕。這個模式麻煩套用到全站所有目前還有手動儲存按鈕的地方（案件編輯、代理成本、Lane設定、報價設定、公司抬頭等），不要只改一處。另外要記得跟第17節的驗證規則銜接：欄位還沒填完整時，自動儲存先不要跳出阻斷式錯誤，狀態顯示「有未填完整項目尚未儲存」就好，只有離開該區塊時才需要明確提示。

---

## 19. 總優先順序重整（效率調整，取代之前分散的每輪待辦）

實測跑到第八輪後，發現連續出現「大改動修好A、卻不小心弄壞已經修好的B」的情況（第15節幣別歸屬那次），代表目前「每次只回報單一問題、逐項小範圍修」的節奏，累積下來效率不夠好。這一節把**目前所有還沒完成的項目**，依「使用者的核心目的——節省成本蒐集整理時間、更快把報價送出去」重新排序，取代之前分散在各輪的待辦，之後開發直接照這份順序走，不再逐輪零散安排。

**排序原則**：越能直接縮短「蒐集成本→送出報價」這條路徑所花時間的項目，優先度越高；純體驗優化（好不好看、順不順手）放後面。**（第24節更新：使用者明確表示導覽/迷路問題已經影響日常操作效率，視為與「省時間」同等急迫，priority已調整）**

| 順序 | 項目 | 對應章節 | 為什麼排這裡 |
|---|---|---|---|
| 1 | ~~回歸複查~~（持續進行中的常態工作，不算單一項目） | 第20節 | 每次大改動都要做，不是做一次就結束 |
| 2 | **報價格式切換bug（目前正在查）** | 第22節 | 正在排查中的既有問題，先解決 |
| 3 | **視覺設計系統 + 案件導覽側欄**（色彩/字體規範、收折+固定導覽面板解決迷路問題） | 6.5.1/6.7節（第24節新增） | 使用者明確表示這已經影響日常操作效率、有急迫性，優先度上調 |
| 4 | **AI 智慧匯入**（Email/PDF/Excel/圖片 → 自動判讀分類成本） | 第5節 | 核心目的「節省成本蒐集整理時間」的最大槓桿，仍是還沒開始的核心功能 |
| 5 | **港口/機場自動完成**（含海運內陸站點） | 6.5.2節 | 每一筆成本輸入都要用到 |
| 6 | **案件複製/範本重用**（已確認：目前完全沒有這個功能，需要實際開發，不只是驗證） | 2.1/7節 | 已確認沒做，需要排入開發 |
| 7 | **客戶抬頭資訊 + 報價單完整度** | 2.1/4節 | 報價單要能真正送出去給客戶的必要條件 |
| 8 | **比較分析支援部分段落資料 + 自訂重量情境分析** | 3.1/3.2節 | 提升分析階段的彈性 |
| 9 | **手機/平板響應式** | 6.5.3節 | 這次也提高一些優先度（使用者提到電腦/手機/平板都要方便），但實作上建議在第3項的導覽側欄做完後一起做，因為側欄本身就要考慮手機版的收合行為，兩者放一起做效率較高 |
| 10 | **市場運價指數參考** | 第13節 | 使用者自己也說可以放最後，且資料源現實限制大 |

**建議跟 Claude Code 說的下一步（一次講清楚，取代之前逐輪個別交代）**：
> 規格書第19節優先順序表更新了（見第24節說明），這次把視覺設計+導覽側欄往前提到報價格式bug之後、AI匯入之前，因為這已經影響到我日常操作效率。請按這個順序：先解決報價格式bug；接著做第6.7節的視覺設計系統+第6.5.1節的案件導覽側欄；然後才是第5節AI智慧匯入；後面依序是港口自動完成、案件複製（已確認沒做，需要真的開發）、客戶抬頭、比較分析彈性化、手機響應式（可以跟導覽側欄一起做）、市場運價指數殿後。每個項目做完都照第20節複查。

---

## 20. 回歸複查機制（防止「改A壞B」，取代逐次被動抓 bug）

**目的**：這個對話裡已經發生兩次「大範圍改動時，不小心弄壞之前已經修好的功能」。與其每次都靠使用者肉眼測試才發現，應該建立一個機制讓 Claude Code 自己在每次較大改動後主動複查。

**規則**：
- 只要一次修改牽涉到**兩個以上檔案**、或動到**資料庫欄位**、或觸及**FeeLine/Segment 核心計算邏輯**，視為「大範圍改動」，改完後除了測試這次的新行為，**必須額外重新檢查以下清單**，確認沒有被波及：
  1. 第2.4節：FeeLine 是否仍只有 `currency` 欄位（不含 `fxRate`，v4已移除），換算是否正確透過 `case.rateTable` 查表，而不是又退回 Segment 層級或寫死匯率
  2. 第2.4節：perKgBreak 簡單模式（單一「每KG單價+最低消費」兩欄位）與多級距模式互相切換是否正常
  3. 第17節：清單型輸入（FeeLine清單、breaks級距、cargo.units、amountByType）存檔前是否仍有「未填完整就擋下並提示」的驗證，沒有被繞過
  4. 第6.5.4節：自動儲存機制是否仍正常運作（不需要手動按鈕）
  5. 比較分析頁、報價頁的總額計算，用一個已知正確答案的測試案例重新核對一次數字
  6. 第6.6節：`case.rateTable` 是否正確運作，切換比較/報價/利潤幣別時金額是否正確重算
- **複查方式**：這個環境沒有瀏覽器工具能自動跑，Claude Code 應該用「讀程式碼、對照上述清單逐項確認邏輯是否仍然一致」的方式複查（就像上一輪它自己核對第15節那樣，那次的複查方法是對的），複查完把結果明確列出來（哪幾項確認沒問題、哪幾項不確定需要使用者實測），而不是只回報這次新做的東西
- 使用者這邊配合的部分：往後每次大改動回報時，可以只需要照 Claude Code 列出的「不確定/需要實測」清單去測，不用每次從頭測全部功能，加快雙方的來回速度

---

## 21. 實測回饋修正（第九輪）：幣別架構 v4（取代第15節），代理角色標籤，跨幣別報價/利潤

使用者實測後提出6點，重新設計如下：

1. **成本輸入只填幣別，不填匯率** → 已在 2.4 節移除 FeeLine 的 `fxRate` 欄位，匯率改存在 2.1 節新增的 `Case.rateTable`（案件層級共用一張匯率表，維護一處、全案適用）
2. **比較分析要能選擇比較用的幣別** → 已在第3節加入幣別選擇器，切換後整張比較表用選定幣別重新計算
3. **代理要能標示「出口地代理／進口地代理」，方便比較時分組篩選** → 已在 2.2 節 Agent 加入 `role` 欄位，第3節比較分析頁加入依角色篩選/分組的需求
4. **all-in格式切換後下方結構沒變** → 這是bug，已記錄在第4節，優先修正
5. **報價頁要能依段落切換不同幣別**（因應客戶要求不同段用不同幣別報價）→ 已在 2.1 節加入 `quoteCurrencyBySegment`，第4節加入每段幣別選擇器需求
6. **利潤分析也要能切換幣別** → 已在第4節加入利潤幣別選擇器，跟報價分段幣別是獨立的兩件事，不綁在一起

同時新增 6.6 節，說明 `rateTable` 的管理介面（案件層級的匯率設定區塊，自動偵測案件內用到的幣別、可手動輸入或抓即時匯率）。

**這是資料庫層級的異動**（`fee_lines` 表要移除 `fx_rate` 欄位，新增一張 `rate_table` 相關的表或在 `cases` 表加 jsonb 欄位存匯率表，`agents` 表要加 `role` 欄位，`cases` 表要加 `quote_currency_by_segment` 欄位），需要新的 migration，並且要重新檢查比較分析、報價、利潤三個地方原本讀 `fl.fx_rate` 的計算邏輯，全部改成呼叫 `case.rateTable` 查表換算。

**建議跟 Claude Code 說的下一步**：
> 規格書第21節是這次的重點，幣別架構升級到 v4，取代第15節的設計：FeeLine 移除 fxRate，改成案件層級共用一張 rateTable（2.1/6.6節），比較分析（第3節）、報價（第4節）、利潤都要能各自選擇顯示幣別，透過 rateTable 換算。同時 Agent 加了 role 欄位（出口/進口代理標籤，2.2節），用於比較分析頁篩選分組。另外第4節記錄了一個bug：all-in格式切換後下方結構沒變，麻煩優先修。這是資料庫層級異動，需要新的migration，並且要照第20節的方式做完整的回歸複查（這次改動會牽涉到 pricing.js、comparison.js、quote.js 全部要重新串接新的幣別換算方式，範圍不小，做完務必依第20節清單自我複查，尤其是核對金額計算是否正確）。

---

## 22. 實測回饋修正（第十輪）：手動賣價模式要依報價格式切換輸入框數量、空運每KG賣價顯示

幣別v4確認正常後，實測報價頁面發現：

1. **all-in格式的bug依然存在**：選了「All-in(單一總價)」+「手動輸入賣價」，畫面還是列出出口/國際/進口三段各自的輸入框（見截圖：450/280/270三個框），沒有變成單一總價輸入框。第4節已經把手動賣價模式的規則寫得更明確：`allin`格式時手動賣價**只能有一個輸入框**，`segment`/`items`格式才維持三段各自輸入，並建議了對應的資料結構 `Case.manualSellPrice {allin, bySegment}`，兩組數值分開存、不互相覆蓋。
2. **空運沒有每KG賣價的輔助顯示**：已在第4節加入需求，`case.mode==='air'`時，任何呈現的賣價總額旁邊都要附註換算後的「每KG單價」（金額÷計費重量），海運不適用（海運業界慣用每櫃計價）。

**建議跟 Claude Code 說的下一步**：
> all-in格式的bug我這次把規則寫得更明確了（規格書第4節），這次麻煩務必修好並自己實測確認：選all-in格式+手動輸入賣價，畫面必須只有一個輸入框，不是三段分開的輸入框；切回segment/items格式，才恢復三段各自輸入，且兩種格式下打過的數字要分開記住、不要互相覆蓋。另外新增一個需求：空運模式下，賣價總額旁邊要附註換算成每KG的單價（金額÷計費重量），方便業務快速比較，海運不用加這個。這兩項改完，一樣照第20節做完整回歸複查。

---

## 23. 實測回饋修正（第十一輪）：支援部分段落有資料的工作流程、自訂重量情境分析

使用者反映：實務上不會三段成本同時到齊，常常先拿到某一段（如進口地）報價就想先分析，目前系統卡在「一定要三段都選定才能往下走」，不符合實際節奏。已在第3節新增 3.1、3.2 兩個小節：

1. **報價頁不應該被「三段都要選定」卡住**：只要至少一段有資料就能進報價分頁，未選定的段落顯示「尚未選定」、金額算0、不計入總價，不強制擋住整個功能
2. **比較分析頁要能只看/只匯出單一段落**：提供篩選（只看出口段/國際段/進口段/全部），Excel匯出也要能只匯出篩選出來的段落
3. **自訂重量情境分析（What-if）**：針對用perKgBreak計價的段落，讓使用者自訂輸入一組情境重量（如100/300/500/1000kg），系統跑出「情境重量×代理/Lane」的對照表，純粹分析用途，不影響案件實際的 `cargo.chargeableWeightKg`，兩者分開

**建議跟 Claude Code 說的下一步**：
> 規格書第3節新增3.1、3.2兩節。3.1是重要的工作流程調整：報價頁不應該要求三段都選定才能進入，未選定的段落顯示「尚未選定」、金額算0即可；比較分析頁要能篩選只看/只匯出單一段落。3.2是新功能：針對perKgBreak計價的段落，提供一個「自訂情境重量」輸入區，讓使用者輸入多個假設重量，跑出對照表比較不同重量下的成本，這個純粹是分析工具，不能影響案件實際的計費重量與報價金額。麻煩排在目前正在處理的報價格式bug之後，一起做完再照第20節複查。

---

## 24. 實測回饋修正（第十二輪）：確認案件複製未開發、UI/UX優先度上調、視覺設計系統、案件導覽側欄

兩件事：

1. **案件複製功能確認未開發**：使用者確認案件列表/明細頁找不到任何複製案件的按鈕或入口，第19節優先順序表已把這項從「先驗證」改成「已確認未做，需要開發」。
2. **UI/UX優先度上調**：使用者明確表示「捲動迷路」（不知道自己在編輯哪個代理、哪一段）已經影響日常操作效率，視為急迫項目，不只是體驗優化。新增兩塊具體規劃：
   - **6.5.1節升級**：原本的「收折+sticky麵包屑」不夠，新增「案件導覽側欄」——固定顯示的案件結構樹（代理→段落→Lane），點擊可跳轉，並隨捲動位置自動高亮目前所在項目，桌機用固定側欄、手機/平板用可收合的抽屜選單
   - **6.7節（新增）**：具體的視覺設計系統，包含色彩/字體/圓角陰影的CSS變數規範，取代目前的瀏覽器預設樣式，要求全站統一套用同一套變數
   - 第19節優先順序表整個重排，這兩項移到報價格式bug之後、AI智慧匯入之前

**建議跟 Claude Code 說的下一步**：
> 規格書第19節優先順序表重排了（第24節說明原因），案件複製已確認沒做、需要排入開發。這次UI/UX往前提了：報價格式bug處理完之後，接著做6.7節的視覺設計系統（先套用色彩/字體變數，讓全站看起來一致）+ 6.5.1節升級版的案件導覽側欄（固定結構樹側欄，可跳轉、隨捲動自動高亮，桌機/手機版都要考慮），這兩項做完後才繼續AI智慧匯入。麻煩這次做完視覺+導覽側欄後，主動截圖或描述一下實際呈現效果給我確認方向對不對，不要做完才發現方向理解錯了要整個重做。

---

## 25. 實測回饋修正（第十三輪）：港口自動完成是「全站規則」，不是逐一補漏的清單

使用者明確表示：所有牽涉到輸入出口/進口港口的欄位都要做，不是只有成本輸入那一處。已在6.5.2節把這件事訂成明確的全站規則，並多找出一個原本沒設計到的觸點——**Lane 也應該有結構化的 `fromPort`/`toPort` 欄位**（2.5節新增），跟 `routing` 那個自由文字的完整路線描述分開，起訖點本身仍要能用下拉建議快速填入。

目前已知需要套用自動完成的三個觸點：Segment.fromLocation/toLocation（已完成）、Case.origin/destination（缺漏）、Lane.fromPort/toPort（缺漏，新欄位）。規格書特別強調：**這是一條全站規則，之後任何新欄位只要代表「一個港口/機場/地點」都要主動套用，不用等使用者測出來才補**。

**建議跟 Claude Code 說的下一步**：
> 規格書6.5.2節把港口自動完成訂成全站規則了，另外2.5節的Lane新增了`fromPort`/`toPort`結構化欄位（原本只有自由文字的routing，現在起訖點要能像Segment一樣用下拉建議填），這個如果需要資料庫migration記得一併處理。這條規則以後開發新功能時麻煩主動檢查，不用每次都等我測出來才發現漏掉。這幾項排進第19節第5項「港口自動完成」一起做，一次做完三個觸點（Segment、Case、Lane），不要又漏一個。

---

## 26. 實測回饋修正（第十四輪）：常用費用名稱等欄位的建議清單

使用者提出：所有需要手動輸入成本項目的欄位，是不是都能有基礎參考清單協助輸入。已在6.5.5節盤點：

- **適合做**：FeeLine.name（依段落分類的常見貨運費用名稱庫，如THC/報關費/EDI/Ocean Freight/Demurrage等）、cargo.units.type（20GP/40GP/PLT等）、Lane.carrier（常見承運人代號，但這類資料沒有像機場港口那樣完整的免費公開清單，主要靠使用者常用清單自然累積）
- **不適合做**：Agent.name、Case.name、letterhead、customerInfo——這些是使用者自己的專屬商業資料，不是通用詞彙，不套用建議清單

跟港口自動完成一樣的模式：內建基礎清單 + 允許自由輸入 + 使用者自訂項目累積成常用清單。

**建議跟 Claude Code 說的下一步**：
> 規格書6.5.5節新增常用費用名稱等欄位的建議清單需求，模式跟港口自動完成一樣（基礎清單+自由輸入+使用者常用清單累積），適用範圍是FeeLine.name、cargo.units.type、Lane.carrier這三處，Agent.name等專屬資料欄位不要套用。這個可以跟第19節第5項的港口自動完成放在同一批做，因為是同一類型的UI元件、同樣的實作模式，一次做完比較有效率。

---

## 27. 實測回饋修正（第十五輪）：混合計價基礎加總bug + 三種成本呈現模式（分項/混合換算/純小計）

### 27.1 Bug回報（優先修，會動搖核心可信度，需優先於新功能處理）— v2 修正，取代原本不準確的描述

> 這一節原本的描述是早期草稿（誤把「ATE」當成費用項目名稱、且把同一個症狀誤拆成兩個獨立bug），已用實際截圖證據修正如下。

**確認的症狀（單一問題，非兩個獨立bug）**：代理 **ATE**（`role = export`，出口地代理）在比較分析頁，出口段與國際段的 Subtotal/Total **全部顯示 0.00**，但實際輸入的資料如下（案件 `SEA-HPHCAL-260805-2`）：
- 出口段：THC（`basis=perUnit`，20'GP=280 USD、40'HQ=300 USD）、DOC（`basis=perShipment`，90 USD）、Handling charge（`basis=perShipment`，20 USD）
- 國際段：POL=Haiphong、POD=Calgary，OF（`basis=perUnit`，20'GP=3300 USD、40'HQ=4200 USD）

這些金額都不是0，但比較分析頁全部顯示0，且畫面上沒有出現「缺匯率」之類的警示。

**已排除的假設**：`filterAgentsByRole()` 只會整筆排除/保留代理，不會讓某代理留在畫面上但金額歸零，這段邏輯本身沒問題。

**目前最可能的根因（已提出，待使用者確認資料後才能定案）**：
- `perUnit` 費用的 `getUnitQty()` 用完全字串比對 `type` 欄位對應 `cargo.units[].type`，若 FeeLine 裡打的是 `20'GP`（帶單引號）但 `cargo.units` 存的是 `20GP`（不帶），比對不到，金額算成0
- `perShipment` 費用直接乘 `cargo.shipmentQty`，若這個案件的貨量資訊沒有填票數/BL數，`shipmentQty` 為0或undefined，金額也會算成0
- 這兩點加總起來，剛好能解釋 ATE 這四筆費用全部變成0——**這是同一個根因的兩種呈現，不是兩個獨立bug**

**待使用者確認（畫面檢查，不用寫程式）**：
1. 案件 `SEA-HPHCAL-260805-2` 的「貨量資訊」卡片，`shipmentQty`（票數/BL數）欄位是否有填數字
2. 同一張卡片的 `cargo.units` 裡，type 打法（`20GP` 還是 `20'GP`）是否跟 ATE 的 FeeLine 裡「單位類型」欄位打法一致

**除了修bug本身，一併要做的結構性修正（v2修正，取代原本錯誤的警示邏輯）**：

> 實測後發現原本的警示邏輯方向錯了。代理報的成本本質上是一份「費率表」（Rate Card），不是這批貨專屬的帳單——代理可能同時報了20GP/40GP/40HQ的價格，但這批貨可能只用到其中一種，其餘的只是暫時用不到的費率，**不是輸入錯誤，不該被當成警示**，這樣的警示反而會讓使用者誤以為自己打錯字。

- `perUnit` 費用的「單位類型」欄位改成下拉選單，選項來源是 6.5.5 節的「貨櫃類型標準參考」**完整清單**，**不要限制只能選這個案件 `cargo.units` 裡已經填過的類型**——代理的費率表本來就可能涵蓋比這批貨更多的類型，這是正常情況，讓使用者能自由選擇任何標準貨櫃類型輸入費率
- **警示邏輯方向修正**：
  - ❌ 不要警示：某筆 FeeLine 報了「這批貨的 `cargo.units` 裡沒有」的類型 → 這是正常的多餘費率，安靜地不計入總額即可，不用任何警示樣式
  - ✅ 應該警示：`cargo.units` 裡「有登記數量」的類型，但**這個代理名下所有 FeeLine 都沒有提供該類型的報價** → 這代表這家代理沒辦法給這批貨的完整報價，警示應該顯示在**該代理該段落的小計旁邊**（例如「⚠ 此代理未提供 40HQ 的報價，無法計算完整成本」），不是掛在單一 FeeLine 上
  - **新增第三種情況（第39節，實測發現的嚴重bug）：使用者用 `perUnit` 硬塞一個自創的非標準類型（如「Shipment」代表一趟整車運費），本意是這筆錢要算，但因為這個類型不在 `cargo.units` 裡，被前兩條規則誤判成「多餘費率」安靜算成0元、完全沒有任何提示，導致真實成本消失且難以察覺（實測發現一筆USD 2500的卡車費因此漏算）。修正方式：
    - **`perUnit` 類型欄位若輸入的不是 6.5.5 節「貨櫃類型標準參考」裡的標準代碼**（判定為自訂/非標準類型），該筆費用列旁邊要顯示一個**持續可見、但不是警示色的中性提示文字**（例如灰色小字「ℹ️ 貨量資訊未登記此類型，此列目前不計入金額」），不用等使用者跑去比較分析頁核對才發現，輸入當下就要看得到
    - 這個提示文字建議再加一句引導：「若這是固定費用（如整趟運費），建議改用 flat 固定金額或 perShipment 每票計價，避免漏算」，幫助使用者判斷是不是選錯了計價基礎
    - 這條規則同樣適用於標準類型但這批貨沒有的情況（例如代理報了20GP但這批貨只有40HQ）——差別在於：標準類型的提示可以更輕描淡寫（純粹告知「這批貨沒用到」），非標準/自訂類型的提示則要多加一句「考慮換計價基礎」的引導，因為自訂類型比標準類型更可能是使用者選錯了
- 兩處的貨櫃類型輸入都要套用 6.5.5 節的「貨櫃類型標準參考」，統一用不帶`'`符號的標準代碼（如 `20GP`、`40HQ`）當內部比對值
- **修正既有資料，不是只處理新輸入**：正規化邏輯（`normalizeContainerType()`）必須連同**已經存在資料庫裡的舊資料**一起重新正規化過一次（透過 migration 或一次性批次更新腳本），不能只套用在「之後新輸入」的資料上——這是實測發現 ATE 的 40'HQ 即使使用者已經正確填入對應貨量，金額依然是0的可能原因：正規化只套用在新存檔的資料，沒有回頭處理舊資料
- 這個修正原則呼應第17節「不完整/對不上的資料不該被靜默吞掉」，但這次要更精確地區分「多餘費率」（正常，不警示）跟「真正缺報價」（異常，要警示）兩種情況，不能一律當成同一種問題處理

### 27.2 核心計算原則修正：「算出來是0」跟「資料不完整無法算」必須清楚區分（比字串比對修正更根本）

使用者在確認 shipmentQty 沒填之後，明確指出一個更根本的問題：**系統不應該讓「缺少必要的貨量資訊」跟「這筆費用真的是0元」看起來一樣**。目前的計算邏輯（`perShipment` 沒填 `shipmentQty` 就乘出0、`perUnit` 找不到對應單位類型就當作數量0）會讓使用者以為是「算對了、剛好是0」，實際上是「資料不完整、根本沒辦法算」，這兩種情況必須讓使用者能一眼分辨。

**規則（適用所有 basis，這是計算引擎層級的原則，不是個別bug修法）：**
- `perShipment`：若 `cargo.shipmentQty` 為 `null`/`undefined`/`0`，這筆費用不應該直接算成金額0，而要標記成**「⚠ 缺票數/BL數，無法計算」**
- `perKg` / `perKgBreak`：若 `cargo.chargeableWeightKg` 為 `null`/`undefined`/`0`，標記**「⚠ 缺計費重量，無法計算」**
- `perCBM`：若 `cargo.volumeCBM` 為 `null`/`undefined`/`0`，標記**「⚠ 缺材積CBM，無法計算」**
- `perUnit`：警示方向修正（見27.1節v2修正）——若某筆 FeeLine 的 `amountByType` 裡有一筆 `type` 是這批貨 `cargo.units` 沒有的類型，**不警示**，安靜視為0（多餘費率，正常情況）；反過來，若 `cargo.units` 裡某個類型有登記數量，但該代理名下**所有** FeeLine 都沒有提供這個類型的報價，才標記**「⚠ 此代理未提供[該類型]的報價，無法計算完整成本」**，掛在該代理該段落的小計旁邊
- 這些標記要在 **Segment 卡片、比較分析頁、報價頁** 都清楚呈現（樣式比照既有的「缺匯率」警示），且該 FeeLine 不計入 Subtotal/Total 的金額加總，改成在總額旁標示「（含N筆無法計算的項目，請補齊貨量資訊）」，避免使用者誤信一個看起來正常、實際上被少算的總數字
- 這個原則同時解釋了這次的 ATE 案例：出口段的 DOC、Handling charge（perShipment）本來就該因為缺 shipmentQty 被標記警示，而不是安靜地算成0元、讓整段 Subtotal 看起來「正常存在但剛好是0」

### 27.3 新功能：三種成本呈現模式（分項列示／混合換算成單一單位／純小計）

已在 3.3 節新增，讓比較分析頁依運輸模式提供不同呈現方式：
- 海運FCL：可混合換算成「每櫃」成本（÷總櫃數）
- 空運：可混合換算成「每KG」成本（÷計費重量），並能結合3.2節的情境重量，呈現「情境重量×混合每KG成本」對照表
- 海運LCL：新增 `cargo.volumeCBM`（總材積）與 FeeLine 的 `perCBM` 計價基礎（2.1/2.4節），可混合換算成「每CBM」成本
- 三種模式（分項/混合換算/純小計）使用者可自由切換，純粹是顯示層級選項，不影響報價頁面實際金額

**建議跟 Claude Code 說的下一步**：
> 規格書第27節已經修正並擴充了。**第27.1節是修正後的bug描述**（ATE代理三段全部顯示0.00，已確認是同一個症狀不是兩個獨立bug，且已排除代理角色篩選這個假設）；**第27.2節是這次真正的核心修正**——「算出來是0」跟「資料不完整無法算」必須明確區分，perShipment缺shipmentQty、perUnit找不到對應貨量單位時，都不該靜默算成0，要標記警示；同時 6.5.5 節新增了準確的貨櫃類型標準參考（`'`符號是英尺、GP=DC同義），要求內部統一用標準代碼比對。麻煩照第20節方式，優先處理27.1+27.2（這兩個是同一組修正，建議一起做），確認沒問題後再做27.3節/3.3節的三種成本呈現模式新功能（含新增cargo.volumeCBM欄位、FeeLine的perCBM計價基礎，需要對應的migration）。

---

## 28. 實測回饋修正（第十六輪）：警示邏輯方向錯誤、舊資料未正規化、What-if加每單位成本、設計哲學

實測上一輪的修正後，發現原本的方向有誤，並提出更根本的設計哲學，整理如下：

1. **警示邏輯方向錯了（27.1節v2修正）**：代理報的成本是「費率表」不是「這批貨專屬帳單」，代理報了這批貨用不到的貨櫃類型是正常現象，不該警示；真正該警示的是反過來——這批貨有的類型，卻沒有代理報價。已修正 perUnit 下拉選單改抓完整標準參考清單（不限縮成 `cargo.units` 裡的類型），警示改成掛在代理段落小計，不是掛在單筆 FeeLine
2. **ATE的40'HQ仍顯示0，懷疑是舊資料未正規化**：上一輪的 `normalizeContainerType()` 可能只套用在新輸入，沒有回頭處理已存在資料庫的舊資料，需要額外的一次性批次正規化（或包進migration）
3. **What-if情境分析要加「每單位成本」**：3.2節每個情境重量現在要同時顯示總成本與換算後的每KG單價（3.2+3.3概念結合）
4. **新增0.1節「核心設計哲學」**：把使用者這次的meta-feedback（費率表vs帳單、能選不要打字、海空運各自不同整理邏輯）提煉成三條原則，放在規格書最前面，要求之後任何新功能/修法都要先對照這個原則，不要再發生「修好bug但方向不對」的情況
5. **上一輪回報「已完成」的空運direct/calculated模式，實測找不到**，需要它重新檢查為什麼沒有實際渲染出來（regression，不是新需求）

**建議跟 Claude Code 說的下一步**：
> 規格書大幅修正，最重要的是新增的0.1節「核心設計哲學」，麻煩先讀這節，之後任何設計決定都要先對照這三條原則。具體改動：
> 1. 27.1節v2：警示邏輯方向修正（代理費率表有這批貨用不到的類型是正常、不警示；這批貨有的類型卻沒代理報價才警示，且警示要掛在代理段落小計，不是單筆FeeLine），perUnit下拉選單改抓完整標準參考清單，不要限縮成只有cargo.units裡的類型
> 2. 修正既有資料：懷疑ATE的40'HQ持續顯示0是因為正規化只套用在新輸入，沒有處理舊資料，麻煩檢查並補一次性批次正規化
> 3. 3.2節What-if情境分析要加上每個情境重量的「換算每KG單價」，不是只有總成本
> 4. 重新檢查空運direct/calculated模式為什麼實測找不到，這是regression
>
> 這四項改完，麻煩再次用ATE案例(SEA-HPHCAL-260805-2)完整驗證，這個案例已經來回好幾輪了，這次要真正解決，不要再有下一輪。

---

## 29. 補齊先前擱置的需求：Project案件類型、Bidding混合報價、Pivot Weight、船期/航班資訊

這幾項是使用者較早提出、但因為後續bug排查一路岔開而延遲補齊的規格，這次一次補完。

### 29.1 三種詢價情境的差異，新增 Project 案件類型

- **Spot Inquiry**：客戶給非常具體的單一貨量規格，只需要算出這批貨的實際成本，`quoteType='inquiry'`，現有設計已涵蓋
- **Tender/月標**：客戶給約略月量範圍，`quoteType='tender'`，第9.1節已涵蓋議價輪次/有效期間
- **Project（新增）**：客戶的出貨規格多元複雜——可能同時要比較空運跟海運、或同一批貨有不同尺寸/性質的貨物（一般貨+超大超重貨）需要分開處理。`quoteType='project'` 時，案件底下可以建立多個**情境（Scenario）**，每個情境各自是一組完整的 mode+cargo+代理成本+比較+報價，共用同一個案件的客戶/Incoterm等上層資訊：

```
Case.scenarios: [Scenario]   // 僅 quoteType === 'project' 時使用；inquiry/tender 案件視為只有一個隱含的預設情境，沿用現有結構不變

Scenario {
  id, label          // 使用者自訂標籤，如「空運-一般貨」「空運-超大尺寸(Pivot Weight)」「海運-標準櫃」「海運-超重貨(開頂櫃)」
  mode                // 這個情境自己的運輸模式，可以跟案件內其他情境不同（例如同案件下同時有air跟sea_fcl兩個情境，用於比較時間成本權衡）
  cargo               // 這個情境自己的貨量資訊
  agents: [Agent]
  selection, markup, quoteFormat, quoteCurrencyBySegment  // 同案件層級結構，但scoped在這個情境內
}
```

- **介面設計要求（呼應使用者「容易閱讀理解且不顯得混亂」的要求）**：
  - 案件明細頁在 `quoteType='project'` 時，最上層改用**情境分頁/標籤**呈現（比照6.5.1節案件導覽側欄的邏輯，情境是比代理更高一層的分組），使用者在情境之間切換，每個情境內部維持原本代理成本/比較分析/報價三分頁的結構不變
  - 額外提供一個**「情境總覽」**畫面：把所有情境的關鍵數字（總成本、運輸時間、報價總額）並列成一張簡表，方便使用者做「空運快但貴、海運慢但便宜」這類時間與成本的權衡比較，不用切來切去才能比較
  - 報價單也要能選擇「只出某個情境」或「把多個情境合併成一份報價單，各情境分開列示」兩種輸出方式

### 29.2 Bidding的混合報價，呼應3.3節「混合換算成單一單位」

使用者說明月標實務：海運通常給客戶「每櫃all-in價格」（把per container、per BL、per shipment的成本全部混合換算），也可能要求拆成三段列示；空運通常給「all-in每KG價格」，也可能要求拆三段各自的每KG價格，或把per BL/per shipment的固定費用獨立列出。

- 這正好完全對應第3.3節已經設計的「分項列示／混合換算成單一單位／純小計」三種呈現模式——**這個功能的存在意義，很大一部分就是為了服務Bidding案件的報價需求**，兩者要確保串接一致：報價頁的格式選項應該也能沿用同一套「混合換算」邏輯，不是比較分析頁跟報價頁各自兩套呈現邏輯
- `cargo.units[].qty`（單一代表數量，通常設1）用來算出「每櫃」的混合費率本身；`qtyMin/qtyMax`（2.1節新增）記錄客戶給的約略月量範圍，純資訊用途，不參與費率計算——月標的報價通常是「不管你這個月出幾櫃，每櫃都是這個價錢」，不是「總金額隨月量變動」

### 29.3 Pivot Weight：沿用既有 perKgBreak 結構，不需要新欄位

> 已查證業界定義：Pivot Weight 是航空公司對 ULD（單位裝載容器）設定的最低計費重量門檻——低於門檻用「under-pivot rate」（較高的每公斤費率）計價、且無論實際重量多輕都至少要付到「pivot重量 × under-pivot費率」這個保底金額；超過門檻的部分用「over-pivot rate」（較低的每公斤費率）計價。這個結構本質上跟本系統既有的 `perKgBreak`（min charge + 級距費率表）完全相同，不需要另外設計新的資料欄位或計算邏輯。

- 使用方式：`minCharge` = pivot重量 × under-pivot費率；`breaks` 設兩筆：`{thresholdKg: 0, ratePerKg: under-pivot費率}` 與 `{thresholdKg: pivot重量, ratePerKg: over-pivot費率}`
- 建議在 FeeLine 的 `remark` 欄位註明「Pivot Weight: Xkg」方便日後辨識，或者在 6.5.5 節的常見費用名稱建議清單中，空運國際段的「空運費」項目下方加註提示文字，告知使用者若代理報價是Pivot Weight結構，可以用這個方式輸入，不需要額外UI

### 29.4 海運/空運船期附加資訊

已在 2.5 節 Lane 模型補上：
- 海運：船名/航次、SI/VGM/CY截止時間、ETD/ETA
- 空運：每週班次（格式如業界慣例 `D1234567`／`Daily`／`D135`）
- 兩者共用：是否直航/直飛（`isDirect`）、轉運/轉機站點清單（`transshipPoints`）

這些欄位屬於參考/附註資訊，不參與成本計算，但可選擇性顯示在報價單上（尤其Project、Tender案件常需要附帶這些資訊供客戶評估）。

**建議跟 Claude Code 說的下一步（這批排在27節bug修正之後）**：
> 規格書第29節補齊了之前擱置的需求：quoteType新增'project'（案件可包含多個情境Scenario並列比較，含UI設計要求：情境分頁+情境總覽）、cargo.units新增qtyMin/qtyMax給Bidding用、確認Pivot Weight可以直接用既有的perKgBreak結構表達不需要新欄位、Lane新增船期資訊(船名航次/SI-VGM-CY截止/ETD-ETA/週班次/直航與否)。這批工作量不小，尤其Project的多情境結構是比較大的功能，麻煩排在27節的ATE bug修正之後再開始，不要打斷目前的bug排查。

---

## 30. 費用項目參考資料庫擴充（使用者提供完整中英對照表，已篩選優化）

使用者提供一份完整的國際貿易物流成本項目中英對照表（出口/國際運輸[空/海/鐵路/多式聯運]/進口），已篩選、優化、整合進規格書，不是照單全收：

- **6.5.5節費用名稱參考表全面改寫**：改用業界慣用縮寫（THC、O/F、BAF、CAF、PSS、LSS、ETS、D/O、FSC、SSC、MTD、MTO等），新增「通用」表（不分模式的出口/進口段常見項目：報關費、文件費、驗貨費、產證費、保險費、押匯手續費、保證金手續費等），並新增鐵路、多式聯運兩個模式的費用表（先前只有海運/空運）
- **新增三種計價基礎**（2.4節）：`perCBMPerDay`（材積×天數，如LCL/多式聯運倉儲費）、`percentValue`（申報價值百分比，如保險費、押匯手續費）、`perKm`（距離計價，如內陸配送）
- **cargo模型新增**（2.1節）：`declaredValue`+`declaredValueCurrency`（申報價值，供percentValue使用）、`distanceKm`（配送距離，供perKm使用）
- **刻意排除**：進口關稅（Import Duty）、加值稅/營業稅（VAT/GST）不列入費用名稱庫——這是進口商對海關的稅務義務，不是貨運代理報價的常規範疇，避免模糊系統定位；若之後有DDP稅金估算需求，建議另外討論設計方式

**建議跟 Claude Code 說的下一步（排在27節bug修正、29節新功能之後）**：
> 規格書第30節擴充了費用名稱參考庫（改用業界縮寫、新增通用/鐵路/多式聯運表），並新增三種計價基礎(perCBMPerDay/percentValue/perKm)與對應的cargo欄位(declaredValue/distanceKm)。這批屬於資料庫層級異動，需要migration。排在27節bug修正、29節Project/船期資訊之後處理，優先順序最低，不急著做。

---

## 31. 視覺設計系統定案：色塊分區加強、移除刺眼強調色

使用者看過視覺預覽（桌機/平板/手機三種尺寸的模擬畫面）後確認方向，6.7節已更新為**定案版本**：

1. **強調色從 `#0f9b8e` 改成更深的 `#0b7d6f`**，且訂為強制規則：強調色只能用在背景色塊/圖示/邊框，不可以直接當文字顏色，避免小字體白底情境下顯得刺眼
2. **新增三段專屬區塊色**：出口段（薄荷綠 `#eaf6f4`）、國際運輸段（淡藍紫 `#eef1fb`）、進口段（淡杏色 `#fdf3e6`），三段的表單區塊套用對應淡色背景+邊框線色，讓使用者光看色塊背景就能分辨目前在哪個工作區
3. **側欄改用深色底**（`--color-primary-dark`），跟白色主內容區形成強對比，強化「導覽區 vs 工作區」的視覺區隔
4. **最低價/成功狀態改用色塊徽章樣式**（淡綠底+深綠文字），取代原本的純彩色文字呈現方式

**建議跟 Claude Code 說的下一步**：
> 規格書6.7節的視覺設計系統已經是定案版本了（v2），取代原本第一版色票，重點修正：強調色改深且只能用於色塊/邊框不可當文字色、新增出口/國際/進口三段專屬區塊背景色、側欄改深色底強化分區、最低價等狀態改用色塊徽章而非彩色文字。這批排進第19節優先順序的視覺設計系統實作項目，照原訂順序處理即可。

---

## 32. 實測回饋修正（第十七輪）：items格式逐筆幣別報價、代理角色與「套用最低成本組合」的邏輯修正

Project功能測完後，使用者檢查報價頁跟比較分析頁，提出兩點：

1. **items格式手動賣價要細到每筆FeeLine，且各自可選幣別**：已在第4節新增 `Case.manualSellPrice.byItem`，逐筆顯示原幣別金額，段落小計則透過`rateTable`換算成統一幣別呈現並標註「已換算」，兩者並存不衝突
2. **「套用最低成本組合」誤把「不適用」當「最低成本」**：出口地代理的進口段（或反之）顯示0.00，不是免費而是這個代理結構性不承接該段業務。已修正第3節：比較表對於`role`不涵蓋的段落改顯示「－不適用」而非「0.00」，「選用」按鈕停用，且「套用最低成本組合」邏輯只在`role`涵蓋該段的代理中比較最低價

**建議跟 Claude Code 說的下一步**：
> 規格書第4節新增了items格式下逐筆FeeLine手動賣價+各自幣別的功能（`manualSellPrice.byItem`，段落小計透過rateTable換算統一幣別並標註），第3節修正了「套用最低成本組合」的邏輯錯誤——代理`role`不涵蓋的段落要顯示「－不適用」不是「0.00」，選用按鈕要停用，且套用最低成本組合時只能在role涵蓋該段的代理裡比較，不能把不適用的0.00誤判成最低成本。這批建議排在目前第19節優先順序合適的位置，做完照第20節複查，尤其要確認ATE等既有案例的比較分析結果沒有被這次的role過濾邏輯意外影響。

---

## 33. 實測回饋修正（第十八輪）：items格式perUnit賣價要拆到貨櫃類型層級

使用者實測第32節做出來的「逐筆選幣別」功能後，發現 `perUnit` 這類同時涵蓋多種貨櫃類型的費用（如THC同時有20GP/40HQ兩種單價），賣價輸入卻是一個跟類型脫勾的單一空白框，沒辦法針對「這批貨實際用到的類型」去輸入賣價。已修正第4節：

1. `byItem[feeLineId].byType: [{type, amount, currency}]` 取代單一 `amount/currency`，用於 `perUnit`/`perUnitPerDay` 的費用
2. **只列出 `cargo.units` 裡實際有數量（qty>0）的類型**，這批貨用不到的類型（如這次範例的20GP，數量是0）不出現在賣價輸入區——呼應0.1節「費率表 vs 這批貨帳單」原則，成本端可以看到代理的完整費率表，報價端只處理真的會用到的部分
3. Basis顯示文字具體化：不顯示生硬的「perUnit」代號，改顯示「每40'HQ」這種具體單位描述，貨櫃類型用6.5.5節的人類可讀格式呈現（內部比對值仍是不帶符號的標準代碼）

**建議跟 Claude Code 說的下一步**：
> 規格書第4節再次修正：items格式下，perUnit/perUnitPerDay的費用，賣價輸入要拆成跟成本端`amountByType`一樣的「一個貨櫃類型一個輸入列」結構（`byItem[feeLineId].byType`），而且只列出這批貨cargo.units裡實際有數量(qty>0)的類型，不相關的類型（如這批貨沒有的20GP）不要出現在賣價輸入區。同時Basis欄位不要顯示「perUnit」這種代號，改顯示具體的「每40'HQ」這類描述。麻煩檢查一下第32節那次的實作是不是漏了這個情況，一併修正。

---

## 34. 成本輸入端同步優化：perUnit/perUnitPerDay 加速輸入與相關性標示

第33節修正了報價端「只顯示這批貨相關的類型」後，回頭檢視成本輸入端也有同樣可以加速的地方（使用者主動提出的延伸問題）。已在6.5.5節新增：

1. **「自動加入本案貨量單位」快速按鈕**：讀取 `cargo.units` 裡有數量的類型，自動生成空白費率列，不用每次手動從下拉選單一個個加
2. **「本批貨適用」視覺標籤**：對應到 `cargo.units` 有數量的類型加淡色標籤，跟代理費率表裡其他額外類型（這批貨用不到，但代理有報）視覺區分，純粹輔助辨識、不是警示
3. 兩者都不限制使用者仍可手動新增任何標準類型的費率列，維持代理費率表的完整彈性

這讓成本輸入端跟報價端在「哪些類型跟這批貨有關」這件事上，體驗前後一致。

**建議跟 Claude Code 說的下一步**：
> 規格書6.5.5節新增了perUnit/perUnitPerDay成本輸入端的加速功能：「自動加入本案貨量單位」快速按鈕（讀取cargo.units有數量的類型自動生成空白費率列）+「本批貨適用」視覺標籤（區分跟這批貨有關/無關的類型，不是警示）。這個排在跟第33節同一批做，因為修的是同一個UI元件的一體兩面（成本輸入+報價輸入）。

---

## 35. 貨櫃類型擴充（危險品櫃/罐櫃）+ 貨櫃規格彈出視窗

使用者提供完整的貨櫃規格對照表，已整合：

1. **6.5.5節貨櫃類型標準參考擴充**：新增 `20DG`/`40DG`（危險品櫃）、`20ISOTANK`/`40ISOTANK`（罐式貨櫃），並補上每個類型的外徑/內徑尺寸、最大負載、容積完整規格資料
2. **新增貨櫃規格彈出視窗**：在「貨量資訊」的貨櫃類型欄位、以及成本/報價的`perUnit`類型欄位旁各加一個「ⓘ」圖示，點擊彈出對應類型的規格卡片，平常不佔版面。規格資料存成靜態JSON參考檔（比照機場/港口資料的處理方式），並註明「僅供參考，實際以櫃門標示為準」
3. `OT`/`PLT`/`CTN` 這類目前沒有完整規格資料的類型，彈出視窗顯示「暫無詳細規格資料」，不留空白/報錯

**建議跟 Claude Code 說的下一步**：
> 規格書6.5.5節擴充了貨櫃類型參考表（新增DG危險品櫃、ISO罐櫃，並補上完整規格數據），新增「貨櫃規格彈出視窗」功能，在貨量資訊跟成本/報價的貨櫃類型欄位旁各加ⓘ圖示可點擊查看規格卡片。規格資料建議存成靜態JSON參考檔，不需要外部API。這個可以跟第25節的港口/機場自動完成排在同一批做，都是屬於「靜態參考資料+查詢UI」的同類型工作。

---

## 36. 三項新增規劃：首頁Dashboard、市場行情參考顯示位置、AI匯入精靈入口

使用者提出三項規劃：

1. **首頁Dashboard**：已新增第7.5節，登入後第一個畫面改成Dashboard，內含待處理事項（27.2節警示案件、9.1節即將到期的月標案件）、快速統計、最近案件、快速建立案件、市場行情參考小工具。這跟案件內導覽側欄（6.5.1節）是不同層級、互補的兩種導覽，不是取代關係
2. **市場行情參考顯示位置**：已在新增的第7.6節確定放兩處——Dashboard首頁的小工具區塊，以及案件明細頁的可收合參考面板（成本/報價輸入時可展開比對）。兩處共用同一份資料，資料來源維持第13節說的「使用者自行記錄」簡易版本，沒有改變底層機制，這次只是確定UI放置位置
3. **AI匯入精靈入口**：已修正第5節——原本AI匯入只藏在代理卡片裡，使用者收到新代理報價時還沒建代理，動線不順。新增案件層級的「AI智慧匯入」精靈入口（跟「+新增代理報價」並列同樣顯眼），引導式流程：貼資料→AI解析（含嘗試判斷代理身份）→選擇建立新代理或併入既有代理→逐項確認→套用。原本代理卡片內嵌的入口保留，作為「補資料進既有代理」的次要/快速入口

**這三項都屬於規劃階段，實際開發優先順序建議**：Dashboard跟AI匯入精靈入口都還沒開始做，建議照第19節既有順序，AI智慧匯入（含這次擴充的精靈入口）維持原本排序（優先度高，核心功能）；Dashboard跟市場行情參考排在AI匯入之後，屬於錦上添花但非阻塞核心工作流程的項目。

**建議跟 Claude Code 說的下一步**：
> 規格書新增第7.5節（首頁Dashboard）、第7.6節（市場行情參考顯示位置，資料來源不變，只是確定UI放置）、第5節修正（AI智慧匯入新增案件層級的精靈入口，跟既有代理卡片內嵌入口並存）。這些都還沒開始做。做第5節AI智慧匯入時，請一併把這次新增的案件層級精靈入口做出來，不要只做代理卡片內嵌的版本。Dashboard、市場行情參考排在AI匯入之後，等其他核心項目告一段落再排入。

---

## 37. 報價行事曆：追蹤報價期限與月標週期性交件

使用者提出：月標客戶常有固定週期要求更新報價，需要一個機制追蹤「下次該交報價是什麼時候」「交了沒」。已新增第7.7節：

1. **Case新增`schedule`欄位**：`quotationDeadline`（單次案件截止時間）、`recurrence`+`recurrenceDay`（月標週期規則，如每月25號）、`nextDueDate`（系統算出的下次應交日期）、`quotedStatus`（pending/submitted/overdue）、`lastSubmittedAt`
2. **週期性自動循環**：標記「本輪已交」後，系統依規則自動算出下一輪`nextDueDate`並重置狀態，不用每輪手動重設
3. **報價行事曆頁面**：月曆檢視，案件依到期日點在對應日期上，依狀態用6.7節警示色系統區分顏色，點日期/案件可跳轉
4. **與Dashboard整合**：待處理事項要納入即將到期/已逾期的報價
5. **誠實劃定範圍**：這版只做畫面上的視覺追蹤，不含主動推播通知（Email/簡訊），那需要後端排程機制，是更大的工程，先不做

**建議跟 Claude Code 說的下一步**：
> 規格書新增第7.7節報價行事曆功能：Case新增schedule欄位（quotationDeadline/recurrence/recurrenceDay/nextDueDate/quotedStatus/lastSubmittedAt），支援月標案件的週期性交件自動追蹤（標記已交後自動算下一輪到期日），新增一個月曆檢視頁面，並要求Dashboard的待處理事項納入即將到期/逾期的報價。這版只做視覺追蹤，不含主動推播通知。這個排在Dashboard（第36節）同一批做，因為兩者都要串接「待處理事項」這個共用邏輯。

---

## 38. 實測回饋修正（第十九輪）：三角貿易案件，quoteScope=false的段落卡住「組合總成本」

使用者實測一個真實三角貿易案件（越南工廠FOB付給當地代理，台灣客戶Arcadyan只需付國際運輸+進口段DDP費用）發現：比較分析頁把出口段當成「必須選一個代理」的必填欄位，因為`quoteScope.export=false`所以沒有東西可選，導致「組合總成本」整個卡在「尚未選滿三段」，沒辦法看到真正該看的數字（國際+進口兩段的總和）。

已修正第3節：新增第三種「空白」的原因分類，跟既有兩種明確區分——
1. 「－不適用」：代理`role`不涵蓋這段（既有）
2. 「⚠ 資料不完整」：這段該有資料但缺了（27.2節既有）
3. **「－依貿易條件不需報價」（新增）**：`quoteScope=false`，案件層級設定這段不需要跟客戶收費，不需要選代理，不該卡住組合總成本計算

**建議跟 Claude Code 說的下一步**：
> 規格書第3節修正了三角貿易案件的bug：quoteScope=false的段落（如三角貿易的出口段）不應該被當成必選欄位卡住「組合總成本」，這是第三種「空白」的原因，要跟既有的「role不適用」「資料不完整」分開標示成「－依貿易條件不需報價」。組合總成本的計算要跳過quoteScope=false的段落，不能出現「尚未選滿三段」這種阻擋性文字。這個bug直接影響到使用者現有的真實三角貿易案件，建議優先處理，用瀏覽器實測確認修好後，組合總成本能正確只加總國際+進口兩段。

---

## 39. 實測回饋修正（第二十輪，重大）：perUnit自訂類型漏算真實成本、What-if級距下限計算邏輯錯誤

使用者在實際使用時發現一筆USD 2500的卡車費完全沒被算進總成本，且完全沒有任何警示提示，並指出What-if情境重量分析的計算邏輯不符合業界慣例。兩項都是重大問題，直接影響報價正確性。

### 39.1 perUnit自訂類型導致真實成本靜默消失（嚴重bug）

使用者用`perUnit`計價基礎、自創類型「Shipment」輸入一筆USD 2500的整車運費，因為這個類型不在貨量資訊裡，被既有規則（27.1節「多餘費率不警示」）誤判成正常的多餘費率，安靜算成0元。已在27.1節新增第三種情況的規則：`perUnit`類型若不是6.5.5節標準參考裡的代碼，該筆費用列旁邊要有**持續可見的中性提示**（不是警示色，是灰色資訊提示），告知「貨量資訊未登記此類型，此列目前不計入金額」，並引導使用者考慮改用flat或perShipment，不能讓使用者要跑去比較分析頁核對總額才發現錢不見了。

**同時發現一個關聯的實作缺口**：使用者實際上是想表達「每棧板/每週」的倉租費用（如截圖裡的"Normal W/H Storage"、"Normal Warehouse Storage"），正確應該用第28節已經定義的`perUnitPerDay`計價基礎，但畫面上的基礎下拉選單似乎沒有這個選項可選，導致使用者被迫用`perUnit`硬塞「PLT/Week」這種自創的複合類型去表達。**需要請Claude Code確認`perUnitPerDay`是否真的有出現在基礎選單裡，如果沒有，這是需要補齊的實作缺口，不是新需求。**

### 39.2 What-if情境重量分析：要用「級距下限」而非使用者輸入值本身去計算

業界慣例：只知道概略貨量、還未確定最終總重量會落在哪個級距時，要用「該級距的下限」去反推保守估算的每KG單價，不是直接拿使用者隨手輸入的重量數字去除。已修正3.2節：情境重量要先判斷落在哪個級距（找出適用的`bracketFloor`），**用這個下限本身**去算總成本、也用它當除數，兩者要是同一個數字，並在畫面上明確標示「此情境對應級距下限：Xkg」，新增「帶入此費用的級距下限」快速按鈕直接抓FeeLine自己定義的門檻值。

**實作後追加發現的邊界案例（第44節，比原本預期的更精確）**：`bracketFloor`反推邏輯本來是設計給「真的有多階級距、不確定w落在哪一階」的情境用；但**簡單模式的perKgBreak（只有min charge+單一費率，沒有多階級距）存檔時固定用`{thresholdKg:0, ratePerKg:...}`表示，這種情況下`bracketFloor`永遠算出0**——這個0是合法的「唯一一階、從0kg起就適用」，不是「沒有資料」，但如果判斷「是否缺重量」的程式碼寫成`chargeableWeightKg > 0`這種條件，會把合法的0誤判成缺失。**規則修正：`bracketFloor`反推邏輯只在`breaks.length > 1`（真的有多階）時套用；只有一階時，直接用情境重量本身代入計算，不要透過bracketFloor這層轉換**。

**衍生的通用原則（新增進0.1節設計哲學的延伸提醒）**：任何欄位的「合法值」包含0時（重量、金額、天數、數量等皆可能合法為0），判斷「這個值是否缺失」的邏輯必須明確檢查`null`/`undefined`，不能用`欄位值 > 0`或單純的truthy/falsy判斷去代替「有沒有填」的檢查——0是一個合法輸入，不是空值，這條原則不限於這次修的地方，日後任何欄位的「缺資料」判斷都要遵守。

**建議跟 Claude Code 說的下一步**：
> 規格書這次修正兩個重大問題，都需要優先處理：
> 1. **27.1節新增規則**：perUnit類型若不是標準參考代碼，要在費用列旁邊顯示持續可見的中性提示（灰色資訊文字，不是警示色），告知「貨量資訊未登記此類型，此列目前不計入金額」並建議考慮改用flat/perShipment。麻煩順便確認`perUnitPerDay`計價基礎是否真的有出現在基礎選單UI裡——實測發現使用者被迫用perUnit硬塞「PLT/Week」這種自創類型去表達每棧板每週的倉租費，懷疑perUnitPerDay這個選項沒有真的做出來，如果缺了要補上。
> 2. **3.2節What-if邏輯修正**：情境重量要先算出適用的級距下限（`bracketFloor`），用這個下限（不是使用者原始輸入值）去算總成本跟每KG單價的除數，畫面標示對應的級距下限是多少，並加「帶入級距下限」快速按鈕。
>
> 這兩項都直接影響報價金額正確性，麻煩優先處理，並且用使用者提供的真實案例（ALFA代理、$2500卡車費、1000-4000kg多個情境重量）實際驗證修好，不要只用簡化的測試資料。

---

## 40. 重大架構調整（第二十一輪）：perUnit/perUnitPerDay 拆成更具體的計價基礎；起訖點自動完成問題再次升級

### 40.1 perUnit/perUnitPerDay 拆分（取代39.1節的權宜修法，從源頭解決問題）

使用者提出更根本的問題：`perUnit`把貨櫃/棧板/箱等所有單位類型混在同一個籃子裡，型別欄位又允許自由輸入非標準字串，這正是39.1節那筆USD 2500卡車費消失的根本原因——**與其事後提示「這個類型不對」，不如從一開始就不讓使用者選得到不合理的類型**。

**已在 2.4 節完成拆分，這是新的權威定義，取代文件裡任何更早段落提到的 `perUnit`/`perUnitPerDay`：**

- `perUnit` → 拆成 `perContainer`（每櫃，type下拉限定貨櫃代碼）、`perPallet`（每棧板，單一費率）、`perCarton`（每箱，單一費率）
- `perUnitPerDay` → 拆成 `perContainerPerDay`（每櫃每天，如延滯費/留滯費）、`perPalletPerDay`（每棧板每天，這正是使用者這次遇到的倉租情境）、`perChassisPerDay`（底盤Per Diem）

**這是全文取代規則，不是新增規則**：本文件第2.4節之前（第10、15、16、17、27、28、33、34、39節等多處）提到的 `perUnit`／`perUnitPerDay`，一律視為已被這次拆分取代，語意上請對應到新的具體計價基礎（例如原本泛稱的「perUnit的貨櫃相關情境」現在對應`perContainer`，「perUnit的棧板情境」對應`perPallet`）。**不需要、也不建議逐一去改動文件裡每一段舊文字**，請 Claude Code 依照這條全文取代規則，自行找出程式碼裡所有還在用 `perUnit`/`perUnitPerDay` 的地方（資料庫schema、UI下拉選單、AI匯入判讀邏輯、比較分析/報價頁面的計算函式等），統一migration成新的具體計價基礎。

**影響範圍評估（誠實列出，這是大工程，不是小修）：**
- 資料庫：`fee_lines`表的`basis`欄位允許值要更新，既有資料要依原本的`amountByType`裡的type內容，自動判斷該轉成`perContainer`還是`perPallet`還是`perCarton`（是貨櫃代碼的轉`perContainer`，是PLT的轉`perPallet`，是CTN的轉`perCarton`，無法判斷的類型——如這次的「Shipment」——建議轉成`flat`並把原始金額原封不動保留，同時在remark註明原本的type字串供使用者事後核對）
- UI：所有計價基礎下拉選單、成本輸入表單、報價items格式的顯示邏輯都要更新
- AI智慧匯入：第5.2節的判讀規則要更新成輸出這些新的具體計價基礎，不能再輸出`perUnit`
- 6.5.5節費用名稱參考表：各費用建議的「典型計價基礎」欄位要對應更新（例如THC原本建議`perUnit`，現在要改建議`perContainer`）

**因為範圍很大，建議排在27.1/3.2那兩個緊急修正（39節）之後，當作接下來的下一個獨立階段來做，做完務必依第20節方式完整回歸複查，尤其要用瀏覽器實測既有資料migration後金額有沒有算對，不要只測新輸入的資料。**

### 40.2 起訖點自動完成（Case.origin/destination）—— 這是第三次被提出，優先度必須提高

使用者明確指出這個問題已經提過很多次（第25節就已經列為缺漏項目），到現在都還沒真的做出來。**這次不再只是列進待辦清單，而是要求 Claude Code 這一輪就先確認現況、給出明確時程，不要再讓這件事無限期往後延**：
- Segment層級的港口/機場自動完成已確認完成
- Case層級（新增/編輯案件的起運地/目的地欄位）、Lane層級（fromPort/toPort）**目前確認狀態不明，需要立刻查證**，不是「還沒排到」的問題，是「已經講了兩輪還沒人回報進度」的問題

**建議跟 Claude Code 說的下一步**：
> 這次的訊息分兩部分，麻煩都要處理：
>
> **第一部分（大工程，架構調整）**：規格書第40.1節是這次的重點修正——把`perUnit`拆成`perContainer`/`perPallet`/`perCarton`，`perUnitPerDay`拆成`perContainerPerDay`/`perPalletPerDay`/`perChassisPerDay`，每種計價基礎的貨櫃/棧板/箱類型下拉選單都要限定只顯示對應的選項，不能再讓使用者輸入非標準字串。這是全文取代規則，取代文件裡所有更早提到perUnit/perUnitPerDay的地方，不用逐一改規格書文字，麻煩你自己找出程式碼裡所有使用點統一migration，包含既有資料庫的舊資料也要一併轉換（依原本type內容判斷該轉哪一種，無法判斷的轉flat並保留remark註記）。這個排在39節那兩個緊急修正之後，當作獨立階段處理，做完要完整回歸複查，用瀏覽器實測migration後的既有資料金額對不對。
>
> **第二部分（立刻查證，不是排隊等待）**：Case層級（新增/編輯案件表單）跟Lane層級（fromPort/toPort）的港口/機場自動完成，麻煩現在就去查證目前實際狀態（不要用猜的，去讀程式碼或用瀏覽器實測），回報這兩處到底做了沒有。如果還沒做，這個優先度要提到跟39節的緊急修正同一個等級，不要再往後延。

---

## 41. 報價端的級距費率卡，不該被「還沒確定計費重量」卡住

使用者指出一個更根本的情境：報價時常常需要**先出一張完整的級距費率卡**（各級距各自的售價），還不知道、也不需要先知道客戶最終貨量會落在哪一格，等實際出貨才對應套用——這在標案報價尤其常見。已在第4節新增設計：

1. **費率卡的計算完全不依賴 `cargo.chargeableWeightKg`**：每個級距的售價 = 該級距成本單價 × 加成比例，只需要成本+markup就能算，跟這次貨物實際多重無關
2. `items` 格式的 `perKgBreak` 明細**永遠顯示完整費率卡**，不受27.2節「缺計費重量無法計算」規則限制——那條規則管的是「實際金額算不算得出來」，不是「費率卡能不能生成」，兩者要分開判斷
3. 只有「本次實際適用哪一級距、實際總金額多少」才需要真正的計費重量，沒填就在費率卡旁註明「尚未提供本次計費重量，此表僅供費率參考」，不擋住費率卡本身
4. 若整段都是「純費率卡未定案」狀態，`totalSellPrice` 該段顯示「依實際計費重量另計」，不顯示0或報錯
5. 費率卡格式也要能完整匯出進報價單PDF/Excel（第6節），這是常要交給標案客戶的正式文件

**同時在0.1節新增第四條核心設計原則**：「不要強迫使用者在還沒準備好的時候，就先鎖定一個固定數字」——這條原則統整了3.2節的情境重量分析、這次的費率卡報價，都是同一種思維的不同應用：系統要能適應「延遲決定」的實務工作方式，不能因為某個環節缺一個數字，就把整條分析/報價都擋住。

**建議跟 Claude Code 說的下一步**：
> 規格書第4節新增了perKgBreak報價費率卡的設計，也在0.1節新增第四條核心設計原則。重點：items格式的perKgBreak明細要永遠顯示完整級距費率卡（售價=成本單價×加成比例，不需要知道cargo.chargeableWeightKg），這部分不受27.2節「缺資料無法計算」規則限制；只有「本次實際適用哪一級距、算出實際總金額」才需要真正的計費重量，沒填的話費率卡照常顯示，只是加註「僅供費率參考」，不要整個擋住。這個排在第40節之後、屬於報價功能的延伸修正，一併處理。

---

## 42. 全欄位輸入方式總盤點（依0.1節「能選就不要打字」原則系統性檢視，不是逐一等使用者測出來才補）

使用者要求把整個系統會用到使用者手動輸入的欄位全部檢視一遍。以下逐一盤點，分三類標示：

**✅ 已經是下拉選單/建議清單（已完成或已在其他章節規劃）**
- Case：`mode`、`quoteType`、`quoteCurrency`、`incoterm`、`quoteScope`（勾選框）
- Agent：`role`
- Segment：`defaultCurrency`、`fromLocation`/`toLocation`（已確認完成，6.5.2節）、`useLanes`（勾選框）
- Lane：`carrier`（6.5.5節建議清單+常用累積）、`incoterm`
- FeeLine：`name`（6.5.5節建議清單+常用累積）、`certainty`、`currency`、`basis`、`amountByType[].type`（第40節修正後依basis限定選項）
- cargo：`units[].type`（6.5.5節標準參考+常用累積）、`weightInputMode`（單選鈕）、`dimensionUnit`（應為cm/mm下拉，需確認實作）
- 比較分析頁：比較幣別、代理角色篩選、段落篩選；報價頁：報價格式、賣價輸入模式、markup模式

**⚠️ 這次新發現的缺口，需要補（不是重複第25/40.2節已經提過的港口自動完成，是這次系統性檢視才發現的）**
1. **`Lane.transshipPoints`（轉運/轉機站點）**：目前是逗號分隔的自由文字輸入（Claude Code在第29節回報時自己承認的暫時做法），應該升級成跟`fromPort`/`toPort`同一套的港口/機場自動完成，只是允許**多選**（可能不只一個轉運站），不是純文字
2. **日期/時間類欄位**：`Lane`的`validityStart`/`validityEnd`/`siCutoff`/`vgmCutoff`/`cyCutoff`/`etd`/`eta`，以及`Case.schedule`的`quotationDeadline`/`nextDueDate`——這些都應該用**日期/時間選擇器元件**（瀏覽器原生的`<input type="date">`/`<input type="datetime-local">`或類似元件），不能是純文字輸入框，避免日期格式不一致（如2026/1/5 跟 01-05-2026 混用）造成排序或比對錯誤
3. **`Lane.weeklyFrequency`（每週班次）**：目前的設計是要求使用者直接打業界代碼字串（如「D1357」），這其實違反「能選就不要打字」原則——應該改成**7個可點擊的星期一到星期日切換鈕**，使用者用點的方式勾選有航班的日子，系統自動組成對應的代碼字串顯示，不需要使用者自己記代碼規則
4. **`cargo.volumetricDivisor`（材積換算除數）**：目前是純數字輸入，可以加一個**快速選擇**（國際線慣例6000／快遞常用5000兩個常見選項的按鈕），點選直接帶入，仍保留手動輸入覆蓋其他數值的彈性，減少每次都要自己想這個數字的機率
5. **`Case.schedule.recurrenceDay`（週期性報價的每月/每週第幾天）**：目前定義是數字，應該依`recurrence`的值提供對應的選擇器——`monthly`時是1-31的日期下拉，`weekly`時是星期一到星期日的下拉，不要是純數字輸入框讓使用者自己猜範圍
6. **`Lane.vesselName`（船名）**：可以比照`carrier`的做法，加入「使用者常用清單」累積機制——同一條船公司的固定航線常常重複用到同幾艘船，累積後能加速輸入，但這項優先度較低，不強制列入本輪必做

**✔️ 合理維持自由文字，不需要改（避免不必要的過度設計）**
- `Case.name`（案件名稱/客戶）、`Agent.name`（代理名稱）：使用者自己的專屬商業識別資料，沒有通用詞彙可循
- `letterhead`/`customerInfo` 所有欄位：使用者自己公司或客戶的專屬聯絡資訊
- `tradeRemark`、`FeeLine.remark`、`Lane.remark`：本來就設計成自由文字說明用途，結構化反而失去彈性
- `Lane.voyageNumber`（航次號）：每趟航班/船期各自不同，沒有可預測的固定清單可建議
- 所有金額/數量類數字欄位（`amount`、`qty`、`days`、`percentRate`、`transitDaysMin/Max`等）：本質上是使用者自訂的數值，不適用下拉選單，這類欄位的改善方向是第41節那種「減少必須先知道才能輸入」的彈性設計，不是下拉選單化

**建議跟 Claude Code 說的下一步**：
> 規格書第42節是這次系統性檢視所有輸入欄位的結果，分成已完成/新發現缺口/合理維持自由文字三類。麻煩處理「新發現的缺口」這6項，優先度上前4項（轉運站點自動完成、日期時間選擇器、每週班次改成星期切換鈕、材積除數快速選擇）比較重要，第5項（週期性報價的日期選擇器）因為第7.7節Dashboard/行事曆功能本身還沒開始做，可以跟那批一起處理，第6項（船名常用清單）優先度最低可以先跳過。這批排在第39/40/41節之後，屬於同一類「減少手動輸入」的系統性優化，可以視情況跟第40節的perUnit拆分一起規劃工作量，不用另外重新起一輪。

---

## 43. What-if情境分析擴充：非重量直接驅動的成本（如棧板倉租）併入級距混合分析

> **優先度確認（使用者明確要求）**：這項排在「Batch 3（第40.1節perUnit拆分+第41節報價費率卡）完成並確認沒問題」之後的**下一輪就要開始做**，不是無限期規劃、不是排在第42節那批體驗優化之後才輪到。使用者特別強調`certain`跟`possible`成本要不要計入的判斷，對實際報價決策非常關鍵，這不是錦上添花的功能，是核心分析能力的缺口。

使用者提出更進階的情境：像棧板倉租這種`certainty='possible'`（條件性，if required才發生）的成本，不是直接隨重量變動，而是「這個重量級距大概需要幾個棧板」，需要讓使用者自己估算每個級距對應的數量範圍，系統再用**最大數量**（保守估算）去反推這筆成本在該級距的每KG貢獻，最後併入該級距的混合每KG成本。

**與39.2節「級距下限」規則的關鍵差異（不是衝突，是兩種不同計價驅動力各自對應的正確算法）**：
- `perKgBreak`（如運費本身）：費率是「重量門檻的階梯函數」，用**級距下限**當計算重量與除數（39.2節既有規則，不變）
- **非`perKgBreak`的成本項目**（`perPallet`/`perContainer`/`perContainerPerDay`/`perPalletPerDay`等）**併入級距分析時**：這些成本不是重量的階梯函數，是「這個級距大概會用到幾個單位」的物理估算，除數應該用**「這個數量的單位實際代表的重量」**，不是級距下限本身

**新增機制**：
1. 每個非`perKgBreak`的FeeLine，若使用者想把它併入What-if級距分析，需要輸入**「每單位換算重量」**（如1 PLT ≈ 250kg，這是選填、可重複使用的設定值，不用每次重新輸入）
2. 針對What-if分析用到的每一個級距下限（沿用39.2節「帶入級距下限」機制產生的同一組門檻），使用者可以**個別輸入這個級距的估計數量範圍**（如1000KG+級距估計4-5個棧板），系統可以先用「級距下限 ÷ 每單位換算重量」算出一個建議值供參考，但使用者仍可手動覆蓋成自己的實務估計（因為實際打包效率、是否有零星尾數棧板等因素，不一定是乾淨的除法結果）
3. **計算公式（第50節修正，原公式有誤，qty會在分子分母互相抵銷導致進階模式失去意義）**：`該項目在此級距的每KG貢獻 = (該級距估計數量的最大值 × 單位費率 [×天數，若是PerDay類型]) ÷ 級距下限(bracketFloor)`——分母改用級距下限本身，不是「數量×每單位換算重量」，這樣使用者輸入的估計數量若偏離「級距下限÷每單位換算重量」這個理論整除值（反映現實中棧板等單位無法整除、需要多留一個的浪費），才會真的影響算出來的每KG貢獻，這才是進階模式真正該達到的效果。例如級距下限1000kg，理論上1000÷250=4個棧板剛好整除，但若使用者估計實際需要5個棧板（考慮零星尾數浪費），貢獻 = `5 PLT × 15 USD ÷ 1000KG = 75 ÷ 1000 = 0.075 USD/KG`（比理論值0.06更高，正確反映了多用一個棧板的浪費成本）。這個算法也跟第48節公式總表裡`perShipment`/`flat`類項目（總成本÷級距下限）的邏輯一致，不是另外設計一套。
4. 該級距的**混合每KG總成本** = `perKgBreak項目的每KG成本（39.2節既有算法，用級距下限）` + `Σ 所有併入分析的非perKgBreak項目的每KG貢獻（本節新算法，用各自的實際代表重量）`
5. **呼應既有的certain/possible機制**：What-if分析畫面要能切換顯示「僅Subtotal（只算certainty=certain的項目）」跟「Total（certain+possible都算）」兩種混合每KG成本，不是另外發明新概念，是把既有的Subtotal/Total邏輯延伸套用到這個混合分析上——這正好對應使用者這次舉的例子（倉租標記possible，代表「要不要把這個條件性成本算進去」由使用者自己決定要看哪個版本）

**這個功能屬於3.2節What-if情境分析的擴充，不是取代**，原本純粹處理perKgBreak的情境分析邏輯不變，這次是新增「順便把其他非重量驅動的相關成本也一起考慮進去」的進階選項，使用者可以選擇要不要啟用這個擴充分析。

**建議跟 Claude Code 說的下一步**：
> 規格書第43節是3.2節What-if情境分析的重大擴充：讓非perKgBreak的成本項目（如perPallet/perContainer類）也能併入級距混合分析。核心設計：每個要併入分析的FeeLine需要一個「每單位換算重量」設定（如1PLT≈250kg），每個級距使用者可以輸入估計數量範圍（系統可建議但允許覆蓋），用最大數量估算該項目在此級距的每KG貢獻，除數用「這個數量代表的實際重量」不是級距下限（這點跟perKgBreak本身的算法不同，不要搞混）。最後該級距的混合每KG成本 = perKgBreak的貢獻(用級距下限) + 所有併入項目的貢獻(各自用其代表重量)加總。並且要能切換Subtotal(僅certain)/Total(含possible)兩種版本，呼應既有機制。**這項已確認為下一輪要做的項目（Batch 3完成並確認沒問題之後），不是排在第42節之後才輪到，麻煩先確認理解這個設計、有沒有不清楚的地方，Batch 3一結束就接著規劃這項的實作細節。**

---

## 44. What-if簡單模式perKgBreak的0值誤判修正（已由Claude Code精確診斷並修好）

實測發現「Airport Transfer」這類簡單模式的perKgBreak費用（只有min charge+單一費率，沒有多階級距），在What-if情境重量表裡不管輸入什麼重量，都持續顯示「缺計費重量，無法計算」，金額完全不隨情境重量變化。

**根因（比原本推測更精確）**：簡單模式的perKgBreak存檔時固定用`{thresholdKg:0, ratePerKg:...}`表示唯一一階，39.2節的`bracketFloor`反推邏輯套用在這種情況上，永遠算出0；而判斷「是否缺重量」的程式碼用了`chargeableWeightKg > 0`這種條件，把合法的0誤判成缺失。**已修正**：`bracketFloor`反推邏輯只在真的有多階級距（`breaks.length > 1`）時套用，單階直接用情境重量本身代入計算。

**衍生的通用原則**：任何欄位的合法值包含0時，判斷「是否缺失」必須明確檢查`null`/`undefined`，不能用`>0`或truthy/falsy判斷代替，這條原則不限於這次修的地方，日後任何欄位的缺資料判斷都要遵守。

**建議跟 Claude Code 說的下一步**：
> Airport Transfer的What-if bug修正確認理解且合理，麻煩用瀏覽器實測確認在多個情境重量下都能正確算出max(minCharge, rate×w)。另外請你搜尋整個程式碼庫，有沒有其他地方也用了類似「數值>0」或單純truthy/falsy判斷去代替「是否有填」的檢查——例如cargo.volumeCBM、cargo.declaredValue、cargo.distanceKm這些欄位若合法值也可能是0，可能有一樣的問題，找到的話列出清單讓我確認優先度，不用馬上全部修。
>
> 另外還沒有得到答案：這幾輪的修正（含§38、Batch3）目前commit+push到GitHub了嗎？我的Netlify正式網址還是舊畫面，麻煩確認並回報。

---

## 45. What-if情境分析要能三段同時比較+匯出；「不強迫先鎖定固定數字」原則要延伸到比較分析的「選用」機制

使用者提出兩點，本質上是同一個核心問題——**標案案件本來就沒有固定計費重量，系統的比較分析邏輯卻還是預設「要有一個固定重量才能算、才能選代理」，這跟標案的實際工作方式衝突**。

### 45.1 What-if情境分析改成三段同時呈現，並支援一次匯出

- 3.2節原本的「分析段落」下拉選單（一次只能選一段）**改成三段（出口/國際/進口）同時顯示**，用同一組情境重量橫向比較三段（或跨代理）在各重量情境下的表現，不用來回切換段落
- 「匯出比較表Excel」要能把三段的情境分析結果一次匯出（可以是同一個檔案裡三個工作表，或同一張表用段落分組），不是只匯出目前選定的那一段

### 45.2 比較分析頁「選用」機制不該被「缺計費重量」卡住（核心修正，呼應0.1節第四條原則+第41節報價費率卡設計）

- **問題根源**：目前若某段成本含`perKg`/`perKgBreak`項目、案件`cargo.chargeableWeightKg`是空的，該段Subtotal/Total顯示27.2節的「無法計算」警示，導致「選用」按鈕實質上被卡住無法使用——但這個前提本身在標案情境下是錯的：**標案案件本來就不會有固定計費重量，這不是「資料不完整」，是這種案件類型的正常狀態**
- **修正方向**：
  1. 沒有固定計費重量、但成本含weight-based項目的段落，「選用」按鈕**不應該被停用**——使用者應該能基於「這家代理的費率結構」（透過45.1節三段同時呈現的情境分析去比較）做出選擇，不需要先有一個算好的固定總金額才能選
  2. 選定之後，該段的Subtotal/Total顯示改成「依實際計費重量另計」（呼應第41節報價費率卡對`totalSellPrice`的處理方式），不要顯示誤導性的警示或空白
  3. 「組合總成本」卡片，若組合裡有段落是「依實際計費重量另計」狀態，整體總成本也要相應顯示「部分依實際計費重量另計」，不能假裝算出一個完整但實際上是錯誤/不完整的數字
  4. 這個修正讓「成本輸入 → 比較分析 → 報價」整條路徑，在「還沒有固定重量」這件事上保持一致的處理邏輯——不要卡在比較分析這一段，前後其他階段卻已經支援彈性處理（第3.2/39.2節的情境分析、第41節的報價費率卡）

**建議跟 Claude Code 說的下一步**：
> 規格書第45節是這次的重點，兩件事都要處理：
> 1. **45.1**：What-if情境分析從「一次選一段」改成三段同時呈現、同一組情境重量橫向比較，匯出Excel也要涵蓋三段。
> 2. **45.2（更核心）**：比較分析頁的「選用」機制，不該因為`cargo.chargeableWeightKg`是空的就卡住——標案案件本來就沒有固定計費重量，這是正常狀態不是資料不完整。含weight-based成本的段落，沒有固定重量時仍要能正常選用代理，選定後該段顯示「依實際計費重量另計」，不要用27.2節的警示邏輯去卡住這種案件類型。這個修正要讓「成本輸入→比較分析→報價」整條路徑，在「還沒有固定重量」這件事上處理邏輯一致，呼應0.1節第四條設計原則跟第41節報價費率卡的既有設計方向。
>
> 這批工作量不小，建議先確認理解設計意圖再動工，尤其45.2牽涉到27.2節既有警示邏輯的適用範圍要重新界定（不是拿掉警示，是要正確區分「真的缺資料」跟「這種案件類型本來就沒有固定重量」兩種情況），不要照搬27.2節原本的判斷方式。

---

## 46. 統整原則：「實際金額 vs 情境試算」是永遠並存的兩種視角，不是依案件類型分支的兩套邏輯

使用者直接問了一個關鍵問題：要不要依案件類型（spot固定要計費重量、bidding不用）去分兩套處理邏輯？**答案是不要**，使用者自己也已經看出這個做法的破綻——spot案件填了實際計費重量後，難道就不能再看不同重量情境下的表現嗎？顯然還是需要。這代表「案件類型」根本不是正確的分界線。

**這一節把0.1節第四條原則講得更精確，統整了27.2/39.2/41/45節分散的邏輯，這是之後開發時該遵循的最終框架，不是又一個新規則：**

真正的分界線只有一條：**「這個驅動數字（如計費重量）現在有沒有值」，而且「實際金額」跟「情境試算」永遠同時存在，不是二選一、也不由案件類型決定要不要開放**：
- 有值 → 算得出實際金額，情境試算依然可以同時使用（想看看不同假設下的比較，隨時都可以）
- 沒有值 → 沒有實際金額（顯示「未定」，不是警示），情境試算正常使用，「選用」等操作依然可以基於費率結構去進行，不需要等實際金額出現

**這條原則不需要`quoteType`參與判斷**，spot、tender、project案件在這件事上的行為完全一樣，只看當下`cargo.chargeableWeightKg`（或其他驅動數字）有沒有值。之前規格書把這個概念拆散在好幾節分別描述（27.2節的警示規則、39.2節的情境分析、41節的報價費率卡、45節的選用機制），這節的用意是把它們收斂成同一個心智模型，避免之後每遇到一個新畫面又要重新想一次「這裡該怎麼處理沒有固定數字的情況」。

**建議跟 Claude Code 說的下一步**：
> 規格書第46節統整了一個核心心智模型，取代之前分散在27.2/39.2/41/45節的個別規則，之後任何涉及「重量/貨量等驅動數字可能還沒填」的畫面，都要套用這個統一框架，不要依案件類型（spot/tender/project）分支邏輯：
>
> 「實際金額」跟「情境試算」永遠並存，不互斥。有驅動數字就算實際金額（情境試算依然可用，兩者不衝突）；沒有驅動數字，實際金額顯示「未定」（不是警示、不阻擋任何操作），情境試算跟選用等操作正常使用。這條原則不看案件類型，只看當下數字有沒有值。
>
> 麻煩先確認完全理解這個統整框架，之後做第45節（多段情境分析+選用機制修正）跟第43節（非重量驅動成本併入分析）時，都要以這個框架為準，不要再依畫面各自發明處理方式。

---

## 47. 使用者提供實際手算範例（Excel），補齊三個規格書沒設計到的重要概念

使用者提供一份自己手算的完整成本/報價範例（同一案件），比對後發現三個目前規格完全沒涵蓋、但實務上必要的概念：

### 47.1 「可能成本」選用框架：個別勾選 + 選填的互斥子群組（第50節修正，取代原本偏窄的版本）

> 使用者修正：「一般倉/保稅倉」不是這個功能的固定用途，只是眾多情境裡的**一個例子**。真正要的是兩層彈性：(1) 每一筆`possible`成本能不能個別勾選要不要計入，不是只有「整批算/整批不算」的二選一；(2) 有需要時，可以把幾筆possible成本自訂框成一組互斥選項，適用任何情境（不限倉儲），群組名稱由使用者自訂，也不是每個案件都需要分組。

**新增設計（兩層）**：

```
FeeLine {
  certainty: 'certain' | 'possible'
  optionGroup   // 選填，自由文字標籤（使用者自訂，如"一般倉"/"保稅倉"，或任何其他情境的分組名稱），
                // null代表這筆possible成本不屬於任何群組
}
```

**第一層：個別勾選（適用所有`possible`成本，不管有沒有分組）**
- 比較分析/報價/情境分析頁面，`possible`的費用清單要能**逐筆勾選**要不要計入這次的成本試算，不是只有現行「Subtotal(僅certain) / Total(含全部possible)」這種整批切換的二選一
- 現行的Subtotal/Total兩欄位維持作為**快速參考數字**（Subtotal=僅certain，Total=certain+全部possible都算進去的上限值），但實際使用者要拿去分析/報價的「選定組合」，是依照這一層的個別勾選結果決定，不是只能在Subtotal跟Total兩個極端之間選

**第二層：選填的互斥子群組（適用有互斥關係的possible成本，使用者自訂何時需要用到）**
- 使用者可以把幾筆possible成本自訂設定同一個`optionGroup`標籤，這幾筆會被視為**互斥的一組**，介面上用單選（不是複選）呈現，使用者只能選其中一筆（或都不選），比照手算範例的「一般倉」vs「保稅倉」這個情境（但這只是其中一種用法，不限定於倉儲相關）
- 沒有設定`optionGroup`的possible成本，就只受第一層的個別勾選控制，不受這一層影響
- 這個機制要能跟What-if情境分析（第43/45節）搭配：同一組情境重量下，若有設定互斥群組，可以同時看到不同群組選項各自算出的每KG成本並排比較（例如手算範例的「一般倉」跟「保稅倉」兩條線）

### 47.2 固定比例換算為預設做法，逐級距手動估算數量為進階選項（修正第43節的優先順序）

手算範例裡，棧板類費用（Storage $15/PLT/週、Warehouse in&out $10/PLT）都是用**固定比例**換算成每KG成本（如1PLT≈250kg，$15÷250kg=0.06USD/KG），**不管級距多少，每KG貢獻都是同一個數字**，因為這是線性比例關係，不需要每個級距重新估算。

**修正**：第43節原本設計的「每個級距手動輸入數量範圍」，這次確認**只有在使用者需要考慮零星尾數棧板（打包效率不是乾淨整除）時才需要用到**，這是進階選項；**預設情況下，只要輸入一個固定的「每單位換算重量」比例，系統就該自動算出一個在所有級距都適用的固定每KG貢獻值**，不需要使用者為每個級距分別輸入數量。使用者需要更精細的估算時，才手動切換成「逐級距自訂數量」模式覆蓋這個預設值。

### 47.3 固定賣價的損益兩平分析（全新功能）

手算範例裡有一個目前系統完全沒有的功能：**輸入一個固定的每KG賣價（不隨級距變動），系統算出這個賣價在各個重量級距下的毛利（金額+每KG）**，讓使用者看出「這個報價要出到多少貨量才會開始賺錢」（範例中1000-1500KG是虧損、2000KG打平、2500KG以上開始賺）。

**新增設計**：What-if情境分析（第43/45節）擴充一個「損益兩平分析」子功能：
- 使用者輸入一個固定的每KG賣價（單一數字，不隨級距變動，這是業務決定要用同一個價格報給客戶的情境）
- 系統依每個情境重量級距，算出：`該級距毛利每KG = 固定賣價 - 該級距混合每KG成本`；`該級距毛利總額 = 毛利每KG × 該級距重量（用級距下限）`
- 表格呈現「情境重量 | 混合成本/KG | 固定賣價/KG | 毛利/KG | 毛利總額」，讓使用者一眼看出從哪個級距開始轉虧為盈
- 這個功能要能分別套用在47.1節的不同`optionGroup`上（一般倉/保稅倉各自的損益兩平點可能不同）

**建議跟 Claude Code 說的下一步**：
> 規格書第47節根據使用者提供的實際手算Excel範例，新增三個概念：
> 1. **47.1 可能成本選用框架（第50節修正版，不限倉儲情境）**：兩層彈性——(a) 每一筆possible成本要能個別勾選是否計入，不是只有Subtotal/Total整批切換 (b) FeeLine新增`optionGroup`欄位（自由文字，使用者自訂），同組的possible費用視為互斥方案，介面單選呈現，What-if情境分析要能同時呈現不同群組各自的每KG成本供比較
> 2. **47.2 修正第43節優先順序**：固定比例換算（一個「每單位換算重量」數字，適用所有級距）是預設簡單做法，逐級距手動輸入數量範圍是進階選項，不是反過來
> 3. **47.3 損益兩平分析**：What-if情境分析新增功能，輸入固定每KG賣價，算出各級距下的毛利/KG跟毛利總額，看出從哪個級距開始賺錢
>
> 這三項都是第43/45/46節What-if情境分析大架構下的延伸，建議整合在同一批開發規劃裡，不要分開處理，因為底層資料結構（optionGroup）跟畫面（情境分析表格）都會互相影響。麻煩先確認理解這三個概念，尤其47.1的互斥選項組是全新的資料模型異動，需要資料庫migration。

---

## 48. What-if混合每KG成本引擎：全計價基礎公式總表 + 計價單位資料庫（統整第43/45/46/47節，補齊完整性）

使用者要求把Excel範例裡出現的**每一種計價單位**都對照過一次，確保情境分析引擎能正確處理所有情況，不只是之前個別討論過的perKgBreak/perPallet。逐一核對後，Excel範例用到的單位（USD/KG、USD/BL、USD/truck、USD/PLT/WK、USD/PLT）**全部都對應到既有的計價基礎**（第40節拆分後的完整清單），沒有遺漏需要新增的單位類型；這一節的用意是把公式**統整成一張完整表**，取代之前分散在43/45/46節的片段描述。

### 48.1 計價單位資料庫（正式確立，取代並整合6.5.5節的分散描述）

所有計價基礎的「單位」欄位，都必須是下拉選單來源，不允許自由文字輸入（呼應0.1節第2條原則），對照如下：

| 計價基礎 | 單位資料庫來源 | 說明 |
|---|---|---|
| `perKg`/`perKgBreak` | 無須額外單位選單（固定是KG） | 使用`cargo.chargeableWeightKg` |
| `perShipment` | 無須額外單位選單（固定是每票/BL） | 使用`cargo.shipmentQty` |
| `perContainer`/`perContainerPerDay` | 6.5.5節「貨櫃類型標準參考」（20GP/40HQ等） | 下拉限定貨櫃代碼 |
| `perPallet`/`perPalletPerDay` | 固定為`PLT` | 不需下拉（只有一種） |
| `perCarton` | 固定為`CTN` | 不需下拉（只有一種） |
| `perChassisPerDay` | 固定為`CHASSIS` | 不需下拉（只有一種） |
| `flat` | 無單位概念（一次性金額） | 不隨任何數量變動 |
| `percentValue`/`perKm`/`perCBM`/`perCBMPerDay`/`perKgPerDay` | 分別對應申報價值/公里數/材積 | 見2.4節既有定義 |

**每一筆FeeLine的幣別（`currency`）獨立於計價基礎，透過`case.rateTable`換算成分析當下選定的顯示幣別**（沿用3.3節既有的幣別換算架構），這條規則本來就存在，這裡重申是為了確認：情境分析裡不管是哪一種計價基礎的費用，都要先各自查`rateTable`換算成同一顯示幣別，才能加總成有意義的「混合每KG成本」。

### 48.2 情境分析（What-if）完整公式總表——依計價基礎分類，每種都要正確處理

給定情境重量對應的級距下限`bracketFloor`（perKgBreak用途，見39.2節）：

| 計價基礎 | 該情境下的總成本 | 每KG貢獻（換算成顯示幣別後） | 是否隨級距變動 |
|---|---|---|---|
| `perKgBreak` | `max(minCharge, applicableRate(breaks,bracketFloor)×bracketFloor)` | 總成本 ÷ bracketFloor | 會（階梯式） |
| `perKg` | `amount × bracketFloor` | = `amount`本身（固定費率，恆定） | 不會（本身就是固定費率） |
| `perShipment` | `amount × cargo.shipmentQty`（不隨重量變動的實際總額） | 總成本 ÷ bracketFloor | 會（分母變大，貢獻遞減，如手算範例的Terminal fee等） |
| `flat` | `amount`（固定金額） | 總成本 ÷ bracketFloor | 會（同上，分母變大貢獻遞減） |
| `perPallet`/`perCarton` | 預設模式依47.2節：`amount × (bracketFloor ÷ 每單位換算重量)`；進階模式（第50節修正）：`amount × 使用者輸入的估計數量` | 預設：`amount ÷ 每單位換算重量`（固定比例，恆定，如手算範例的Warehouse in&out）；進階：`(數量×amount) ÷ bracketFloor`（會隨使用者估計數量偏離理論值而變動，反映零星浪費） | 預設模式不會；進階模式會 |
| `perPalletPerDay` | 同上再乘`days` | = `(amount × days) ÷ 每單位換算重量`（固定比例，恆定，如手算範例的Storage） | 不會（除非用進階模式） |
| `perContainer`/`perContainerPerDay`/`perChassisPerDay` | 使用`cargo.units`裡實際登記的數量（不隨情境重量變動，貨櫃/底盤數量是實際declare的值，不是靠重量反推） | 預設**不列入**「混合每KG成本」（貨櫃/底盤成本業界慣例不會換算成每KG比較，比照貨櫃直接看「每櫃」即可，見3.3節），使用者可選擇性納入，若納入則按總成本÷bracketFloor處理 | 視使用者選擇 |
| `percentValue`/`perKm`/`perCBM`/`perCBMPerDay`/`perKgPerDay` | 依2.4節既有公式 | 目前DB/前端尚未實作（第30節已知缺口），情境分析暫不支援，等這些計價基礎補齊後再納入 | — |

**混合每KG總成本（該情境重量、該段落）** = Σ 上表所有納入計算的FeeLine的「每KG貢獻」（已排除47.1節`optionGroup`裡未被選中的互斥方案）

這張表統整了43/45/46節分散的規則，之後任何新增的計價基礎，都要照這個表的邏輯補上對應的「情境分析行為」定義，不能遺漏。

**建議跟 Claude Code 說的下一步**：
> 規格書第48節是這次的統整版，把之前43/45/46/47節分散的情境分析公式，整理成一張完整對照表（48.2節），涵蓋目前已實作的所有計價基礎，並確立了計價單位資料庫（48.1節，取代6.5.5節分散的描述）。這節本身不是新功能，是把之前的規則講清楚、講完整，麻煩對照第48.2節的表格，確認第43/45節的實作規劃是否已經正確涵蓋每一種計價基礎的情境分析行為，特別注意：perShipment/flat類固定總額的項目，貢獻會隨級距升高而遞減（不是恆定）；perPallet/perCarton類固定比例換算的項目，貢獻在各級距是恆定值（不會變動）；perContainer類預設不納入混合每KG分析。這三種行為模式不一樣，不能用同一套邏輯處理，麻煩在實作時明確依照這張表分流。

---

## 49. 主動盤點：四個目前規格完全沒涵蓋、但以現在複雜度遲早會出問題的缺口

使用者要求主動思考還有什麼能讓系統更完整，不要只被動等使用者測出來才反應。盤點如下：

### 49.1 數字四捨五入規則（使用者確認：全程無限精度，只在最終顯示時統一處理）

情境分析算出的每KG單價可能有很長的小數位，目前沒有統一規則。**訂定（使用者確認版本，取代原本區分金額/比率位數的提案）**：所有中間運算（加總、換算幣別、逐筆相加）**全程維持完整精度，不四捨五入**；只有在最終呈現給使用者看的那一刻（畫面顯示、PDF/Excel匯出），才統一四捨五入到**小數點後2位**，不分金額類或比率類，全站統一這一條規則。這樣可以確保加總過程不會因為中間步驟提早四捨五入而累積誤差。

### 49.2 同一段落有多筆perKgBreak、且門檻不同時，情境分析怎麼處理（使用者提供具體案例驗證規則正確）

例如「基本運費」跟「燃油附加費」都是各自獨立的perKgBreak，但兩者的級距門檻設定不同。目前39.2節的設計只抓「第一筆perKgBreak」決定`bracketFloor`，多筆且門檻不同時行為未定義。**規則**：每一筆perKgBreak各自依自己的`breaks`計算自己的`bracketFloor`，不共用同一個下限——因為不同費用項目的級距結構本來就可能不同（運費費率的斷點跟燃油附加費的斷點沒有必然關聯），情境重量表格的「此情境對應級距下限」提示，若同段落有多筆perKgBreak且下限不同，要各自標示清楚，不能只顯示一個籠統的下限數字。

**使用者提供具體案例驗證這條規則**：運費級距是100/300/500/1000，燃油附加費級距是100/500/1000。情境重量100時，運費用100的費率、燃油附加費也用100的費率（兩者剛好都有100這個門檻）；情境重量300時，運費用300的費率（運費本身有300這個門檻），但燃油附加費因為沒有300這個門檻，要用「小於等於300的最大門檻」也就是100的費率去對應；情境重量500/1000時，兩者剛好都對得上，各自用500/1000。**這正好完全符合上面的規則**——不需要另外設計特殊邏輯，只要每筆perKgBreak各自套用「找出自己breaks裡小於等於情境重量的最大門檻」這個既有邏輯（跟applicableBreakRate/applicableBreakFloor既有的查找方式一致），就會自然產生使用者預期的結果，這節等於確認了規則設計正確，實作時直接照這個邏輯做即可。

### 49.3 版本記錄與快照系統（使用者擴充：不只報價匯出時凍結，還要能手動存檔、查閱歷史版本、以歷史版本為基礎建立新案件）

**問題根源**：這正是Batch 3那次「migration後金額變多，不確定客戶有沒有已經收到舊數字」問題的根本解法。使用者這次補充了兩個相關但不完全一樣的需求：

**A. 畫面沒即時反映最新變更的疑慮（補充給6.5.4節autosave機制）**：使用者反映在某處改了資料後，有時候整體成本分析畫面沒有立刻看到更新，即使autosave已經存檔。修正方向：
- 優先修法是**排查、修正底層的即時更新機制**，讓比較分析/報價等匯總畫面，在任何相關資料（成本/加成/幣別等）異動存檔後，能正確重新拉取最新資料呈現，不需要使用者自己想到要重新整理
- 但同時**新增一個明顯位置的「重新整理成本分析」按鈕，作為保險機制**——不是要取代自動更新，是萬一自動更新在某些情境下沒有正確觸發（例如跨分頁編輯），使用者能主動點擊強制重新拉取最新資料，不用整頁重新整理（`F5`）這麼粗暴的方式

**B. 版本記錄/快照系統（範圍比原本的報價匯出快照更完整）**：使用者要的不只是「報價匯出時自動凍結」，而是一套完整的版本管理：
- **手動「存檔」按鈕**：在代理成本分頁跟報價分頁都提供一個「存檔」按鈕，讓使用者在任何時間點主動把目前的完整計算結果（不限於報價匯出當下）存成一個具名的版本快照，使用者可以自訂這個版本的名稱/備註（例如「報價v1 - 2026/8/12」或自由文字）
- **報價匯出時也自動建立一份快照**（沿用原本49.3節的設計，跟手動存檔並存，不互相取代）
- **案件明細頁要有「版本記錄」區塊**，列出這個案件所有存過的快照（手動存的+匯出自動存的），依時間排序，每筆顯示名稱/時間/簡要金額摘要
- **每個歷史版本要能執行兩種動作**：
  1. **「還原到這個版本」**：把案件目前的即時資料**覆蓋回**這個快照當時的狀態，用於「這個版本改壞了，想退回之前對的版本」的情境
  2. **「以此版本為範本建立新案件」**：用這個快照的內容當基礎，建立一份全新獨立的案件（沿用第7節案件複製的機制，但複製來源是歷史快照而不是目前的即時資料）——用於「同一個客戶下一期報價，想從上次的版本繼續改」或「不同客戶但類似航線，想從舊的一份報價開始改」這兩種情境，使用者自己決定要繼續編輯目前這個案件、還是另外開一個新案件
- 資料結構：`CaseSnapshot { id, caseId, label, createdAt, snapshotType('manual'|'quote_export'), fullData(jsonb，完整凍結的案件+代理+段落+FeeLine+報價設定) }`，需要新的資料表跟migration

### 49.4 基準測試案例（Golden Test Cases）——把已經在做的事正式化

這幾輪已經多次靠「找一個已知答案的真實案例回頭核對」抓出bug（如ALFA、Airport Transfer）。**建議正式化**：挑選3-5個案件，記錄下確定正確的關鍵數字（各段Subtotal/Total、情境分析在特定重量下的結果），存成一份文件（例如`sql/golden_test_cases.md`或類似形式）。

**使用者提出的顧慮（範圍界定，避免變成負擔）**：這個機制**只在真正需要時才觸發，不是每次改動都要跑**，明確界定觸發條件——**沿用第20節既有的「大範圍改動」門檻**（牽涉兩個以上檔案、動到資料庫欄位、或觸及FeeLine/Segment核心計算邏輯），只有符合這個門檻的改動，才需要額外拿基準案例核對；單純的UI調整、文字修改、樣式異動，不需要觸發這個檢查，不會拖慢日常小修改的節奏。而且核對方式本身應該盡量輕量——優先用「讀程式碼、依文件記錄的公式手動核算」的方式比對（不一定每次都要真的開瀏覽器跑一輪），只有結果對不上時，才需要進一步用瀏覽器實測定位問題，這樣可以把大部分情況的核對成本降到最低，不會每次都消耗大量資源去做一次完整的端對端驗證。

**建議跟 Claude Code 說的下一步**：
> 規格書第49節主動盤點了四個目前完全沒涵蓋的缺口：
> 1. 訂定全站統一的數字四捨五入規則：全程無限精度，只在最終顯示時統一四捨五入到小數點後2位，不分金額或比率類
> 2. 同段落多筆perKgBreak且門檻不同時，各自依自己的breaks算bracketFloor，不共用（使用者提供的具體案例已驗證這條規則正確）
> 3. **版本記錄與快照系統**（範圍比原提案更完整）：新增「重新整理成本分析」按鈕當保險機制（同時要修正底層即時更新機制本身）；代理成本/報價分頁都要有手動「存檔」按鈕存成具名版本快照；案件明細頁要有「版本記錄」區塊，每個歷史版本能「還原到這個版本」或「以此版本為範本建立新案件」（沿用第7節案件複製機制，但來源是歷史快照）
> 4. 基準測試案例：只在符合第20節「大範圍改動」門檻時才觸發，優先用讀程式碼手動核算比對，不用每次都跑完整瀏覽器測試，避免變成日常負擔
>
> 這四項裡，49.3版本記錄與快照系統優先度較高（直接解決你們Batch 3遇到的那類問題），49.1/49.2是規則補強，49.4是流程建議且已明確界定觸發門檻不會增加日常負擔。麻煩先確認理解，排進第43-48節那批工作完成之後的下一階段規劃。

---

## 50. 實測回饋：47.1選項組UI缺失待查證 + All-in報價新增「輸出樣式」選擇（總金額 vs 每KG費率）

### 50.1 47.1成本互斥選項組的UI狀態需要立刻查證

使用者實測發現，比較分析頁跟報價頁都完全沒有「一般倉/保稅倉」這種互斥選項組的選擇介面，懷疑這個功能還沒真的做出來（或只做了資料層沒接UI）。**需要立刻查證，不是排隊等待**，比照之前第40.2節港口自動完成的處理方式：直接搜尋程式碼裡有沒有`optionGroup`相關的UI渲染邏輯，回報實際狀態。

### 50.2 All-in報價新增「輸出樣式」：總金額 vs 費率，且費率單位要依運輸模式而定（第50節修正，不限空運）

> 使用者補充：這不是空運限定的需求，海運散貨LCL同樣常見「currency/CBM」或「currency/計費噸(Revenue Ton)」這種費率式報價，不是只有空運的USD/KG。

海運FCL的All-in報價自然是一個總金額（貨櫃數量確定），但**空運、海運LCL的All-in報價常常直接是一個費率數字，不是一個總金額換算出來的附加參考資訊，而是報價單本身要正式呈現給客戶的核心數字**。目前系統的All-in格式只會算出固定總金額（畫面上的每KG換算只是附註，不是報價本身）。

**新增設計（依運輸模式提供對應的費率單位選項，不是單一寫死的USD/KG）**：
```
Case.allinOutputStyle   // 'lumpSum'(單一總金額，現行) | 'rate'(費率)，只在quoteFormat='allin'時有意義
Case.allinRateUnit       // 'perKg' | 'perCBM' | 'perRevenueTon' | 'perContainer'，只在allinOutputStyle='rate'時有意義，可選項目依case.mode篩選：
                          //   空運 → perKg
                          //   海運LCL → perCBM 或 perRevenueTon（計費噸，沿用3.3節既有的Revenue Ton/W/M定義：取重量噸數與CBM較大值）
                          //   海運FCL → perContainer（費率報成「每櫃多少錢」，跟lumpSum的差別在於lumpSum是「總共N櫃共多少錢」，perContainer是單純報「每櫃單價」，數學上關聯但呈現目的不同：一個是這次交易的總金額，一個是可複用的單價供客戶自行依櫃數計算）
```
- `lumpSum`：現行行為，算出一個固定總金額，需要對應的驅動數字（計費重量/材積/櫃數）有值才能算出實際金額（沒有則依46節框架顯示「未定」，情境試算仍可用）
- **`rate`（新增）**：報價本身就是一個費率數字，不強制需要知道最終總量：
  - 費率來源可以是（a）依markup%自動算出（用該段混合每單位成本×(1+markup%)，混合成本計算沿用48節公式總表跟47.1節選定的possible成本組合）（b）使用者手動輸入一個固定費率（直接對應47.3節的SR概念，這時SR的單位也要依`allinRateUnit`調整，不是只有USD/KG一種）
  - 若對應的驅動數字（重量/材積/櫃數）剛好有值，額外顯示「若本批貨為X，預估總金額為Y」的參考資訊（跟現行lumpSum模式的角色互換：這次總金額變成附加參考，費率才是報價主體）
  - 這個模式下，若段落有47.1節設定的possible成本群組，報價頁要能讓使用者選擇要計入哪個組合，並排呈現不同組合算出的費率供比較
- 使用者依實際情境選擇要用哪種輸出樣式：確定貨量的spot詢價通常用`lumpSum`（跟客戶要一個總數字）；不確定貨量的空運/LCL報價或標案常用`rate`（跟客戶報一個費率讓對方自己依實際貨量計算）

**這三件事（47.1可能成本選用框架、47.3損益兩平、這次的All-in費率輸出）本質上是同一套彈性成本/報價系統的三個面向，建議規劃時一併考慮，不要各自獨立設計。**

**建議跟 Claude Code 說的下一步**：
> 兩件事：
> 1. **立刻查證**：47.1節的可能成本選用框架（optionGroup），比較分析頁跟報價頁目前完全沒有可以選擇的UI，麻煩直接查程式碼確認實際狀態並回報，這個不是排隊等待的事項。
> 2. **新增規格第50.2節**：All-in報價格式新增輸出樣式選擇（總金額 vs 費率），費率單位依運輸模式而定（空運perKg、海運LCL可選perCBM或perRevenueTon、海運FCL可選perContainer），不是只有空運USD/KG這一種情境，費率可以是markup自動算出或手動輸入固定值（對應47.3節SR概念），若段落有47.1節的possible成本組合，要能選擇/並排比較不同組合算出的費率。
>
> 麻煩先查證第1點回報現況，再一起評估這批（47.1+47.3+50.2）要怎麼排進現有的批次規劃，這三個是同一套彈性系統的不同面向，建議一起設計不要分開處理。
