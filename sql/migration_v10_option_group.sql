-- v10 遷移(第47.1節,修正為兩層框架):FeeLine新增option_group(互斥家族名稱)+option_value(該家族底下的選項值)
-- 兩個欄位,支援「可能成本互斥子群組」——手算範例裡possible成本被分成「一般倉」/「保稅倉」兩組互斥方案
-- (二選一,不是都算),但這只是其中一種用法,不限倉儲:同一個agent/lane底下可能同時存在多組互相獨立的
-- 「幾選一」決策(如倉儲方案跟報關方式各自獨立選),所以用「家族名稱」+「家族內選項值」兩層,而不是單一標籤——
-- 同一個option_group(家族)底下、option_value不同的possible費用互斥,不同option_group之間互相獨立。
-- (47.1節另一半:沒有option_group的possible成本,逐筆勾選是否計入的狀態存在case/scenario的selection欄位,
-- 不是fee_lines自己的欄位,所以這裡不需要額外的DB異動)
--
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可
-- 前置條件:已執行過 migration_v2 ~ migration_v9
--
-- 這是單純新增兩個可為空的自由文字欄位,不改動既有資料、不需要資料轉換、不加check constraint
-- (家族名稱/選項值都是使用者自訂字串,如「倉儲方案」/「保稅倉」,不是固定枚舉)。

begin;

alter table fee_lines add column if not exists option_group text;
alter table fee_lines add column if not exists option_value text;

commit;
