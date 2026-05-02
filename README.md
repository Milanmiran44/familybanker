# Family Bank GitHub Connection

This replaces the Supabase plan with a GitHub-based setup.

## What GitHub Can Safely Do

- Host the app with GitHub Pages.
- Store a JSON file in a private repo through the GitHub Contents API.
- Keep a commit history of every database change.

## Security Note

GitHub is not a real banking backend. Do not hard-code a GitHub token into frontend JavaScript. This adapter stores the token only in `sessionStorage`, so it disappears when the browser session ends.

For a family/private demo app this can work. For real money records, use a proper backend.

## Setup

1. Create a GitHub repo, for example `family-bank`.
2. Copy your existing HTML/CSS/JS app into this folder.
3. Copy `github-config.js` and `github-db.js` beside the HTML file.
4. Update `github-config.js` with your GitHub username/org and repo name.
5. Commit this folder to GitHub.
6. In the repo, go to Settings -> Pages -> Source -> GitHub Actions.
7. The included `.github/workflows/pages.yml` deploys the app on every push to `main`.

## Token

Create a fine-grained personal access token with access only to this repo and permission:

- Contents: Read and write

When the app starts, ask the admin for that token and call:

```js
import { setGithubToken, loadDB } from "./github-db.js";

setGithubToken(tokenFromInput);
await loadDB();
```

## Replacing localStorage

Remove:

```js
const DK = "fb_db2";
function initDB(){...}
function save(){...}
initDB();
```

Import:

```js
import {
  DB,
  CU,
  setGithubToken,
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
```

Then replace each old mutation:

```js
DB.transactions.push(tx);
save();
```

with:

```js
await addTransaction(tx, "Add deposit request");
```

And replace:

```js
user.balance += amount;
save();
```

with:

```js
await updateUser(user.id, { balance: user.balance + amount }, "Update balance");
```
