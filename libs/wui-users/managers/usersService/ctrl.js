// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * The CTRL side of the usersService manager: every read and write of the WinCC OA
 * user administration goes through the vendor's own classes (UserManagement,
 * UserManagementUser / Group / Area, OaAuthFactory, UpdateUserGroups) — the same
 * ones the user administration panel uses. They exist in CTRL only, so the manager
 * runs them in ONE `WinccoaCtrlScript` and calls its functions.
 *
 * Persistence goes exclusively through `UserManagement.saveChangesError()`: the
 * changes are sent as encrypted commands on `_CommandChannel`, executed by the
 * project's commandChannel manager — never a dpSet on `_Users` / `_Groups` /
 * `_Areas`. That manager checks the permission of the USER OF THIS MANAGER (the one
 * it runs as, `-user` in pmon): it must have the "user administration" permission
 * level (`_System.Auth.UserManagement`). `Health` reports it.
 *
 * Every function takes one JSON string and returns one JSON string:
 *   { ok: true, ... } or { ok: false, error, errors? }
 *
 * Verified against the 3.21 sources (scripts/libs/classes/userManagement/*,
 * classes/auth/*, classes/UpdateUserGroups.ctl, libs/userMan.ctl,
 * scripts/commandChannel.ctl):
 *   - permission level L (1..32) is bit L-1 of a bit32 (userMan.ctl,
 *     getUserPermissionForArea: perm[level - 1]);
 *   - a new user/group gets its id only once saved: groups are assigned in a
 *     second save (as importADGroupUsers.ctl and UserSelect::saveUsers do);
 *   - the authentication method is the text of `_WinUserAdmin.External`
 *     ("Standard", "Windows" = Active Directory, or a user-defined one), read by
 *     OaAuthFactory::getAuthName().
 */

const CTRL_SOURCE = `
#uses "userMan"
#uses "classes/userManagement/UserManagement"
#uses "classes/userManagement/UserManagementUser"
#uses "classes/userManagement/UserManagementGroup"
#uses "classes/userManagement/UserManagementArea"
#uses "classes/UpdateUserGroups"
#uses "classes/auth/OaAuthFactory"
#uses "classes/auth/OaAuthMethod"

shared_ptr<UserManagement> g_um;

shared_ptr<UserManagement> um()
{
  if (g_um == nullptr)
    g_um = UserManagement::getInstance();
  return g_um;
}

// ---- helpers -----------------------------------------------------------------

string fail(string error, dyn_string errors = makeDynString())
{
  if (g_um != nullptr)
    g_um.reset(); // drop the local changes of a refused operation
  return jsonEncode(makeMapping("ok", false, "error", error, "errors", errors));
}

string done(mapping result = makeMapping())
{
  result["ok"] = true;
  return jsonEncode(result);
}

/** saveChangesError, '' on success, else the first reason. */
string save(dyn_string &errors)
{
  dynClear(errors);
  if (um().saveChangesError(errors))
    return "";
  return dynlen(errors) > 0 ? errors[1] : "saveChanges refused";
}

dyn_bool bitsToDyn(bit32 bits)
{
  dyn_bool result;
  for (int i = 0; i < 32; i++)
    dynAppend(result, getBit(bits, i));
  return result;
}

bit32 dynToBits(dyn_anytype values)
{
  bit32 bits;
  for (int i = 1; i <= dynlen(values) && i <= 32; i++)
    setBit(bits, i - 1, (bool)values[i]);
  return bits;
}

dyn_uint toIds(dyn_anytype values)
{
  dyn_uint ids;
  for (int i = 1; i <= dynlen(values); i++)
    dynAppend(ids, (uint)values[i]);
  return ids;
}

shared_ptr<OaAuthMethod> auth()
{
  OaAuthFactory factory;
  return factory.getAuth();
}

bool isAD(shared_ptr<OaAuthMethod> method)
{
  return method.getAuthType() == OaAuthenticationType::AD;
}

// ---- health / snapshot ---------------------------------------------------------

string health(string json)
{
  OaAuthFactory factory;
  unsigned level;
  bool hasLevel = dpExists("_System.Auth.UserManagement");
  if (hasLevel)
    dpGet("_System.Auth.UserManagement", level);
  return done(makeMapping(
    "system", getSystemName(),
    "userId", getUserId(),
    "userName", getUserName(),
    "level", (int)level,
    "canManage", hasLevel && getUserPermission(level, getUserId(), myManType(), myManNum()),
    "commandChannel", dpExists("_CommandChannel"),
    "authName", factory.getAuthName(),
    "auths", factory.listAuths()));
}

string snapshot(string json)
{
  shared_ptr<UserManagement> m = um();
  OaAuthFactory factory;
  dyn_mapping users, groups, areas;

  dyn_anytype all = m.getAllSavedUsers();
  for (int i = 1; i <= dynlen(all); i++)
  {
    shared_ptr<UserManagementUser> u = all[i];
    if (u.getId() == DEFAULT_USERID)
      continue;
    dynAppend(users, makeMapping(
      "id", u.getId(),
      "name", u.getName(),
      "fullName", (string)u.getFullName(),
      "comment", (string)u.getComment(),
      "enabled", u.getEnabled(),
      "language", u.getLanguage(),
      "osId", u.getOSID(),
      "domain", u.getDomain(),
      "groupIds", u.getGroupIds()));
  }

  all = m.getAllGroups();
  for (int i = 1; i <= dynlen(all); i++)
  {
    shared_ptr<UserManagementGroup> g = all[i];
    if (g.getId() == DEFAULT_USERID)
      continue;
    dyn_uint areaIds = g.getAreaIds();
    dyn_bit32 areaPerms = g.getAreaPermission();
    dyn_mapping groupAreas;
    for (int j = 1; j <= dynlen(areaIds); j++)
      dynAppend(groupAreas, makeMapping("id", areaIds[j], "permissions", bitsToDyn(j <= dynlen(areaPerms) ? areaPerms[j] : (bit32)0)));
    dynAppend(groups, makeMapping(
      "id", g.getId(),
      "name", g.getName(),
      "fullName", (string)g.getFullName(),
      "comment", (string)g.getComment(),
      "osId", g.getOSID(),
      "permissions", bitsToDyn(g.getPermissionSet()),
      "areas", groupAreas));
  }

  all = m.getAllAreas();
  for (int i = 1; i <= dynlen(all); i++)
  {
    shared_ptr<UserManagementArea> a = all[i];
    if (a.getId() == DEFAULT_USERID)
      continue;
    dynAppend(areas, makeMapping(
      "id", a.getId(),
      "name", a.getName(),
      "fullName", (string)a.getFullName(),
      "comment", (string)a.getComment(),
      "permissions", bitsToDyn(a.getPermissionSet())));
  }

  dyn_string permissionNames;
  dyn_langString descriptions = m.getAllPermissionDescriptions();
  for (int i = 1; i <= dynlen(descriptions); i++)
    dynAppend(permissionNames, (string)descriptions[i]);

  return done(makeMapping(
    "users", users,
    "groups", groups,
    "areas", areas,
    "permissionNames", permissionNames,
    "authName", factory.getAuthName(),
    "auths", factory.listAuths()));
}

// ---- users ----------------------------------------------------------------------

/** Replace the groups of a (saved) user — umSetGroupsForUser's way, by ids. */
void setUserGroups(shared_ptr<UserManagementUser> u, dyn_uint groupIds)
{
  shared_ptr<UserManagement> m = um();
  dyn_uint current = u.getGroupIds();
  for (int i = 1; i <= dynlen(current); i++)
    u.removeGroup(current[i]);
  for (int i = 1; i <= dynlen(groupIds); i++)
  {
    shared_ptr<UserManagementGroup> g = m.getGroup(groupIds[i]);
    if (g != nullptr)
      u.addGroup(g);
  }
}

string userCreate(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  string name = req.value("name", "");
  if (m.getUserByName(name) != nullptr)
    return fail("user exists: " + name);

  shared_ptr<UserManagementUser> u = new UserManagementUser(name, (string)req.value("osId", ""));
  u.setFullName((string)req.value("fullName", ""));
  u.setComment((string)req.value("comment", ""));
  if (req.value("language", "") != "")
    u.setLanguage((string)req.value("language", ""));
  if (req.value("password", "") != "")
    u.setPassword((string)req.value("password", ""));
  m.addUser(u);

  dyn_string errors;
  string error = save(errors);
  if (error != "")
    return fail(error, errors);

  shared_ptr<UserManagementUser> created = m.getUserByName(name);
  if (created == nullptr || created.getId() == DEFAULT_USERID)
    return fail("user not found after creation: " + name);

  dyn_anytype groupIds = req.value("groupIds", makeDynAnytype());
  bool enabled = req.value("enabled", true);
  if (dynlen(groupIds) > 0 || !enabled)
  {
    setUserGroups(created, toIds(groupIds));
    if (!enabled)
      created.changeProperty(UserManagementKey::ENABLED, false);
    error = save(errors);
    if (error != "")
      return fail("created, but its groups were refused: " + error, errors);
  }
  return done(makeMapping("id", created.getId()));
}

string userUpdate(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  shared_ptr<UserManagementUser> u = m.getUser((uint)req.value("id", DEFAULT_USERID));
  if (u == nullptr)
    return fail("unknown user");

  if (req.contains("name"))
    u.setName((string)req["name"]);
  if (req.contains("fullName"))
    u.setFullName((string)req["fullName"]);
  if (req.contains("comment"))
    u.setComment((string)req["comment"]);
  if (req.contains("language"))
    u.setLanguage((string)req["language"]);
  if (req.contains("enabled"))
    u.changeProperty(UserManagementKey::ENABLED, (bool)req["enabled"]);
  if (req.contains("groupIds"))
  {
    dyn_anytype groupIds = req["groupIds"];
    setUserGroups(u, toIds(groupIds));
  }

  dyn_string errors;
  string error = save(errors);
  return error == "" ? done(makeMapping("id", u.getId())) : fail(error, errors);
}

string userPassword(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagementUser> u = um().getUser((uint)req.value("id", DEFAULT_USERID));
  if (u == nullptr)
    return fail("unknown user");
  if (u.setPassword((string)req.value("password", "")) != 0)
    return fail("empty password");
  dyn_string errors;
  string error = save(errors);
  return error == "" ? done() : fail(error, errors);
}

string userDelete(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  shared_ptr<UserManagementUser> u = m.getUser((uint)req.value("id", DEFAULT_USERID));
  if (u == nullptr)
    return fail("unknown user");
  m.remove(u);
  dyn_string errors;
  string error = save(errors);
  return error == "" ? done() : fail(error, errors);
}

// ---- groups ---------------------------------------------------------------------

/** Replace the domains (areas) of a saved group and their permission bits. */
void setGroupAreas(shared_ptr<UserManagementGroup> g, dyn_anytype wanted)
{
  shared_ptr<UserManagement> m = um();
  dyn_uint wantedIds;
  for (int i = 1; i <= dynlen(wanted); i++)
  {
    mapping entry = wanted[i];
    dynAppend(wantedIds, (uint)entry.value("id", DEFAULT_USERID));
  }
  dyn_uint current = g.getAreaIds();
  for (int i = 1; i <= dynlen(current); i++)
    if (!dynContains(wantedIds, current[i]))
      g.removeArea(current[i]);
  for (int i = 1; i <= dynlen(wanted); i++)
  {
    mapping entry = wanted[i];
    shared_ptr<UserManagementArea> a = m.getArea(wantedIds[i]);
    if (a == nullptr)
      continue;
    g.addArea(a); // ignored when already there
    dyn_anytype bits = entry.value("permissions", makeDynAnytype());
    g.setAreaPermissionBits(a, dynToBits(bits));
  }
}

/** Members of a group: users added to it or removed from it. */
void setGroupMembers(uint groupId, dyn_uint memberIds)
{
  shared_ptr<UserManagement> m = um();
  shared_ptr<UserManagementGroup> g = m.getGroup(groupId);
  dyn_anytype users = m.getAllSavedUsers();
  for (int i = 1; i <= dynlen(users); i++)
  {
    shared_ptr<UserManagementUser> u = users[i];
    bool member = dynContains(u.getGroupIds(), groupId) > 0;
    bool wanted = dynContains(memberIds, u.getId()) > 0;
    if (member && !wanted)
      u.removeGroup(groupId);
    else if (!member && wanted)
      u.addGroup(g);
  }
}

string groupCreate(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  string name = req.value("name", "");
  if (m.getGroupByName(name) != nullptr)
    return fail("group exists: " + name);

  shared_ptr<UserManagementGroup> g = new UserManagementGroup(name, (string)req.value("osId", ""));
  g.setFullName((string)req.value("fullName", name));
  g.setComment((string)req.value("comment", ""));
  dyn_anytype bits = req.value("permissions", makeDynAnytype());
  g.setGroupPermission(dynToBits(bits));
  m.addGroup(g);

  dyn_string errors;
  string error = save(errors);
  if (error != "")
    return fail(error, errors);

  shared_ptr<UserManagementGroup> created = m.getGroupByName(name);
  if (created == nullptr || created.getId() == DEFAULT_USERID)
    return fail("group not found after creation: " + name);

  if (req.contains("areas") || req.contains("memberIds"))
  {
    if (req.contains("areas"))
      setGroupAreas(created, req["areas"]);
    if (req.contains("memberIds"))
      setGroupMembers(created.getId(), toIds(req["memberIds"]));
    error = save(errors);
    if (error != "")
      return fail("created, but its domains or members were refused: " + error, errors);
  }
  return done(makeMapping("id", created.getId()));
}

string groupUpdate(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  shared_ptr<UserManagementGroup> g = m.getGroup((uint)req.value("id", DEFAULT_USERID));
  if (g == nullptr)
    return fail("unknown group");

  if (req.contains("name"))
    g.setName((string)req["name"]);
  if (req.contains("fullName"))
    g.setFullName((string)req["fullName"]);
  if (req.contains("comment"))
    g.setComment((string)req["comment"]);
  if (req.contains("permissions"))
  {
    dyn_anytype bits = req["permissions"];
    g.setGroupPermission(dynToBits(bits));
  }
  if (req.contains("areas"))
    setGroupAreas(g, req["areas"]);
  if (req.contains("memberIds"))
    setGroupMembers(g.getId(), toIds(req["memberIds"]));

  dyn_string errors;
  string error = save(errors);
  return error == "" ? done(makeMapping("id", g.getId())) : fail(error, errors);
}

string groupDelete(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  uint id = (uint)req.value("id", DEFAULT_USERID);
  shared_ptr<UserManagementGroup> g = m.getGroup(id);
  if (g == nullptr)
    return fail("unknown group");
  dyn_anytype members = m.getSavedUsersByGroupId(id);
  for (int i = 1; i <= dynlen(members); i++)
  {
    shared_ptr<UserManagementUser> u = members[i];
    u.removeGroup(id);
  }
  m.remove(g);
  dyn_string errors;
  string error = save(errors);
  return error == "" ? done() : fail(error, errors);
}

string permissionNames(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  dyn_anytype names = req.value("names", makeDynAnytype());
  for (int i = 1; i <= dynlen(names) && i <= 32; i++)
  {
    if ((string)m.getPermissionDescription(i) == (string)names[i])
      continue; // keep the other languages of an unchanged description
    langString description = (string)names[i];
    m.setPermissionDescription(i, description);
  }
  dyn_string errors;
  string error = save(errors);
  return error == "" ? done() : fail(error, errors);
}

// ---- domains (areas) ---------------------------------------------------------------

string areaCreate(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  string name = req.value("name", "");
  if (m.getAreaByName(name) != nullptr)
    return fail("domain exists: " + name);
  shared_ptr<UserManagementArea> a = new UserManagementArea(name);
  a.setFullName((string)req.value("fullName", name));
  a.setComment((string)req.value("comment", ""));
  dyn_anytype bits = req.value("permissions", makeDynAnytype());
  a.setGroupPermission(dynToBits(bits));
  m.addArea(a);
  dyn_string errors;
  string error = save(errors);
  if (error != "")
    return fail(error, errors);
  shared_ptr<UserManagementArea> created = m.getAreaByName(name);
  return done(makeMapping("id", created == nullptr ? DEFAULT_USERID : created.getId()));
}

string areaUpdate(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagementArea> a = um().getArea((uint)req.value("id", DEFAULT_USERID));
  if (a == nullptr)
    return fail("unknown domain");
  if (req.contains("name"))
    a.setName((string)req["name"]);
  if (req.contains("fullName"))
    a.setFullName((string)req["fullName"]);
  if (req.contains("comment"))
    a.setComment((string)req["comment"]);
  if (req.contains("permissions"))
  {
    dyn_anytype bits = req["permissions"];
    a.setGroupPermission(dynToBits(bits));
  }
  dyn_string errors;
  string error = save(errors);
  return error == "" ? done(makeMapping("id", a.getId())) : fail(error, errors);
}

string areaDelete(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  uint id = (uint)req.value("id", DEFAULT_USERID);
  shared_ptr<UserManagementArea> a = m.getArea(id);
  if (a == nullptr)
    return fail("unknown domain");
  dyn_anytype groups = m.getGroupsByAreaId(id);
  for (int i = 1; i <= dynlen(groups); i++)
  {
    shared_ptr<UserManagementGroup> g = groups[i];
    g.removeArea(id);
  }
  m.remove(a);
  dyn_string errors;
  string error = save(errors);
  return error == "" ? done() : fail(error, errors);
}

// ---- authentication method -----------------------------------------------------------

string authMode(string json)
{
  mapping req = jsonDecode(json);
  string mode = req.value("mode", "");
  OaAuthFactory factory;
  if (!dynContains(factory.listAuths(), mode))
    return fail("authentication method not available here: " + mode);
  if (dpSetWait("_WinUserAdmin.External", mode) != 0)
    return fail("_WinUserAdmin.External not written");
  return done(makeMapping("authName", mode));
}

// ---- Active Directory ------------------------------------------------------------------

/** '' when the configured method is a reachable Active Directory, else why not. */
string adProblem(shared_ptr<OaAuthMethod> method)
{
  if (!isAD(method))
    return "the configured authentication is not Active Directory";
  if (!method.checkConnection())
    return "the Active Directory cannot be reached";
  return "";
}

string adGroups(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<OaAuthMethod> method = auth();
  string problem = adProblem(method);
  if (problem != "")
    return fail(problem);

  mapping groups;
  if (method.hasFeature(OaAuthFeature::GET_NEXT_GROUPS))
  {
    int requestId = 0;
    while (method.getNextGroups((bool)req.value("local", false), requestId, groups) > 0) {}
  }
  else
  {
    dyn_string names = method.getAllGroups();
    for (int i = 1; i <= dynlen(names); i++)
      groups[names[i]] = makeMapping("Name", names[i], "OSID", method.getExternalIdForGroup(names[i]),
                                     "Comment", method.getCommentForGroup(names[i]));
  }

  dyn_mapping result;
  dyn_string keys = mappingKeys(groups);
  for (int i = 1; i <= dynlen(keys); i++)
  {
    mapping g = groups[keys[i]];
    dynAppend(result, makeMapping("name", g.value("Name", keys[i]), "osId", g.value("OSID", ""),
                                  "comment", g.value("Comment", ""), "local", g.value("isLocal", false)));
  }
  return done(makeMapping("groups", result));
}

string adUsers(string json)
{
  shared_ptr<OaAuthMethod> method = auth();
  string problem = adProblem(method);
  if (problem != "")
    return fail(problem);
  if (!method.hasFeature(OaAuthFeature::GET_NEXT_USERS))
    return fail("the authentication method cannot list its users (GET_NEXT_USERS)");

  // result < 0 ends the enumeration, normally as well as on an error: an empty
  // list is the failure (importADGroupUsers.ctl, loadAllADUsers).
  mapping users;
  int requestId = 0;
  while (method.getNextUsers(requestId, users) > 0) {}
  if (mappinglen(users) == 0)
    return fail("no Active Directory user could be listed");

  dyn_mapping result;
  dyn_string keys = mappingKeys(users);
  for (int i = 1; i <= dynlen(keys); i++)
  {
    mapping u = users[keys[i]];
    dynAppend(result, makeMapping("name", keys[i], "osId", u.value("OSID", ""), "comment", u.value("Comment", "")));
  }
  return done(makeMapping("users", result));
}

/** Groups of AD users that ALREADY exist in WinCC OA (modifyGroups = false: none is created). */
string adUserGroups(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<OaAuthMethod> method = auth();
  string problem = adProblem(method);
  if (problem != "")
    return fail(problem);

  dyn_anytype users = req.value("users", makeDynAnytype());
  dyn_mapping result;
  for (int i = 1; i <= dynlen(users); i++)
  {
    mapping entry = users[i];
    dyn_string groups;
    errClass err;
    int rc = UpdateUserGroups::getGroupListForUser(um(), method, (string)entry.value("name", ""),
                                                   (string)entry.value("osId", ""), false, groups, err);
    dynAppend(result, makeMapping("name", entry.value("name", ""), "ok", rc >= 0, "groups", groups,
                                  "error", rc < 0 ? getErrorText(err) : ""));
  }
  return done(makeMapping("users", result));
}

/** Import AD groups as WinCC OA groups linked by their OSID (GroupSelect::saveGroups). */
string adImportGroups(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  dyn_anytype groups = req.value("groups", makeDynAnytype());
  dyn_string created;
  for (int i = 1; i <= dynlen(groups); i++)
  {
    mapping entry = groups[i];
    string name = entry.value("name", "");
    if (name == "" || m.getGroupByName(name) != nullptr)
      continue;
    shared_ptr<UserManagementGroup> g = new UserManagementGroup(name, (string)entry.value("osId", ""));
    g.setFullName(name);
    g.setComment((string)entry.value("comment", ""));
    m.addGroup(g);
    dynAppend(created, name);
  }
  if (dynlen(created) == 0)
    return done(makeMapping("created", created));
  dyn_string errors;
  string error = save(errors);
  return error == "" ? done(makeMapping("created", created)) : fail(error, errors);
}

/**
 * Create one AD user, linked by its OSID, in the given (existing) groups —
 * importADGroupUsers.ctl createUserWithGroups / UserSelect::saveUsers.
 */
string adCreateUser(string json)
{
  mapping req = jsonDecode(json);
  shared_ptr<UserManagement> m = um();
  string name = req.value("name", "");
  if (m.getUserByName(name) != nullptr)
    return fail("user exists: " + name);

  shared_ptr<UserManagementUser> u = new UserManagementUser(name, (string)req.value("osId", ""));
  u.setComment((string)req.value("comment", ""));
  u.setFullName(name);
  m.addUser(u);
  dyn_string errors;
  string error = save(errors);
  if (error != "")
    return fail(error, errors);

  shared_ptr<UserManagementUser> created = m.getUserByName(name);
  if (created == nullptr || created.getId() == DEFAULT_USERID)
    return fail("could not retrieve the created user to assign its groups");

  dyn_anytype groupNames = req.value("groups", makeDynAnytype());
  dyn_uint groupIds;
  for (int i = 1; i <= dynlen(groupNames); i++)
  {
    shared_ptr<UserManagementGroup> g = m.getGroupByName((string)groupNames[i]);
    if (g != nullptr)
      dynAppend(groupIds, g.getId());
  }
  setUserGroups(created, groupIds);
  error = save(errors);
  if (error != "")
    return fail("created, but its groups were refused: " + error, errors);
  return done(makeMapping("id", created.getId()));
}
`;

/** The CTRL functions the service calls; each takes and returns one JSON string. */
const CTRL_FUNCTIONS = [
  'health',
  'snapshot',
  'userCreate',
  'userUpdate',
  'userPassword',
  'userDelete',
  'groupCreate',
  'groupUpdate',
  'groupDelete',
  'permissionNames',
  'areaCreate',
  'areaUpdate',
  'areaDelete',
  'authMode',
  'adGroups',
  'adUsers',
  'adUserGroups',
  'adImportGroups',
  'adCreateUser'
];

/**
 * The CTRL script, compiled once in this manager, and `call(fn, request)` → the
 * parsed answer. `WinccoaCtrlScript` keeps the script's globals between calls, so
 * the UserManagement instance (and its dpConnect on _Users/_Groups/_Areas) is
 * created once, as in importADGroupUsers.ctl.
 */
function createCtrl(winccoa, WinccoaCtrlScript, WinccoaCtrlType) {
  const script = new WinccoaCtrlScript(winccoa, CTRL_SOURCE, 'wuiUsersService');
  return {
    async call(fn, request = {}) {
      if (!CTRL_FUNCTIONS.includes(fn)) throw new Error(`unknown CTRL function ${fn}`);
      const raw = await script.start(fn, [JSON.stringify(request ?? {})], [WinccoaCtrlType.string]);
      try {
        return JSON.parse(String(raw ?? ''));
      } catch {
        return { ok: false, error: `${fn}: no answer from CTRL (${String(raw ?? '').slice(0, 200)})` };
      }
    }
  };
}

module.exports = { CTRL_FUNCTIONS, CTRL_SOURCE, createCtrl };
