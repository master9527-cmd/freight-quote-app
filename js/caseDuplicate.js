// 案件複製(spec 第19/24節:已確認未開發,需要實際開發,不只是驗證)——整案複製,含代理/Lane/成本費用/抬頭設定,
// 用於類似航線快速重新報價。之後49.3B「以歷史快照為範本建立新案件」會直接重用這支,屆時只是把資料來源從
// fetchAgentsWithCosts()換成快照的full_data,複製agents/segments/lanes/feeLines那段邏輯不用重寫。

// fee_lines除了parent(segment_id/lane_id)以外要複製的欄位——集中定義一次,新增basis相關欄位時只要改這裡
function feeLinePayloadFor(fl, parentRef) {
  return {
    ...parentRef,
    name: fl.name,
    certainty: fl.certainty,
    remark: fl.remark,
    currency: fl.currency,
    basis: fl.basis,
    amount: fl.amount,
    amount_by_type: fl.amount_by_type,
    min_charge: fl.min_charge,
    breaks: fl.breaks,
    days: fl.days,
  };
}

// 把一組來源agents(fetchAgentsWithCosts()回傳的巢狀結構)整批複製到newCaseId(+newScenarioId,inquiry/tender案件是null),
// 回傳這次複製建立的id對照表,供之後改寫selection/manual_sell用(這兩個欄位存的是舊案件的agentId/laneId/feeLineId,
// 直接複製過去會指向新案件裡不存在的id)
async function duplicateAgentsForScope(newCaseId, newScenarioId, agents) {
  const agentMap = {};
  const laneMap = {};
  const feeLineMap = {};

  for (const agent of agents) {
    const { data: newAgent, error: agentError } = await supabaseClient
      .from("agents")
      .insert({ case_id: newCaseId, scenario_id: newScenarioId, name: agent.name, role: agent.role })
      .select("id")
      .single();
    if (agentError) throw agentError;
    agentMap[agent.id] = newAgent.id;

    // 同一個agent底下所有segment/lane的feeLines先收集起來,最後一次bulk insert
    // (跟segmentForm.js既有的fee_lines bulk insert同款寫法,靠回傳陣列順序對應輸入順序建立id對照表)
    const feeLinePayloads = [];
    const feeLineOldIds = [];

    for (const segType of SEGMENT_TYPES) {
      const segment = agent.segmentsByType[segType];
      if (!segment) continue;

      const { data: newSegment, error: segmentError } = await supabaseClient
        .from("segments")
        .insert({
          agent_id: newAgent.id,
          segment_type: segment.segment_type,
          default_currency: segment.default_currency,
          from_location: segment.from_location,
          to_location: segment.to_location,
          use_lanes: segment.use_lanes,
        })
        .select("id")
        .single();
      if (segmentError) throw segmentError;

      if (segment.use_lanes) {
        for (const lane of segment.lanes || []) {
          const { data: newLane, error: laneError } = await supabaseClient
            .from("lanes")
            .insert({
              segment_id: newSegment.id,
              carrier: lane.carrier,
              routing: lane.routing,
              from_port: lane.from_port,
              to_port: lane.to_port,
              transit_days_min: lane.transit_days_min,
              transit_days_max: lane.transit_days_max,
              stops_count: lane.stops_count,
              validity_start: lane.validity_start,
              validity_end: lane.validity_end,
              incoterm: lane.incoterm,
              remark: lane.remark,
              vessel_name: lane.vessel_name,
              voyage_number: lane.voyage_number,
              si_cutoff: lane.si_cutoff,
              vgm_cutoff: lane.vgm_cutoff,
              cy_cutoff: lane.cy_cutoff,
              etd: lane.etd,
              eta: lane.eta,
              weekly_frequency: lane.weekly_frequency,
              is_direct: lane.is_direct,
              transship_points: lane.transship_points,
            })
            .select("id")
            .single();
          if (laneError) throw laneError;
          laneMap[lane.id] = newLane.id;

          (lane.feeLines || []).forEach((fl) => {
            feeLinePayloads.push(feeLinePayloadFor(fl, { lane_id: newLane.id }));
            feeLineOldIds.push(fl.id);
          });
        }
      } else {
        (segment.feeLines || []).forEach((fl) => {
          feeLinePayloads.push(feeLinePayloadFor(fl, { segment_id: newSegment.id }));
          feeLineOldIds.push(fl.id);
        });
      }
    }

    if (feeLinePayloads.length) {
      const { data: newFeeLines, error: feeLineError } = await supabaseClient.from("fee_lines").insert(feeLinePayloads).select("id");
      if (feeLineError) throw feeLineError;
      newFeeLines.forEach((row, i) => {
        feeLineMap[feeLineOldIds[i]] = row.id;
      });
    }
  }

  return { agentMap, laneMap, feeLineMap };
}

// selection結構:{export:{agentId,laneId}, intl:{...}, import:{...}} ——把舊id換成新id;
// 找不到對應(理論上不會發生,agentMap/laneMap是這次複製剛建的完整對照表)時保守地設回null,不留一個指向舊案件的id
function remapSelection(selection, agentMap, laneMap) {
  if (!selection) return selection;
  const out = {};
  SEGMENT_TYPES.forEach((t) => {
    const s = selection[t];
    if (!s) return;
    out[t] = {
      agentId: s.agentId ? agentMap[s.agentId] || null : s.agentId,
      laneId: s.laneId ? laneMap[s.laneId] || null : s.laneId,
    };
  });
  return out;
}

// manual_sell.byItem是{[feeLineId]:{amount,currency}}(spec第32節),key是舊feeLineId,要換成新id;
// allin/bySegment沒有id參照,原樣保留
function remapManualSell(manualSell, feeLineMap) {
  if (!manualSell) return manualSell;
  const byItem = {};
  Object.entries(manualSell.byItem || {}).forEach(([oldFeeLineId, value]) => {
    const newId = feeLineMap[oldFeeLineId];
    if (newId) byItem[newId] = value;
  });
  return { ...manualSell, byItem };
}

// 整案複製主流程。這個專案目前所有跨表寫入都是client端依序呼叫、沒有用DB transaction(cases.js建案件+
// scenario也是兩次獨立呼叫),這裡沿用同樣風格;失敗時靠schema既有的on delete cascade(cases→scenarios→
// agents→segments→lanes/fee_lines一路都是cascade)清掉這次已建立的殘留資料,不會留下複製到一半的案件。
async function duplicateCase(caseId) {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  const userId = session.user.id;

  const { data: sourceCase, error: caseError } = await supabaseClient.from("cases").select("*").eq("id", caseId).single();
  if (caseError) throw caseError;

  // ref重新產生(今天日期+序號),跟新增案件同一套邏輯——不沿用舊編號,舊編號的日期段已經不代表這次複製的時間
  const ref = await generateCaseRef(supabaseClient, userId, {
    mode: sourceCase.mode,
    origin: sourceCase.origin,
    destination: sourceCase.destination,
  });

  const newCasePayload = {
    user_id: userId,
    ref,
    name: `${sourceCase.name}(複製)`,
    origin: sourceCase.origin,
    destination: sourceCase.destination,
    mode: sourceCase.mode,
    quote_type: sourceCase.quote_type,
    quote_currency: sourceCase.quote_currency,
    cargo: sourceCase.cargo,
    selection: sourceCase.selection,
    markup: sourceCase.markup,
    quote_format: sourceCase.quote_format,
    letterhead: sourceCase.letterhead,
    incoterm: sourceCase.incoterm,
    quote_scope: sourceCase.quote_scope,
    trade_remark: sourceCase.trade_remark,
    rate_table: sourceCase.rate_table,
    quote_currency_by_segment: sourceCase.quote_currency_by_segment,
    sell_mode: sourceCase.sell_mode,
    manual_sell: sourceCase.manual_sell,
    cost_basis: sourceCase.cost_basis,
    bidding_round: sourceCase.bidding_round,
    validity_start: sourceCase.validity_start,
    validity_end: sourceCase.validity_end,
    committed_volume: sourceCase.committed_volume,
    max_stops_allowed: sourceCase.max_stops_allowed,
    max_transit_days_allowed: sourceCase.max_transit_days_allowed,
  };

  const { data: newCase, error: newCaseError } = await supabaseClient.from("cases").insert(newCasePayload).select("id").single();
  if (newCaseError) throw newCaseError;
  const newCaseId = newCase.id;

  try {
    if (sourceCase.quote_type === "project") {
      // spec 29.1:project案件的代理成本掛在情境底下,逐一情境複製,每個情境自己的selection/manual_sell各自remap
      const { data: scenarios, error: scenariosError } = await supabaseClient
        .from("scenarios")
        .select("*")
        .eq("case_id", caseId)
        .order("sort_order", { ascending: true });
      if (scenariosError) throw scenariosError;

      for (const scenario of scenarios) {
        const { data: newScenario, error: newScenarioError } = await supabaseClient
          .from("scenarios")
          .insert({
            case_id: newCaseId,
            label: scenario.label,
            mode: scenario.mode,
            cargo: scenario.cargo,
            selection: scenario.selection,
            markup: scenario.markup,
            quote_format: scenario.quote_format,
            quote_currency_by_segment: scenario.quote_currency_by_segment,
            sell_mode: scenario.sell_mode,
            manual_sell: scenario.manual_sell,
            cost_basis: scenario.cost_basis,
            sort_order: scenario.sort_order,
          })
          .select("id")
          .single();
        if (newScenarioError) throw newScenarioError;

        const agents = await fetchAgentsWithCosts(caseId, scenario.id);
        const { agentMap, laneMap, feeLineMap } = await duplicateAgentsForScope(newCaseId, newScenario.id, agents);

        const { error: updateScenarioError } = await supabaseClient
          .from("scenarios")
          .update({
            selection: remapSelection(scenario.selection, agentMap, laneMap),
            manual_sell: remapManualSell(scenario.manual_sell, feeLineMap),
          })
          .eq("id", newScenario.id);
        if (updateScenarioError) throw updateScenarioError;
      }
    } else {
      const agents = await fetchAgentsWithCosts(caseId, null);
      const { agentMap, laneMap, feeLineMap } = await duplicateAgentsForScope(newCaseId, null, agents);

      const { error: updateCaseError } = await supabaseClient
        .from("cases")
        .update({
          selection: remapSelection(sourceCase.selection, agentMap, laneMap),
          manual_sell: remapManualSell(sourceCase.manual_sell, feeLineMap),
        })
        .eq("id", newCaseId);
      if (updateCaseError) throw updateCaseError;
    }
  } catch (error) {
    await supabaseClient.from("cases").delete().eq("id", newCaseId);
    throw error;
  }

  return newCaseId;
}
