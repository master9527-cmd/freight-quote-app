-- migration_v13_case_snapshots.sql 執行前的準備腳本
-- 使用方式:到 Supabase SQL Editor,依序執行下面 2 段,確認結果後再執行 migration_v13_case_snapshots.sql 本體
-- 這是純新增一張新表(不改動任何既有表/資料),風險低,不需要像fee_lines/cases那樣先備份既有資料

-- ============================================================
-- 1) 確認 case_snapshots 表目前還不存在(migration前的預期狀態)
-- ============================================================
select table_name
from information_schema.tables
where table_schema = 'public' and table_name = 'case_snapshots';
-- 預期:migration前這個查詢應該回傳0筆

-- ============================================================
-- 2) 確認既有的rate_snapshots表(議價歷史快照,spec 9.1)存在且不受這次migration影響——
--    這是為了避免使用者事後把兩張表搞混,順便確認既有表安然無恙
-- ============================================================
select count(*) as existing_rate_snapshots_count from rate_snapshots;
