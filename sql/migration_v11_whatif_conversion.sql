-- v11 遷移(第43/47.2節,以第48.2節統整公式表為準):FeeLine新增conversion_weight_kg(每單位換算重量)+
-- include_in_whatif(是否納入What-if混合每KG成本),讓非perKgBreak的成本項目也能併入情境重量分析:
-- - conversion_weight_kg:只對basis in ('perPallet','perCarton','perPalletPerDay')有意義,選填。有填代表
--   這筆成本要用固定比例(amount÷conversion_weight_kg)併入What-if混合每KG成本分析(spec 47.2預設模式),
--   null代表不併入(預設,向下相容)
-- - include_in_whatif:只對basis in ('perContainer','perContainerPerDay','perChassisPerDay')有意義,
--   預設false(spec 48.2:貨櫃/底盤成本業界慣例不換算成每KG比較,比照直接看「每櫃」即可),使用者可勾選
--   納入這個option的「混合每KG成本」指標——這個欄位只影響混合每KG指標,不影響Subtotal/Total金額本身
--   (金額不論這個欄位為何都照樣計入,沿用既有行為)
--
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可
-- 前置條件:已執行過 migration_v2 ~ migration_v10
--
-- 這是單純新增兩個欄位,不改動既有資料、不需要資料轉換:
-- conversion_weight_kg可為空、不加check constraint(使用者自訂數字);
-- include_in_whatif not null default false,對既有列全部補上false(等同「維持現況:不納入」),不需要額外轉換

begin;

alter table fee_lines add column if not exists conversion_weight_kg numeric;
alter table fee_lines add column if not exists include_in_whatif boolean not null default false;

commit;
