const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp',
  '.png', '.apng', '.gif', '.bmp', '.webp', '.avif', '.svg', '.ico',
  '.tif', '.tiff', '.heic', '.heif', '.jxl'
]);
const TRANSCODE_IMAGE_EXTENSIONS = new Set(['.tif', '.tiff', '.heic', '.heif', '.jxl']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.avi', '.mkv', '.wmv', '.mpeg', '.mpg']);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

function encodeMediaUrl(filePath) {
  return `media-file://local/${Buffer.from(filePath, 'utf8').toString('base64url')}`;
}

function decodeMediaUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'local') throw new Error('Invalid media host');
  return Buffer.from(parsed.pathname.slice(1), 'base64url').toString('utf8');
}

async function getWindowsDrives() {
  const candidates = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
  const checks = await Promise.all(candidates.map(async (drive) => {
    try {
      await fs.access(drive);
      return { name: drive, path: drive, hasChildren: true };
    } catch {
      return null;
    }
  }));
  return checks.filter(Boolean);
}

async function listDirectories(parentPath) {
  const entries = await fs.readdir(parentPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
    .map((entry) => ({
      name: entry.name,
      path: path.join(parentPath, entry.name),
      hasChildren: true
    }));
}

async function listMediaFiles(folderPath) {
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
    files.push({ name: entry.name, path: fullPath, url: encodeMediaUrl(fullPath), type, size });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
}

async function openVideo(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    return { ok: false, error: '動画のパスが正しくありません。' };
  }
  if (!VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { ok: false, error: '動画ファイルではありません。' };
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, error: '動画ファイルが見つかりません。' };
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#10141c',
    title: 'Media Thumbnail Explorer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  protocol.handle('media-file', (request) => {
    try {
      const filePath = decodeMediaUrl(request.url);
      const extension = path.extname(filePath).toLowerCase();
      if (TRANSCODE_IMAGE_EXTENSIONS.has(extension)) {
        return fs.readFile(filePath)
          .then((input) => sharp(input, { pages: 1 }).png().toBuffer())
          .then((output) => new Response(output, { headers: { 'Content-Type': 'image/png' } }))
          .catch((error) => new Response(`Image conversion failed: ${error.message}`, { status: 415 }));
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Bad media path', { status: 400 });
    }
  });

  ipcMain.handle('fs:drives', getWindowsDrives);
  ipcMain.handle('fs:directories', (_event, folderPath) => listDirectories(folderPath));
  ipcMain.handle('fs:media', (_event, folderPath) => listMediaFiles(folderPath));
  ipcMain.handle('shell:open-video', (_event, filePath) => openVideo(filePath));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
