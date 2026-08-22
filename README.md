# Along the Trail: Fungi & Field Finds

Interactive trail guide — fungi and field finds with species ID, habitat notes, GPS trail maps, search, and community photo uploads.

## Live site (GitHub Pages)

After deploy, the public gallery is at:

`https://briansudol.github.io/along-the-trail/`

**Admin photo editing is localhost-only.** On GitHub Pages the Admin button and editor are removed automatically. Use `admin_server.py` on your Mac to edit images and moderate uploads, then `git push` to update the live site.

## Preview locally (with admin + persistence)

```bash
cd ~/along-the-trail-site
cp admin_config.example.json admin_config.json   # first time only
python3 admin_server.py
```

Open [http://localhost:8877](http://localhost:8877).

Community uploads and newsletter signups are saved on disk while this server is running. localStorage is still used as a demo fallback (plain `http.server`, or if the API is down).

**Admin**
1. Click **Admin** (top nav) when the admin server is running
2. Password: see `admin_config.json`
3. **Community inbox** → approve / reject visitor photos, see newsletter emails
4. **Edit photos** → rotate / flip / crop → **Save to disk**
5. **Set as cover** to change a group’s main card image
6. Commit and push approved community files so GitHub Pages updates

> Use `admin_server.py` (not plain `http.server`) so save/cover/persist APIs work.

## Features

- **Gallery** of trail mushrooms with common + scientific names
- **Category** chips (polypore, gilled, chanterelle, coral, community)
- **Search** across names, habitat, trees, uses, and locations
- **Detail panel** with uses, habitat, tree associates, field marks, season
- **Community uploads** with moderation (pending until approved)
- **Newsletter** signups stored for real (local API, Supabase, or Formspree)

## Persistence

Uploads and signups try backends in this order:

1. **Local admin API** — `python3 admin_server.py` writes photos to `uploads/community/` (pending) and, on approve, `photos/community/` (GitHub-committable). Newsletter emails go to `data/newsletter.json` (gitignored).
2. **Supabase** — set `supabaseUrl` + `supabaseAnonKey` in `js/backend-config.js` and run `supabase/schema.sql`. Images go to the `community-photos` bucket. Public gallery only shows **approved** rows.
3. **Formspree** — optional `formspreeNewsletter` endpoint for newsletter-only production signups.
4. **localStorage** — demo fallback so the existing UI still works without a backend.

Approved finds are also written to `data/community.json`. Commit that file plus `photos/community/` to publish them on GitHub Pages even without Supabase.

### Supabase (GitHub Pages)

1. Create a project at [supabase.com](https://supabase.com)
2. SQL editor: run `supabase/schema.sql`
3. Insert a moderation secret:
   ```sql
   insert into public.admin_settings (key, value)
   values ('moderate_secret', 'your-localhost-secret')
   on conflict (key) do update set value = excluded.value;
   ```
4. Paste the project URL and anon key into `js/backend-config.js`
5. Put the same secret in `moderateSecret` so localhost admin can approve production uploads

### Formspree (newsletter only)

Create a form at [formspree.io](https://formspree.io) and set `formspreeNewsletter` in `js/backend-config.js` to the form endpoint (`https://formspree.io/f/xxxx`).

## Project layout

```
along-the-trail-site/
  index.html
  css/styles.css
  js/app.js
  js/persist.js
  js/backend-config.js
  data/mushrooms.json
  data/community.json      # approved community finds (safe to commit)
  photos/                  # curated trail photos
  photos/community/        # approved visitor photos (commit these)
  supabase/schema.sql
  README.md
```

## Deploy

Upload the whole folder to Netlify, Cloudflare Pages, or GitHub Pages.
Point a custom domain if desired.

## Disclaimer

Educational gallery only — **not a foraging guide**.
