import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const PACKAGE_NAME = '@wincc-oa/webui-runtime';

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn(),
    cp: vi.fn(),
    rename: vi.fn()
  }
}));

vi.mock('node:readline', () => ({
  default: { createInterface: vi.fn() }
}));

vi.spyOn(console, 'log').mockImplementation(vi.fn());

import fsp from 'node:fs/promises';
import { findSourceDirectory } from './postinstall-webui-runtime.mjs';

describe('findSourceDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsp.access).mockRejectedValue(new Error('ENOENT'));
  });

  it('returns the local node_modules path when the package exists there', async () => {
    const callingDir = '/project';
    const localPath = path.join(callingDir, 'node_modules', PACKAGE_NAME);
    vi.mocked(fsp.access).mockImplementation((p) =>
      String(p) === localPath
        ? Promise.resolve()
        : Promise.reject(new Error('ENOENT'))
    );

    expect(await findSourceDirectory(callingDir)).toBe(localPath);
  });

  it('returns the resolved parent node_modules path when local is absent', async () => {
    const callingDir = '/project/subdir';
    const parentCandidate = path.join(
      callingDir,
      '..',
      'node_modules',
      PACKAGE_NAME
    );
    vi.mocked(fsp.access).mockImplementation((p) =>
      String(p) === parentCandidate
        ? Promise.resolve()
        : Promise.reject(new Error('ENOENT'))
    );

    expect(await findSourceDirectory(callingDir)).toBe(
      path.resolve(parentCandidate)
    );
  });

  it('returns undefined when the package exists in neither location', async () => {
    expect(await findSourceDirectory('/project')).toBeUndefined();
  });
});
