// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
//
// =============================================================================
// Engineering Studio — CTRL backend manager (MSA vRPC service "EngStudio").
// =============================================================================
// Deployed into <project>/scripts/wui/ and registered in config/progs by
// tools/scripts/deploy-backend.mjs (spec: backend.ctrlManagers):
//
//   WCCOActrl        | always |      30 |        3 |        1 |wui/engStudioService.ctl
//
// WHY A CTRL MANAGER. The studio's webserver routes are Node; two of the
// operations they need are CTRL-only or CTRL-native:
//
//   * the OPC UA connection PASSWORD must be encrypted with the project's
//     driver certificate through the vendor library (drvsSecSetPassword ->
//     secureEncode, shipped as a binary CTRL extension) — there is no Node
//     binding for it. This used to be done by spawning a one-shot WCCOActrl per
//     save: a process launch, a command line, an exit code to interpret and a
//     script path to keep deployed. A resident service replaces all of it;
//   * everything else the studio writes into the project (connection creation,
//     datapoints, DP types, configs, poll groups) is a plain dp call — and doing
//     it HERE puts every project mutation of the page behind one auditable
//     service instead of two code paths.
//
// The ENGINEERING LOGIC stays out of this file. The pure core
// (@visuelconcept/wui-eng-core, unit-tested with no runtime) decides WHAT to
// write — element type codes, config attribute sets, address references — and
// this manager is the execution arm: it receives already-built (dpe, value)
// pairs and already-flattened type rows. That is deliberate: one source of
// engineering truth, and no CTRL copy of it to drift.
//
// PROTOCOL. Each method takes and returns ONE JSON string (the same convention
// as this project's JS managers, so the webserver client is identical):
//
//   Node : Vrpc.Variant.createString(JSON.stringify(request))
//   CTRL : jsonDecode(request) -> mapping ... -> jsonEncode(response)
//
// Answers are structured rather than thrown: `{ok: false, error: "..."}` so the
// caller always has a reason to show an operator. vrpcThrow is reserved for a
// malformed call (not a mapping, unknown shape) — a programming error, not an
// engineering one.
//
// Payload encryption is MANDATORY on this service (see main()): a password
// travels in these payloads, and that is exactly what the vendor's own
// OaAuthService does for the same reason (scripts/uidservice.ctl).
//
// Verified against the installed 3.21 before being written: the CTRL vRPC
// server classes (scripts/libs/classes/msa/vrpc/server/*), the vendor service
// pattern (scripts/uidservice.ctl, classes/auth/UserIDService.ctl), the
// dpTypeCreate row/depth layout (libs/ac.ctl), dpSetWait(dyn_string,
// dyn_anytype) (libs/driverSettings.ctl) and drvsSecSetPassword itself.
// See docs/wui-eng-studio/OPCUA-CONNECTION-SECURITY.md.
// =============================================================================
#uses "vrpc"
#uses "driverSettings.ctl"

class EngStudioService : VrpcServiceBase
{
  public EngStudioService()
    : VrpcServiceBase("EngStudio")
  {
    registerFunction(Health);
    registerFunction(CreateOpcuaConnection);
    registerFunction(ApplyOpcuaSecurity);
    registerFunction(TypeExists);
    registerFunction(DpExists);
    registerFunction(DpCreate);
    registerFunction(DpDelete);
    registerFunction(DpSetWait);
    registerFunction(DpTypeCreate);
    registerFunction(DpTypeDelete);
    registerFunction(EnsurePollGroup);
  }

  // ---------------------------------------------------------------------------
  // Health — what the webserver probes to decide whether the manager is there,
  // and what an operator needs before blaming the page. `driverCertificate`
  // is the precondition of every password write (see setPassword).
  // ---------------------------------------------------------------------------
  public anytype Health(VrpcServerContext &serverContext, anytype request)
  {
    mapping res;
    res["ok"] = true;
    res["service"] = "EngStudio";
    res["system"] = getSystemName();
    res["driverCertificate"] = hasDriverCertificate();
    return jsonEncode(res);
  }

  // ---------------------------------------------------------------------------
  // CreateOpcuaConnection { name, endpoint?, driverNumber?, user?, policy?,
  //                         messageMode?, certificate?, flags?, password? }
  //   -> { ok, created, dp, applied[], passwordSet?, warnings[] }
  //
  // Declaring a server name the project does not have IS the request for a new
  // connection (see the page's connection picker). The write set is the one the
  // standard OPC UA panel uses; registration with the _OPCUA<n> manager is
  // best-effort, because an equipment is legitimately declared before its
  // driver is started.
  // ---------------------------------------------------------------------------
  public anytype CreateOpcuaConnection(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    mapping res;
    dyn_string warnings;
    dyn_string applied;

    string name = trimUnderscore(text(req, "name"));
    if (name == "")
      return errorResponse("no connection name given — nothing was created");

    string connDp = "_" + name;
    bool created = false;

    if (!dpExists(connDp))
    {
      string createError;
      if (!createDp(connDp, "_OPCUAServer", createError))
        return errorResponse(createError);

      created = true;
      dynAppend(applied, "connection");
    }

    string endpoint = text(req, "endpoint");
    if (created)
    {
      // The panel's own creation write set. ConnInfo may be empty: the
      // connection then exists and cannot connect, and the warning says so
      // rather than the studio inventing an endpoint.
      dyn_string dpes;
      dyn_anytype values;
      dynAppend(dpes, connDp + ".Config.ConnInfo");        dynAppend(values, endpoint);
      dynAppend(dpes, connDp + ".Config.Active");          dynAppend(values, 1);
      dynAppend(dpes, connDp + ".Config.ReconnectTimer");  dynAppend(values, 10);
      dynAppend(dpes, connDp + ".Config.Separator");       dynAppend(values, ".");
      dynAppend(dpes, connDp + ".Redu.Config.ConnInfo");   dynAppend(values, "opc.tcp://");
      dynAppend(dpes, connDp + ".Redu.Config.Active");     dynAppend(values, 0);
      if (dpSetWait(dpes, values) != 0)
        dynAppend(warnings, "the connection was created but its base configuration could not be written");

      if (endpoint == "")
        dynAppend(warnings, "No endpoint declared — the connection was created with an empty ConnInfo; "
                            "fill in the equipment's endpoint (opc.tcp://...) so the driver knows where to connect.");
    }
    else if (endpoint != "")
    {
      // An existing connection keeps its endpoint unless one is declared.
      if (dpSetWait(connDp + ".Config.ConnInfo", endpoint) == 0)
        dynAppend(applied, "endpoint");
    }

    applySecurityTo(connDp, req, applied, warnings, res);

    if (created)
      registerWithDriver(connDp, req, warnings);

    res["ok"] = true;
    res["created"] = created;
    res["dp"] = connDp;
    res["name"] = name;
    res["applied"] = applied;
    res["warnings"] = warnings;
    return jsonEncode(res);
  }

  // ---------------------------------------------------------------------------
  // ApplyOpcuaSecurity { connection, user?, policy?, messageMode?,
  //                      certificate?, flags?, password? }
  //   -> { ok, applied[], passwordSet?, warnings[] }
  //
  // Only what the request CARRIES is written: an absent field leaves the live
  // value alone, so a connection also managed through the standard panel is
  // never reset by a save that said nothing about security.
  // ---------------------------------------------------------------------------
  public anytype ApplyOpcuaSecurity(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    mapping res;
    dyn_string warnings;
    dyn_string applied;

    string name = trimUnderscore(text(req, "connection"));
    if (name == "")
      return errorResponse("no connection given — nothing was applied");

    string connDp = "_" + name;
    if (!dpExists(connDp))
      return errorResponse("no _OPCUAServer connection '" + connDp + "' — nothing was applied");

    applySecurityTo(connDp, req, applied, warnings, res);

    res["ok"] = true;
    res["dp"] = connDp;
    res["applied"] = applied;
    res["warnings"] = warnings;
    return jsonEncode(res);
  }

  // ---------------------------------------------------------------------------
  // The EngPort surface — the core's applier calls these through the webserver.
  // Each one is a plain dp call: the DECISION of what to write was taken by the
  // pure core, this only performs it inside the project.
  // ---------------------------------------------------------------------------

  public anytype TypeExists(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    mapping res;
    res["ok"] = true;
    res["exists"] = dynContains(dpTypes(), text(req, "name")) > 0;
    return jsonEncode(res);
  }

  public anytype DpExists(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    string name = text(req, "name");
    mapping res;
    res["ok"] = true;
    // Both spellings, like the webserver's own probe: a datapoint may answer to
    // "Name" or "Name.".
    res["exists"] = dpExists(name) || dpExists(name + ".");
    return jsonEncode(res);
  }

  public anytype DpCreate(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    string name = text(req, "name");
    string type = text(req, "type");
    if (name == "" || type == "")
      return errorResponse("dpCreate needs a name and a type");

    // Idempotent like the core's applier expects: an existing datapoint is not
    // an error, it is a no-op (a re-applied plan must converge, not fail).
    if (dpExists(name) || dpExists(name + "."))
    {
      mapping res;
      res["ok"] = true;
      res["created"] = false;
      return jsonEncode(res);
    }
    string createError;
    if (!createDp(name, type, createError))
      return errorResponse(createError);

    mapping res;
    res["ok"] = true;
    res["created"] = true;
    return jsonEncode(res);
  }

  public anytype DpDelete(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    string name = text(req, "name");
    if (name == "")
      return errorResponse("dpDelete needs a name");
    if (!dpExists(name) && !dpExists(name + "."))
    {
      mapping res;
      res["ok"] = true;
      res["deleted"] = false;
      return jsonEncode(res);
    }
    string deleteError;
    if (!deleteDp(name, deleteError))
      return errorResponse(deleteError);

    mapping res;
    res["ok"] = true;
    res["deleted"] = true;
    return jsonEncode(res);
  }

  // DpSetWait { dpes: [...], values: [...] } — the CONFIG write arm.
  //
  // One call is ONE `dpSetWait`, whatever its size: the core batches the configs of many
  // DPEs into a single call (see `ApplyOptions.batch`) because a round-trip per DPE made a
  // real check-in take minutes. A multi-step sequence — the analog alert handling — is still
  // sent step by step, in order, so nothing here has to know about that distinction.
  public anytype DpSetWait(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    if (!mappingHasKey(req, "dpes") || !mappingHasKey(req, "values"))
      return errorResponse("dpSetWait needs dpes[] and values[]");

    dyn_string dpes = req["dpes"];
    dyn_anytype values = req["values"];
    if (dynlen(dpes) == 0)
      return errorResponse("dpSetWait called with an empty dpes[]");
    if (dynlen(dpes) != dynlen(values))
      return errorResponse("dpSetWait: " + dynlen(dpes) + " dpe(s) for " + dynlen(values) + " value(s)");

    int rc = dpSetWait(dpes, values);
    if (rc != 0)
      return errorResponse("dpSetWait failed (rc=" + rc + ") on " + dpes[1] + (dynlen(dpes) > 1 ? " (+" + (dynlen(dpes) - 1) + " more)" : ""));

    mapping res;
    res["ok"] = true;
    res["written"] = dynlen(dpes);
    return jsonEncode(res);
  }

  // DpTypeCreate { name, rows: [{depth, name, type}] } — creates OR changes.
  //
  // `rows` is the type ALREADY FLATTENED by the core into WinCC OA's own
  // row/depth layout (dpelements[row][depth], verified in libs/ac.ctl), with
  // `type` the numeric DPEL_* code. Flattening in TypeScript rather than here is
  // the same rule as everywhere else in the studio: the element-type mapping is
  // engineering data owned by the core and unit-tested there, so there is no
  // second copy in CTRL to fall out of step.
  public anytype DpTypeCreate(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    string name = text(req, "name");
    if (name == "" || !mappingHasKey(req, "rows"))
      return errorResponse("dpTypeCreate needs a name and rows[]");

    dyn_anytype rows = req["rows"];
    if (dynlen(rows) == 0)
      return errorResponse("dpTypeCreate('" + name + "') got no rows");

    dyn_dyn_string names;
    dyn_dyn_int types;
    for (int i = 1; i <= dynlen(rows); i++)
    {
      mapping row = rows[i];
      int depth = row["depth"];
      if (depth < 1)
        return errorResponse("dpTypeCreate('" + name + "'): row " + i + " has depth " + depth);
      names[i][depth] = row["name"];
      types[i][depth] = row["type"];
    }

    bool exists = dynContains(dpTypes(), name) > 0;
    int rc = exists ? dpTypeChange(names, types) : dpTypeCreate(names, types);
    if (rc != 0)
      return errorResponse((exists ? "dpTypeChange('" : "dpTypeCreate('") + name + "') failed (rc=" + rc + ")");

    mapping res;
    res["ok"] = true;
    res["changed"] = exists;
    return jsonEncode(res);
  }

  public anytype DpTypeDelete(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    string name = text(req, "name");
    if (name == "")
      return errorResponse("dpTypeDelete needs a name");
    if (dynContains(dpTypes(), name) < 1)
    {
      mapping res;
      res["ok"] = true;
      res["deleted"] = false;
      return jsonEncode(res);
    }
    int rc = dpTypeDelete(name);
    if (rc != 0)
      return errorResponse("dpTypeDelete('" + name + "') failed (rc=" + rc + ")");

    mapping res;
    res["ok"] = true;
    res["deleted"] = true;
    return jsonEncode(res);
  }

  // EnsurePollGroup { name, interval? } -> { ok, dp } — a polled address needs
  // one, and creating it here keeps the "does the project have it" question in
  // the one place that can answer it.
  public anytype EnsurePollGroup(VrpcServerContext &serverContext, anytype request)
  {
    mapping req = decodeRequest(request);
    string name = text(req, "name");
    if (name == "")
      return errorResponse("ensurePollGroup needs a name");

    string dp = (substr(name, 0, 1) == "_") ? name : "_" + name;
    int interval = mappingHasKey(req, "interval") ? (int)req["interval"] : 1000;

    if (!dpExists(dp) && !dpExists(dp + "."))
    {
      string createError;
      if (!createDp(dp, "_PollGroup", createError))
        return errorResponse(createError);

      dyn_string dpes;
      dyn_anytype values;
      dynAppend(dpes, dp + ".Active");        dynAppend(values, 1);
      dynAppend(dpes, dp + ".PollInterval");  dynAppend(values, interval);
      if (dpSetWait(dpes, values) != 0)
        return errorResponse("the poll group " + dp + " was created but could not be configured");
    }

    mapping res;
    res["ok"] = true;
    res["dp"] = dp;
    return jsonEncode(res);
  }

  // ---------------------------------------------------------------------------
  // Security helpers
  // ---------------------------------------------------------------------------

  /**
   * Write the DECLARED security onto `connDp`, and push the password when the
   * request carries one. `applied` / `warnings` / `res` are filled in place so
   * both public entry points report the same shape.
   */
  private void applySecurityTo(string connDp, mapping req, dyn_string &applied, dyn_string &warnings, mapping &res)
  {
    dyn_string dpes;
    dyn_anytype values;

    if (mappingHasKey(req, "user"))
    {
      dynAppend(dpes, connDp + ".Config.AccessInfo");
      dynAppend(values, text(req, "user"));
      dynAppend(applied, "user");
    }
    if (mappingHasKey(req, "policy"))
    {
      dynAppend(dpes, connDp + ".Config.Security.Policy");
      dynAppend(values, (int)req["policy"]);
      dynAppend(applied, "policy");
    }
    if (mappingHasKey(req, "messageMode"))
    {
      dynAppend(dpes, connDp + ".Config.Security.MessageMode");
      dynAppend(values, (int)req["messageMode"]);
      dynAppend(applied, "mode");
    }
    if (mappingHasKey(req, "certificate"))
    {
      dynAppend(dpes, connDp + ".Config.Security.Certificate");
      dynAppend(values, text(req, "certificate"));
      dynAppend(applied, "certificate");
    }
    if (dynlen(dpes) > 0 && dpSetWait(dpes, values) != 0)
      dynAppend(warnings, "the security settings could not be written on " + connDp);

    applyFlags(connDp, req, applied, warnings);

    if (mappingHasKey(req, "password"))
    {
      string warning;
      bool ok = setPassword(connDp, req["password"], warning);
      res["passwordSet"] = ok;
      if (ok)
        dynAppend(applied, "password");
      if (warning != "")
        dynAppend(warnings, warning);
    }
  }

  /**
   * Force the requested `Config.Flags` bits — READ-MODIFY-WRITE, so the tuning
   * bits (0-7) and anything a future WinCC OA version adds survive a studio
   * save. `flags` is `{ "<bit>": bool }`; a bit that is not named is left alone.
   */
  private void applyFlags(string connDp, mapping req, dyn_string &applied, dyn_string &warnings)
  {
    if (!mappingHasKey(req, "flags"))
      return;

    mapping flags = req["flags"];
    dyn_string bits = mappingKeys(flags);
    if (dynlen(bits) == 0)
      return;

    int current = 0;
    if (dpGet(connDp + ".Config.Flags", current) != 0)
      current = 0; // unreadable: start from nothing rather than refusing the save

    for (int i = 1; i <= dynlen(bits); i++)
    {
      int bit = (int)bits[i];
      int mask = 1 << bit;
      if (flags[bits[i]])
        current = current | mask;
      else
        current = current & ~mask;
    }

    if (dpSetWait(connDp + ".Config.Flags", current) == 0)
      dynAppend(applied, "flags");
    else
      dynAppend(warnings, "the certificate options (Config.Flags) could not be written on " + connDp);
  }

  /**
   * The one thing only CTRL can do: encrypt the password with the project's
   * driver certificate and store it, through the vendor function the standard
   * OPC UA panel itself calls (drvsSecSetPassword -> secureEncode with
   * _DriverSecurity.PublicKey).
   *
   * The precondition is checked HERE rather than with the vendor's
   * drvsSecCheckCert: that one opens a modal PANEL, which a headless manager
   * must never do. Same verdict, no UI.
   *
   * Success is what the datapoint READS BACK, never "the call returned": a
   * blob that did not land would otherwise be reported as a password set.
   */
  private bool setPassword(string connDp, string password, string &warning)
  {
    warning = "";
    string pwDpe = connDp + ".Config.Password";

    if (!dpExists(pwDpe))
    {
      warning = "no " + pwDpe + " element — the password was NOT set";
      return false;
    }
    if (password != "" && !hasDriverCertificate())
    {
      warning = "The project has no driver certificate (_DriverSecurity.PublicKey is empty) — the password was NOT set. "
                "Create it once in System Management -> Driver certificate, then save again.";
      return false;
    }

    drvsSecSetPassword(pwDpe, password);

    blob stored;
    if (dpGet(pwDpe, stored) != 0)
    {
      warning = "the password was written but " + pwDpe + " could not be read back — treating it as NOT set";
      return false;
    }
    bool landed = bloblen(stored) > 0;

    // Clearing IS a success: an empty password means "log in anonymously".
    if (password == "")
      return true;

    if (!landed)
      warning = "the vendor encryption ran but " + pwDpe + " reads back empty — the password was NOT set";

    return landed;
  }

  /**
   * dpCreate, with the two things CTRL gets wrong if you come from the JS API.
   *
   * 1. **CTRL returns 0 on SUCCESS and -1 on failure** (verified: help "dpCreate()
   *    returns 0 on success and -1 on failure"). The JS API returns a boolean, so a
   *    `if (!dpCreate(...))` written from that habit reports a failure on every
   *    SUCCESS — which is exactly what said "the connection could not be created"
   *    about a connection that had in fact just been created.
   * 2. The same help warns it may return 0 **while the DP was not created** (a name
   *    clash), so success is confirmed by `dpExists`, never by the return code alone.
   */
  private bool createDp(string name, string type, string &error)
  {
    error = "";

    // The TYPE first, and by name: `dpCreate` answers "Invalid argument in function" for a type
    // that does not exist, which says nothing about which argument or why. A datapoint cannot
    // exist without its type, so the precondition is stated here — the caller then reads
    // "DP type 'X' does not exist" instead of hunting through a CTRL line number.
    dyn_string knownTypes = dpTypes(type);
    if (dynlen(knownTypes) == 0)
    {
      error = "dpCreate('" + name + "','" + type + "'): DP type '" + type + "' does not exist — "
              "check the type in before its datapoints (the type item of the plan)";
      return false;
    }

    int rc = dpCreate(name, type);
    if (rc != 0)
    {
      error = "dpCreate('" + name + "','" + type + "') failed (rc=" + rc + "): " + getErrorText(getLastError());
      return false;
    }
    if (!dpExists(name) && !dpExists(name + "."))
    {
      error = "dpCreate('" + name + "','" + type + "') returned OK but the datapoint does not exist "
              "(name clash, or the type is unknown): " + getErrorText(getLastError());
      return false;
    }
    return true;
  }

  /** dpDelete with the same convention (0 = deleted, -1 = failed). */
  private bool deleteDp(string name, string &error)
  {
    error = "";

    int rc = dpDelete(name);
    if (rc != 0)
    {
      error = "dpDelete('" + name + "') failed (rc=" + rc + "): " + getErrorText(getLastError());
      return false;
    }
    return true;
  }

  /** Whether the project has the driver certificate every password write needs. */
  private bool hasDriverCertificate()
  {
    string publicKey;
    if (dpGet(getSystemName() + "_DriverSecurity.PublicKey", publicKey) != 0)
      return false;
    return publicKey != "";
  }

  /**
   * Register a freshly created connection with its OPC UA manager
   * (`_OPCUA<n>.Config.Servers`, then `Command.AddServer`). Best effort by
   * design: "no driver yet" is a normal state of a declaration, so it comes
   * back as a warning and never as a failed creation.
   */
  private void registerWithDriver(string connDp, mapping req, dyn_string &warnings)
  {
    int managerNumber = mappingHasKey(req, "driverNumber") ? (int)req["driverNumber"] : 0;
    if (managerNumber < 1)
    {
      // The vendor's own helper: the OPC UA client drivers currently running.
      dyn_int running = drvsCheckRunningDrvNums("OPCUAC", false);
      if (dynlen(running) > 0)
        managerNumber = running[1];
    }
    if (managerNumber < 1)
    {
      dynAppend(warnings, "The connection is not registered with any _OPCUA<n> manager (no driver number declared, "
                          "no running OPC UA driver found) — set the driver number on the equipment or start the driver, then save again.");
      return;
    }

    string managerDp = "_OPCUA" + managerNumber;
    string bare = substr(connDp, 1, strlen(connDp) - 1);

    if (!dpExists(managerDp) && !dpExists(managerDp + "."))
    {
      string createError;
      if (!createDp(managerDp, "_OPCUA", createError))
      {
        dynAppend(warnings, "the connection was created but " + managerDp + " could not be created: " + createError);
        return;
      }
    }

    // An unreadable list is treated as empty and re-written: a connection that is
    // not registered anywhere never connects, so failing closed here would be worse.
    dyn_string servers;
    dpGet(managerDp + ".Config.Servers", servers);

    if (dynContains(servers, bare) < 1)
    {
      dynAppend(servers, bare);
      if (dpSetWait(managerDp + ".Config.Servers", servers) != 0)
      {
        dynAppend(warnings, "the connection was created but could not be registered with " + managerDp);
        return;
      }
    }

    if (dpSetWait(managerDp + ".Command.AddServer", bare) != 0)
      dynAppend(warnings, "the OPC UA driver " + managerNumber + " was not notified (Command.AddServer) — "
                          "start or restart it for the connection to go live.");
  }

  // ---------------------------------------------------------------------------
  // Request / response plumbing
  // ---------------------------------------------------------------------------

  /** The JSON string the webserver sent -> a mapping. A malformed call throws. */
  private mapping decodeRequest(anytype request)
  {
    mapping empty;
    if (getType(request) == MAPPING_VAR)
      return request; // a CTRL caller may pass the mapping directly

    if (getType(request) != STRING_VAR)
    {
      vrpcThrow(VrpcStatusCode::InvalidArgument, "EngStudio called with a payload that is neither a JSON string nor a mapping");
      return empty;
    }

    string payload = request;
    if (payload == "")
      return empty;

    anytype decoded = jsonDecode(payload);
    if (getType(decoded) != MAPPING_VAR)
    {
      vrpcThrow(VrpcStatusCode::InvalidArgument, "EngStudio called with a payload that is not a JSON object");
      return empty;
    }
    return decoded;
  }

  /** Trimmed string value of a request key ('' when absent). */
  private string text(mapping req, string key)
  {
    if (!mappingHasKey(req, key))
      return "";
    string value = req[key];
    return strltrim(strrtrim(value));
  }

  /** A leading `_` is the datapoint's, not the connection name's. */
  private string trimUnderscore(string name)
  {
    return (substr(name, 0, 1) == "_") ? substr(name, 1, strlen(name) - 1) : name;
  }

  /** `{ok:false, error}` as a JSON string — a reason an operator can read. */
  private string errorResponse(string message)
  {
    mapping res;
    res["ok"] = false;
    res["error"] = message;
    return jsonEncode(res);
  }
};

// The container must outlive main() — the service is served from it.
VrpcServiceContainer engStudioContainer;

void main()
{
  VrpcServiceOptions options;
  // A password travels in these payloads, so encrypt them — the same decision
  // the vendor's OaAuthService makes for the same reason (uidservice.ctl).
  options.setPayloadEncryptionMode(MsaPayloadEncryptionMode::Mandatory);

  engStudioContainer.registerService(new EngStudioService(), options);
  engStudioContainer.startAllServices();

  DebugTN("engStudioService: EngStudio vRPC service started");
}
