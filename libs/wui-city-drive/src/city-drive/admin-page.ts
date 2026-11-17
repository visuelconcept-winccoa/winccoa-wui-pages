// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * City Drive's admin page (#94), `/city-drive/admin`, role `city-drive/admin`: the game's
 * statistics for the event's organisers.
 *
 * - figures: matches (and duos), players, emails collected, logos (total, average, best),
 *   average score, first / last match; photos kept on the server, waiting for Supabase (with
 *   the last error) and published (backend `GET /api/city-drive/stats`);
 * - charts (plain SVG, iX colours): matches per hour of the day, matches per day, logos per
 *   result;
 * - the ranking's top 10 (nicknames);
 * - actions: **Export CSV** (every result, emails included — hence the role) and **Reset the
 *   ranking** (empties `CityDrive_Results`, after a confirmation), both written to the audit
 *   trail (`RESULTS_EXPORT`, `RESULTS_RESET`).
 *
 * Reads the results log through the same DpSingleJsonStore as the game; refreshes every 30 s.
 */
import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { hasRole$ } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { AuditTrailWriter } from '@visuelconcept-winccoa/wui-kit/data/audit-trail.js';
import { DpSingleJsonStore } from '@visuelconcept-winccoa/wui-kit/data/dp-single-json-store.js';
import { AUDIT_DP, AUDIT_ITEM_TYPE } from './audit.js';
import { leaderboard, type GameResult } from './results.js';
import { gameStats, resultsCsv } from './stats.js';

const RESULTS_DP = 'CityDrive_Results';
const STATS_URL = '/api/city-drive/stats';
const REFRESH_MS = 30_000;

interface PhotoStats {
  photos: number;
  pending: number;
  published: number;
  lastError: string;
  supabase: boolean;
}

@customElement('wui-city-drive-admin')
export class WuiCityDriveAdmin extends LitElement {
  static override readonly styles = [IXCoreStyles, adminStyles()];

  @state() private allowed: boolean | null = null;
  @state() private log: GameResult[] = [];
  @state() private photos: PhotoStats | null = null;
  @state() private offline = false;
  @state() private confirmReset = false;
  @state() private note = '';
  private readonly store = new DpSingleJsonStore<GameResult[]>(RESULTS_DP, RESULTS_DP, () => [], { isArray: true });
  private readonly audit = new AuditTrailWriter({ dpName: AUDIT_DP, itemType: AUDIT_ITEM_TYPE });
  private roleSub = new Subscription();
  private timer = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.roleSub = hasRole$('city-drive', 'admin').subscribe((granted) => {
      this.allowed = granted;
      if (granted) void this.refresh();
    });
    this.timer = window.setInterval(() => {
      if (this.allowed) void this.refresh();
    }, REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
    window.clearInterval(this.timer);
  }

  private async refresh(): Promise<void> {
    this.log = await this.store.load().catch(() => []);
    this.offline = this.store.offline;
    this.photos = await fetch(STATS_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<PhotoStats>) : null))
      .catch(() => null);
  }

  /** Every result as CSV (emails included), downloaded by the browser; audited. */
  private exportCsv(): void {
    const blob = new Blob([resultsCsv(this.log)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `city-drive-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    void this.audit.write({ action: 'RESULTS_EXPORT', item: RESULTS_DP, newval: `${this.log.length} result(s), emails included`, reason: 'Admin page' });
  }

  /** Empties the results log (a new event); audited with the count it had. */
  private async resetRanking(): Promise<void> {
    const count = this.log.length;
    try {
      await this.store.save([]);
      void this.audit.write({ action: 'RESULTS_RESET', item: RESULTS_DP, oldval: `${count} result(s)`, newval: '0', reason: 'Admin page: new ranking' });
      this.note = `Ranking reset (${count} result(s) removed).`;
    } catch (error) {
      this.note = `Reset failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.confirmReset = false;
    await this.refresh();
  }

  override render(): TemplateResult {
    if (this.allowed === null) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (!this.allowed) return html`<div class="center muted">Your groups do not hold the "Admin" role of City Drive.</div>`;
    const s = gameStats(this.log);
    const top = leaderboard(this.log, new Set(), 10);
    return html`<div class="page">
      <div class="head">
        <ix-typography format="h2">City Drive · Statistics</ix-typography>
        <span class="grow"></span>
        ${this.offline ? html`<ix-pill variant="warning" outline>No backend: demo data in memory</ix-pill>` : nothing}
        <ix-button variant="secondary" icon="refresh" @click=${() => void this.refresh()}>Refresh</ix-button>
        <ix-button icon="export" ?disabled=${this.log.length === 0} @click=${() => this.exportCsv()}>Export CSV</ix-button>
        ${this.confirmReset
          ? html`<ix-button variant="danger-primary" icon="trashcan" @click=${() => void this.resetRanking()}>Confirm: erase ${this.log.length} result(s)</ix-button>
              <ix-button variant="secondary" @click=${() => (this.confirmReset = false)}>Cancel</ix-button>`
          : html`<ix-button variant="secondary" icon="trashcan" ?disabled=${this.log.length === 0} @click=${() => (this.confirmReset = true)}>Reset the ranking</ix-button>`}
      </div>
      ${this.note ? html`<div class="note">${this.note}</div>` : nothing}

      <div class="tiles">
        ${this.tile('Matches', s.matches, `${s.duo} with two players`)}
        ${this.tile('Players', s.players, 'one per email, else per nickname')}
        ${this.tile('Emails collected', s.emails, `${s.withEmail} result(s) with an email`)}
        ${this.tile('WinCC OA logos', s.logos, `${s.avgLogos} per player on average`)}
        ${this.tile('Best result', s.bestLogos, `average score ${s.avgScore}`)}
        ${this.tile(
          'Photos',
          this.photos?.photos ?? '—',
          this.photos ? (this.photos.supabase ? `${this.photos.published} published · ${this.photos.pending} waiting` : 'Supabase not configured') : 'backend not reachable'
        )}
      </div>
      ${this.photos?.pending && this.photos.lastError ? html`<div class="note warn">Photos waiting for Supabase: ${this.photos.lastError}</div>` : nothing}

      <div class="grid">
        <section class="card">
          <div class="card-title">Matches per hour of the day</div>
          ${this.bars(s.byHour.map((v, h) => ({ label: `${h}`, value: v })), true)}
        </section>
        <section class="card">
          <div class="card-title">Matches per day</div>
          ${s.byDay.length ? this.bars(s.byDay.map((d) => ({ label: d.day.slice(5), value: d.matches }))) : html`<div class="muted">No match yet.</div>`}
        </section>
        <section class="card">
          <div class="card-title">WinCC OA logos per player and match</div>
          ${this.bars(s.logoBands.map((b) => ({ label: b.label, value: b.count })))}
        </section>
        <section class="card">
          <div class="card-title">Ranking · top 10</div>
          ${top.length
            ? html`<table class="rank">
                ${top.map((r) => html`<tr><td class="r">${r.rank}</td><td>${r.nickname}</td><td class="n"><strong>${r.logos}</strong> logos</td><td class="n">${r.score}</td></tr>`)}
              </table>`
            : html`<div class="muted">No result yet.</div>`}
          <div class="muted small">${s.first ? `From ${new Date(s.first).toLocaleString()} to ${new Date(s.last).toLocaleString()}` : ''}</div>
        </section>
      </div>
    </div>`;
  }

  private tile(label: string, value: number | string, sub: string): TemplateResult {
    return html`<div class="tile">
      <div class="t-label">${label}</div>
      <div class="t-value">${value}</div>
      <div class="t-sub">${sub}</div>
    </div>`;
  }

  /** A bar chart in plain SVG: one bar per value, its label under it, the value over it. */
  private bars(data: { label: string; value: number }[], sparseLabels = false): TemplateResult {
    const w = 600;
    const h = 180;
    const max = Math.max(1, ...data.map((d) => d.value));
    const slot = w / Math.max(1, data.length);
    const bw = Math.max(4, slot * 0.7);
    return html`<svg class="chart" viewBox="0 0 ${w} ${h + 34}" role="img">
      ${data.map((d, k) => {
        const bh = (d.value / max) * h;
        const x = k * slot + (slot - bw) / 2;
        return svg`<g>
          <rect class="bar" x=${x} y=${h - bh + 14} width=${bw} height=${Math.max(0, bh)} rx="2"></rect>
          ${d.value > 0 ? svg`<text class="val" x=${x + bw / 2} y=${h - bh + 10} text-anchor="middle">${d.value}</text>` : nothing}
          ${!sparseLabels || k % 3 === 0 ? svg`<text class="lbl" x=${x + bw / 2} y=${h + 30} text-anchor="middle">${d.label}</text>` : nothing}
        </g>`;
      })}
    </svg>`;
  }
}

function adminStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--theme-color-std-text);
      background: var(--theme-color-1);
    }
    .page {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem 1.25rem 2rem;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .grow {
      flex: 1;
    }
    .center {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .small {
      font-size: 0.8rem;
      margin-top: 0.5rem;
    }
    .note {
      padding: 0.5rem 0.75rem;
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .note.warn {
      color: var(--theme-color-warning);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: 0.75rem;
    }
    .tile,
    .card {
      padding: 0.9rem 1rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .t-label,
    .card-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
    }
    .t-value {
      font-size: 2rem;
      font-weight: 800;
      color: var(--theme-color-primary);
    }
    .t-sub {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr));
      gap: 0.75rem;
    }
    .chart {
      width: 100%;
      height: auto;
      margin-top: 0.5rem;
    }
    .bar {
      fill: var(--theme-color-primary);
    }
    .val {
      font-size: 11px;
      fill: var(--theme-color-std-text);
    }
    .lbl {
      font-size: 11px;
      fill: var(--theme-color-soft-text);
    }
    .rank {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0.5rem;
    }
    .rank td {
      padding: 0.3rem 0.4rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .rank .r {
      font-weight: 800;
      color: var(--theme-color-warning);
      width: 2rem;
    }
    .rank .n {
      text-align: right;
      white-space: nowrap;
    }
  `;
}
