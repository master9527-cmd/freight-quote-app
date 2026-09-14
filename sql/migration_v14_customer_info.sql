-- v14 遷移(第4節/客戶抬頭補做):新增cases.customer_info——報價單「報價對象」欄位區塊
-- { companyName, contactPerson, address, contact },跟letterhead(我方抬頭)是兩組獨立資料，
-- 顯示在報價單上要能同時看出「誰報的」跟「報給誰」。
--
-- 只加在cases表,不加scenarios表:比照letterhead既有的案件層級共用模式(不論quote_type是否為
-- 'project',同一案件底下不同情境一律共用同一組customer_info,不像quote_format/sell_mode那類
-- 「情境範圍」設定需要cases/scenarios兩表並存)。
--
-- 沒有預設值繼承的概念(跟letterhead不同,letterhead理論上可繼承user_settings.default_letterhead——
-- 但那個繼承目前實際上沒有接線,是另一個獨立問題,不在這次範圍):customer_info每個案件一律從空白開始。
--
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可
-- 前置條件:已執行過 migration_v2 ~ migration_v13

begin;

alter table cases add column if not exists customer_info jsonb;

commit;
