-- v4 遷移:把 currency/fx_rate 從 segments 搬到 fee_lines(spec 第15節)
-- 原因:同一段成本內部常常混用好幾種幣別(如出口段主要人民幣、文件費單獨用美金),
-- 不能再假設整個 segment/lane 只有一種幣別/匯率,改成每一筆 fee_line 自己決定
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可(依序執行,不可跳步)
-- 前置條件:已執行過 migration_v2_feeline_model.sql 與 migration_v3_comparison_quote.sql

-- ============================================================
-- 1) fee_lines 新增 currency/fx_rate 欄位(先允許 currency 為 null,backfill 完再收緊)
-- ============================================================

alter table fee_lines add column if not exists currency text;
alter table fee_lines add column if not exists fx_rate numeric not null default 1;

-- ============================================================
-- 2) 從既有資料 backfill:掛在 segment 底下的 fee_lines,沿用該 segment 目前的 currency/fx_rate
-- ============================================================

update fee_lines fl
set currency = s.currency,
    fx_rate = s.fx_rate
from segments s
where fl.segment_id = s.id and fl.currency is null;

-- 掛在 lane 底下的 fee_lines,沿用該 lane 所屬 segment 目前的 currency/fx_rate
update fee_lines fl
set currency = s.currency,
    fx_rate = s.fx_rate
from lanes l
join segments s on s.id = l.segment_id
where fl.lane_id = l.id and fl.currency is null;

-- ============================================================
-- 3) backfill 完成後,currency 收緊為必填(fx_rate 已在新增欄位時設定 not null default 1)
-- ============================================================

alter table fee_lines alter column currency set not null;

-- ============================================================
-- 4) segments.currency 改名為 default_currency,語意改成「新增費用項目時預帶入的幣別」,不再參與計算;
--    segments.fx_rate 不再需要(計算改用每筆 fee_lines 自己的 fx_rate),直接移除
-- ============================================================

alter table segments rename column currency to default_currency;
alter table segments alter column default_currency drop not null;
alter table segments drop column fx_rate;
