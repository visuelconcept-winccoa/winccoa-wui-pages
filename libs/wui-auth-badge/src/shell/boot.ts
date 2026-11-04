// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The module's boot script in the shell (`wuiPage.shell.boot`, wui-toolkit
 * 0.23.0 or later): loaded with the application, before any page.
 *
 * The logout hook: every session close — the logout, "Switch user", a
 * connection the server closed — is audited by the backend (POST
 * /api/auth-badge/logout, ../session-close.ts) for the token's user, whatever
 * the login provider that opened the session (`provider`, undefined for the
 * standard form or OIDC: written as `standard`). Called while the session is
 * still open; the shell waits 3 s at most and never lets a hook block the
 * logout — auditSessionClose never rejects.
 *
 * An idle expiry: the shell knows only `logout` and `switch-user`, so a site
 * module that closes an idle session through `switchUser()` puts
 * `logoutReason: 'idle'` and `idleMinutes` in the login context first; the
 * close is then audited as `idle` (SESSION_EXPIREE_INACTIVITE) with its delay.
 *
 * Declares neither a header element nor `loginHome`: it goes along with a
 * site module's boot script (the station's page and item).
 */
import { auditSessionClose } from '../session-close.js';

/** What the shell's logout hook passes (wui-toolkit docs/REFERENCE.md, "What a module adds to the shell"). */
export interface LogoutInfo {
  reason: 'logout' | 'switch-user';
  /** The login provider's module that opened the session; undefined for the standard form or OIDC. */
  provider: string | undefined;
  /** The modules' login context, merged (`item`: the station, for the audit line). */
  context: Record<string, string>;
}

/** The module's handle on the shell — only what this script uses. */
export interface WuiShellBoot {
  readonly module: string;
  onLogout(callback: (info: LogoutInfo) => void | Promise<void>): () => void;
}

export default function boot(shell: WuiShellBoot): void {
  shell.onLogout((info) => {
    const context = info.context ?? {};
    const base = { item: context['item'], provider: info.provider ?? 'standard' };
    if (context['logoutReason'] !== 'idle') return auditSessionClose(info.reason, base);
    const idleMinutes = Number(context['idleMinutes']);
    return auditSessionClose('idle', Number.isFinite(idleMinutes) && idleMinutes > 0 ? { ...base, idleMinutes } : base);
  });
}
