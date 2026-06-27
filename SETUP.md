# PicSearch — Setup Guide

## What you need before starting
- A Google account
- A Vercel account (free tier is fine)

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
2. Name it **PicSearch** (or anything you like).
3. On **Sheet1**, rename it to **Vehicles** (right-click the tab → Rename).
4. Add these headers in row 1 — exact spelling matters:

   | A   | B            | C     | D    | E        | F       | G    | H          | I          | J    |
   |-----|--------------|-------|------|----------|---------|------|------------|------------|------|
   | S/N | Vehicle Make | Model | Year | Capacity | Luggage | Type | Aff. Price | Ret. Price | Pics |

5. Share the sheet: **Share → Change to anyone with the link → Viewer**.  
   This lets the site read vehicle data without a login.

6. Copy the Sheet ID from the URL:  
   `https://docs.google.com/spreadsheets/d/**SHEET_ID**/edit`

---

## Step 2 — Get a Google Sheets API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project (e.g. **PicSearch**).
3. In the left menu: **APIs & Services → Library** → search **Google Sheets API** → Enable it.
4. Go to **APIs & Services → Credentials → Create Credentials → API Key**.
5. Copy the key.
6. Click **Edit API key** → under **API restrictions**, select **Google Sheets API** only.  
   *(Optional but recommended to prevent misuse.)*

---

## Step 3 — Deploy the Google Apps Script (write API)

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Delete all existing code in the editor.
3. Copy the entire contents of `apps-script.js` (from this repo) and paste it in.
4. Replace `YOUR_GOOGLE_SHEET_ID_HERE` on line 6 with your actual Sheet ID.
5. Click **Save** (floppy disk icon).
6. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy**. Authorise when prompted (Google will warn about unverified app — click **Advanced → Go to PicSearch (unsafe)**).
8. Copy the **Web app URL** that appears.

---

## Step 4 — Configure the site

Open `config.js` and fill in the four values:

```js
const CONFIG = {
  SHEET_ID:       'paste-your-sheet-id-here',
  API_KEY:        'paste-your-api-key-here',
  APPS_SCRIPT_URL:'paste-your-web-app-url-here',
  ADMIN_PASSWORD: 'choose-a-strong-password',
  SHEET_NAME:     'Vehicles',   // must match the tab name in the sheet
};
```

> **Security note:** `config.js` is public. The API key is read-only and restricted to the Sheets API, so this is safe. The admin password prevents casual visitors from adding vehicles; for stronger security, restrict Vercel access by IP or add Vercel authentication.

---

## Step 5 — Deploy to Vercel

### Option A — Drag & drop (easiest)
1. Zip the project folder.
2. Go to [vercel.com](https://vercel.com) → **Add New Project → drag the zip**.
3. No build settings needed — it's a static site.

### Option B — Via GitHub
1. Push this folder to a GitHub repo.
2. In Vercel: **Add New Project → Import Git Repository**.
3. Leave all build settings blank (or framework = "Other").
4. Click **Deploy**.

Your site is live. The URL will look like `https://picsearch-xxx.vercel.app`.

---

## Using the site

| Page | URL | Purpose |
|------|-----|---------|
| Listings | `/` | Public vehicle grid with search + filter |
| Detail | `/vehicle.html?id=xxx` | Shareable link — paste into PDFs or emails |
| Admin | `/admin.html` | Add vehicles manually or bulk-upload a spreadsheet |

### Bulk upload spreadsheet format

Use the **Download CSV template** button on the admin page for a ready-to-fill template.  
Column names are flexible — e.g. `colour`, `Colour`, `color` all work.  
Minimum required columns: **make** and **model**. All others are optional.

### Image hosting

The `imageurl` column holds a link to a photo hosted elsewhere:
- **Google Drive**: upload a photo → right-click → **Get link** → set to Anyone with link → use the direct link format:  
  `https://drive.google.com/uc?export=view&id=FILE_ID`
- **Imgur**, **Cloudinary**, or any public image URL also work.

---

## Column reference

| Column | Example | Notes |
|--------|---------|-------|
| S/N | 1, 2, 3 | Unique number per vehicle — used as the shareable URL key |
| Vehicle Make | Ford | Manufacturer name |
| Model | E450 | Model name |
| Year | 2022 | Optional |
| Capacity | 15 | Number of passengers |
| Luggage | Yes / No | Whether the vehicle has luggage space |
| Type | Party Bus | Used to populate the filter dropdown on the listings page |
| Aff. Price | 180 | Affordable/affiliate price — shown in blue |
| Ret. Price | 200 | Retail price — shown alongside for comparison |
| Pics | https://… | Direct URL to a vehicle photo |

To edit any value, change it directly in the Google Sheet — the site picks it up within seconds.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Vehicles not loading | Check `SHEET_ID` and `API_KEY` in config.js. Make sure the sheet is shared publicly. |
| "Add Vehicle" button spins but nothing appears | Check `APPS_SCRIPT_URL` in config.js. Re-deploy the Apps Script if needed. |
| Vehicle added but not showing yet | Wait ~5 seconds and refresh — Sheets API has a short cache. |
| Excel upload fails | Make sure the XLSX library loaded (check browser console). |
