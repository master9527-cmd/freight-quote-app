-- v5 遷移:Case 加 incoterm(參考標籤)+ quote_scope(實際控制報價要收哪幾段錢的開關)(spec 第14節第1點 / 2.1節)
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可(純新增欄位,不影響既有資料;
-- 既有案件 quote_scope 預設三段全收,行為跟現在完全一樣,不會突然漏收錢)

alter table cases add column if not exists incoterm text;
alter table cases add column if not exists quote_scope jsonb not null default '{"export":true,"intl":true,"import":true}'::jsonb;
alter table cases add column if not exists trade_remark text;
