#!/usr/bin/env node
/*
  Postinstall script for @wincc-oa/webui-runtime
  Copies webui-runtime workspace files from node_modules to the calling directory
*/

import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const PACKAGE_NAME = '@wincc-oa/webui-runtime';

const log = (...messages) =>
  console.log('[webui-runtime-postinstall]', ...messages);

function isInteractive() {
  return process.stdin.isTTY && process.stdout.isTTY;
}

async function askConfirmation(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  await fsp.cp(source, destination, {
    recursive: true,
    force: true,
    dereference: true
  });
}

export async function findSourceDirectory(callingDirectory) {
  // Always check node_modules/<package> relative to calling directory first
  let candidate = path.join(callingDirectory, 'node_modules', PACKAGE_NAME);
  if (await pathExists(candidate)) {
    return candidate;
  }

  // Check parent directory's node_modules (monorepo case)
  candidate = path.join(callingDirectory, '..', 'node_modules', PACKAGE_NAME);
  if (await pathExists(candidate)) {
    return path.resolve(candidate);
  }
}

const autoConfirm = process.argv.includes('-y');
const callingDirectory = process.env.INIT_CWD || process.cwd();
const sourceDirectory = await findSourceDirectory(callingDirectory);

if (!sourceDirectory) {
  log(`Package ${PACKAGE_NAME} not found in node_modules`);
  log(
    `Hint: Install the package first or copy files manually from node_modules/${PACKAGE_NAME}`
  );
  process.exitCode = 0;
} else if (path.resolve(sourceDirectory) === path.resolve(callingDirectory)) {
  // Prevent copying to itself
  log('Source and target are the same, skipping');
} else {
  log(`Source: ${sourceDirectory}`);
  log(`Target: ${callingDirectory}`);

  // Auto-confirm with -y flag (for CI/pipeline usage)
  if (autoConfirm || isInteractive()) {
    if (!autoConfirm) {
      const rawAnswer = await askConfirmation(
        'Deploy webui-runtime workspace files? [y/N]: '
      );
      const answer = rawAnswer.trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        log('Deployment cancelled');
        log(
          `Hint: Files can be manually copied from node_modules/${PACKAGE_NAME}`
        );
        process.exit(0);
      }
    }
    try {
      log('Copying files...');
      await copyDirectory(sourceDirectory, callingDirectory);

      // npm strips .gitignore during install, so it was packed as _gitignore
      const renamed = path.join(callingDirectory, '_gitignore');
      const target = path.join(callingDirectory, '.gitignore');
      if (await pathExists(renamed)) {
        await fsp.rename(renamed, target);
        log('Restored _gitignore → .gitignore');
      }

      log('Deployment completed');
      log('Next steps:');
      log('  npm install --no-audit --no-fund --include dev');
      log('  npm run init:oa-data');
    } catch (error) {
      log('Deployment failed:', error?.message || error);
      process.exitCode = 1;
    }
  } else {
    log(`Hint: Files available at node_modules/${PACKAGE_NAME}`);
  }
}
