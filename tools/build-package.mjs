#!/usr/bin/env node
// -----------------------------------------------------------------------------
// build-package.mjs <specFile>   (spec = one object, or an array of objects)
//
// Deterministically assembles dist-packages/wui-<page>/ from a spec:
//   • vendors the frontend (vendor-page.mjs: self-contained, _vendor/<lib>/)
//   • copies the menu fragment
//   • detects frontend npm deps by scanning the vendored output
//   • copies the backend module source + generates its index.ts descriptor
//   • copies managers (excluding node_modules / .env / maps / lockfiles)
//   • generates module.json + drops the canonical install.mjs
// README.md / INTEGRATION.md are written separately (page-specific prose).
// -----------------------------------------------------------------------------
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));   // <repo>/tools
const ROOT = dirname(HERE);                             // <repo>
const DIST = join(ROOT, 'packages');                    // generated, self-contained packages
const LIBS = join(ROOT, 'libs');                        // page + shared lib SOURCE
const WS_SRC = join(ROOT, 'backend', 'routes');         // backend route module SOURCE (flat)
const MGR_SRC = join(ROOT, 'backend', 'managers');      // JS managers (node_modules-free)

const REGISTRY = {
  echarts: ['@siemens/ix-echarts', '~3.0.0'],
  '@siemens/ix-echarts': ['@siemens/ix-echarts', '~3.0.0'],
  three: ['three', '^0.169.0'],
  '@novnc/novnc': ['@novnc/novnc', '1.4.0'],
  '@cycjimmy/jsmpeg-player': ['@cycjimmy/jsmpeg-player', '^6.1.2']
};

function walk(d) {
  const o = [];
  if (!existsSync(d)) return o;
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) o.push(...walk(p));
    else if (p.endsWith('.ts')) o.push(p);
  }
  return o;
}

const mgrFilter = (src) => {
  const b = src.replace(/\\/g, '/');
  if (/\/node_modules(\/|$)/.test(b)) return false;
  if (b.endsWith('/.env') || b.endsWith('.js.map') || b.endsWith('.d.ts.map') || b.endsWith('/package-lock.json')) return false;
  return true;
};

function build(spec) {
  const page = spec.page;
  const PKG = join(DIST, `wui-${page}`);
  rmSync(PKG, { recursive: true, force: true });
  const spDir = join(PKG, 'frontend', 'standalone-pages');
  mkdirSync(spDir, { recursive: true });

  // 1. vendor frontend
  execSync(`node "${join(HERE, 'vendor-page.mjs')}" "${page}" "${LIBS}" "${spDir}"`, { stdio: 'inherit' });

  // 2. menu fragment
  const menuSrc = join(LIBS, `wui-${page}`, 'menu.fragment.jsonc');
  if (!existsSync(menuSrc)) throw new Error(`menu fragment missing: ${menuSrc}`);
  copyFileSync(menuSrc, join(PKG, 'frontend', 'menu.fragment.jsonc'));

  // 3. npm-dep detection (scan vendored output)
  const feText = walk(spDir).map((f) => readFileSync(f, 'utf8')).join('\n');
  const npmDeps = { ...(spec.npmDeps || {}) };
  for (const [pkg, [name, ver]] of Object.entries(REGISTRY)) {
    const re = new RegExp(`from ['"]${pkg.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:/[^'"]*)?['"]`);
    if (re.test(feText)) npmDeps[name] = ver;
  }

  // 4. backend module
  let backend;
  if (spec.backend) {
    const b = spec.backend;
    const modDir = join(PKG, 'backend', 'modules', page);
    mkdirSync(modDir, { recursive: true });
    for (const f of b.srcFiles) copyFileSync(join(WS_SRC, f), join(modDir, f));
    const L = [
      `// Backend module descriptor for the ${spec.title} page — auto-discovered by`,
      `// @visuelconcept/wui-webserver (mountModuleRoutes${b.relayFn ? ' + mountModuleRelays' : ''}).`,
      `import { WsjAccessControlList } from '@winccoa/backend';`,
      ``,
      `import { ${b.routeClass} } from './${b.routeFile}';`
    ];
    if (b.relayFn) L.push(`import { ${b.relayFn} } from './${b.relayFile}';`);
    L.push(``, `export default {`, `  mount: '${b.mount}',`, `  // Unauthenticated for demo. Tighten before production, e.g. { allowUsers: ['root', 'engineer'] }.`, `  acl: WsjAccessControlList.fullAccess,`, `  routes: () => ${b.routeClass}.routes()${b.relayFn ? ',' : ''}`);
    if (b.relayFn) L.push(`  registerRaw: (app: unknown) => ${b.relayFn}(app)`);
    L.push(`};`, ``);
    writeFileSync(join(modDir, 'index.ts'), L.join('\n'));
    backend = { module: `backend/modules/${page}` };
  }

  // 5. managers
  let managers;
  if (spec.managers && spec.managers.length) {
    managers = [];
    for (const name of spec.managers) {
      const dst = join(PKG, 'manager', name);
      mkdirSync(dst, { recursive: true });
      cpSync(join(MGR_SRC, name), dst, { recursive: true, filter: mgrFilter });
      managers.push({ dir: `manager/${name}`, name, pmon: `node | always | 30 | 3 | 1 |${name}/index.js` });
    }
  }

  // 6. module.json
  const mod = {
    name: spec.name,
    version: '0.1.0',
    mode: 'source',
    tier: spec.tier,
    description: spec.description,
    requires: ['a WebUI Runtime workspace (@wincc-oa/webui-runtime)'].concat(backend ? ['@visuelconcept/wui-webserver (hosts the backend module)'] : []),
    frontend: { standalonePagesDir: 'frontend/standalone-pages', menuFragment: 'frontend/menu.fragment.jsonc', npmDeps }
  };
  if (backend) mod.backend = backend;
  if (managers) mod.managers = managers;
  writeFileSync(join(PKG, 'module.json'), `${JSON.stringify(mod, null, 2)}\n`);

  // 7. canonical installer
  copyFileSync(join(HERE, 'install.template.mjs'), join(PKG, 'install.mjs'));

  // 8. hand-authored docs (README/INTEGRATION/NOTES) from docs/wui-<page>/
  const docsDir = join(ROOT, 'docs', `wui-${page}`);
  if (existsSync(docsDir)) {
    for (const f of readdirSync(docsDir)) if (f.endsWith('.md')) copyFileSync(join(docsDir, f), join(PKG, f));
  }

  console.log(`✓ ${spec.name}  npmDeps=${Object.keys(npmDeps).join(',') || 'none'}  backend=${backend ? spec.backend.mount : 'no'}  managers=${(managers || []).map((x) => x.name).join(',') || 'none'}`);
}

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const specs = Array.isArray(raw) ? raw : [raw];
for (const s of specs) build(s);
console.log(`\nBuilt ${specs.length} package(s).`);
