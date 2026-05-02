import {
  DB,
  CU as currentUser,
  setGithubToken,
  clearGithubToken,
  loadDB,
  saveDB,
  doLogin as githubLogin,
  doLogout as githubLogout,
  addMember,
  addTransaction,
  updateUser,
  updateTransaction,
  addLoan,
  updateLoan,
  addAudit
} from "./github-db.js";

window.DB = DB;
window.getCurrentUser = () => currentUser;

function CU() {
  return currentUser;
}

function err(error, fallback) {
  window.toast?.(error?.message || fallback, "e");
}

window.connectGithub = async function connectGithub() {
  try {
    const token = prompt("Paste your fine-grained GitHub token for this session:");
    if (!token) return;
    setGithubToken(token.trim());
    await loadDB();
    window.toast("GitHub connected.");
  } catch (error) {
    err(error, "GitHub connection failed");
  }
};

window.doLogin = async function doLogin() {
  try {
    const email = document.getElementById("le").value.trim();
    const password = document.getElementById("lp").value;
    await githubLogin(email, password);

    document.getElementById("auth").style.display = "none";
    document.getElementById("wrap").style.display = "flex";
    window.setupSidebar();
    window.nav("dashboard");
  } catch (error) {
    err(error, "Invalid credentials");
  }
};

window.doLogout = function doLogout() {
  githubLogout();
  clearGithubToken();
  document.getElementById("wrap").style.display = "none";
  document.getElementById("auth").style.display = "flex";
  Object.values(window.charts || {}).forEach(chart => {
    try { chart.destroy(); } catch {}
  });
  window.charts = {};
};

window.submitDeposit = async function submitDeposit() {
  try {
    const amount = parseFloat(document.getElementById("dep-amt").value);
    const note = document.getElementById("dep-note").value.trim();
    if (!amount || amount < 100) return window.toast("Minimum Rs.100", "e");

    await addTransaction({
      uid: CU().id,
      type: "deposit",
      amount,
      status: "pending",
      note: note || "Deposit"
    }, "Submit deposit");

    window.toast("Deposit submitted! Awaiting approval.");
    window.nav("deposit");
  } catch (error) {
    err(error, "Deposit failed");
  }
};

window.approveDep = async function approveDep(txId) {
  try {
    const tx = DB.transactions.find(item => item.id === txId);
    const user = window.gu(tx.uid);

    await updateTransaction(txId, { status: "approved" }, "Approve deposit");
    await updateUser(user.id, {
      contribution: user.contribution + tx.amount,
      balance: user.balance + tx.amount
    }, "Credit deposit");
    await addAudit(`Approved deposit ${window.fmt(tx.amount)} for ${user.name}`);

    window.toast(`Approved ${window.fmt(tx.amount)} for ${user.name}`);
    window.nav("admin-deposits");
  } catch (error) {
    err(error, "Approval failed");
  }
};

window.rejectDep = async function rejectDep(txId) {
  try {
    const tx = DB.transactions.find(item => item.id === txId);
    const user = window.gu(tx.uid);

    await updateTransaction(txId, { status: "rejected" }, "Reject deposit");
    await addAudit(`Rejected deposit ${window.fmt(tx.amount)} for ${user.name}`);

    window.toast("Deposit rejected", "e");
    window.nav("admin-deposits");
  } catch (error) {
    err(error, "Reject failed");
  }
};

window.submitLoan = async function submitLoan() {
  try {
    const amount = parseFloat(document.getElementById("l-amt").value);
    const months = parseInt(document.getElementById("l-dur").value, 10);
    const purpose = document.getElementById("l-purp").value.trim();
    const user = window.gu(CU().id);

    if (!amount || amount < 1000) return window.toast("Minimum loan Rs.1,000", "e");
    if (amount > user.contribution * 2) {
      return window.toast(`Max eligible: ${window.fmt(user.contribution * 2)}`, "e");
    }

    const emiValue = window.emi(amount, DB.settings.loanRate, months);
    await addLoan({
      uid: CU().id,
      principal: amount,
      rate: DB.settings.loanRate,
      months,
      emi: emiValue,
      remaining: amount,
      status: "pending",
      purpose,
      repayments: []
    }, "Submit loan request");
    await addTransaction({
      uid: CU().id,
      type: "loan",
      amount,
      status: "pending",
      note: `Loan: ${purpose || "Not specified"}`
    }, "Add loan transaction");

    window.toast("Loan request submitted! Awaiting approval.");
    window.nav("loans");
  } catch (error) {
    err(error, "Loan request failed");
  }
};

window.approveLoan = async function approveLoan(loanId) {
  try {
    const loan = DB.loans.find(item => item.id === loanId);
    const user = window.gu(loan.uid);

    if (loan.principal > window.liq()) {
      return window.toast(`Insufficient liquidity. Available: ${window.fmt(window.liq())}`, "e");
    }

    await updateLoan(loanId, { status: "active" }, "Approve loan");
    await updateUser(user.id, { loanBal: loan.principal }, "Set loan balance");
    const tx = DB.transactions.find(item => item.uid === loan.uid && item.type === "loan" && item.status === "pending");
    if (tx) await updateTransaction(tx.id, { status: "approved" }, "Approve loan transaction");
    await addAudit(`Approved loan ${window.fmt(loan.principal)} for ${user.name}`);

    window.toast(`Loan approved for ${user.name}`);
    window.nav("admin-loans");
  } catch (error) {
    err(error, "Loan approval failed");
  }
};

window.rejectLoan = async function rejectLoan(loanId) {
  try {
    const loan = DB.loans.find(item => item.id === loanId);
    const user = window.gu(loan.uid);

    await updateLoan(loanId, { status: "rejected" }, "Reject loan");
    const tx = DB.transactions.find(item => item.uid === loan.uid && item.type === "loan" && item.status === "pending");
    if (tx) await updateTransaction(tx.id, { status: "rejected" }, "Reject loan transaction");
    await addAudit(`Rejected loan from ${user.name}`);

    window.toast("Loan rejected", "e");
    window.nav("admin-loans");
  } catch (error) {
    err(error, "Loan reject failed");
  }
};

window.doRepay = async function doRepay(loanId) {
  try {
    const loan = DB.loans.find(item => item.id === loanId);
    const input = document.getElementById(`ramt-${loanId}`) || document.getElementById(`rl-amt-${loanId}`);
    const amount = parseFloat(input?.value || 0);
    if (!amount || amount <= 0) return window.toast("Enter valid amount", "e");
    if (amount > loan.remaining) return window.toast("Exceeds remaining balance", "e");

    const remaining = Math.max(0, loan.remaining - amount);
    await updateLoan(loanId, { remaining, status: remaining === 0 ? "completed" : "active" }, "Record repayment");
    await updateUser(loan.uid, { loanBal: remaining }, "Update loan balance");
    await addTransaction({
      uid: loan.uid,
      type: "repayment",
      amount,
      status: "approved",
      note: "Loan repayment"
    }, "Add repayment transaction");

    window.toast(remaining === 0 ? "Loan fully repaid!" : "Repayment recorded!");
    window.nav("loans");
  } catch (error) {
    err(error, "Repayment failed");
  }
};

window.doAddUser = async function doAddUser() {
  try {
    const name = document.getElementById("nu-n").value.trim();
    const email = document.getElementById("nu-e").value.trim();
    const password = document.getElementById("nu-p").value;
    const initialBalance = parseFloat(document.getElementById("nu-b").value) || 0;
    if (!name || !email || !password) return window.toast("Fill all fields", "e");

    await addMember({ name, email, password, initialBalance });
    document.getElementById("add-user-panel").innerHTML = "";
    window.toast(`${name} added!`);
    window.nav("admin-users");
  } catch (error) {
    err(error, "Could not add member");
  }
};

window.doAdjust = window.doAdjustUser = async function doAdjustAny(userId) {
  try {
    const prefix = document.getElementById(`adj-amt-${userId}`) ? "adj" : "ua";
    const amount = parseFloat(document.getElementById(`${prefix}-amt-${userId}`).value);
    const type = document.getElementById(`${prefix}-type-${userId}`).value;
    const reason = document.getElementById(`${prefix}-rsn-${userId}`).value.trim();
    const user = window.gu(userId);

    if (!amount || !reason) return window.toast("Fill amount and reason", "e");
    if (type !== "add" && user.balance < amount) return window.toast("Insufficient balance", "e");

    await updateUser(userId, {
      contribution: type === "add" ? user.contribution + amount : user.contribution,
      balance: type === "add" ? user.balance + amount : user.balance - amount
    }, "Adjust balance");
    await addTransaction({
      uid: userId,
      type: "adjustment",
      amount,
      status: "approved",
      note: `Admin: ${reason}`
    }, "Add adjustment transaction");
    await addAudit(`${type === "add" ? "Added" : "Deducted"} ${window.fmt(amount)} for ${user.name}: ${reason}`);

    window.toast("Balance adjusted");
    window.nav("admin-users");
  } catch (error) {
    err(error, "Adjustment failed");
  }
};

window.saveSettings = async function saveSettings() {
  try {
    const interestRate = parseFloat(document.getElementById("si").value);
    const loanRate = parseFloat(document.getElementById("sl").value);
    if (Number.isNaN(interestRate) || interestRate < 0 || interestRate > 10) return window.toast("Rate 0-10%", "e");
    if (Number.isNaN(loanRate) || loanRate < 0 || loanRate > 30) return window.toast("Loan rate 0-30%", "e");

    DB.settings.interestRate = interestRate;
    DB.settings.loanRate = loanRate;
    await addAudit(`Updated rates: deposit ${interestRate}%/mo, loan ${loanRate}% p.a.`);
    await saveDB("Update settings");
    window.toast("Settings saved!");
    window.nav("admin-settings");
  } catch (error) {
    err(error, "Settings save failed");
  }
};
