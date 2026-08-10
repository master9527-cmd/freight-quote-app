-- v8 遷移:第40.2節(查證第25/2.5節缺漏)
-- lanes 新增 from_port/to_port 結構化欄位(spec 2.5):起訖點本身,跟既有的 routing(自由文字完整路線描述)是
-- 兩個不同用途的欄位並存,不是取代關係——routing繼續給「這條路線怎麼走」的敘述用,from_port/to_port是給起訖港口/
-- 機場本身掛自動完成用(比照 Segment.fromLocation/toLocation 同一套 attachLocationAutocomplete())
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可
-- 前置條件:已執行過 migration_v2 ~ migration_v7

alter table lanes add column if not exists from_port text;
alter table lanes add column if not exists to_port text;
