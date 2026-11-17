// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// City Drive — after the event: delete every photo of the Supabase bucket (the bucket stays).
//
//   npm install @supabase/supabase-js
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... node empty-bucket.mjs --yes
//
// Download them first (download-all.mjs): this cannot be undone. Without --yes it only counts.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_BUCKET || 'photos';
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

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
if (!process.argv.includes('--yes')) {
  console.log(`${files.length} photo(s) in "${bucket}". Run again with --yes to delete them.`);
  process.exit(0);
}
let removed = 0;
for (let k = 0; k < files.length; k += 100) {
  const batch = files.slice(k, k + 100);
  const { error } = await supabase.storage.from(bucket).remove(batch);
  if (error) console.error(`  batch ${k / 100 + 1}: ${error.message}`);
  else removed += batch.length;
}
console.log(`${removed} of ${files.length} photo(s) deleted from "${bucket}".`);
