#!/usr/bin/env node
/** Creates oa-data/ skeleton for translations, icons, and SVGs. Idempotent. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../..');
const oaDataDirectory = path.resolve(workspaceRoot, 'oa-data');

const directories = [
  'WebUI/msg/en_US.utf8',
  'WebUI/msg/de_AT.utf8',
  'WebUI/icons',
  'WebUI/svg',
  'WebUI/widgets-v2'
];

const README = `# OA Project Data

Files in this directory are deployed to the WinCC OA project alongside the dashboard build.

## Directory Structure

    oa-data/
    └── WebUI/
        ├── msg/              Translation files (JSON)
        │   ├── en_US.utf8/   English translations
        │   └── de_AT.utf8/   German translations
        ├── icons/            Custom SVG icons (appear in widget icon selector)
        ├── svg/              SVG process diagrams
        └── widgets-v2/       Custom widget definitions (JSON + SVG + JS)

## How It Works

- Run \`npm run deploy:oa-data\` to copy files to the output directory.
- \`npm run build\` also runs the deploy automatically.
- When \`OUT_DIR\` is set, files deploy to \`\${OUT_DIR}/../\` (the parent \`data/\` directory).
- When \`OUT_DIR\` is not set, files go to \`dist/\`.
- The target directory is never cleaned — only individual files are copied/overwritten.

## Translation Files

Widget translations follow the naming pattern \`WUI_Widget_<WidgetName>.json\`:

    {
      "myWidget": {
        "label": "My Widget",
        "description": "A custom dashboard widget."
      }
    }

Place the same file in both \`en_US.utf8/\` and \`de_AT.utf8/\` with translated values.
The WinCC OA backend merges all \`WUI_*.json\` files from \`data/WebUI/msg/\` and serves them to the frontend.
`;

let created = 0;

for (const directory of directories) {
  const fullPath = path.join(oaDataDirectory, directory);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    created++;
  }
}

const readmePath = path.join(oaDataDirectory, 'README.md');
if (!fs.existsSync(readmePath)) {
  fs.writeFileSync(readmePath, README, 'utf8');
}

if (created > 0) {
  console.log(
    `[init:oa-data] Created oa-data/ structure at ${oaDataDirectory}`
  );
} else {
  console.log('[init:oa-data] oa-data/ already exists.');
}
