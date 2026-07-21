# Mushrooms of the Delaware Water Gap and Sourlands

Interactive field atlas website — species ID, category, habitat, tree associates, uses, search, and community photo uploads.

## Live site (GitHub Pages)

After deploy, the public gallery is at:

`https://briansudol.github.io/mushrooms-delaware-valley/`

**Admin photo editing is localhost-only.** On GitHub Pages the Admin button and editor are removed automatically. Use `admin_server.py` on your Mac to edit images, then `git push` to update the live site.

## Preview locally (with admin photo editor)

```bash
cd ~/mushrooms-delaware-valley
cp admin_config.example.json admin_config.json   # first time only
python3 admin_server.py
```

Open [http://localhost:8877](http://localhost:8877).

**Admin**
1. Click **Admin** (top nav) when the admin server is running  
2. Password: see `admin_config.json`  
3. **Edit photos** → rotate / flip / crop → **Save to disk**  
4. **Set as cover** to change a group’s main card image  
5. Commit and push changes so GitHub Pages updates  

> Use `admin_server.py` (not plain `http.server`) so save/cover APIs work.

## Features

- **Gallery** of trail mushrooms with common + scientific names  
- **Category** chips (polypore, gilled, chanterelle, coral, community)  
- **Search** across names, habitat, trees, uses, and locations  
- **Detail panel** with uses, habitat, tree associates, field marks, season  
- **Community uploads** stored in the browser (`localStorage`) for demos  

## Project layout

```
mushrooms-delaware-valley/
  index.html
  css/styles.css
  js/app.js
  data/mushrooms.json
  photos/                 # curated trail photos
  README.md
```

## Deploy

Upload the whole folder to Netlify, Cloudflare Pages, or GitHub Pages.  
Point a custom domain if desired.

## Note on uploads

Community photos are saved **in the visitor’s browser only** (no server).  
For a multi-user production upload inbox, add a backend (e.g. Supabase, Firebase, or form service) later.

## Disclaimer

Educational gallery only — **not a foraging guide**.
