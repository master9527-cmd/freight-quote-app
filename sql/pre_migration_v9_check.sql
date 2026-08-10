-- migration_v9_basis_split.sql 執行前的準備腳本
-- 使用方式:到 Supabase SQL Editor,依序執行下面 3 段(每段結果都留著,之後跟 migration 後的結果比對)
-- 完成後才執行 migration_v9_basis_split.sql 本體

-- ============================================================
-- 1) 備份 fee_lines 全表(比手動 export CSV 更保險,migration 失敗要救援/比對都方便)
--    若這張備份表已存在(重跑這個腳本),先手動確認是否要保留舊備份,再決定要不要 drop 掉重建
-- ============================================================
create table if not exists fee_lines_backup_v9 as
select * from fee_lines;

-- ============================================================
-- 2) 確認目前資料庫裡「所有」basis='perUnit'的費用列,連同所屬案件名稱,
--    不只看廣泰/Arcadyan這兩個已知案件——先前實測時在真實資料庫發現至少4筆金額會被migration修正,
--    這裡把全部案件都列出來,避免漏掉廣泰/Arcadyan以外、金額也會變動的案件
-- ============================================================
select
  c.id as case_id,
  c.name as case_name,
  c.ref as case_ref,
  fl.id as fee_line_id,
  fl.name as fee_line_name,
  fl.currency,
  fl.amount_by_type,
  fl.remark
from fee_lines fl
left join segments s on s.id = fl.segment_id
left join lanes ln on ln.id = fl.lane_id
left join agents a on a.id = coalesce(s.agent_id, (select agent_id from segments where id = ln.segment_id))
left join cases c on c.id = a.case_id
where fl.basis = 'perUnit'
order by c.name, fl.id;

-- ============================================================
-- 3) 針對廣泰、Arcadyan這兩個已知會變動金額的案件,列出完整代理成本明細,
--    當作migration前的「金額存證」——之後若要跟客戶對帳/電話說明,這份資料就是原始依據
-- ============================================================
select
  c.id as case_id,
  c.name as case_name,
  a.name as agent_name,
  fl.id as fee_line_id,
  fl.name as fee_line_name,
  fl.basis,
  fl.amount,
  fl.amount_by_type,
  fl.currency,
  fl.remark
from fee_lines fl
left join segments s on s.id = fl.segment_id
left join lanes ln on ln.id = fl.lane_id
left join agents a on a.id = coalesce(s.agent_id, (select agent_id from segments where id = ln.segment_id))
left join cases c on c.id = a.case_id
where c.name ilike '%廣泰%' or c.name ilike '%Arcadyan%'
order by c.name, a.name, fl.id;
