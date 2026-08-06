-- 國際貨運報價作業台 — Supabase 資料表結構
-- (v2 統一 FeeLine 清單模型 + v3 比較/報價分頁 + v4 幣別下移 FeeLine 層級 + v5 incoterm/quoteScope)
-- 對應 spec 2.1–2.5(核心模型)+ 第9節補充 + 第10節修正1、2 + 第14節第1點 + 第15節(currency/fx_rate 搬到 fee_lines)
-- 使用方式:全新專案直接複製整份貼到 Supabase SQL Editor 執行;
-- 若是從既有專案升級,依序執行 sql/migration_v2_feeline_model.sql → migration_v3_comparison_quote.sql
--   → migration_v4_feeline_currency.sql → migration_v5_incoterm_quotescope.sql

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- user_settings — 使用者的預設抬頭等偏好設定
-- ============================================================

create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_letterhead jsonb,   -- { companyName, slogan, address, contact, terms }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "user can manage own settings"
  on user_settings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger trg_user_settings_updated_at
  before update on user_settings
  for each row execute function set_updated_at();

-- ============================================================
-- cases — 詢價案件(spec 2.1 + 9.1 tender 擴充)
-- ============================================================

create table cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  ref text,                     -- 報價編號,如 SEA-TPELAX-260725-42(產生邏輯留給前端)
  name text not null,
  origin text,
  destination text,
  mode text not null check (mode in (
    'air','sea_fcl','sea_lcl','land','rail','cross_border_trucking','multimodal'
  )),
  quote_type text not null check (quote_type in ('inquiry','tender')),
  quote_currency text not null,

  cargo jsonb not null default '{}'::jsonb,      -- { units:[{type,qty}], chargeableWeightKg, shipmentQty }
  selection jsonb not null default '{}'::jsonb,  -- { export:{agentId,laneId}, intl:{...}, import:{...} }
  markup jsonb not null default '{}'::jsonb,     -- { export:{mode,value}, intl:{...}, import:{...} }
  quote_format text check (quote_format in ('allin','segment','items')),
  letterhead jsonb,              -- 個別覆蓋,null 則繼承 user_settings.default_letterhead

  -- spec 2.1(第14節第1點):incoterm 是參考標籤,quote_scope 才是實際控制報價要收哪幾段錢的開關,兩者分開不強制綁死
  incoterm text,
  quote_scope jsonb not null default '{"export":true,"intl":true,"import":true}'::jsonb,
  trade_remark text,             -- 例如三角貿易等例外狀況的說明,供日後回顧

  -- 報價分頁(spec 4)
  sell_mode text not null default 'markup' check (sell_mode in ('markup','manual')),
  manual_sell jsonb,             -- sell_mode='manual' 時使用:{ export, intl, import }(數字)
  cost_basis text not null default 'total' check (cost_basis in ('subtotal','total')),

  -- tender(月標)專用,spec 9.1
  bidding_round text,
  validity_start date,
  validity_end date,
  committed_volume text,

  -- spec 9.3 警示門檻
  max_stops_allowed int,
  max_transit_days_allowed int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cases_user_id on cases(user_id);

alter table cases enable row level security;

create policy "user can manage own cases"
  on cases for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger trg_cases_updated_at
  before update on cases
  for each row execute function set_updated_at();

-- ============================================================
-- agents — 代理報價(spec 2.2)
-- ============================================================

create table agents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_agents_case_id on agents(case_id);

alter table agents enable row level security;

create policy "user can manage agents of own cases"
  on agents for all
  using (exists (select 1 from cases c where c.id = agents.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from cases c where c.id = agents.case_id and c.user_id = auth.uid()));

create trigger trg_agents_updated_at
  before update on agents
  for each row execute function set_updated_at();

-- ============================================================
-- segments — 單一運輸段(spec 2.3 v2:不再存 pricingType,只存段落層級設定,
-- 實際成本改由獨立的 fee_lines 表表示)
-- 每個 agent 剛好有 export / intl / import 三個 segment
-- ============================================================

create table segments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  segment_type text not null check (segment_type in ('export','intl','import')),

  default_currency text,   -- spec 第15節:純粹是「新增費用項目時預帶入的幣別」,不參與計算,實際計算一律用 fee_lines 自己的 currency/fx_rate

  from_location text,      -- 標籤依 case.mode 動態顯示(AOL/POL/Pickup from/From...)
  to_location text,         -- 同上(AOD/POD/Delivery to/To...)

  use_lanes boolean not null default false,  -- true 時改用 lanes,忽略此 segment 直屬的 fee_lines

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (agent_id, segment_type)
);

create index idx_segments_agent_id on segments(agent_id);

alter table segments enable row level security;

create policy "user can manage segments of own cases"
  on segments for all
  using (exists (
    select 1 from agents a join cases c on c.id = a.case_id
    where a.id = segments.agent_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from agents a join cases c on c.id = a.case_id
    where a.id = segments.agent_id and c.user_id = auth.uid()
  ));

create trigger trg_segments_updated_at
  before update on segments
  for each row execute function set_updated_at();

-- ============================================================
-- lanes — 多航線/多船公司比較(spec 2.5 v2:不再有 fromPort/toPort/truckingBreaks,
-- 級距費率改用內部一筆 basis='perKgBreak' 的 FeeLine 表示)
-- 僅 segment.use_lanes = true 時使用
-- ============================================================

create table lanes (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments(id) on delete cascade,

  carrier text,                 -- 船/航空公司代號,或鐵路/卡車班次代號
  routing text,                 -- 路由描述
  transit_days_min int,
  transit_days_max int,
  stops_count int,
  validity_start date,
  validity_end date,
  incoterm text,
  remark text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_lanes_segment_id on lanes(segment_id);

alter table lanes enable row level security;

create policy "user can manage lanes of own cases"
  on lanes for all
  using (exists (
    select 1 from segments s join agents a on a.id = s.agent_id join cases c on c.id = a.case_id
    where s.id = lanes.segment_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from segments s join agents a on a.id = s.agent_id join cases c on c.id = a.case_id
    where s.id = lanes.segment_id and c.user_id = auth.uid()
  ));

create trigger trg_lanes_updated_at
  before update on lanes
  for each row execute function set_updated_at();

-- ============================================================
-- fee_lines — 費用項目(spec 2.4 v2:獨立表,每筆費用自己決定 basis,
-- 掛在 segment(use_lanes=false)或 lane(use_lanes=true)之一)
-- ============================================================

create table fee_lines (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid references segments(id) on delete cascade,
  lane_id uuid references lanes(id) on delete cascade,

  name text not null,
  certainty text not null check (certainty in ('certain','possible')),
  remark text,

  currency text not null,        -- spec 第15節:每筆費用自己的原始幣別,不假設整段/整條 Lane 只有一種幣別
  fx_rate numeric not null default 1,  -- 換算成 case.quote_currency 的匯率;currency 與 quote_currency 相同時固定為 1

  basis text not null check (basis in ('flat','perShipment','perKg','perUnit','perKgBreak')),

  amount numeric,              -- basis: flat | perShipment | perKg
  amount_by_type jsonb,        -- basis: perUnit → [{type, amount}]
  min_charge numeric,          -- basis: perKgBreak
  breaks jsonb,                -- basis: perKgBreak → [{thresholdKg, ratePerKg}]

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fee_lines_exactly_one_parent check (
    (segment_id is not null and lane_id is null) or
    (segment_id is null and lane_id is not null)
  )
);

create index idx_fee_lines_segment_id on fee_lines(segment_id);
create index idx_fee_lines_lane_id on fee_lines(lane_id);

alter table fee_lines enable row level security;

create policy "user can manage fee_lines of own cases"
  on fee_lines for all
  using (
    exists (
      select 1 from segments s join agents a on a.id = s.agent_id join cases c on c.id = a.case_id
      where s.id = fee_lines.segment_id and c.user_id = auth.uid()
    )
    or exists (
      select 1 from lanes l join segments s on s.id = l.segment_id join agents a on a.id = s.agent_id join cases c on c.id = a.case_id
      where l.id = fee_lines.lane_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from segments s join agents a on a.id = s.agent_id join cases c on c.id = a.case_id
      where s.id = fee_lines.segment_id and c.user_id = auth.uid()
    )
    or exists (
      select 1 from lanes l join segments s on s.id = l.segment_id join agents a on a.id = s.agent_id join cases c on c.id = a.case_id
      where l.id = fee_lines.lane_id and c.user_id = auth.uid()
    )
  );

create trigger trg_fee_lines_updated_at
  before update on fee_lines
  for each row execute function set_updated_at();

-- ============================================================
-- rate_snapshots — 議價歷史快照(spec 9.1,僅 tender 案件使用)
-- ============================================================

create table rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  lane_id uuid references lanes(id) on delete set null,

  captured_at timestamptz not null default now(),
  round_label text,             -- 如 "R2"
  summary jsonb not null        -- 該次快照的成本內容,自由格式,供日後比對
);

create index idx_rate_snapshots_case_id on rate_snapshots(case_id);

alter table rate_snapshots enable row level security;

create policy "user can manage rate_snapshots of own cases"
  on rate_snapshots for all
  using (exists (select 1 from cases c where c.id = rate_snapshots.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from cases c where c.id = rate_snapshots.case_id and c.user_id = auth.uid()));

-- ============================================================
-- location_favorites — 使用者的港口/機場/陸運交接點常用清單(spec 6.5.2)
-- ============================================================

create table location_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('airport','seaport','land')),
  code text not null,        -- 機場 IATA 代碼 / 港口 UN-LOCODE 代碼 / 陸運自訂代碼(用輸入文字本身當 code)
  label text not null,       -- 顯示用文字,如 "TPE — Taipei Taoyuan"
  use_count int not null default 1,
  last_used_at timestamptz not null default now(),

  unique (user_id, kind, code)
);

create index idx_location_favorites_user_kind on location_favorites(user_id, kind);

alter table location_favorites enable row level security;

create policy "user can manage own location favorites"
  on location_favorites for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
