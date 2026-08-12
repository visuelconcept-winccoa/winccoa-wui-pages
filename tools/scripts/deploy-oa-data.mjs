#!/usr/bin/env node
/**
 * Copies oa-data/ contents to ${OUT_DIR}/../ (or dist/ if unset).
 * Never cleans target. Skips symlinks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../..');
const sourceDirectory = path.resolve(workspaceRoot, 'oa-data');

const outDirectory = process.env.OUT_DIR;
const targetDirectory = outDirectory
  ? path.resolve(outDirectory, '..')
  : path.resolve(workspaceRoot, 'dist');

if (!fs.existsSync(sourceDirectory)) {
  console.log('[deploy:oa-data] No oa-data/ directory found, skipping.');
  process.exit(0);
}

if (
  targetDirectory === '/' ||
  targetDirectory === path.parse(targetDirectory).root
) {
  console.error(
    '[deploy:oa-data] Target resolves to filesystem root — aborting.'
  );
  process.exit(1);
}

function copyRecursive(source, destination) {
  let count = 0;
  const entries = fs.readdirSync(source, { withFileTypes: true });
  let directoryCreated = false;

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isSymbolicLink()) {
      console.warn(`[deploy:oa-data] Skipping symlink: ${sourcePath}`);
      continue;
    }

    if (entry.isDirectory()) {
      count += copyRecursive(sourcePath, destinationPath);
    } else if (entry.name === '.gitkeep' || entry.name === 'README.md') {
      continue;
    } else if (entry.isFile()) {
      if (!directoryCreated) {
        fs.mkdirSync(destination, { recursive: true });
        directoryCreated = true;
      }
      fs.copyFileSync(sourcePath, destinationPath);
      count++;
    }
  }

  return count;
}

const count = copyRecursive(sourceDirectory, targetDirectory);

if (count === 0) {
  console.log(
    '[deploy:oa-data] No files to deploy (oa-data/ contains only placeholders).'
  );
} else {
  console.log(
    `[deploy:oa-data] Deployed ${count} file(s) to ${targetDirectory}`
  );
}
