document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    // spec 6.5.4/第17節:autosave 不阻斷存檔,但切分頁離開前如果還有欄位沒填完整(尚未存檔),要明確示警
    if (
      !btn.classList.contains("active") &&
      typeof hasIncompleteAutosave === "function" &&
      hasIncompleteAutosave() &&
      !confirm("還有項目未填完整,尚未儲存,確定要離開嗎?")
    ) {
      return;
    }

    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

    if (btn.dataset.tab === "comparison" && typeof loadComparisonTab === "function") {
      loadComparisonTab();
    }
    if (btn.dataset.tab === "quote" && typeof loadQuoteTab === "function") {
      loadQuoteTab();
    }
  });
});
