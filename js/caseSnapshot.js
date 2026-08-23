// 版本記錄與快照系統(spec 第49.3節B)——不只是報價匯出時凍結,而是完整版本管理:手動存檔、報價匯出
// 自動存檔(兩者並存,不互相取代)、案件明細頁列出版本記錄、每個版本能「還原到這個版本」或
// 「以此版本為範本建立新案件」(沿用js/caseDuplicate.js的createCaseFromSourceData()共用核心)。
//
// 跟既有的rate_snapshots(spec 9.1,議價歷史快照,單一代理/Lane某一輪報價的成本記錄)是完全不同的兩件事,
// 不要混淆——這裡的case_snapshots記的是整個案件當下的完整狀態(案件設定+所有代理/段落/Lane/FeeLine)。

// 抓一個案件當下的完整狀態,結構跟createCaseFromSourceData()的輸入參數對應,方便「以此版本為範本建立
// 新案件」直接把full_data餵給那支函式——project案件是{case,scenarios:[{scenario,agents}]},
// 否則是{case,agents}
async function captureCaseSnapshotData(caseId) {
  const { data: sourceCase, error } = await supabaseClient.from("cases").select("*").eq("id", caseId).single();
  if (error) throw error;

  if (sourceCase.quote_type === "project") {
    const { data: scenarios, error: scenariosError } = await supabaseClient
      .from("scenarios")
      .select("*")
      .eq("case_id", caseId)
      .order("sort_order", { ascending: true });
    if (scenariosError) throw scenariosError;

    const scenariosWithAgents = [];
    for (const scenario of scenarios) {
      const agents = await fetchAgentsWithCosts(caseId, scenario.id);
      scenariosWithAgents.push({ scenario, agents });
    }
    return { case: sourceCase, scenarios: scenariosWithAgents };
  }

  const agents = await fetchAgentsWithCosts(caseId, null);
  return { case: sourceCase, agents };
}

// 存檔當下算好的簡要摘要,供版本記錄列表快速顯示,不用每次展開full_data重算——project案件有多個情境,
// 沒有單一有意義的總金額,不勉強算一個,只顯示情境數;非project案件用comparison.js既有的
// computeSelectedCosts()算出跟比較分析頁「組合總成本」卡片同一套邏輯的Subtotal/Total
function computeSnapshotSummary(data) {
  if (data.case.quote_type === "project") {
    return { scenarioCount: (data.scenarios || []).length };
  }
  const caseData = data.case;
  const cost = computeSelectedCosts(data.agents, caseData.selection, caseData.cargo, caseData, caseData.quote_currency);
  return { sumSubtotal: cost.sumSubtotal, sumTotal: cost.sumTotal, currency: caseData.quote_currency };
}

async function saveCaseSnapshot(caseId, label, snapshotType) {
  const data = await captureCaseSnapshotData(caseId);
  const summary = computeSnapshotSummary(data);
  const { error } = await supabaseClient
    .from("case_snapshots")
    .insert({ case_id: caseId, label, snapshot_type: snapshotType, full_data: data, summary });
  if (error) throw error;
}

// 「還原到這個版本」:把案件目前的即時資料覆蓋回快照當時的狀態(危險操作,呼叫端要先confirm())。
// 流程跟createCaseFromSourceData()建新案件很像,差別是目標是同一個caseId不是新case:先清空現有
// agents(cascade連segments/lanes/fee_lines一起清掉)、project案件連同scenarios一併清空重建,
// 再用duplicateAgentsForScope()把快照內容寫回來,最後把cases表操作性欄位覆蓋回快照當時的值。
//
// 安全防護:快照的quote_type如果跟案件目前的quote_type不同,直接擋下——spec沒有定義跨類型還原這種
// 邊界情況要怎麼處理(project案件的代理成本掛在scenarios底下,非project案件掛在case本身,結構不同,
// 不安全地嘗試轉換,寧可拒絕讓使用者自己決定要不要用「以此版本為範本建立新案件」改用別的方式處理)
async function restoreCaseFromSnapshot(caseId, snapshot) {
  const frozen = snapshot.full_data;
  const { data: currentCaseRow, error: currentCaseError } = await supabaseClient
    .from("cases")
    .select("quote_type")
    .eq("id", caseId)
    .single();
  if (currentCaseError) throw currentCaseError;
  if (frozen.case.quote_type !== currentCaseRow.quote_type) {
    throw new Error(
      `這個快照是「${QUOTE_TYPE_LABELS[frozen.case.quote_type] || frozen.case.quote_type}」類型的案件,跟目前案件的類型不同,無法直接還原。如果想沿用這個版本的內容,可以改用「以此版本為範本建立新案件」。`
    );
  }

  const { data: existingAgents, error: existingAgentsError } = await supabaseClient.from("agents").select("id").eq("case_id", caseId);
  if (existingAgentsError) throw existingAgentsError;
  if (existingAgents.length) {
    const { error: deleteAgentsError } = await supabaseClient
      .from("agents")
      .delete()
      .in("id", existingAgents.map((a) => a.id));
    if (deleteAgentsError) throw deleteAgentsError;
  }

  const restorePayload = caseFieldsToCopy(frozen.case);

  if (frozen.case.quote_type === "project") {
    const { data: existingScenarios, error: existingScenariosError } = await supabaseClient
      .from("scenarios")
      .select("id")
      .eq("case_id", caseId);
    if (existingScenariosError) throw existingScenariosError;
    if (existingScenarios.length) {
      const { error: deleteScenariosError } = await supabaseClient
        .from("scenarios")
        .delete()
        .in("id", existingScenarios.map((s) => s.id));
      if (deleteScenariosError) throw deleteScenariosError;
    }

    for (const { scenario, agents } of frozen.scenarios) {
      const { data: newScenario, error: newScenarioError } = await supabaseClient
        .from("scenarios")
        .insert({ case_id: caseId, ...scenarioFieldsToCopy(scenario) })
        .select("id")
        .single();
      if (newScenarioError) throw newScenarioError;

      const { agentMap, laneMap, feeLineMap } = await duplicateAgentsForScope(caseId, newScenario.id, agents);

      const { error: updateScenarioError } = await supabaseClient
        .from("scenarios")
        .update({
          selection: remapSelection(scenario.selection, agentMap, laneMap, feeLineMap),
          manual_sell: remapManualSell(scenario.manual_sell, feeLineMap),
        })
        .eq("id", newScenario.id);
      if (updateScenarioError) throw updateScenarioError;
    }
  } else {
    const { agentMap, laneMap, feeLineMap } = await duplicateAgentsForScope(caseId, null, frozen.agents);
    restorePayload.selection = remapSelection(frozen.case.selection, agentMap, laneMap, feeLineMap);
    restorePayload.manual_sell = remapManualSell(frozen.case.manual_sell, feeLineMap);
  }

  const { error: updateCaseError } = await supabaseClient.from("cases").update(restorePayload).eq("id", caseId);
  if (updateCaseError) throw updateCaseError;
}

// 「以此版本為範本建立新案件」:直接把快照的full_data餵給js/caseDuplicate.js的共用核心,
// 跟即時複製案件(duplicateCase())走同一套邏輯,只是來源資料換成快照凍結的內容
function createCaseFromSnapshot(snapshot) {
  const frozen = snapshot.full_data;
  if (frozen.case.quote_type === "project") {
    return createCaseFromSourceData(frozen.case, frozen.scenarios, null);
  }
  return createCaseFromSourceData(frozen.case, null, frozen.agents);
}

function formatSnapshotTypeLabel(type) {
  return type === "quote_export" ? "報價匯出自動存檔" : "手動存檔";
}

function formatSnapshotSummary(summary) {
  if (!summary) return "-";
  if (summary.scenarioCount != null) return `${summary.scenarioCount}個情境`;
  if (summary.sumTotal != null) return `Total ${formatMoney(summary.sumTotal, summary.currency)}`;
  return "-";
}

// 案件明細頁的「版本記錄」區塊:存檔輸入框+按鈕、版本列表(還原/以此版本建立新案件)。
// 跨分頁固定可見(呼叫端把container放在case-summary-card旁邊,不在任何.tab-panel裡面),
// 呼應spec原文「代理成本分頁跟報價分頁都提供存檔按鈕」的實際效果——不管在哪個分頁都能存檔,
// 不用在兩個分頁裡各刻一份重複的按鈕
async function renderVersionHistoryCard(container, caseId) {
  container.innerHTML = `
    <h2>版本記錄</h2>
    <p style="font-size: 12px; color: var(--color-text-muted)">手動存檔可以在任何時間點把目前的完整計算結果存成一個具名版本;報價分頁匯出PDF/Excel時也會自動存一份。</p>
    <div class="form-grid">
      <div class="field-inline field-full">
        <label for="snapshot-label-input">存檔名稱/備註</label>
        <input type="text" id="snapshot-label-input" placeholder="如「報價v1 - 2026/8/12」" />
        <button type="button" class="btn-small" id="save-snapshot-btn">存檔</button>
      </div>
    </div>
    <div id="snapshot-save-status" class="save-status"></div>
    <div id="version-history-list" style="margin-top: 10px"><p class="empty-state">載入中...</p></div>
  `;

  async function refreshList() {
    const listEl = container.querySelector("#version-history-list");
    const { data: snapshots, error } = await supabaseClient
      .from("case_snapshots")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (error) {
      listEl.innerHTML = `<div class="message error" style="display:block">讀取版本記錄失敗:${error.message}</div>`;
      return;
    }
    if (!snapshots.length) {
      listEl.innerHTML = `<p class="empty-state">還沒有任何存檔版本。</p>`;
      return;
    }

    listEl.innerHTML = `
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <thead>
            <tr><th>名稱</th><th>時間</th><th>類型</th><th>摘要</th><th>動作</th></tr>
          </thead>
          <tbody>
            ${snapshots
              .map(
                (snap) => `
              <tr>
                <td>${escapeHtml(snap.label)}</td>
                <td>${escapeHtml(new Date(snap.created_at).toLocaleString())}</td>
                <td>${escapeHtml(formatSnapshotTypeLabel(snap.snapshot_type))}</td>
                <td>${escapeHtml(formatSnapshotSummary(snap.summary))}</td>
                <td>
                  <button type="button" class="btn-link snapshot-restore-btn" data-snapshot-id="${snap.id}">還原到這個版本</button>
                  <button type="button" class="btn-link snapshot-duplicate-btn" data-snapshot-id="${snap.id}">以此版本為範本建立新案件</button>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;

    listEl.querySelectorAll(".snapshot-restore-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const snap = snapshots.find((s) => s.id === btn.dataset.snapshotId);
        if (
          !confirm(
            `確定要把案件目前的資料還原成「${snap.label}」這個版本嗎?這會覆蓋掉目前所有代理/成本/選用設定,還原前的資料不會自動留存(如果需要,請先手動存檔目前的狀態再還原)。`
          )
        )
          return;
        btn.disabled = true;
        try {
          await restoreCaseFromSnapshot(caseId, snap);
          alert("已還原,頁面即將重新整理。");
          window.location.reload();
        } catch (error) {
          alert(error.message || "還原失敗,請再試一次。");
          btn.disabled = false;
        }
      });
    });

    listEl.querySelectorAll(".snapshot-duplicate-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const snap = snapshots.find((s) => s.id === btn.dataset.snapshotId);
        if (!confirm(`要用「${snap.label}」這個版本當範本,建立一份全新獨立的案件嗎?`)) return;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "建立中…";
        try {
          const newCaseId = await createCaseFromSnapshot(snap);
          window.location.href = `case.html?id=${newCaseId}`;
        } catch (error) {
          alert(error.message || "建立案件失敗,請再試一次。");
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    });
  }

  await refreshList();

  const saveBtn = container.querySelector("#save-snapshot-btn");
  const statusEl = container.querySelector("#snapshot-save-status");
  saveBtn.addEventListener("click", async () => {
    const labelInput = container.querySelector("#snapshot-label-input");
    const label = labelInput.value.trim() || `存檔 - ${new Date().toLocaleString()}`;
    saveBtn.disabled = true;
    statusEl.textContent = "存檔中…";
    statusEl.className = "save-status";
    try {
      await saveCaseSnapshot(caseId, label, "manual");
      labelInput.value = "";
      statusEl.textContent = "已存檔 ✓";
      statusEl.className = "save-status success";
      await refreshList();
    } catch (error) {
      statusEl.textContent = `存檔失敗:${error.message}`;
      statusEl.className = "save-status error";
    } finally {
      saveBtn.disabled = false;
    }
  });
}
