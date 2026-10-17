<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# The EngStudio CTRL manager (MSA vRPC) — every project write behind one service

The studio's page and HTTP routes are TypeScript; **the writes into the WinCC OA
project are performed by a CTRL manager**, `libs/wui-eng-studio/project-scripts/wui/engStudioService.ctl`,
hosting the MSA **vRPC** service `EngStudio`. The webserver is its stub client
(`libs/wui-eng-studio/backend/engVrpc.ts`).

## Why

1. **The password can only be done in CTRL.** An OPC UA connection password is
   encrypted with the project's driver certificate by the vendor library
   (`drvsSecSetPassword` → `secureEncode`), shipped as a binary CTRL extension
   (`bin/windows-64/CtrlDrvSec.dll`). There is no Node binding, and
   reimplementing an undocumented format is exactly what this project's rules
   forbid. The first implementation therefore **spawned a one-shot `WCCOActrl`**
   per save — a process launch, a command line, an exit code to interpret, a
   script to keep deployed, plus two option traps found the hard way (`-n` starts
   a CTRL manager with **no Event-manager connection**; `-config` demands a
   *registered* config file). A resident service replaces all of it with one call.
2. **One writer instead of two.** Connection creation, its security, datapoints,
   DP types, configs and poll groups now all land through the same auditable
   service, rather than being split between "what Node can do" and "what needed
   CTRL".
3. **The payload can be encrypted.** A vRPC service declares
   `MsaPayloadEncryptionMode::Mandatory` and the framework enforces it — the
   client configures nothing (verified: on the Node side `PayloadEncryptionMode`
   is a *service*-side option). That is precisely what the vendor's own
   `OaAuthService` does, and for the same reason: a password travels in these
   payloads.

## What stays out of it, deliberately

The manager holds **no engineering logic**. The pure core
(`@visuelconcept-winccoa/wui-eng-core`, unit-tested with no runtime) decides *what* to
write — element-type codes, config attribute sets, address references, which
security fields were declared — and the manager executes it:

- configs arrive as an already-built `{dpes[], values[]}` pair (one call per
  config family, one `dpSetWait`, exactly as before);
- a DP type arrives as **rows already flattened** into WinCC OA's own
  `names[row][depth]` layout, with numeric `DPEL_*` codes;
- the security arrives as values (`policy: 4`), not as names to interpret.

One source of engineering truth, and no CTRL copy of it to drift. The bit-masking
rule for `Config.Flags` is the one piece with a TypeScript twin: `applyFlagBits`
in the core is kept as the **executable specification** the CTRL `applyFlags` is
reviewed against, because a bit rule nobody can test is a rule that drifts.

## Service surface (JSON string in, JSON string out)

Same convention as this project's JS managers, so the client is the same shape as
`aiController`'s: `Vrpc.Variant.createString(JSON.stringify(req))` →
`jsonDecode` → work → `jsonEncode`.

| Method | Request | Answer |
|---|---|---|
| `Health` | — | `{ok, service, system, driverCertificate}` |
| `CreateOpcuaConnection` | `{name, endpoint?, driverNumber?, user?, policy?, messageMode?, certificate?, flags?, password?}` | `{ok, created, dp, name, applied[], passwordSet?, warnings[]}` |
| `ApplyOpcuaSecurity` | `{connection, user?, policy?, messageMode?, certificate?, flags?, password?}` | `{ok, dp, applied[], passwordSet?, warnings[]}` |
| `TypeExists` / `DpExists` | `{name}` | `{ok, exists}` |
| `DpCreate` | `{name, type}` | `{ok, created}` (idempotent) |
| `DpDelete` | `{name}` | `{ok, deleted}` |
| `DpSetWait` | `{dpes[], values[]}` | `{ok, written}` |
| `DpTypeCreate` | `{name, rows:[{depth,name,type}]}` | `{ok, changed}` (creates or changes) |
| `DpTypeDelete` | `{name}` | `{ok, deleted}` |
| `EnsurePollGroup` | `{name, interval?}` | `{ok, dp}` |

`{ok:false, error}` is an **engineering refusal** the caller shows to the
operator; a non-OK vRPC status is a transport failure and throws. Only what a
request *carries* is written — an absent security field leaves the live
connection alone, so a connection also managed through the standard OPC UA panel
is never reset by a save that said nothing about it.

## Fallback, and why it exists

The webserver probes the service (cached 30 s) and, when it is unreachable,
performs the writes **directly** through `WsjServerGlobal.winccoa` as before —
except the password, which is impossible without CTRL and is refused with that
reason. This keeps a project that has not yet deployed/registered the manager
able to check in instead of losing the feature, and the boot log says which path
is in use:

```
engController: EngStudio CTRL manager reachable (system 'X') — project writes go through it; driver certificate present.
engController: the EngStudio CTRL manager is NOT reachable — project writes use the direct API fallback, and OPC UA passwords cannot be set …
```

`GET /api/eng/health` reports the same under `manager`, because "the studio
cannot write to the project" and "the studio is not installed" are different
problems with different fixes.

## Deployment

The script lives in the module (`libs/wui-eng-studio/project-scripts/wui/engStudioService.ctl`)
and is published with it. wui-toolkit 0.6.0 deploys no CTRL script: copy it to
`<project>/scripts/wui/` and add the progs line by hand:

```
WCCOActrl        | always |      30 |        3 |        1 |wui/engStudioService.ctl
```

Then **start it in pmon** (the deployer never starts or restarts managers — that
is a live-system action), and restart the webserver so the new routes are loaded.
After editing the `.ctl`, restart the manager: like every WinCC OA manager, it
keeps its old code in memory.

## ⚠️ CTRL returns 0 on SUCCESS — the bug this cost

`dpCreate` / `dpDelete` / `dpSetWait` / `dpGet` / `dpType*` all return **0 on
success and -1 on failure** in CTRL (verified in the help: *"dpCreate() returns 0
on success and -1 on failure"*). The **JS** API of the same operations returns a
**boolean**, and the studio's TypeScript side is written against that — so
`if (!dpCreate(...))`, carried over from habit, reports a failure on every
**success**. It shipped, and produced exactly one confusing field report:

> Device "YYYY" created. The connection "sim1" could not be created:
> dpCreate('_sim1','_OPCUAServer') failed

…about a connection that had in fact just been created. Both directions were
wrong: a real failure (`-1`) would have been reported as success.

Every create/delete now goes through `createDp` / `deleteDp`, which also handle
the caveat the same help page adds — **dpCreate may return 0 while the datapoint
was not created** (a name clash), so success is confirmed with `dpExists` and the
reason comes from `getErrorText(getLastError())`, never from the return code
alone. `dpSetWait`/`dpGet`/`dpType*` were already tested against 0 and are
unchanged.

The lesson worth keeping: `-syntax` proves every symbol exists, and proves nothing
about a return convention. When porting a call from the JS manager API to CTRL,
read that function's own "Return Value" section first.

## Verification status

- The manager **compiles against the installed 3.21**:
  `WCCOActrl -config <proj>/config/config -syntax libs/wui-eng-studio/project-scripts/wui/engStudioService.ctl`
  exits 0. That check was itself validated (a broken script, an unknown function
  and an unknown method each exit 1), so exit 0 means every function, class,
  enum and `#uses` in the file really resolves — including `VrpcServiceBase`,
  `registerFunction`, `MsaPayloadEncryptionMode`, `drvsSecSetPassword` and
  `drvsCheckRunningDrvNums`.
- The patterns are the vendor's own, read from the installation:
  `scripts/uidservice.ctl` (container + `registerService` + `startAllServices`),
  `classes/auth/UserIDService.ctl` and `classes/wssServer/WebUiTokenProviderService.ctl`
  (`anytype Method(VrpcServerContext &ctx, anytype request)`),
  `libs/ac.ctl` (the `dpTypeCreate` row/depth layout),
  `libs/driverSettings.ctl` (`dpSetWait(dyn_string, dyn_anytype)`).
- ⚠️ **Not yet run on a live project.** It has never served a request: the
  round-trip (webserver stub ↔ manager), the payload encryption negotiation and
  the actual password encryption are to be verified on the deploy target — see
  the protocol in [OPCUA-CONNECTION-SECURITY.md](./OPCUA-CONNECTION-SECURITY.md)
  §4, plus one first step: start the manager, then `GET /api/eng/health` and
  check `manager.reachable` is true.
