-- v12 遷移(第50.2節):All-in報價新增「輸出樣式」選擇——單一總金額(lumpSum,現行行為) vs 費率(rate)。
-- cases/scenarios兩張表都要加(比照quote_format/sell_mode等既有欄位兩表並存的模式,project案件的
-- 每個情境也需要各自設定):
--   allin_output_style:只在quote_format='allin'時有意義,預設'lumpSum'維持現行行為不變
--   allin_rate_unit:只在allin_output_style='rate'時有意義,可選項目依case.mode篩選(前端負責篩選):
--     空運→perKg;海運LCL→perCBM或perRevenueTon(計費噸,見3.3節);海運FCL→perContainer;
--     其餘模式(land/rail/cross_border_trucking/multimodal)維持只有lumpSum,前端不顯示rate選項
--
-- 手動輸入的固定費率數值不需要新欄位:沿用既有的manual_sell jsonb,新增子欄位allinRate
-- (比照現有manual_sell.allin的模式),jsonb新增子欄位不需要跑migration。
--
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可
-- 前置條件:已執行過 migration_v2 ~ migration_v11

begin;

alter table cases add column if not exists allin_output_style text not null default 'lumpSum' check (allin_output_style in ('lumpSum', 'rate'));
alter table cases add column if not exists allin_rate_unit text check (allin_rate_unit in ('perKg', 'perCBM', 'perRevenueTon', 'perContainer'));

alter table scenarios add column if not exists allin_output_style text not null default 'lumpSum' check (allin_output_style in ('lumpSum', 'rate'));
alter table scenarios add column if not exists allin_rate_unit text check (allin_rate_unit in ('perKg', 'perCBM', 'perRevenueTon', 'perContainer'));

commit;
