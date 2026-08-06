const MODE_REF_PREFIX = {
  air: "AIR",
  sea_fcl: "SEA",
  sea_lcl: "LCL",
  land: "LAND",
  rail: "RAIL",
  cross_border_trucking: "TRK",
  multimodal: "MM",
};

function portCode(text) {
  return (text || "").trim().slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "") || "XXX";
}

function todayCode() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

// 產生報價編號,如 SEA-TPELAX-260725-42
// seq 取「今天已建立的案件數 + 1」,小工具規模下不處理併發搶號
async function generateCaseRef(client, userId, { mode, origin, destination }) {
  const modePrefix = MODE_REF_PREFIX[mode] || "GEN";
  const routeCode = `${portCode(origin)}${portCode(destination)}`;
  const dateCode = todayCode();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count } = await client
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString());

  const seq = (count || 0) + 1;
  return `${modePrefix}-${routeCode}-${dateCode}-${seq}`;
}
