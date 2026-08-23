# 國際貨運報價作業台

純 HTML/CSS/JS 專案,不需要 Node.js 建置流程。詳細規格見 `freight-quote-app-spec.md`。

## 專案結構

```
index.html                登入 / 註冊頁
app.html                   案件列表 + 建立案件
case.html                  案件明細:分頁(代理成本 / 比較分析 / 報價)
css/style.css              樣式
sql/schema.sql             Supabase 資料表結構(全新專案用,SQL Editor 執行)
sql/migration_v2_feeline_model.sql  v1→v2 升級(FeeLine 模型)
sql/migration_v3_comparison_quote.sql  v2→v3 升級(報價欄位 + 常用清單表)
sql/migration_v4_feeline_currency.sql  v3→v4 升級(currency/fx_rate 從 segments 搬到 fee_lines)
sql/migration_v5_incoterm_quotescope.sql  v4→v5 升級(cases 加 incoterm/quote_scope/trade_remark)
sql/migration_v6_ratetable_v4.sql  v5→v6 升級(幣別架構v4:rate_table/agent.role/quote_currency_by_segment)
sql/migration_v7_project_scenario.sql  v6→v7 升級(quote_type新增project、scenarios表、agents.scenario_id、lanes船期欄位)
sql/migration_v8_lane_ports.sql        v7→v8 升級(第40.2節:lanes新增from_port/to_port結構化欄位,跟routing並存)
sql/migration_v9_basis_split.sql       v8→v9 升級(第40.1節:perUnit拆分成perContainer/perPallet/perCarton,perUnitPerDay拆分成perContainerPerDay/perPalletPerDay/perChassisPerDay,含既有資料自動轉換)
js/data/airports.json      機場自動完成資料(離線處理自 OurAirports,約 8,800 筆有 IATA 代碼的機場)
js/data/seaports.json      海港自動完成資料(離線處理自 UN/LOCODE,約 17,500 筆有港口 function 的地點)
js/data/containerSpecs.json 貨櫃規格參考資料(第35節:外徑/內徑/最大負載/容積,供貨櫃規格彈出視窗使用)
js/config.js               Supabase 連線設定(需自行填入)
js/supabaseClient.js       Supabase client 初始化
js/auth.js                 登入/註冊邏輯
js/app.js                  共用:session 檢查 + header(email 顯示 + 登出)
js/labels.js               共用:中文標籤對照表 + escapeHtml + 貨櫃類型標準參考/正規化
js/containerSpecPopup.js   貨櫃規格彈出視窗元件(第35節):貨櫃類型欄位旁的ⓘ圖示,點擊查看規格卡片
js/pricing.js               共用成本計算引擎(feeLineAmount/subtotal/total)+ fetchAgentsWithCosts(比較/報價分頁共用查詢)
js/locationAutocomplete.js  港口/機場自動完成元件 + 常用清單(location_favorites)
js/ref.js                  報價編號(ref)自動產生邏輯
js/cases.js                案件列表載入 + 建立案件表單
js/caseDetail.js           案件明細載入、代理新增/刪除、案件編輯
js/segmentForm.js          Segment 卡片:defaultCurrency(僅預帶入用)/from-to(含自動完成)/useLanes + FeeLine 清單編輯器(每筆自己的 currency/fxRate)+ Lane 巢狀清單
js/aiImport.js              AI 智慧匯入(第5節/第36節):案件層級精靈(主要入口,貼資料→AI解析→建立新代理/併入既有代理→分層預覽→套用)+ 代理卡片內嵌次要入口,共用同一套解析/預覽/寫入邏輯
supabase/functions/ai-parse-costs/index.ts  AI 智慧匯入的 Supabase Edge Function,伺服器端呼叫 Anthropic API(金鑰存 Supabase secrets,不暴露在前端)
js/comparison.js           「比較分析」分頁:代理×三段矩陣、Lane 展開、警示、選段、成本總覽、匯出比較表 Excel
js/quote.js                「報價」分頁:markup/手動賣價切換、即時利潤、quoteFormat 三選一、匯出報價單 PDF/Excel
js/tabs.js                  案件明細頁三個分頁的切換邏輯
```

## 設定 Supabase(必要,否則無法登入)

1. 到 https://supabase.com 註冊並建立一個新專案。
2. 進入該專案的 **Project Settings → API**,複製:
   - **Project URL**
   - **anon public** key
3. 打開 `js/config.js`,把這兩個值分別貼到 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`。
4. 在 Supabase 後台 **Authentication → Providers**,確認 **Email** 登入方式是啟用的(預設就是啟用)。
5. 若不想每次註冊都要收驗證信,可到 **Authentication → Settings** 關閉 "Confirm email"(僅建議開發階段這樣做)。

## 本機預覽

這是純靜態網站,但**港口/機場自動完成需要用 `fetch()` 讀取 `js/data/*.json`**,直接用瀏覽器打開 `file://.../index.html` 在部分瀏覽器(尤其 Chrome)會被 CORS 擋掉導致資料載入失敗(自動完成會退化成只剩「常用清單」)。建議一律透過本機靜態伺服器預覽,例如 VS Code 的 Live Server 套件,或在專案目錄下執行 `python -m http.server 8000` 後開 `http://localhost:8000`。正式部署到 Netlify/Cloudflare Pages 沒有這個問題。

## 建立/升級資料表結構

**全新專案**:到 Supabase 後台 SQL Editor,依序貼上執行 `sql/schema.sql`(會建立 `user_settings / cases / scenarios / agents / segments / lanes / fee_lines / rate_snapshots / case_snapshots / location_favorites` 十張表 + RLS,已含最新欄位)。

**已有專案要升級**:依序執行(每份只需執行一次):
1. `sql/migration_v2_feeline_model.sql` — v1→v2,FeeLine 統一模型(會 DROP 重建 `segments/lanes/fee_lines`,`cases/agents` 不受影響)
2. `sql/migration_v3_comparison_quote.sql` — v2→v3,新增 `cases.sell_mode/manual_sell/cost_basis` 欄位 + `location_favorites` 表(純新增,不影響既有資料)
3. `sql/migration_v4_feeline_currency.sql` — v3→v4
4. `sql/migration_v5_incoterm_quotescope.sql` — v4→v5
5. `sql/migration_v6_ratetable_v4.sql` — v5→v6
6. `sql/migration_v7_project_scenario.sql` — v6→v7,新增 `scenarios` 表(Project案件情境)+ `agents.scenario_id` + `lanes` 船期欄位(純新增,既有 inquiry/tender 案件不受影響)
7. `sql/migration_v8_lane_ports.sql` — v7→v8,新增 `lanes.from_port`/`lanes.to_port`(第40.2節,結構化起訖點欄位,純新增,不影響既有 `routing` 資料)
8. `sql/migration_v9_basis_split.sql` — v8→v9,**第40.1節重大架構調整**:`fee_lines.basis` 拆分(`perUnit`→`perContainer`/`perPallet`/`perCarton`,`perUnitPerDay`→`perContainerPerDay`/`perPalletPerDay`/`perChassisPerDay`),新增 `fee_lines.days` 欄位,並自動轉換既有 `perUnit` 資料。**執行前請務必先備份 `fee_lines` 表**,詳見該檔案開頭的說明註解(含一項重要提醒:部分過去因為單位類型字串對不上貨量資訊而靜默算成0元的費用,migration後會開始正確計入總成本,這是修正後的正確金額)
9. `sql/migration_v10_option_group.sql` — v9→v10,第47.1節:`fee_lines` 新增 `option_group`/`option_value`(可能成本互斥子群組),純新增欄位
10. `sql/migration_v11_whatif_conversion.sql` — v10→v11,第43/47.2/48.2節:`fee_lines` 新增 `conversion_weight_kg`/`include_in_whatif`(What-if混合每KG成本併入設定),純新增欄位
11. `sql/migration_v12_allin_rate.sql` — v11→v12,第50.2節:`cases`/`scenarios` 新增 `allin_output_style`/`allin_rate_unit`(All-in報價費率輸出樣式),純新增欄位
12. `sql/migration_v13_case_snapshots.sql` — v12→v13,第49.3節:新增 `case_snapshots` 表(版本記錄與快照系統),純新增資料表

## 資料模型重點

- **v2(FeeLine 統一模型)**:Segment 不再是「選一種 pricingType」,而是「一份 FeeLine 清單」,每筆費用自己決定 `basis`(flat/perShipment/perKg/perUnit/perKgBreak),可以在同一段混用。需要比較多航線/多船公司時才開啟 `useLanes`,改在每條 Lane 底下各自維護一份 FeeLine 清單。詳見 spec 2.3–2.5。
- **v3(報價欄位)**:`cases.sell_mode`(markup/manual)、`cases.manual_sell`、`cases.cost_basis`(subtotal/total)支援報價分頁的兩種賣價輸入模式。

## 港口/機場自動完成

資料來源為公開資料集,離線處理後存成靜態 JSON(不即時打外部 API):
- 機場:[OurAirports](https://ourairports.com/data/) `airports.csv`,篩選有 IATA 代碼的 large/medium/small airport,約 8,800 筆
- 海港:[UN/LOCODE](https://unece.org/uncefact/locode) 官方代碼表,篩選 Function 含「港口」(1)的地點,約 17,500 筆
- 陸運交接點沒有標準化公開清單,維持文字輸入 + 使用者「常用清單」(`location_favorites` 表)逐漸累積
- 依 `case.mode` 自動決定顯示機場或海港清單;使用者選過的項目會存進常用清單,下次輸入同類型欄位時優先顯示在最上面

## AI 智慧匯入 Edge Function 部署(第5節/第36節)

前端(`js/aiImport.js` + `case.html`/`js/caseDetail.js` 的兩個入口)已完成,但 AI 判讀要透過 Supabase Edge Function 代打 Anthropic API(金鑰不能放在瀏覽器端),需要額外部署這個 function 才能實際使用:

1. **建立 function**:到 Supabase 後台 **Edge Functions** → 新增一個名為 `ai-parse-costs` 的 function,把 `supabase/functions/ai-parse-costs/index.ts` 的內容貼上去。若有安裝 [Supabase CLI](https://supabase.com/docs/guides/cli),也可以在專案根目錄執行 `supabase functions deploy ai-parse-costs`。
2. **設定 API 金鑰**:到 Supabase 後台 **Edge Functions → Secrets**(或用 CLI:`supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`),新增 `ANTHROPIC_API_KEY`,值是你的 [Anthropic API 金鑰](https://console.anthropic.com/settings/keys)。
3. **不用改前端任何設定**:部署完成後,`js/aiImport.js` 透過 `supabaseClient.functions.invoke('ai-parse-costs', ...)` 呼叫,會自動打到同一個 Supabase 專案底下的這個 function,不需要額外的 URL 設定。
4. 若還沒完成上述步驟就點擊「AI 智慧匯入」,「開始解析」會顯示清楚的錯誤訊息(而不是卡住或空白),完成部署後重新整理頁面即可正常使用。

## 目前完成度(對應 spec 第 8 節)

- [x] 1. 專案骨架 + Supabase 連線 + 帳號登入(Email + 密碼)
- [x] 2. 依 2.1–2.5(v2 FeeLine 模型,含第9節擴充)建立 Supabase 資料表結構
- [x] 3a. 案件列表 + 建立案件(app.html)+ 案件編輯(case.html,含 mode 動態欄位標籤)
- [x] 3b. 成本輸入 v2:Segment 的 FeeLine 清單(flat/perShipment/perKg/perUnit/perKgBreak 混用)+ 選用 Lane(每條 Lane 內嵌自己的 FeeLine 清單)
- [x] 4. 比較分析分頁:代理×三段矩陣、Lane 展開、9.3 警示、選段、成本總覽、套用最低成本組合、匯出比較表 Excel
- [x] 5a. 報價分頁:markup/手動賣價切換、即時總成本/報價總價/利潤、quoteFormat 三選一預覽、抬頭覆蓋、匯出報價單 PDF + Excel
- [x] 6.5.2 港口/機場自動完成(OurAirports + UN/LOCODE)+ 常用清單
- [x] 6. AI 智慧匯入(第5節/第36節):案件層級精靈(主要入口)+ 代理卡片內嵌(次要入口),多格式判讀(文字/PDF/Excel/Word/圖片)+ 分層預覽確認。**前端 UI 與 Supabase Edge Function 原始碼已完成,但需要使用者自行部署 Edge Function 並設定 `ANTHROPIC_API_KEY` 後才能端對端驗證(見下方部署章節)**
- [ ] 6.5.1 卡片預設收折(accordion)UI 優化
- [ ] 2.3/11 起訖點鏈式帶入(export→intl→import 自動銜接)
- [ ] 7. 部署
