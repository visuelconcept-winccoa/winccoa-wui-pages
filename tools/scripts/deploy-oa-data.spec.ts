import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn<() => boolean>(),
  readdirSync: vi.fn<() => unknown[]>(),
  mkdirSync: vi.fn<() => void>(),
  copyFileSync: vi.fn<() => void>()
}));

vi.mock('node:fs', () => ({ default: mockFs }));

const dirent = (name: string, type: 'file' | 'dir' | 'symlink') => ({
  name,
  isFile: () => type === 'file',
  isDirectory: () => type === 'dir',
  isSymbolicLink: () => type === 'symlink'
});

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(true);
  mockFs.readdirSync.mockReturnValue([]);
  mockFs.mkdirSync.mockReset();
  mockFs.copyFileSync.mockReset();
  delete process.env['OUT_DIR'];
  vi.resetModules();
});

async function loadScript() {
  await import('./deploy-oa-data.mjs');
}

describe('deploy-oa-data', () => {
  it('exits early with code 0 when oa-data/ directory does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockReturnValue(undefined as never);
    await loadScript();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('exits with code 1 when OUT_DIR resolves to filesystem root', async () => {
    process.env['OUT_DIR'] = '/';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockReturnValue(undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockReturnValue();
    await loadScript();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('filesystem root')
    );
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('copies regular files from oa-data/ to the target directory', async () => {
    mockFs.readdirSync.mockReturnValue([dirent('config.json', 'file')]);
    await loadScript();
    expect(mockFs.copyFileSync).toHaveBeenCalledOnce();
    expect(mockFs.mkdirSync).toHaveBeenCalledOnce();
  });

  it('creates the target directory only once per folder, not per file', async () => {
    mockFs.readdirSync.mockReturnValue([
      dirent('a.json', 'file'),
      dirent('b.json', 'file')
    ]);
    await loadScript();
    expect(mockFs.copyFileSync).toHaveBeenCalledTimes(2);
    expect(mockFs.mkdirSync).toHaveBeenCalledOnce();
  });

  it('recurses into subdirectories', async () => {
    mockFs.readdirSync
      .mockReturnValueOnce([dirent('subdir', 'dir')])
      .mockReturnValueOnce([dirent('file.json', 'file')]);
    await loadScript();
    expect(mockFs.copyFileSync).toHaveBeenCalledOnce();
  });

  it('skips symlinks without copying them', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue();
    mockFs.readdirSync.mockReturnValue([dirent('link', 'symlink')]);
    await loadScript();
    expect(mockFs.copyFileSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('symlink'));
    warnSpy.mockRestore();
  });

  it('skips .gitkeep and README.md placeholder files', async () => {
    mockFs.readdirSync.mockReturnValue([
      dirent('.gitkeep', 'file'),
      dirent('README.md', 'file')
    ]);
    await loadScript();
    expect(mockFs.copyFileSync).not.toHaveBeenCalled();
  });

  it('reports no files deployed when oa-data/ contains only placeholders', async () => {
    const logSpy = vi.spyOn(console, 'log').mockReturnValue();
    await loadScript();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('No files to deploy')
    );
    logSpy.mockRestore();
  });

  it('logs the deployed file count on success', async () => {
    mockFs.readdirSync.mockReturnValue([dirent('config.json', 'file')]);
    const logSpy = vi.spyOn(console, 'log').mockReturnValue();
    await loadScript();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Deployed 1 file')
    );
    logSpy.mockRestore();
  });

  it('resolves target directory from OUT_DIR environment variable', async () => {
    process.env['OUT_DIR'] = '/some/out/dir';
    mockFs.readdirSync.mockReturnValue([dirent('file.json', 'file')]);
    const logSpy = vi.spyOn(console, 'log').mockReturnValue();
    await loadScript();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('/some/out'));
    logSpy.mockRestore();
  });
});
