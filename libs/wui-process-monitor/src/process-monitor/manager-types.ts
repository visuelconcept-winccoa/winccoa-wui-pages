// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The manager types offered when adding a manager (issue 51): the usual WinCC OA executables,
 * with a hint for their options, merged with the executables the host's pmon already runs
 * (so a type of this installation absent from the list is offered too). "Other…" keeps the
 * free field for any other executable.
 *
 * The names are those pmon reports (MGRLIST:LIST), e.g. `WCCOAjavascript` for a JavaScript
 * manager (`node` in some config/progs files). Check the list against the executables of the
 * installed version (`<WinCC_OA>/bin`) when a type is missing.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { ml } from './i18n.js';

export interface ManagerType {
  /** The executable, without `.exe` — what pmon is given. */
  exe: string;
  label: MultiLangString;
  /** Options shown as a placeholder (never as a value). */
  optionsHint: string;
  /** Already run by this host's pmon. */
  inUse?: boolean;
}

export const MANAGER_TYPES: readonly ManagerType[] = [
  { exe: 'WCCOActrl', label: ml('CTRL manager', 'Manager CTRL', 'CTRL-Manager'), optionsHint: '-num 2 -f script.ctl' },
  { exe: 'WCCOAjavascript', label: ml('JavaScript manager (Node.js)', 'Manager JavaScript (Node.js)', 'JavaScript-Manager (Node.js)'), optionsHint: '-num 3 <dir>/index.js' },
  { exe: 'WCCOAui', label: ml('User interface', 'Interface utilisateur', 'Benutzeroberfläche'), optionsHint: '-num 2 -p <panel>.pnl' },
  { exe: 'WCCILdata', label: ml('Data manager', 'Manager de données', 'Datenmanager'), optionsHint: '' },
  { exe: 'WCCILevent', label: ml('Event manager', 'Manager d’événements', 'Eventmanager'), optionsHint: '' },
  { exe: 'WCCILdist', label: ml('Distribution manager', 'Manager de distribution', 'Distributionsmanager'), optionsHint: '' },
  { exe: 'WCCILredu', label: ml('Redundancy manager', 'Manager de redondance', 'Redundanzmanager'), optionsHint: '' },
  { exe: 'WCCILproxy', label: ml('Proxy manager', 'Manager proxy', 'Proxy-Manager'), optionsHint: '' },
  { exe: 'WCCILsim', label: ml('Simulation driver', 'Driver de simulation', 'Simulationstreiber'), optionsHint: '-num 1' },
  { exe: 'WCCOAnextgenarch', label: ml('NextGen archive (NGA)', 'Archive NextGen (NGA)', 'NextGen-Archiv (NGA)'), optionsHint: '' },
  { exe: 'WCCOAascii', label: ml('ASCII manager', 'Manager ASCII', 'ASCII-Manager'), optionsHint: '-in <file>.dpl' },
  { exe: 'WCCOAopcua', label: ml('OPC UA client driver', 'Driver client OPC UA', 'OPC UA-Client-Treiber'), optionsHint: '-num 2' },
  { exe: 'WCCOAopcuasrv', label: ml('OPC UA server', 'Serveur OPC UA', 'OPC UA-Server'), optionsHint: '' },
  { exe: 'WCCOAs7plus', label: ml('S7+ driver', 'Driver S7+', 'S7+-Treiber'), optionsHint: '-num 4' },
  { exe: 'WCCOAs7', label: ml('S7 driver', 'Driver S7', 'S7-Treiber'), optionsHint: '-num 3' },
  { exe: 'WCCOAmod', label: ml('Modbus driver', 'Driver Modbus', 'Modbus-Treiber'), optionsHint: '-num 5' },
  { exe: 'WCCOAmqtt', label: ml('MQTT driver', 'Driver MQTT', 'MQTT-Treiber'), optionsHint: '-num 6' },
  { exe: 'WCCOAbacnet', label: ml('BACnet driver', 'Driver BACnet', 'BACnet-Treiber'), optionsHint: '-num 7' }
];

/**
 * The types to offer for a host: the known ones, then the executables its pmon runs that are
 * not in the list (pmon itself excluded); `inUse` marks both. Names compare case-insensitively
 * and without `.exe`.
 */
export function managerTypes(running: readonly string[]): ManagerType[] {
  const key = (exe: string): string => exe.replace(/\.exe$/i, '').toLowerCase();
  const used = new Set(running.map(key));
  const known = MANAGER_TYPES.map((t) => ({ ...t, inUse: used.has(key(t.exe)) }));
  const knownKeys = new Set(known.map((t) => key(t.exe)));
  const others = [...new Set(running.map((exe) => exe.replace(/\.exe$/i, '')))]
    .filter((exe) => exe !== '' && !knownKeys.has(key(exe)) && key(exe) !== 'wccilpmon')
    .sort((a, b) => a.localeCompare(b))
    .map((exe) => ({ exe, label: ml(exe, exe, exe), optionsHint: '', inUse: true }));
  return [...known, ...others];
}

/** The placeholder of the options field for an executable ('' for an unknown one). */
export function optionsHintOf(exe: string, types: readonly ManagerType[]): string {
  return types.find((t) => t.exe.toLowerCase() === exe.toLowerCase())?.optionsHint ?? '';
}
