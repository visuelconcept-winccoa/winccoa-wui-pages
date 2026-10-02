<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# OPC UA connection security for the studio (user/password, policies, certificate options)

**Status: IMPLEMENTED — now through a resident CTRL manager.** §1–2 are the
verified analysis; §3 is what ships. The password (and every other project write
of the page) goes through the **EngStudio CTRL manager**
(`backend/project-scripts/wui/engStudioService.ctl`), an MSA **vRPC service** the
webserver calls — see [CTRL-MANAGER.md](./CTRL-MANAGER.md) for that architecture.

Two earlier iterations are recorded here because their reasons still hold:
a one-shot `WCCOActrl` **spawn** per save (replaced: a process launch, a command
line and an exit code to interpret, for something a resident service does in one
call), and the backend **writing** the helper script itself (reverted on field
feedback: the webserver user must not need write access to `<proj>/scripts`).

Requested originally: add the security modes, the login and the password
(encrypted by WinCC OA with a certificate) to the studio's OPC UA connection
provisioning, re-wire the connection creation/save onto the library the
standard OPC UA connection panel uses, and expose the "ignore certificate
error" options of the standard panel.

Every fact below was read from the installed WinCC OA **3.21**
(`C:\Siemens\Automation\WinCC_OA\3.21`) — the panel plugin, the shared driver
library, the shipped help — never from memory. File paths are relative to that
installation.

## 1 · How the STANDARD panel does it (verified)

### The write set

The panel plugin (`scripts/libs/opcuaDriver_plugin.ctl`) reads and writes one
mapping per connection over these `_OPCUAServer` DPEs
(`opcuaDriver_getConnectionData`, ~line 905; type checked against
`dbdfiles/version_3.21/dptypes.txt`):

| DPE | type | carries |
|---|---|---|
| `Config.ConnInfo` | string | endpoint `opc.tcp://host:4841` |
| `Config.AccessInfo` | string | **user name** — empty = anonymous login (help `opc_ua_c_internaldp`) |
| `Config.Password` | **blob** | the password, **encrypted** (below) |
| `Config.Security.Policy` | uint | `None(0)`, `Basic128Rsa15(2)`, `Basic256(3)`, `Basic256Sha256(4)`, `Aes128Sha256RsaOaep(5)`, `Aes256Sha256RsaPss(6)` — 1 unused (help, same page) |
| `Config.Security.MessageMode` | uint | `None(0)`, `Sign(1)`, `Sign&Encrypt(2)` |
| `Config.Security.Certificate` | string | **client** certificate file; empty → `WinCC_OA_UA_Client.der` |
| `Config.Flags` | bit32 | the advanced/certificate options (below) |
| `Config.Active`, `Config.ReconnectTimer`, `Config.Separator`, `Redu.Config.*` | | as already written by the studio today |

Except for the password, **the panel writes all of this with plain `dpSet`** —
there is no hidden library magic for the attributes. The studio's existing
write set (ported from the tag importer) is therefore already "the library's"
write set for everything but `Password` and `Flags` detail.

### `Config.Flags` — the "ignore certificate errors" options

`opcuaDriver_panelToMapping` (~line 245) maps the *Advanced settings*
checkboxes onto bits; the meaning of each bit is vendor-documented in the help
(`OPC_UA/opc_ua_c_internaldp.html`), including the security cautions:

| bit | panel checkbox | documented meaning |
|---|---|---|
| 0 | Register node IDs | faster access when polling |
| 1 | Disable MI on passive OA | monitored items |
| 2 | Disable MI on passive UA server | monitored items |
| 3 | Wait for server state "Running" | delay subscriptions |
| 4 | Only active driver connects | redundancy |
| **8** | Allow unsecured servers | client may talk to servers without secure communication — **"will lead to unencrypted transmissions of passwords"** (vendor CAUTION) |
| **9** | Accept invalid certificate | server without a valid certificate |
| **10** | Ignore revocation | valid certificates that were revoked |
| **11** | Ignore issuer revocation list errors | |
| **12** | Accept expired certificates | |
| **13** | Accept invalid hostname | |
| **14** | Ignore invalid ApplicationUri | in the 3.21 panel (not yet on the help page) |
| **15** | Ignore basic constraints | in the 3.21 panel (not yet on the help page) |

Bits 8–15 are the certificate/security relaxations the request asks for; bits
0–4 are communication tuning (out of scope for the device form, or a later
"advanced" card).

### The password: certificate-encrypted, by ONE library function

The save path (`opcuaDriver_plugin.ctl` ~1059–1109):

1. a non-empty password first requires the **project driver certificate**:
   `drvsSecCheckCert()` (`scripts/libs/driverSettings.ctl:783`) refuses when
   `_DriverSecurity.PublicKey` is empty (and offers to create it);
2. then `drvsSecSetPassword(dpe, pw)` (`driverSettings.ctl:810`):
   `dpGet(_DriverSecurity.PublicKey)` → **`secureEncode(blob(pw), publicKey,
   out)`** → `dpSetWait` of the blob to `<conn>.Config.Password`;
3. an empty password clears the DPE.

`secureEncode` is a CTRL built-in and is **not in the public help** (zero
index entries in `help/en_US.utf8/core-en.qch`) — an undocumented internal,
callable only from CTRL. That is the one step that genuinely needs the vendor
library.

### The key pair (once per project)

`panels/para/driverSec_certificate.pnl` ("Driver certificate", System
Management) creates it by shelling out to the **shipped** `bin/openssl.exe`:

```
openssl genrsa -out <proj>/config/driver_private.key <bits>
openssl rsa -in driver_private.key -RSAPublicKey_out -out temp_pub.pem
dpSet("_DriverSecurity.PublicKey", <pem>)
```

The driver decrypts with `<proj>/config/driver_private.key`. So the "certificate"
is an RSA key pair: public half on a DP, private half a file in the project
config directory.

## 2 · How the studio backend can REUSE the vendor code

The studio backend is Node (webserver, `WsjServerGlobal.winccoa`) — it cannot
call CTRL functions in-process. Three options were weighed:

> **What shipped in the end: option A's insight (run the vendor function in
> CTRL), option B's shape (a resident service) — without option B's flaw.** The
> rejection of B below was "the plaintext password would transit the event
> manager", which is true of a **command datapoint**; an MSA **vRPC** service is
> a direct manager-to-manager channel, and its payload is *encrypted* when the
> service asks for it (`MsaPayloadEncryptionMode::Mandatory`, exactly what the
> vendor's own `OaAuthService` does for passwords). See
> [CTRL-MANAGER.md](./CTRL-MANAGER.md).

**A. One-shot CTRL for the password (the first implementation).** Ship a ~10-line CTRL
script with the module (deployed into the project's `scripts/wui/`):

```ctl
#uses "driverSettings.ctl"
main(string sPwDpe)
{
  drvsSecSetPassword(sPwDpe, getenv("WUI_ENG_PW"));
}
```

and have the backend spawn
`WCCOActrl -currentproj wui/engStudioSetOpcuaPassword.ctl <connDp>.Config.Password`
with the password in the **child environment** (never on the command line — a
command line is visible in the process list).

⚠️ Two option pitfalls, both found the hard way and both verified against the
installed 3.21:

- **`-currentproj`, not `-config <path>`.** The vendor usage text defines
  `-currentproj` as *"define the project which was used for the last manager
  start"* — i.e. the project this webserver belongs to — while `-config` also
  demands a **registered** config file (`"is not a registered config file!"`).
  On a machine running several projects, "current" could resolve elsewhere;
  that fails SAFELY rather than silently (the script's `dpExists` refuses the
  unknown DPE, and the read-back reports the password as not set).
- **No `-n`.** The vendor doc defines `-n` as "starts the CTRL manager *without
  a connection to the Event manager*" — with it, every dp call of the script
  fails (the doc's own `-n` example is a pure-`DebugTN` script, which needs no
  Event manager; ours is nothing but dp calls).

Verified enablers:
`bin/WCCOActrl.exe` exists; `WCCOActrl [option] [filename] {parameter}` with
`main(string p1, …)` is documented (`Manageroptionen-04`); `getenv()` is CTRL;
`driverSettings.ctl` ships in the version scripts and resolves from any
project. This IS the panel's own code path — same function, same encryption,
same DPE — so a password set by the studio and one set by the panel are
indistinguishable to the driver, and a vendor change to the scheme follows
automatically.

**B. Resident CTRL manager + command DP — rejected.** A permanent manager to
deploy and supervise, and the plaintext password would transit the event
manager (any client with `dpConnect` rights could read the command DP).

**C. Re-implement `secureEncode` in Node — rejected.** The function is
undocumented; shipping a reverse-engineered format is exactly what this
project's rules forbid (a wrong blob is a connection that silently fails
authentication). Note for VALIDATION only: the webserver user can read
`config/driver_private.key`, so a test can `privateDecrypt` a blob written by
the REAL panel to prove or disprove byte-compatibility of any future
reimplementation — useful as a self-check, not as the shipping path.

**Key-pair creation.** The panel merely shells the shipped openssl (above), so
the studio *could* replicate it faithfully (both binaries ship with OA).
Recommended v1: do NOT create keys from the studio; when
`_DriverSecurity.PublicKey` is empty and a password was entered, refuse the
password with a structured warning pointing at the standard "Driver
certificate" panel — the exact behaviour of the panel itself
(`drvsSecCheckCert`). Key creation from the studio can be a later, explicit
action (it writes a private key into the project config directory — an
operation an admin should own).

## 3 · What the studio does (implemented)

**Core (`wui-eng-core/src/devices.ts`)** — extend `PROTOCOL_PARAMS.opcua`:

- `user` (text, optional — empty = anonymous, say so in the label/hint);
- `password` (new `secret` kind: write-only, never echoed, never stored —
  see below);
- `securityPolicy` (choice: None / Basic256Sha256 / Aes128Sha256RsaOaep /
  Aes256Sha256RsaPss, plus Basic128Rsa15 / Basic256 offered as *deprecated* —
  the 3.21 panel still lists them);
- `messageMode` (choice: None / Sign / Sign&Encrypt);
- `clientCertificate` (text, optional — hint: empty = `WinCC_OA_UA_Client.der`);
- `certIgnore` flags (checkbox group → `Config.Flags` bits 9–15) and
  `allowUnsecured` (bit 8) with the vendor's own CAUTION wording.
- Validation (core, runs in the form AND on the server): `messageMode != None`
  requires `securityPolicy != None`; a password with an empty `user` is an
  advisory; a password when the project has no `_DriverSecurity.PublicKey` is a
  **refusal at save time** (backend-only check — the core cannot see the DP).

**The password is WRITE-THROUGH, never stored.** `devices.json` is a diffable,
backed-up engineering file — a secret must not land in it, encrypted or not.
The save request carries `password` transiently; the backend pushes it to OA
via option A and forgets it; `normalizeDevice` never persists it. The form
shows a "password is set on the connection" indicator read live from
`Config.Password` being non-empty (blob length), plus a "change password"
field that stays blank.

**Backend (`engController.provisionOpcUaConnection` + a new update path).**
Today the security attributes are only written when the connection is CREATED.
Add: on every device save whose declaration carries security fields, write
`AccessInfo` / `Security.Policy` / `Security.MessageMode` /
`Security.Certificate` / `Flags` to the (existing or new) connection DP — same
plain `dpSet` the panel uses — and run the one-shot CTRL when a new password
was provided. `connectionProvision.warnings` reports: missing public key
(password refused), WCCOActrl not found / non-zero exit, no driver to notify.
Roles: `manage-devices`, as today.

**Deployment — deployed and registered, never written at runtime.** The manager
lives in the repo (`backend/project-scripts/wui/engStudioService.ctl`);
`deploy-backend.mjs` copies every `backend.ctrlManagers` entry into
`<project>/scripts/` **and registers it in `config/progs`**
(`WCCOActrl | always | … |wui/engStudioService.ctl`). The webserver user needs no
write access to the project scripts, and the backend only *probes* the service:
one log line at boot says whether project writes go through the manager or the
direct-API fallback, and whether the driver certificate is present.

**Demo/gateway.** `DemoEngGateway` mirrors: the new fields validate and round
trip, the "password set" indicator toggles, no encryption is simulated
(the demo says "demo — not encrypted" rather than pretending).

## 4 · Verification protocol (on the deploy target)

1. In the standard System Management panel, create the driver certificate
   (`driverSec_certificate.pnl`) — check `_DriverSecurity.PublicKey` non-empty
   and `config/driver_private.key` present.
2. From the studio, declare an OPC UA equipment with user + password + policy
   `Basic256Sha256` / `Sign&Encrypt` → save.
3. Open the STANDARD OPC UA connection panel on that connection: the user, the
   policy, the mode, the flags must display exactly as set, the password as
   `*****` — the two tools must be indistinguishable writers.
4. Point the connection at a secured endpoint requiring that login and check
   `Common.State.ConnState ≥ 256`.
5. Set a wrong password from the studio → the driver must NOT connect (proves
   the blob is really what the driver decodes, not silently ignored).
6. Redundancy note: `Redu.Config.*` shares `Config.Password` — nothing extra
   to write, verify on a redundant pair if one is available.

## 5 · Open points

- **Project name / OA bin path** for the spawn: confirm what the webserver
  environment exposes on the deploy target (`WCCOAPROJ`? console-inherited
  env?) — one `console.info` in a probe run settles it.
- **Spawn rights**: the webserver user must be allowed to start `WCCOActrl`
  (it runs under the same console session — expected yes; verify once).
- Whether to surface Flags bits 0–4 (comm tuning) in a later "advanced" card.
- Whether a studio-side "create driver certificate" action is wanted at all
  (v1 says no — admin-owned, standard panel exists).
