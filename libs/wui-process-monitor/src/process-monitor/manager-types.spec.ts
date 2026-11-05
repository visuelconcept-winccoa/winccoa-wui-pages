import { describe, expect, it } from 'vitest';
import { MANAGER_TYPES, managerTypes, optionsHintOf } from './manager-types.js';

describe('managerTypes (issue 51)', () => {
  it('offers the usual executables, the JavaScript manager under the name pmon reports', () => {
    const exes = managerTypes([]).map((t) => t.exe);
    expect(exes).toContain('WCCOActrl');
    expect(exes).toContain('WCCOAjavascript');
    expect(exes).toHaveLength(MANAGER_TYPES.length);
  });

  it('marks the types the host runs and adds the ones it runs that are not listed, pmon excluded', () => {
    const types = managerTypes(['WCCILpmon', 'WCCOActrl.exe', 'wccoactrl', 'WCCOAvalarch', 'WCCOAiec']);
    expect(types.find((t) => t.exe === 'WCCOActrl')?.inUse).toBe(true);
    expect(types.find((t) => t.exe === 'WCCOAui')?.inUse).toBe(false);
    expect(types.slice(MANAGER_TYPES.length).map((t) => t.exe)).toEqual(['WCCOAiec', 'WCCOAvalarch']);
  });

  it('gives an options hint for a known type only', () => {
    const types = managerTypes([]);
    expect(optionsHintOf('wccoajavascript', types)).toMatch(/index\.js/);
    expect(optionsHintOf('MyTool', types)).toBe('');
  });
});
