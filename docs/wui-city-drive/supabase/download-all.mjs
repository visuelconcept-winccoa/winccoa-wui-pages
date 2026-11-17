// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// City Drive — after the event: download every photo of the Supabase bucket.
//
//   npm install @supabase/supabase-js
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... node download-all.mjs ./photos-event
//
// The secret key is needed to list the bucket (the game's publishable key may only upload).
// Run it on the operator's computer, never on the game's: the secret key opens the whole project.
// The photos keep their <YYYY-MM-DD>/<uuid>.jpg layout under the target folder.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_BUCKET || 'photos';
const target = process.argv[2] || './photos-download';
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Every file under `prefix`, folders walked (list() returns folders as entries without an id). */
async function listAll(prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listAll(path)));
      else files.push(path);
    }
    if (data.length < 1000) return files;
  }
}

const files = await listAll();
console.log(`${files.length} photo(s) in "${bucket}".`);
let done = 0;
for (const path of files) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) {
    console.error(`  ${path}: ${error.message}`);
    continue;
  }
  const out = join(target, path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(await data.arrayBuffer()));
  done++;
}
console.log(`${done} downloaded to ${target}.`);
