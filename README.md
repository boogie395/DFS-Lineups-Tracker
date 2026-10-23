# DFS Lineup Tracker

Static dashboard for comparing daily fantasy lineups built with **Grok** and **ChatGPT**. It loads plain CSV files from `data/` and runs entirely in the browser. GitHub Pages can host it with **Deploy from a branch**, folder **`/` (root)**, on the default branch.

Expected site: [https://boogie395.github.io/DFS-Lineups-Tracker/](https://boogie395.github.io/DFS-Lineups-Tracker/)

No build step, no accounts, no analytics. Do not put FanDuel or DraftKings usernames, entry IDs, emails, or other personal info in the CSVs. The repo is public, and the site renders whatever the CSVs contain.

## Add a slate

1. Export the lineups to a CSV with the header below.
2. Save it under the app folder. One file per app per slate:

   `data/<app>/<date>_<sport>_<site>_<slate>.csv`

   Examples:

   - `data/grok/2026-10-22_NFL_FD_NE@CHI.csv`
   - `data/chatgpt/2026-10-26_NFL_DK_KC@BUF.csv`

   The filename is for you. The columns inside the file are what the site uses. `@` in a slate name is fine.

3. Regenerate the manifest (the site cannot list folders on its own):

   ```bash
   python3 scripts/build_manifest.py
   ```

   That rewrites `data/manifest.json` with every `data/**/*.csv` path. You can also append the path by hand:

   ```json
   {
     "files": [
       "data/grok/2026-10-22_NFL_FD_NE@CHI.csv",
       "data/chatgpt/2026-10-26_NFL_DK_KC@BUF.csv"
     ]
   }
   ```

4. Commit the CSV and `data/manifest.json`.

`data/chatgpt/` is empty on purpose until the first ChatGPT file lands. The ChatGPT view stays on an empty state until then.

To fill in results later, edit `finish`, `field_size`, and `winnings` on the existing rows and commit. Leave those cells blank until you know them. You do not need to rebuild the manifest unless the file path changes.

## Preview locally

Fetch will not work if you open `index.html` as a file. From the repo root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Views

The filter bar sticks across all four views.

| View | Hash | What it shows |
| --- | --- | --- |
| Overview | `#/` | Grok vs ChatGPT: scores, fees, contest mix, trend |
| Grok | `#/grok` | Grok lineups only |
| ChatGPT | `#/chatgpt` | ChatGPT lineups only |
| Lineups | `#/lineups` | Every lineup in the current filter |

## Filters

- App, date range, sport, site, format, slate, contest type
- Entry fee as a min/max dollar range and as buckets (Under $1, $1–$5, $5–$20, $20–$100, $100+)
- Contest size: max-entries buckets (single, 3-max, 5-max, 20-max, 150-max, 150+), field-size buckets, and prize-pool buckets
- Entered / not entered / all. **Entered is the default.** Lineups you generated but did not submit (`used` = no) stay out of fees, winnings, cash rate, and ROI until you turn on **Include unentered lineups in fees, winnings, and ROI**
- Player search, with an **MVP / captain only** option

Max-entries buckets map a lineup's `max_entries` up to the next common cap: 1 → single, 2–3 → 3-max, 4–5 → 5-max, 6–20 → 20-max, 21–150 → 150-max, anything higher → 150+.

## Metrics

- Lineup count, average, median, and best `points` (blank scores are skipped)
- Average percent of optimal: mean of `points / optimal_points` where optimal is present and greater than zero
- Best lineup per slate (date + sport + slate, and per app on the overview)
- Score histogram and a per-app trend of average points by date
- Contest-type and fee-bucket breakdowns
- Captain table: average lineup points with that player in the MVP / CPT / captain slot
- Player exposure versus lineup points. These are lineup totals, not a player's own fantasy score
- When results exist: cash rate (`winnings > 0`), top 1% and top 10% (`finish / field_size`), total fees, total winnings, and ROI `(winnings - fees) / fees`

Cash rate, finish rates, and ROI use only rows where the needed cells are filled in. A blank `winnings` is an unsettled lineup, not a zero. Fees still sum for entered lineups that have an entry fee.

## CSV schema

Header:

```csv
date,sport,site,format,slate,app,contest_name,contest_type,max_entries,prize_pool,entry_fee,used,mvp,flex1,flex2,flex3,flex4,flex5,salary,points,optimal_points,finish,field_size,winnings
```

| Column | Notes |
| --- | --- |
| `date` | `YYYY-MM-DD` |
| `sport`, `site`, `format`, `slate`, `app` | Free text. App should be `Grok` or `ChatGPT` so the colors line up. |
| `contest_name`, `contest_type` | Type is the filter, for example `Single entry` or `150-max GPP`. |
| `max_entries`, `prize_pool`, `entry_fee` | Numbers. Fees can be cents, like `0.05`. |
| `used` | `yes` if you entered it, `no` if you only generated it. Also accepts true/false, 1/0, entered/bench. Blank counts as not entered. |
| `mvp`, `flex1`…`flex5` | Players. `mvp`, `cpt`, `captain`, and `capt` are the captain slot. |
| `salary`, `points`, `optimal_points` | Numbers. |
| `finish`, `field_size`, `winnings` | Leave blank until results are in. |

Other formats can add or rename slot columns (`CPT`, `QB`, `RB`, `WR`, `FLEX`, `DST`, and so on). Any column that is not in the metadata list above is treated as a player slot. Metadata columns are recognized case-insensitively.

These column names are dropped and never shown, so a stray id does not get published as a player: `entry_id`, `username`, `user`, `user_id`, `email`, `owner`, `notes`, `note`, `comment`, `comments`.

## GitHub Pages

Settings → Pages → Build and deployment → **Deploy from a branch** → Branch **`main`**, folder **`/ (root)`** → Save.

The published URL is `https://boogie395.github.io/DFS-Lineups-Tracker/`. The first deploy can take a minute after the commit that contains this site is on `main`.
