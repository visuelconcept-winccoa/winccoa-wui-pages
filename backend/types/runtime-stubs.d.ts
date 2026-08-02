// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Minimal ambient declarations for the WEBSERVER runtime packages, so the
// backend route modules can be TYPECHECKED with no WinCC OA installation.
// -----------------------------------------------------------------------------
// `ultimate-express`, `@winccoa/backend` and `winccoa-manager` ship with the OA
// webserver, not with this repository: on a dev machine `tsc` cannot resolve
// them. These stubs declare only the surface the routes actually use — enough to
// catch a real mistake (a wrong core API, a missing await, a bad narrowing)
// without pretending to be the real typings.
//
// They are used ONLY by backend/tsconfig.typecheck.json. They are NOT deployed:
// deploy-release.mjs copies the files listed in each spec's `srcFiles`, where the
// genuine packages resolve. Keep them lean — a stub that drifts wider than the
// real API turns a compile error into a runtime one.
// -----------------------------------------------------------------------------

declare module 'ultimate-express' {
  export interface Request {
    body?: any;
    params: Record<string, string>;
    query: Record<string, unknown>;
  }
  export interface Response {
    status(code: number): Response;
    json(body: unknown): void;
  }
  export type NextFunction = () => void;
  export interface Router {
    use(...handlers: any[]): void;
    get(path: string, ...handlers: any[]): void;
    post(path: string, ...handlers: any[]): void;
    delete(path: string, ...handlers: any[]): void;
  }
  export function Router(): Router;
  export function json(options?: { limit?: string }): any;
}

declare module '@winccoa/backend' {
  /** The webserver's shared WinccoaManager (typed `unknown`: every call site narrows). */
  export const WsjServerGlobal: { winccoa: unknown };
}

declare module 'winccoa-manager' {
  export class WinccoaDpTypeNode {
    constructor(name: string, type: number, refName: string, children: WinccoaDpTypeNode[]);
    name: string;
    type: number;
    refName: string;
    children: WinccoaDpTypeNode[];
  }
}
