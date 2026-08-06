-- v6 遷移:幣別架構 v4(spec 第21節,取代第15節):FeeLine 移除 fx_rate,
-- 匯率改存在案件層級共用的 cases.rate_table;agents 新增 role(出口/進口代理標籤);
-- cases 新增 quote_currency_by_segment(報價分頁每段可個別顯示的幣別)
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可(依序執行,不可跳步)
-- 前置條件:已執行過 migration_v2 ~ migration_v5

-- ============================================================
-- 1) cases 新增 rate_table / quote_currency_by_segment
-- ============================================================

alter table cases add column if not exists rate_table jsonb not null default '[]'::jsonb;
alter table cases add column if not exists quote_currency_by_segment jsonb;

-- ============================================================
-- 2) backfill:把既有 fee_lines.fx_rate 資料搬進所屬案件的 rate_table,
--    避免使用者升級後要把所有匯率重新輸入一次。
--    同一個案件裡,同一個幣別可能在不同 fee_line 上存了不完全一致的 fx_rate(v3 設計允許逐筆覆蓋),
--    這裡採「該幣別最後一次被更新的那筆 fee_line 的 fx_rate」為準(distinct on ... order by updated_at desc),
--    這只是遷移當下的最佳猜測,遷移後使用者應該到「匯率設定」區塊核對一次數字。
-- ============================================================

with fee_line_currency as (
  -- fee_lines 掛在 segment 或 lane 之一,都要往上找到所屬 case_id
  select
    fl.id, fl.currency, fl.fx_rate, fl.updated_at,
    coalesce(s1.agent_id, s2.agent_id) as agent_id
  from fee_lines fl
  left join segments s1 on s1.id = fl.segment_id
  left join lanes l on l.id = fl.lane_id
  left join segments s2 on s2.id = l.segment_id
  where fl.currency is not null
),
fee_line_case as (
  select flc.id, flc.currency, flc.fx_rate, flc.updated_at, a.case_id
  from fee_line_currency flc
  join agents a on a.id = flc.agent_id
),
latest_per_currency as (
  select distinct on (case_id, currency) case_id, currency, fx_rate
  from fee_line_case
  where fx_rate is not null
  order by case_id, currency, updated_at desc
),
grouped as (
  select case_id, jsonb_agg(jsonb_build_object('currency', currency, 'rate', fx_rate)) as entries
  from latest_per_currency
  where currency <> (select quote_currency from cases c where c.id = latest_per_currency.case_id)
  group by case_id
)
update cases c
set rate_table = grouped.entries
from grouped
where c.id = grouped.case_id
  and (c.rate_table is null or c.rate_table = '[]'::jsonb);

-- ============================================================
-- 3) fee_lines 移除 fx_rate(匯率統一改查 case.rate_table,不再逐筆存)
-- ============================================================

alter table fee_lines drop column if exists fx_rate;

-- ============================================================
-- 4) agents 新增 role(出口地代理/進口地代理/皆可,預設 both,供比較分析頁篩選分組)
-- ============================================================

alter table agents add column if not exists role text not null default 'both'
  check (role in ('export', 'import', 'both'));
