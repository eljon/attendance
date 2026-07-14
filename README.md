# Attendance Check-In

A small web app for reporting that Sunday attendance has been checked for each
organization. It runs entirely on **GitHub Pages** (static site) and uses a
**Google Sheet** as its database — **no Google Cloud Console** and no API keys
required.

- **Check In** tab — enter your name, tick every organization you've checked
  the attendance for, and submit.
- **History** tab — see, at a glance, which organizations have or haven't been
  checked for the current week, plus a full log of every check-in.

The data lives in a Google Sheet you own. The bridge between the static site and
the Sheet is a **Google Apps Script Web App** — a script bound to the Sheet that
you deploy with a couple of clicks. Because Apps Script runs as *you*, it can
read and write the Sheet without any Cloud project, OAuth client, or service
account.

```
 Browser (GitHub Pages)  ──HTTPS──▶  Apps Script Web App  ──▶  Google Sheet
        index.html                       Code.gs               "Attendance" tab
```

---

## 1. Set up the Google Sheet backend

1. Create a new Google Sheet (<https://sheets.new>). Name it anything, e.g.
   *Attendance*.
2. In the Sheet, open **Extensions → Apps Script**. A script editor opens.
3. Delete any starter code in `Code.gs`, then paste the entire contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repo. Click the
   **Save** icon.
4. Deploy it as a Web App:
   - Click **Deploy → New deployment**.
   - Click the gear ⚙ next to *Select type* and choose **Web app**.
   - **Execute as:** *Me*.
   - **Who has access:** *Anyone*. *(This makes the URL reachable from the
     browser. The script only appends check-ins and returns history — it never
     exposes your Google account.)*
   - Click **Deploy**.
5. The first time, Google asks you to **authorize** the script. Click through
   *Review permissions → your account → Advanced → Go to (project) → Allow*.
   (The "unverified app" warning is expected for your own script.)
6. Copy the **Web app URL**. It looks like:

   ```
   https://script.google.com/macros/s/AKfy...long.../exec
   ```

The `Attendance` tab (with headers `Timestamp | Name | Organizations | Week`) is
created automatically the first time a check-in is submitted or history is
loaded.

> **When you change `Code.gs` later:** use **Deploy → Manage deployments →
> edit ✏ → Version: New version → Deploy** so the same URL serves the update.

---

## 2. Point the web app at your Sheet

Edit [`config.js`](config.js) and paste the URL from step 1.6:

```js
window.CONFIG = {
  WEB_APP_URL: "https://script.google.com/macros/s/AKfy...long.../exec",
};
```

Commit and push the change.

---

## 3. Host on GitHub Pages

1. Push this repository to GitHub (the files must be at the repo root).
2. In the repo, go to **Settings → Pages**.
3. Under *Build and deployment*, set **Source: Deploy from a branch**, pick the
   branch that holds these files and the **`/ (root)`** folder, then **Save**.
4. After a minute the site is live at
   `https://<your-user>.github.io/<repo>/`.

That's it — open the site, submit a check-in, and watch the row appear in your
Google Sheet.

---

## How "checked / not checked this week" works

Each submission stores the **Sunday that starts the current week** in the `Week`
column. The History tab computes the current week's Sunday in the browser and
marks an organization **Checked** if any check-in for that week includes it, or
**Not yet** otherwise. A new week automatically resets every organization to
*Not yet*.

## Files

| Path | Purpose |
|------|---------|
| `index.html`         | App shell with the two tabs |
| `assets/styles.css`  | Styling |
| `assets/app.js`      | Front-end logic, form handling, history rendering |
| `config.js`          | Where you paste your Web App URL |
| `apps-script/Code.gs`| Google Apps Script backend (paste into the Sheet) |

## Editing the organizations / divisions

Organizations are grouped into **divisions** (Adults, Young Men, Young Women,
Children, Others). Edit the `DIVISIONS` array near the top of `assets/app.js`:

```js
const DIVISIONS = [
  { name: "Adults", orgs: ["Elders Quorum", "Relief Society", ...] },
  ...
];
```

The order you write is the order shown — the list is **not** sorted. Add or
remove a division by editing an object; add or remove an organization by editing
its `orgs` array. Everything else (checkboxes, per-division counts, progress
ring, history matrix) updates automatically.

No change is needed in the Sheet or `Code.gs`; organizations are stored as plain
text.

## Notes & limitations

- The Sheet must have **"Anyone"** access on the *Web App deployment* (not the
  Sheet itself) for the browser to reach it. The Sheet document can stay private.
- There is no authentication on submissions — anyone with the site URL can post a
  check-in. That's usually fine for an internal attendance tool; if you need to
  lock it down, add a shared passcode field to the form and check it in
  `doPost`.
