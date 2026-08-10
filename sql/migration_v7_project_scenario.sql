-- v7 遷移:第29節補齊需求
-- 1) quote_type 新增 'project'(多情境案件)+ 新增 scenarios 表(spec 29.1)
-- 2) agents 新增 scenario_id(選填,project案件的代理才會用到,inquiry/tender案件維持 null,行為完全不變)
-- 3) lanes 新增船期/航班附加資訊欄位(spec 29.4,參考用途,不參與成本計算)
-- 4) cargo.units[].qtyMin/qtyMax(spec 29.2)是 jsonb 子欄位,不需要跑 migration
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可
-- 前置條件:已執行過 migration_v2 ~ migration_v6

-- ============================================================
-- 1) cases.quote_type 開放 'project'
-- ============================================================

alter table cases drop constraint if exists cases_quote_type_check;
alter table cases add constraint cases_quote_type_check check (quote_type in ('inquiry', 'tender', 'project'));

-- ============================================================
-- 2) scenarios — Project案件底下的情境(spec 29.1):每個情境是一組完整的
--    mode+cargo+代理成本+比較+報價,共用同一個案件的客戶/Incoterm/rate_table等上層資訊
-- ============================================================

create table scenarios (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,

  label text not null,
  mode text not null check (mode in (
    'air','sea_fcl','sea_lcl','land','rail','cross_border_trucking','multimodal'
  )),
  cargo jsonb not null default '{}'::jsonb,
  selection jsonb not null default '{}'::jsonb,
  markup jsonb not null default '{}'::jsonb,
  quote_format text check (quote_format in ('allin','segment','items')),
  quote_currency_by_segment jsonb,

  sell_mode text not null default 'markup' check (sell_mode in ('markup','manual')),
  manual_sell jsonb,
  cost_basis text not null default 'total' check (cost_basis in ('subtotal','total')),

  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_scenarios_case_id on scenarios(case_id);

alter table scenarios enable row level security;

create policy "user can manage scenarios of own cases"
  on scenarios for all
  using (exists (select 1 from cases c where c.id = scenarios.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from cases c where c.id = scenarios.case_id and c.user_id = auth.uid()));

create trigger trg_scenarios_updated_at
  before update on scenarios
  for each row execute function set_updated_at();

-- ============================================================
-- 3) agents 新增 scenario_id:project案件的代理掛在情境底下,不是直接掛在案件底下;
--    inquiry/tender案件的既有代理 scenario_id 維持 null,查詢/RLS 行為完全不變
-- ============================================================

alter table agents add column if not exists scenario_id uuid references scenarios(id) on delete cascade;
create index if not exists idx_agents_scenario_id on agents(scenario_id);

-- ============================================================
-- 4) lanes 新增船期/航班附加資訊(spec 29.4,參考/附註用途,不參與成本計算):
--    海運:船名/航次、SI/VGM/CY截止時間、ETD/ETA;空運:每週班次;兩者共用:是否直航、轉運站點清單
-- ============================================================

alter table lanes add column if not exists vessel_name text;
alter table lanes add column if not exists voyage_number text;
alter table lanes add column if not exists si_cutoff timestamptz;
alter table lanes add column if not exists vgm_cutoff timestamptz;
alter table lanes add column if not exists cy_cutoff timestamptz;
alter table lanes add column if not exists etd timestamptz;
alter table lanes add column if not exists eta timestamptz;
alter table lanes add column if not exists weekly_frequency text;
alter table lanes add column if not exists is_direct boolean;
alter table lanes add column if not exists transship_points jsonb;
