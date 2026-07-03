// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read-only catalogue of embeddable sources for the tile dialog.
 *
 * Enumerates the existing Machine-Fleet-3D ateliers (`MachineFleet3D_Config`
 * DPs) and Remote-VNC connections (`RemoteVnc_Connection` DPs) so the user can
 * pick a source by name instead of typing a raw id. Both lists are best-effort:
 * when the backend is unreachable they resolve to an empty list and the dialog
 * falls back to a manual id/URL field.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

const FLEET_TYPE = 'MachineFleet3D_Config';
const FLEET_PREFIX = 'MachineFleet3D_';
const VNC_TYPE = 'RemoteVnc_Connection';
const VNC_PREFIX = 'RemoteVnc_';
const CAMERA_TYPE = 'RtspCamera_Stream';
const CAMERA_PREFIX = 'RtspCamera_';
const AMPERE_TYPE = 'Ampere_Network';
const AMPERE_PREFIX = 'Ampere_';

/** One selectable source (a fleet atelier, a VNC connection, a camera stream or an Ampère network). */
export interface SourceOption {
  /** Source id (atelier id, connection id or camera id). */
  ref: string;
  /** Human label (the source's display name). */
  label: string;
}

export class SourceCatalog {
  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();

  /** List Machine-Fleet-3D ateliers (by display name). */
  async listAteliers(): Promise<SourceOption[]> {
    return this.listType(FLEET_TYPE, FLEET_PREFIX);
  }

  /** List Remote-VNC connections (by display name). */
  async listVncConnections(): Promise<SourceOption[]> {
    return this.listType(VNC_TYPE, VNC_PREFIX);
  }

  /** List RTSP camera streams (by display name). */
  async listCameras(): Promise<SourceOption[]> {
    return this.listType(CAMERA_TYPE, CAMERA_PREFIX);
  }

  /** List Ampère single-line networks (by display name). */
  async listAmpereNetworks(): Promise<SourceOption[]> {
    return this.listType(AMPERE_TYPE, AMPERE_PREFIX);
  }

  // --- internals -------------------------------------------------------------

  private async listType(type: string, prefix: string): Promise<SourceOption[]> {
    const api = this.api;
    const dpe = this.dpe;
    if (!api || !dpe) return [];
    try {
      const names = await firstValueFrom(dpe.listDatapoints(type));
      const out: SourceOption[] = [];
      for (const dp of names) {
        const ref = this.idFromDp(dp, prefix);
        let label = ref;
        try {
          const raw = await firstValueFrom(api.dpGet(`${dp}.name`));
          label = this.extractString(raw) || ref;
        } catch {
          // keep the id as the label
        }
        out.push({ ref, label });
      }
      out.sort((a, b) => a.label.localeCompare(b.label));
      return out;
    } catch {
      return [];
    }
  }

  private idFromDp(dp: string, prefix: string): string {
    const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
    return bare.startsWith(prefix) ? bare.slice(prefix.length) : bare;
  }

  private extractString(raw: unknown): string | undefined {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const found = this.extractString(item);
        if (found) return found;
      }
      return undefined;
    }
    if (raw && typeof raw === 'object') return this.extractString((raw as { value?: unknown }).value);
    return undefined;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private resolveDpe(): WuiDpeService | null {
    try {
      return container.resolve<WuiDpeService>(WuiDpeService);
    } catch {
      return null;
    }
  }
}
