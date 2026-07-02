# wui-hades — retrofit / shadow deployment

How to put Hades **on top of an existing, in-service tunnel control system**
(GTC) in days, without touching the safety chain. This is the recommended
first deployment: value first, risk zero.

## The idea

Most European tunnel control systems already run on WinCC OA — Hades speaks
the same language natively. In **observation mode** (per-tunnel toggle in the
editor), Hades:

- **reads** the existing plant's datapoints live (`dpConnect` on whatever
  DPEs you bind — the plant keeps its own DP types, nothing is migrated);
- **never writes**: commands, mode engagement and archive switches are
  disabled in the UI (drills stay available — they are fully simulated);
- adds on day one: the 3D twin, the linear synoptic, the compliance advisor,
  the logbook and the safety-file report.

The existing GTC keeps full authority over the field. Hades is a parallel,
read-only web layer — if it is stopped, nothing changes for operations.

## Step by step

1. **Deploy** the page + webserver prerequisites on a WinCC OA system that
   sees the plant datapoints (the production system, a redundancy peer, or a
   dist-connected supervision system — WinCC OA's native distribution means
   Hades can run on a SEPARATE OA system connected to the plant one, keeping
   even its read load away from the operational servers).
2. **Create the tunnel** in Hades: segments from the as-built drawings
   (or import a prepared JSON), equipment placed by PK — use
   "Place a series…" for the repetitive rows.
3. **Enable observation mode** in the editor (identity card toggle).
4. **Bind** each equipment's `state`/measure points to the existing DPEs
   (autocomplete browses the connected system). Command points can be bound
   too — they stay inert while observation mode is on.
5. Done: live twin + synoptic + compliance + logbook + safety report over the
   real tunnel, zero writes. Drills can run immediately (commands are
   intercepted and simulated even on a live plant).

## Later, if/when trust is earned

Switching observation mode off re-enables the audited command path
(confirmation dialog + `AuditTrail_Hades` on every `dpSet`). Do this only
with the operator's safety officer, tunnel by tunnel; command authority,
interlocks and priorities remain the PLC/CTRL layer's responsibility, exactly
as with any SCADA HMI.

## Notes

- Read load: one `dpConnect` over the bound DPEs per open workspace.
- Cybersecurity: the page is served by the WebUI webserver over HTTPS; apply
  the usual IT/OT segmentation (the supervision web tier belongs in the
  DMZ/site level, not in the control network).
- No SIL claim: Hades is an operation & compliance layer, not a safety PLC.
