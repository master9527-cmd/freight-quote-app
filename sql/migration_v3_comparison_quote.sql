-- v3 遷移:比較分析 / 報價分頁 + 港口/機場自動完成常用清單
-- 對應 spec 第3、4節「必須產出的具體畫面/元件」+ 第6.5.2節
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可(純新增,不影響既有資料)

-- ============================================================
-- cases 補欄位:報價賣價模式(markup 自動算 / 手動輸入)+ 成本基準(Subtotal/Total)
-- ============================================================

alter table cases add column if not exists sell_mode text not null default 'markup' check (sell_mode in ('markup','manual'));
alter table cases add column if not exists manual_sell jsonb;   -- sell_mode='manual' 時使用:{ export, intl, import }(數字)
alter table cases add column if not exists cost_basis text not null default 'total' check (cost_basis in ('subtotal','total'));

-- ============================================================
-- location_favorites — 使用者的港口/機場/陸運交接點常用清單(spec 6.5.2)
-- ============================================================

create table if not exists location_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('airport','seaport','land')),
  code text not null,        -- 機場 IATA 代碼 / 港口 UN-LOCODE 代碼 / 陸運自訂代碼(用輸入文字本身當 code)
  label text not null,       -- 顯示用文字,如 "TPE — Taipei Taoyuan"
  use_count int not null default 1,
  last_used_at timestamptz not null default now(),

  unique (user_id, kind, code)
);

create index if not exists idx_location_favorites_user_kind on location_favorites(user_id, kind);

alter table location_favorites enable row level security;

create policy "user can manage own location favorites"
  on location_favorites for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
