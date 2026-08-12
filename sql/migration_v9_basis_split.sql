-- v9 遷移(第40.1節,全文取代規則):perUnit拆成perContainer/perPallet/perCarton,
-- perUnitPerDay拆成perContainerPerDay/perPalletPerDay/perChassisPerDay,取代文件更早處提到的perUnit/perUnitPerDay。
-- 根本動機:39.1節那筆USD 2500卡車費消失的bug,根因是perUnit把所有單位類型混在同一個自由輸入籃子裡,
-- 型別可以打非標準字串又對不上cargo.units,導致這筆費用安靜地算成0元——與其事後提示「這個類型不對」,
-- 改成從一開始就不讓使用者選得到不合理的類型。
--
-- 使用方式:到 Supabase SQL Editor 貼上整份執行一次即可(整份用 transaction 包起來,失敗會自動全部回滾)
-- 前置條件:已執行過 migration_v2 ~ migration_v8
--
-- ⚠️⚠️ 執行前強烈建議先備份 fee_lines 表(Supabase後台 Database → Backups,或至少手動
-- `select * from fee_lines` 匯出存查)——這是一次性的資料拆分/重寫,雖然邏輯上金額總和不變、可回溯,
-- 但事先備份最保險。
--
-- ⚠️⚠️ 重要:這個 migration 會讓部分過去因為「type字串對不上cargo.units」而靜默算成0元的 perUnit 費用,
-- migration 後開始正確計入總成本(這正是這批修正要解決的核心問題)。實測時真實資料庫裡發現至少4筆這種情況,
-- 對應真實案件金額會因此變動(是修正後的正確金額,不是bug),執行前請自行核對這些案件的最新報價是否已經
-- 送出給客戶、需不需要重新確認金額。

begin;

-- 1. 新增 days 欄位,供 perContainerPerDay/perPalletPerDay/perChassisPerDay 使用
alter table fee_lines add column if not exists days integer;

-- 2. 先移除舊的 basis check constraint(只允許 flat/perShipment/perKg/perUnit/perKgBreak,
--    見 migration_v2_feeline_model.sql),讓下面第3步的資料轉換可以把 basis 寫成 perContainer/
--    perPallet/perCarton 等新值。新的 constraint 留到第4步、資料全部轉換完成後才加回去——
--    加 constraint 時 Postgres 會自動驗證表中所有現有資料,等於順便再次確認轉換結果全部合法。
alter table fee_lines drop constraint if exists fee_lines_basis_check;

-- 3. 資料拆分:逐筆處理現有 basis='perUnit' 的 FeeLine,依 amount_by_type 裡每個 type 分類:
--    貨櫃代碼(含常見同義寫法如20DC/40HC)→perContainer / PLT→perPallet / CTN或carton→perCarton /
--    其他無法辨識的字串→各自轉成獨立的flat列(保留原始type字串在remark供人工核對,依規格書指示的做法)
--    若一筆舊資料同時涵蓋多個分類,原地更新第一個分類(優先序 perContainer > perPallet > perCarton > flat),
--    其餘分類各自INSERT新列,金額總和守恆、可追溯(remark互相註記)
do $$
declare
  fl record;
  entry jsonb;
  raw_type text;
  norm_type text;
  container_types jsonb;
  pallet_types jsonb;
  carton_types jsonb;
  other_entries jsonb[];
  first_basis text;
  first_amount_by_type jsonb;
  first_amount numeric;
  first_other_consumed boolean;
  container_aliases jsonb := '{
    "20DC":"20GP","40DC":"40GP","40HC":"40HQ","45HC":"45HQ",
    "20REEFER":"20RF","20RE":"20RF","40REEFER":"40RF","40RH":"40RF",
    "20ISO":"20ISOTANK","40ISO":"40ISOTANK"
  }'::jsonb;
  known_containers text[] := array['20GP','40GP','40HQ','45HQ','20DG','40DG','20RF','40RF','20FR','40FR','20ISOTANK','40ISOTANK','20OT','40OT'];
begin
  for fl in select * from fee_lines where basis = 'perUnit' loop
    container_types := '[]'::jsonb;
    pallet_types := '[]'::jsonb;
    carton_types := '[]'::jsonb;
    other_entries := array[]::jsonb[];

    -- 空陣列(從沒填過資料)的舊列,直接轉perContainer,沒有金額資料,轉哪一種都不影響任何計算結果
    if jsonb_array_length(coalesce(fl.amount_by_type, '[]'::jsonb)) = 0 then
      update fee_lines set basis = 'perContainer' where id = fl.id;
      continue;
    end if;

    for entry in select * from jsonb_array_elements(fl.amount_by_type) loop
      raw_type := trim(entry->>'type');
      norm_type := upper(regexp_replace(regexp_replace(raw_type, '[''’‘＇`]', '', 'g'), '\s+', '', 'g'));
      if container_aliases ? norm_type then
        norm_type := container_aliases->>norm_type;
      end if;

      if norm_type = any(known_containers) then
        container_types := container_types || jsonb_build_object('type', norm_type, 'amount', entry->'amount');
      elsif norm_type = 'PLT' then
        pallet_types := pallet_types || entry;
      elsif norm_type in ('CTN', 'CARTON') then
        carton_types := carton_types || jsonb_build_object('type', 'CTN', 'amount', entry->'amount');
      else
        other_entries := other_entries || entry;
      end if;
    end loop;

    -- 決定原地更新用哪一組(優先序 perContainer > perPallet > perCarton > 第一筆non-standard轉flat)
    first_other_consumed := false;
    if jsonb_array_length(container_types) > 0 then
      first_basis := 'perContainer';
      first_amount_by_type := container_types;
      first_amount := null;
    elsif jsonb_array_length(pallet_types) > 0 then
      first_basis := 'perPallet';
      first_amount := (pallet_types->0->>'amount')::numeric;
      first_amount_by_type := null;
    elsif jsonb_array_length(carton_types) > 0 then
      first_basis := 'perCarton';
      first_amount := (carton_types->0->>'amount')::numeric;
      first_amount_by_type := null;
    else
      first_basis := 'flat';
      first_amount := (other_entries[1]->>'amount')::numeric;
      first_amount_by_type := null;
      first_other_consumed := true;
    end if;

    update fee_lines set
      basis = first_basis,
      amount = first_amount,
      amount_by_type = first_amount_by_type,
      remark = case when first_basis = 'flat' then
        trim(both ' / ' from coalesce(fl.remark || ' / ', '') ||
          format('⚠原本是perUnit「%s」類型的費率,已自動轉為flat,請人工確認計價方式是否正確', other_entries[1]->>'type'))
      else fl.remark end
    where id = fl.id;

    -- 其餘分類各自INSERT新列(第一個分類已經在上面原地更新,這裡只補剩下的)
    if first_basis != 'perContainer' and jsonb_array_length(container_types) > 0 then
      insert into fee_lines (segment_id, lane_id, name, certainty, remark, currency, basis, amount_by_type)
      values (fl.segment_id, fl.lane_id, fl.name, fl.certainty,
        trim(both ' / ' from coalesce(fl.remark || ' / ', '') || format('(原「%s」費用依類型自動拆分的一部分)', fl.name)),
        fl.currency, 'perContainer', container_types);
    end if;
    if first_basis != 'perPallet' and jsonb_array_length(pallet_types) > 0 then
      insert into fee_lines (segment_id, lane_id, name, certainty, remark, currency, basis, amount)
      values (fl.segment_id, fl.lane_id, fl.name, fl.certainty,
        trim(both ' / ' from coalesce(fl.remark || ' / ', '') || format('(原「%s」費用依類型自動拆分的一部分)', fl.name)),
        fl.currency, 'perPallet', (pallet_types->0->>'amount')::numeric);
    end if;
    if first_basis != 'perCarton' and jsonb_array_length(carton_types) > 0 then
      insert into fee_lines (segment_id, lane_id, name, certainty, remark, currency, basis, amount)
      values (fl.segment_id, fl.lane_id, fl.name, fl.certainty,
        trim(both ' / ' from coalesce(fl.remark || ' / ', '') || format('(原「%s」費用依類型自動拆分的一部分)', fl.name)),
        fl.currency, 'perCarton', (carton_types->0->>'amount')::numeric);
    end if;
    if other_entries is not null then
      for entry in select * from unnest(other_entries) loop
        if first_other_consumed and entry = other_entries[1] then
          first_other_consumed := false; -- 只跳過第一筆(已在原地更新處理過),避免重複insert
          continue;
        end if;
        insert into fee_lines (segment_id, lane_id, name, certainty, remark, currency, basis, amount)
        values (fl.segment_id, fl.lane_id, fl.name, fl.certainty,
          trim(both ' / ' from coalesce(fl.remark || ' / ', '') ||
            format('⚠原本是perUnit「%s」類型的費率,已自動轉為flat,請人工確認計價方式是否正確', entry->>'type')),
          fl.currency, 'flat', (entry->>'amount')::numeric);
      end loop;
    end if;
  end loop;
end $$;

-- 4. 加回 basis check constraint,改成新的10種值,perUnit不再是合法值(全文取代規則)。
--    舊 constraint 已在第2步先行移除,這裡是重新加上——加的當下 Postgres 會驗證表中所有現有資料,
--    任何一筆不符合新規則都會讓這行報錯、連帶整個transaction rollback,等於是資料轉換的最終防呆檢查
alter table fee_lines add constraint fee_lines_basis_check check (
  basis in ('flat','perShipment','perKg','perContainer','perPallet','perCarton','perKgBreak','perContainerPerDay','perPalletPerDay','perChassisPerDay')
);

commit;
