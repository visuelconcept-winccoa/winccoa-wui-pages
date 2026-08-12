import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn<(p: unknown) => boolean>(),
  mkdirSync: vi.fn<(p: unknown, opts?: unknown) => void>(),
  writeFileSync: vi.fn<() => void>()
}));

vi.mock('node:fs', () => ({ default: mockFs }));

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false);
  mockFs.mkdirSync.mockReset();
  mockFs.writeFileSync.mockReset();
  vi.resetModules();
});

async function loadScript() {
  await import('./init-oa-data.mjs');
}

describe('init-oa-data', () => {
  it('creates all five oa-data subdirectories when none exist', async () => {
    await loadScript();
    expect(mockFs.mkdirSync).toHaveBeenCalledTimes(5);
  });

  it('creates each directory with the recursive option', async () => {
    await loadScript();
    for (const call of mockFs.mkdirSync.mock.calls) {
      expect(call[1]).toEqual({ recursive: true });
    }
  });

  it('creates all expected locale and asset subdirectories', async () => {
    await loadScript();
    const paths = mockFs.mkdirSync.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes('en_US.utf8'))).toBe(true);
    expect(paths.some((p) => p.includes('de_AT.utf8'))).toBe(true);
    expect(paths.some((p) => p.includes('icons'))).toBe(true);
    expect(paths.some((p) => p.includes('svg'))).toBe(true);
    expect(paths.some((p) => p.includes('widgets-v2'))).toBe(true);
  });

  it('creates README.md when it does not exist', async () => {
    await loadScript();
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('README.md'),
      expect.any(String),
      'utf8'
    );
  });

  it('skips existing directories', async () => {
    mockFs.existsSync.mockReturnValue(true);
    await loadScript();
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
  });

  it('skips writing README.md when it already exists', async () => {
    mockFs.existsSync.mockReturnValue(true);
    await loadScript();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates only missing directories when some already exist', async () => {
    mockFs.existsSync.mockImplementation((p: unknown) =>
      String(p).includes('en_US.utf8')
    );
    await loadScript();
    expect(mockFs.mkdirSync).toHaveBeenCalledTimes(4);
    const paths = mockFs.mkdirSync.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes('en_US.utf8'))).toBe(false);
  });

  it('logs a created message when new directories are made', async () => {
    const logSpy = vi.spyOn(console, 'log').mockReturnValue();
    await loadScript();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Created'));
    logSpy.mockRestore();
  });

  it('logs an already-exists message when all directories are present', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const logSpy = vi.spyOn(console, 'log').mockReturnValue();
    await loadScript();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('already exists')
    );
    logSpy.mockRestore();
  });
});
