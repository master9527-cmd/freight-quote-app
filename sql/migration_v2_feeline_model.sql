-- v2 資料模型遷移:Segment 從「單一 pricingType」改為「統一 FeeLine 清單」
-- 對應 spec 2.3–2.5 + 第10節修正1、2
-- 影響範圍:segments / lanes / fee_lines 三張表(DROP 重建,測試資料會遺失)
-- cases / agents / user_settings / rate_snapshots 不受影響
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次

drop table if exists fee_lines cascade;
drop table if exists lanes cascade;
drop table if exists segments cascade;

-- ============================================================
-- segments — 單一運輸段(spec 2.3 v2:不再存 pricingType,只存段落層級設定)
-- ============================================================

create table segments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  segment_type text not null check (segment_type in ('export','intl','import')),

  currency text not null,
  fx_rate numeric not null default 1,

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
-- lanes — 多航線/多船公司比較(spec 2.5 v2:不再有 fromPort/toPort/truckingBreaks)
-- 僅 segment.use_lanes = true 時使用
-- ============================================================

create table lanes (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments(id) on delete cascade,

  carrier text,
  routing text,
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
-- fee_lines — 費用項目(spec 2.4 v2:獨立表,掛在 segment 或 lane 之一)
-- Segment.useLanes = false → segment_id 有值、lane_id 為 null
-- Segment.useLanes = true  → 掛在對應 Lane,lane_id 有值、segment_id 為 null
-- ============================================================

create table fee_lines (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid references segments(id) on delete cascade,
  lane_id uuid references lanes(id) on delete cascade,

  name text not null,
  certainty text not null check (certainty in ('certain','possible')),
  remark text,

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
