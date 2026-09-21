const fs = require('node:fs/promises');
const path = require('node:path');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp',
  '.png', '.apng', '.gif', '.bmp', '.webp', '.avif', '.svg', '.ico',
  '.tif', '.tiff', '.heic', '.heif', '.jxl'
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.avi', '.mkv', '.wmv', '.mpeg', '.mpg']);
const DIRECTORY_PROBE_CONCURRENCY = 8;

const ACCESS_DENIED_CODES = new Set(['EACCES', 'EPERM']);
const UNAVAILABLE_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETDOWN', 'ENETRESET', 'ENETUNREACH', 'ENOTCONN', 'EPIPE'
]);

function classifyStorageError(error, targetPath) {
  const code = typeof error?.code === 'string' ? error.code : null;
  let type = 'unknown';

  if (ACCESS_DENIED_CODES.has(code)) type = 'access-denied';
  else if (code === 'ENOENT' || code === 'ENOTDIR') type = 'not-found';
  else if (code === 'ETIMEDOUT') type = 'timeout';
  else if (UNAVAILABLE_CODES.has(code)) type = 'unavailable';

  return {
    type,
    code,
    path: typeof targetPath === 'string' ? targetPath : null
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function directoryHasChildren(directoryPath) {
  try {
    const handle = await fs.opendir(directoryPath);
    try {
      for await (const entry of handle) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) return true;
      }
      return false;
    } finally {
      await handle.close().catch(() => {});
    }
  } catch {
    return true;
  }
}

class LocalStorageProvider {
  constructor(networkRoots = []) {
    this.networkRoots = [...networkRoots];
  }

  setNetworkRoots(networkRoots) {
    this.networkRoots = [...networkRoots];
  }

  async getRoots() {
    const candidates = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
    const checks = await Promise.all(candidates.map(async (drive) => {
      try {
        await fs.access(drive);
        return { name: drive, path: drive, hasChildren: true };
      } catch {
        return null;
      }
    }));
    return [
      ...checks.filter(Boolean),
      ...this.networkRoots.map((networkPath) => ({
        name: networkPath,
        path: networkPath,
        hasChildren: true,
        networkRoot: true
      }))
    ];
  }

  async listDirectories(parentPath) {
    const entries = (await fs.readdir(parentPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));

    return mapWithConcurrency(entries, DIRECTORY_PROBE_CONCURRENCY, async (entry) => {
      const directoryPath = path.join(parentPath, entry.name);
      return {
        name: entry.name,
        path: directoryPath,
        hasChildren: await directoryHasChildren(directoryPath)
      };
    });
  }

  async listMediaFiles(folderPath) {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const type = IMAGE_EXTENSIONS.has(extension) ? 'image' : VIDEO_EXTENSIONS.has(extension) ? 'video' : null;
      if (!type) continue;
      const fullPath = path.join(folderPath, entry.name);
      let size = 0;
      try { size = (await fs.stat(fullPath)).size; } catch { /* File may have disappeared. */ }
      files.push({ name: entry.name, path: fullPath, type, size });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
  }
}

module.exports = { LocalStorageProvider, classifyStorageError };
