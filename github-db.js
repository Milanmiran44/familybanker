import { GITHUB_CONFIG } from "./github-config.js";

const API = "https://api.github.com";
const TOKEN_KEY = "family_bank_github_token";

export let DB = {
  settings: { interestRate: 2, loanRate: 8, lastRun: null },
  users: [],
  transactions: [],
  loans: [],
  audit: []
};

export let CU = null;

function now() {
  return Date.now();
}

function id(prefix) {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function initialDB() {
  const t = now();
  return {
    settings: { interestRate: 2, loanRate: 8, lastRun: null },
    users: [
      {
        id: "u0",
        name: "Admin Family",
        email: "admin@family.com",
        password: "admin123",
        role: "admin",
        contribution: 50000,
        interest: 2400,
        balance: 52400,
        loanBal: 0,
        created: t
      }
    ],
    transactions: [],
    loans: [],
    audit: []
  };
}

export function setGithubToken(token) {
  if (!token) throw new Error("GitHub token is required.");
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearGithubToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function token() {
  const value = sessionStorage.getItem(TOKEN_KEY);
  if (!value) {
    throw new Error("Connect GitHub first. A fine-grained token is required for this session.");
  }
  return value;
}

async function github(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.message || `GitHub request failed (${res.status})`);
  }
  return data;
}

function encodeJson(data) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
}

function decodeJson(content) {
  return JSON.parse(decodeURIComponent(escape(atob(content.replace(/\n/g, "")))));
}

async function readRemoteFile() {
  const { owner, repo, branch, dataPath } = GITHUB_CONFIG;
  return github(`/repos/${owner}/${repo}/contents/${encodeURIComponent(dataPath)}?ref=${encodeURIComponent(branch)}`);
}

export async function loadDB() {
  try {
    const file = await readRemoteFile();
    DB = decodeJson(file.content);
    return DB;
  } catch (err) {
    if (!String(err.message).includes("Not Found")) throw err;
    DB = initialDB();
    await saveDB("Initialize Family Bank data");
    return DB;
  }
}

export async function saveDB(message = "Update Family Bank data") {
  const { owner, repo, branch, dataPath } = GITHUB_CONFIG;
  let sha = null;

  try {
    const existing = await readRemoteFile();
    sha = existing.sha;
  } catch (err) {
    if (!String(err.message).includes("Not Found")) throw err;
  }

  await github(`/repos/${owner}/${repo}/contents/${encodeURIComponent(dataPath)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: encodeJson(DB),
      branch,
      sha
    })
  });
}

export async function doLogin(email, password) {
  await loadDB();
  const user = DB.users.find(item => item.email === email && item.password === password);
  if (!user) throw new Error("Invalid credentials.");
  CU = user;
  return user;
}

export function doLogout() {
  CU = null;
}

export async function addMember({ name, email, password, initialBalance = 0 }) {
  const amount = Number(initialBalance || 0);
  if (DB.users.some(user => user.email === email)) throw new Error("Email exists.");

  const user = {
    id: id("u"),
    name,
    email,
    password,
    role: "user",
    contribution: amount,
    interest: 0,
    balance: amount,
    loanBal: 0,
    created: now()
  };

  DB.users.push(user);
  if (amount > 0) {
    DB.transactions.push({
      id: id("t"),
      uid: user.id,
      type: "deposit",
      amount,
      status: "approved",
      note: "Initial deposit by admin",
      date: now()
    });
  }
  DB.audit.push({ id: id("a"), aid: CU.id, action: `Added member ${name}`, date: now() });
  await saveDB(`Add member ${name}`);
  return user;
}

export async function addTransaction(tx, message = "Add transaction") {
  DB.transactions.push({ id: id("t"), date: now(), ...tx });
  await saveDB(message);
}

export async function updateUser(userId, patch, message = "Update member") {
  const user = DB.users.find(item => item.id === userId);
  if (!user) throw new Error("User not found.");
  Object.assign(user, patch);
  await saveDB(message);
  return user;
}

export async function updateTransaction(txId, patch, message = "Update transaction") {
  const tx = DB.transactions.find(item => item.id === txId);
  if (!tx) throw new Error("Transaction not found.");
  Object.assign(tx, patch);
  await saveDB(message);
  return tx;
}

export async function addLoan(loan, message = "Add loan") {
  DB.loans.push({ id: id("l"), created: now(), repayments: [], ...loan });
  await saveDB(message);
}

export async function updateLoan(loanId, patch, message = "Update loan") {
  const loan = DB.loans.find(item => item.id === loanId);
  if (!loan) throw new Error("Loan not found.");
  Object.assign(loan, patch);
  await saveDB(message);
  return loan;
}

export async function addAudit(action) {
  DB.audit.push({ id: id("a"), aid: CU?.id || null, action, date: now() });
  await saveDB(action);
}
