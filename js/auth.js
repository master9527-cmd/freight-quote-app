const formTitle = document.getElementById("form-title");
const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("submit-btn");
const switchText = document.getElementById("switch-text");
const switchLink = document.getElementById("switch-link");
const messageBox = document.getElementById("message");

let mode = "login"; // "login" | "signup"

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
}

function setMode(nextMode) {
  mode = nextMode;
  clearMessage();
  if (mode === "login") {
    formTitle.textContent = "登入";
    submitBtn.textContent = "登入";
    switchText.textContent = "還沒有帳號?";
    switchLink.textContent = "註冊新帳號";
  } else {
    formTitle.textContent = "註冊新帳號";
    submitBtn.textContent = "註冊";
    switchText.textContent = "已經有帳號?";
    switchLink.textContent = "回到登入";
  }
}

switchLink.addEventListener("click", () => {
  setMode(mode === "login" ? "signup" : "login");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  submitBtn.disabled = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  try {
    if (mode === "login") {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = "app.html";
    } else {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      showMessage("註冊成功,請check信箱完成驗證後再登入。", "success");
      setMode("login");
    }
  } catch (error) {
    showMessage(error.message || "發生錯誤,請再試一次。", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

// 已登入就直接跳到 app.html
(async () => {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    window.location.href = "app.html";
  }
})();
