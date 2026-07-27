// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview stub for @visuelconcept/wui-kit/data/dp-json-store.js — an in-memory
// store with the kit class's surface (list/create/save/remove, afterRead hook,
// offline flag). Seeded from `globalThis.__previewSeed` (seed.js) or, absent
// that, the page's own demo() fallback.

export class DpJsonStore {
  offline = false;

  constructor(_typeName, prefix, _labelOf, demo, opts = {}) {
    this.prefix = prefix;
    this.opts = opts;
    const seed = globalThis.__previewSeed ?? demo();
    this.items = seed.map((item, index) => {
      const id = item.id && item.id !== '' ? item.id : `preview-${index + 1}`;
      return { ...structuredClone(item), id, dp: prefix + id };
    });
  }

  async list() {
    return this.items.map((item) => this.out(item));
  }

  async create(item, opts = {}) {
    const id = opts.id ?? `preview-${Date.now().toString(36)}`;
    const created = { ...structuredClone(item), id, dp: this.prefix + id };
    this.items.push(created);
    return this.out(created);
  }

  async save(item) {
    const index = this.items.findIndex((x) => x.id === item.id);
    if (index === -1) this.items.push(structuredClone(item));
    else this.items[index] = structuredClone(item);
  }

  async remove(id) {
    this.items = this.items.filter((x) => x.id !== id);
  }

  async importMany(items) {
    const out = [];
    for (const item of items) out.push(await this.create(item));
    return out;
  }

  out(item) {
    const clone = structuredClone(item);
    return this.opts.afterRead ? this.opts.afterRead(clone) : clone;
  }
}
