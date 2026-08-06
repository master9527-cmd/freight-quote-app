// 共用:登入檢查 + header(email 顯示 + 登出),app.html / case.html 都會載入這支
const userEmailLabel = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");

// 回傳目前登入的 session,未登入則導回登入頁並讓呼叫端不再繼續往下執行
async function requireSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = "index.html";
    return null;
  }
  if (userEmailLabel) {
    userEmailLabel.textContent = data.session.user.email;
  }
  return data.session;
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });
}

// 未登入狀態下的變化(例如 session 過期)也導回登入頁
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || !session) {
    window.location.href = "index.html";
  }
});
