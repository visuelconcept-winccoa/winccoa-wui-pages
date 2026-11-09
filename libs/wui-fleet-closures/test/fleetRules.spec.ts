// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Fleet write rules: the role a write needs is decided from what is written; only the
 * Fleet's datapoints and the archive config of a bound datapoint are writable.
 */
import { describe, expect, it } from 'vitest';
import { closuresRoles, configOf, dpOf, rolesForDp, rolesForSet, rolesForType } from '../backend/fleetRules';

const FLEET = { module: 'machine-fleet-3d', role: 'edit' };
const CLOSURES = { module: 'fleet-closures', role: 'edit' };
const MACHINE = { module: 'fleet-closures', role: 'edit-machine' };
const CONFIGURE = { module: 'machine-fleet-3d', role: 'configure' };

describe('fleet write rules', () => {
  it('reads the datapoint and the config of a DPE, system or not', () => {
    expect(dpOf('System1:MachineFleet3D_ilot.json')).toBe('MachineFleet3D_ilot');
    expect(dpOf('M_01.Base.State:_archive.._type')).toBe('M_01');
    expect(configOf('System1:M_01.Base.State:_archive.1._class')).toBe('_archive');
    expect(configOf('MachineFleet3D_ilot.json')).toBe('');
  });

  it('the Fleet configuration needs the Fleet edit role', () => {
    expect(rolesForSet('MachineFleet3D_ilot-1.json')).toEqual([FLEET]);
    expect(rolesForSet('MachineFleet3D_Glb_four_x.data')).toEqual([FLEET]);
    expect(rolesForSet('MachineFleet3D_StopCauses.json')).toEqual([FLEET]);
    expect(rolesForSet('MachineFleet3D_StopQualifications.json')).toEqual([{ module: 'machine-fleet-3d', role: 'qualify' }]);
    expect(rolesForDp('MachineFleet3D_StopQualifications', 'MachineFleet3D_StopQualifications')).toEqual([{ module: 'machine-fleet-3d', role: 'qualify' }]);
    expect(rolesForType('MachineFleet3D_StopQualifications')).toEqual([{ module: 'machine-fleet-3d', role: 'qualify' }]);
    expect(rolesForSet('WC_FOUR_P_TEMP.Value:_archive.._archive')).toEqual([FLEET]);
    expect(rolesForDp('MachineFleet3D_ilot-1', 'MachineFleet3D_Config')).toEqual([FLEET]);
    expect(rolesForType('MachineFleet3D_Glb')).toEqual([FLEET]);
  });

  it('the module settings (every atelier, #70) need the Fleet configure role', () => {
    expect(rolesForSet('System1:MachineFleet3D_Settings.json')).toEqual([CONFIGURE]);
    expect(rolesForDp('MachineFleet3D_Settings', 'MachineFleet3D_Settings')).toEqual([CONFIGURE]);
    expect(rolesForType('MachineFleet3D_Settings')).toEqual([CONFIGURE]);
  });

  it('anything else is refused', () => {
    expect(rolesForSet('WC_FOUR.Context.OF')).toEqual([]);
    expect(rolesForSet('M_01.Base.State:_alert_hdl.._ack')).toEqual([]);
    expect(rolesForSet('MachineFleet3D_x.json:_address.._reference')).toEqual([]);
    expect(rolesForDp('WC_FOUR', 'VC_Workcenter')).toEqual([]);
    expect(rolesForDp('MachineFleet3D_x', 'VC_Workcenter')).toEqual([]);
    expect(rolesForType('VC_Workcenter')).toEqual([]);
  });

  it('non-worked periods: a machine’s periods with edit-machine, the rest with edit', () => {
    expect(rolesForSet('MachineFleet3D_Closures.json')).toEqual([CLOSURES, MACHINE]);
    const before = JSON.stringify({ global: [{ start: 'a', end: 'b' }], ateliers: {}, machines: {} });
    const machineOnly = JSON.stringify({ global: [{ start: 'a', end: 'b' }], ateliers: {}, machines: { M: [{ start: 'c', end: 'd' }] } });
    const global = JSON.stringify({ global: [], ateliers: {}, machines: {} });
    expect(closuresRoles(before, machineOnly)).toEqual([CLOSURES, MACHINE]);
    expect(closuresRoles(before, global)).toEqual([CLOSURES]);
    expect(closuresRoles('', JSON.stringify({ ateliers: { A: [] }, machines: {} }))).toEqual([CLOSURES]);
  });
});
