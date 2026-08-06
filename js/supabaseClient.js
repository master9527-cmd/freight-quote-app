// 由 config.js 提供 SUPABASE_URL / SUPABASE_ANON_KEY
// `supabase` 這個全域變數來自 CDN 引入的 @supabase/supabase-js
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
