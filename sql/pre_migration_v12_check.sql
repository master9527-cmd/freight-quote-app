-- migration_v12_allin_rate.sql 執行前的準備腳本
-- 使用方式:到 Supabase SQL Editor,依序執行下面 3 段(每段結果都留著,之後跟 migration 後的結果比對)
-- 完成後才執行 migration_v12_allin_rate.sql 本體

-- ============================================================
-- 1) 備份 cases/scenarios 全表(比手動 export CSV 更保險,migration 失敗要救援/比對都方便)
--    若這些備份表已存在(重跑這個腳本),先手動確認是否要保留舊備份,再決定要不要 drop 掉重建
-- ============================================================
create table if not exists cases_backup_v12 as
select * from cases;

create table if not exists scenarios_backup_v12 as
select * from scenarios;

-- ============================================================
-- 2) 確認 allin_output_style/allin_rate_unit 這兩個欄位目前還不存在(migration前的預期狀態)
--    這份migration本身不改動任何既有資料、不需要資料轉換——只要確認新增前欄位不存在、
--    新增後所有既有列的allin_output_style都是'lumpSum'、allin_rate_unit都是null即可
-- ============================================================
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name in ('cases', 'scenarios') and column_name in ('allin_output_style', 'allin_rate_unit')
order by table_name, column_name;
-- 預期:migration前這個查詢應該回傳0筆

-- ============================================================
-- 3) 列出目前quote_format='allin'的案件/情境,當作migration前的基準筆數存證——
--    migration後可以用這份資料核對:(a) 這些列的quote_format/其餘既有欄位完全沒變
--    (b) 新增的allin_output_style欄位對這些既有列都是'lumpSum'(不是被意外帶入其他值)
-- ============================================================
select id, ref, name, mode, quote_format, sell_mode
from cases
where quote_format = 'allin'
order by name;

select id, case_id, label, mode, quote_format, sell_mode
from scenarios
where quote_format = 'allin'
order by label;
