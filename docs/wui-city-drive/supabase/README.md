<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# City Drive — souvenir photos on Supabase, QR code at the end of the match

The photo booth's photo (taken when the match starts) is published by **City Drive's own
backend** to a Supabase Storage bucket; the podium shows a **QR code** of its link — "Scan to
get your photo" — until the operator starts a new game. No network? The photo waits in
`<project>/data/city-drive/photos/pending/` and the backend retries on its own (5 s, 10 s,
20 s… up to every minute, also after a webserver restart); the screen says so.

```
browser ── POST /api/city-drive/publish (JPEG ≤ 1600 px) ──▶ City Drive backend (webserver)
                                    pending/<uuid>.jpg ──▶ Supabase Storage  photos/<YYYY-MM-DD>/<uuid>.jpg
browser ◀── { id, url } ── (public bucket: the link at once)       retries until done
browser ── GET /api/city-drive/publish/<id> every 3 s ──▶ uploading · pending (error) · published
```

## 1. Supabase (free plan)

1. supabase.com → **New project** (any name, a region near the event). Note its URL:
   *Project Settings → Data API*: `https://<ref>.supabase.co`.
2. **Storage → New bucket**: name `photos`, **Public bucket** ticked (see *Public or private*).
3. **Project Settings → API Keys**: copy the **publishable key** (`sb_publishable_…`).
4. **SQL Editor**, run — the publishable key may then only **add** files to this bucket
   (no listing, no overwriting, no deleting):

   ```sql
   create policy "City Drive: upload photos only"
   on storage.objects for insert to anon
   with check (bucket_id = 'photos');
   ```

## 2. The WinCC OA project

In `<project>/config/config` (never in the code nor in the repository):

```
[cityDriveSupabase]
url = "https://<ref>.supabase.co"
key = "sb_publishable_xxxxxxxxxxxx"
bucket = "photos"
signedDays = 0
```

Restart the webserver (it reads the section for each photo; the worker starts with it).
`GET /api/city-drive/health` answers `"supabase": true` when the section is complete. Without
it, the photo booth still saves the photos locally and the podium shows no QR code.

## Public or private?

The player's phone opens the link **without any login**, so the file must be readable by
whoever has the link:

- **public bucket** (`signedDays = 0`, default): the link is the file's public URL. It is
  unguessable (a random UUID) and nobody can list the bucket, but it never expires. The
  publishable key with the INSERT-only policy is enough. The QR code shows at once.
- **private bucket** (`signedDays = 7`, for example): after the upload the backend asks
  Supabase for a **signed link** valid that many days; the QR code appears once the photo is
  uploaded. The key must then be allowed to read: use the **secret key** (`sb_secret_…`) — it
  stays on the server, in `config/config`, but it opens the whole Supabase project: protect
  that file.

## 3. After the event

From the operator's computer (Node 18+), in this folder:

```bash
npm install @supabase/supabase-js
```

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... node download-all.mjs ./photos-event
```

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... node empty-bucket.mjs --yes
```

`download-all.mjs` keeps the `<date>/<uuid>.jpg` layout; `empty-bucket.mjs` counts only
without `--yes`. On the server, `<project>/data/city-drive/photos/published.jsonl` lists every
published photo (id, path, link, time); the local copies named after the emails stay in
`data/city-drive/photos/` — personal data: delete them when the event is over.
