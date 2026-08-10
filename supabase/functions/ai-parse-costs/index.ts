// spec 第5節/第36節:AI 智慧匯入——伺服器端代理,把 Anthropic API 金鑰留在 Supabase secrets,
// 前端只透過 supabaseClient.functions.invoke('ai-parse-costs', {...}) 呼叫這裡,金鑰不會出現在瀏覽器。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// fee_lines.basis 的 check constraint(sql/migration_v9_basis_split.sql,第40.1節全文取代規則)目前支援這10種。
// spec 第27-30節後來規劃的 perCBM/perKgPerDay/perCBMPerDay/percentValue/perKm 還沒有對應的 DB/前端支援,
// AI 不可以輸出這幾種,否則寫入 fee_lines 會直接違反 constraint 失敗。
const BASIS_VALUES = [
  "flat",
  "perShipment",
  "perKg",
  "perContainer",
  "perPallet",
  "perCarton",
  "perKgBreak",
  "perContainerPerDay",
  "perPalletPerDay",
  "perChassisPerDay",
];
const SEGMENT_TYPES = ["export", "intl", "import"];
const MODES = ["air", "sea_fcl", "sea_lcl", "land", "rail", "cross_border_trucking", "multimodal"];

const SYSTEM_PROMPT = `你是國際貨運報價系統的成本資料判讀助手。使用者會貼上代理報價的原始資料(Email文字、PDF、Excel、圖片等),
你要把裡面的費用項目判讀、分類成結構化資料,呼叫 record_parsed_costs 工具回傳結果,不要用文字回覆。

判讀規則:
1. 運輸模式(mode):依內容判斷是 air/sea_fcl/sea_lcl/land/rail/cross_border_trucking/multimodal 其中之一,無法判斷就回傳 null,這只是參考資訊。
2. 代理身份判斷(detectedAgentName):嘗試從原文的署名、寄件公司資訊、報價表頭的公司名稱判斷這份報價是哪一家代理發出的,判斷得出來就回傳公司名稱,判斷不出來回傳 null。不要瞎猜,沒有明確依據就回傳 null。
3. 段落歸屬(segmentType):依貨運術語判斷每筆費用屬於 export(出口段,如報關/內陸拖車/出口文件/倉租)、intl(國際運輸段,如海運費/空運費/燃油附加費/THC)、還是 import(進口段,如目的港報關/進口內陸配送/D/O費)。
4. FeeLine.basis 只能是以下 10 種之一,不可以輸出其他值(這是資料庫實際支援的全部種類,第40.1節全文取代規則:
   原本的 perUnit/perUnitPerDay 已經拆成下面更具體的計價基礎,不可以再輸出 perUnit 或 perUnitPerDay):
   - flat:整批固定金額
   - perShipment:每票/每BL固定金額
   - perKg:每公斤單價
   - perContainer:依貨櫃類型分別計價(用 amountByType 陣列,每筆 {type, amount},type 只能用標準貨櫃代碼——
     20GP/40GP/40HQ/45HQ/20DG/40DG/20RF/40RF/20FR/40FR/20ISOTANK/40ISOTANK/20OT/40OT,原文若用20DC/40HC等同義寫法
     要正規化成對應的標準代碼,不確定對應哪個標準代碼就不要用perContainer,改用flat並在remark註明原文)
   - perPallet:每棧板單一費率(amount 一個數字,不是陣列),原文提到PLT/Pallet/棧板計價時用這個
   - perCarton:每箱單一費率(amount 一個數字),原文提到CTN/Carton/箱計價時用這個
   - perContainerPerDay:每貨櫃每天(amountByType陣列,同perContainer的type規則,額外要有days欄位),
     觸發關鍵字如延滯費Demurrage、留滯費Detention
   - perPalletPerDay:每棧板每天(amount一個數字 + days),觸發關鍵字如倉租Storage按棧板計價、原文寫「每週」的話換算成天數或在remark註明原始週費率
   - perChassisPerDay:每底盤每天(amount一個數字 + days),觸發關鍵字如Chassis Per Diem(北美常見)
   - perKgBreak:「費率+最低消費」或分級距的計價方式,用 breaks 陣列(每筆 {thresholdKg, ratePerKg}) + minCharge。
     只有原文明確寫出多個級距時才輸出多筆 breaks;只寫「費率+最低消費」的單一費率狀況,輸出一筆 breaks(thresholdKg設0)+ minCharge即可,不要自己發明沒寫出來的級距。
   如果無法判斷屬於哪一種 basis,或type是無法辨識成標準貨櫃代碼/PLT/CTN的自訂字串(如「Shipment」「張」這種跟貨櫃/棧板/箱無關的單位),
   一律用 flat,並把原文那句話整段放進 remark,不要硬套錯誤的basis或編造不存在的type。
5. 幣別(currency):每一筆 FeeLine 自己判斷幣別,不要假設整份文件只有一種幣別——同一份報價裡USD/TWD/CNY混用是常態。
6. 金額若是「範圍」(如 150-225,或"約200上下"):不要取平均或自己猜一個值,amount留null,把原文的範圍文字寫進remark讓使用者自己確認填入正確金額。
7. 若同一段內有多家承運人/多條路由(如多家船公司報價、直航+轉運等不同選項),要分別建立多個 Lane(carrier/routing/transitDaysMin/transitDaysMax/stopsCount/validityStart/validityEnd),每條 Lane 底下有自己的 FeeLine 清單。
   只有真的偵測到「同一段有多種可比較選項」才用 Lane,單一報價方案不要硬拆成只有一條 Lane。
8. 無法結構化判讀的條件式敘述文字(如「需視實際體積重另計」「假日作業加收」等附帶條件),原文放進該筆FeeLine或該條Lane的remark,不要自己下判斷去計算或忽略。
9. certainty:讀起來像正式報價/明確金額的填"certain";讀起來像參考價/預估/待確認的填"possible"。
10. name 用簡短中文或原文費用名稱即可(如「海運費」「THC」「報關費」),不要重複整句原文。
`;

const FEE_LINE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    certainty: { type: "string", enum: ["certain", "possible"] },
    currency: { type: "string" },
    basis: { type: "string", enum: BASIS_VALUES },
    amount: { type: ["number", "null"] },
    amountByType: {
      type: "array",
      items: {
        type: "object",
        properties: { type: { type: "string" }, amount: { type: "number" } },
        required: ["type", "amount"],
      },
    },
    minCharge: { type: ["number", "null"] },
    breaks: {
      type: "array",
      items: {
        type: "object",
        properties: { thresholdKg: { type: "number" }, ratePerKg: { type: "number" } },
        required: ["thresholdKg", "ratePerKg"],
      },
    },
    days: { type: ["number", "null"] }, // basis: perContainerPerDay | perPalletPerDay | perChassisPerDay(第40.1節)
    remark: { type: ["string", "null"] },
  },
  required: ["name", "certainty", "currency", "basis"],
};

const LANE_SCHEMA = {
  type: "object",
  properties: {
    carrier: { type: ["string", "null"] },
    routing: { type: ["string", "null"] },
    transitDaysMin: { type: ["number", "null"] },
    transitDaysMax: { type: ["number", "null"] },
    stopsCount: { type: ["number", "null"] },
    validityStart: { type: ["string", "null"] },
    validityEnd: { type: ["string", "null"] },
    remark: { type: ["string", "null"] },
    feeLines: { type: "array", items: FEE_LINE_SCHEMA },
  },
  required: ["feeLines"],
};

const TOOL = {
  name: "record_parsed_costs",
  description: "回報判讀後的結構化成本資料",
  input_schema: {
    type: "object",
    properties: {
      mode: { type: ["string", "null"], enum: [...MODES, null] },
      detectedAgentName: { type: ["string", "null"] },
      segments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            segmentType: { type: "string", enum: SEGMENT_TYPES },
            feeLines: { type: "array", items: FEE_LINE_SCHEMA },
            lanes: { type: "array", items: LANE_SCHEMA },
          },
          required: ["segmentType"],
        },
      },
    },
    required: ["segments"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "未登入或登入已過期,請重新整理頁面後再試一次" }, 401);
    }

    const body = await req.json();
    const textInputs: string[] = Array.isArray(body.textInputs) ? body.textInputs : [];
    const images: Array<{ mediaType: string; base64: string }> = Array.isArray(body.images) ? body.images : [];
    const pdfs: Array<{ base64: string }> = Array.isArray(body.pdfs) ? body.pdfs : [];

    if (!textInputs.some((t) => t && t.trim()) && !images.length && !pdfs.length) {
      return jsonResponse({ error: "沒有可解析的內容" }, 400);
    }

    const content: unknown[] = [];
    textInputs.forEach((t) => {
      if (t && t.trim()) content.push({ type: "text", text: t });
    });
    pdfs.forEach((p) => {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } });
    });
    images.forEach((img) => {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    });
    if (body.mode) {
      content.push({ type: "text", text: `(參考:此案件目前設定的運輸模式為 ${body.mode})` });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "伺服器尚未設定 ANTHROPIC_API_KEY,請聯絡管理者" }, 500);
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        tools: [TOOL],
        // 強制呼叫單一工具時關閉 thinking,確保回傳的是乾淨的 tool_use 區塊,不會有推理內容混進結構化輸出
        thinking: { type: "disabled" },
        tool_choice: { type: "tool", name: "record_parsed_costs" },
        output_config: { effort: "medium" },
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return jsonResponse({ error: `AI 服務呼叫失敗:${anthropicRes.status} ${errText}` }, 502);
    }

    const result = await anthropicRes.json();

    if (result.stop_reason === "refusal") {
      return jsonResponse({ error: "AI 拒絕處理這份內容,請確認內容是否為正常的報價資料" }, 400);
    }

    const toolUseBlock = (result.content || []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "record_parsed_costs",
    );
    if (!toolUseBlock) {
      return jsonResponse({ error: "AI 未回傳可解析的結構化結果,請重試一次" }, 502);
    }

    return jsonResponse(toolUseBlock.input);
  } catch (error) {
    return jsonResponse({ error: `處理失敗:${error instanceof Error ? error.message : String(error)}` }, 500);
  }
});
