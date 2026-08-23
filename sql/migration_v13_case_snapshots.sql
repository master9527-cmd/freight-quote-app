-- v13 遷移(第49.3節):版本記錄與快照系統——新增case_snapshots表,取代原本只有「報價匯出時凍結」這個
-- 較窄的構想,改成完整版本管理:手動存檔+報價匯出自動存檔並存,案件明細頁列出版本記錄,每個版本能
-- 「還原到這個版本」或「以此版本為範本建立新案件」。
--
-- 跟既有的rate_snapshots(spec 9.1,議價歷史快照,僅tender案件的單一agent/lane報價記錄)是完全不同的
-- 兩件事,不要混淆:rate_snapshots記的是「某個代理某條Lane在某一輪報價的成本內容」,這裡的case_snapshots
-- 記的是「整個案件當下的完整狀態」(案件設定+所有代理/段落/Lane/FeeLine),範圍大很多。
--
-- full_data結構:quote_type='project'的案件是{ case, scenarios:[{scenario,agents}] },
-- 否則是{ case, agents }——agents是fetchAgentsWithCosts()回傳的巢狀結構(含segments/lanes/feeLines)。
-- summary是存檔當下算好的{sumSubtotal,sumTotal,currency}(非project)或{scenarioCount}(project),
-- 純供版本記錄列表快速顯示用,不用每次重新展開full_data重算。
--
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可
-- 前置條件:已執行過 migration_v2 ~ migration_v12

begin;

create table if not exists case_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  label text not null,
  snapshot_type text not null check (snapshot_type in ('manual', 'quote_export')),
  full_data jsonb not null,
  summary jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_snapshots_case_id on case_snapshots(case_id);

alter table case_snapshots enable row level security;

create policy "user can manage case_snapshots of own cases"
  on case_snapshots for all
  using (exists (select 1 from cases c where c.id = case_snapshots.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from cases c where c.id = case_snapshots.case_id and c.user_id = auth.uid()));

commit;
