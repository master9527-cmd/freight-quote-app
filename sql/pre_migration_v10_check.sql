-- migration_v10_option_group.sql 執行前的準備腳本
-- 使用方式:到 Supabase SQL Editor,依序執行下面 3 段(每段結果都留著,之後跟 migration 後的結果比對)
-- 完成後才執行 migration_v10_option_group.sql 本體

-- ============================================================
-- 1) 備份 fee_lines 全表(比手動 export CSV 更保險,migration 失敗要救援/比對都方便)
--    若這張備份表已存在(重跑這個腳本),先手動確認是否要保留舊備份,再決定要不要 drop 掉重建
-- ============================================================
create table if not exists fee_lines_backup_v10 as
select * from fee_lines;

-- ============================================================
-- 2) 確認 option_group/option_value 這兩個欄位目前還不存在(migration前的預期狀態)
--    這份migration本身不改動任何既有資料、不加check constraint,純粹新增兩個可為空欄位,
--    所以跟v9不一樣,不需要「哪些列金額會變」這種比對——只要確認新增前欄位不存在、
--    新增後所有既有列的兩個新欄位都是null即可
-- ============================================================
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'fee_lines' and column_name in ('option_group', 'option_value');
-- 預期:migration前這個查詢應該回傳0筆

-- ============================================================
-- 3) 列出目前所有certainty='possible'的費用列,當作migration前的基準筆數/內容存證——
--    migration後可以用這份資料核對:(a) possible費用列的筆數/內容完全沒變
--    (b) 新增的option_group/option_value兩欄對這些既有列全部是null(不是被意外帶入預設值)
-- ============================================================
select
  c.id as case_id,
  c.name as case_name,
  c.ref as case_ref,
  a.name as agent_name,
  fl.id as fee_line_id,
  fl.name as fee_line_name,
  fl.basis,
  fl.certainty,
  fl.amount,
  fl.amount_by_type,
  fl.currency,
  fl.remark
from fee_lines fl
left join segments s on s.id = fl.segment_id
left join lanes ln on ln.id = fl.lane_id
left join agents a on a.id = coalesce(s.agent_id, (select agent_id from segments where id = ln.segment_id))
left join cases c on c.id = a.case_id
where fl.certainty = 'possible'
order by c.name, a.name, fl.id;
