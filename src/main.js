const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const { spawn } = require('node:child_process');

let ffmpegExecutable = null;

function getFfmpegExecutable() {
  if (ffmpegExecutable) return ffmpegExecutable;

  if (process.env.FFMPEG_PATH) {
    ffmpegExecutable = process.env.FFMPEG_PATH;
    return ffmpegExecutable;
  }

  try {
    ffmpegExecutable = require('ffmpeg-static');
    return ffmpegExecutable;
  } catch {
    ffmpegExecutable = 'ffmpeg';
    return ffmpegExecutable;
  }
}


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


async function generateVideoThumbnail(filePath, timeSeconds) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    return { ok: false, error: '動画のパスが正しくありません。' };
  }
  if (!VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { ok: false, error: '動画ファイルではありません。' };
  }
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    return { ok: false, error: 'サムネイルの取得時刻が正しくありません。' };
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, error: '動画ファイルが見つかりません。' };
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', timeSeconds.toFixed(3),
    '-i', filePath,
    '-map', '0:V:0',
    '-frames:v', '1',
    '-vf', 'scale=320:240:force_original_aspect_ratio=decrease',
    '-q:v', '3',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1'
  ];

  return new Promise((resolve) => {
    const child = spawn(getFfmpegExecutable(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const output = [];
    const errors = [];
    let outputBytes = 0;
    const maxOutputBytes = 10 * 1024 * 1024;

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        return;
      }
      output.push(chunk);
    });
    child.stderr.on('data', (chunk) => errors.push(chunk));

    child.on('error', (error) => {
      const message = error.code === 'ENOENT'
        ? 'FFmpegが見つかりません。ffmpeg-staticをインストールするか、FFMPEG_PATHを設定してください。'
        : error.message;
      resolve({ ok: false, error: message });
    });

    child.on('close', (code) => {
      if (outputBytes > maxOutputBytes) {
        resolve({ ok: false, error: 'サムネイル画像が大きすぎます。' });
        return;
      }
      const image = Buffer.concat(output);
      if (code !== 0 || image.length === 0) {
        const stderr = Buffer.concat(errors).toString('utf8').trim();
        resolve({ ok: false, error: stderr || `FFmpegが終了コード ${code} で失敗しました。` });
        return;
      }
      resolve({ ok: true, mime: 'image/jpeg', data: image.toString('base64') });
    });
  });
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
      // Preserve media request headers (especially Range) so Chromium can seek
      // to arbitrary positions in local video files through the custom protocol.
      return net.fetch(pathToFileURL(filePath).toString(), {
        method: request.method,
        headers: request.headers
      });
    } catch {
      return new Response('Bad media path', { status: 400 });
    }
  });

  ipcMain.handle('fs:drives', getWindowsDrives);
  ipcMain.handle('fs:directories', (_event, folderPath) => listDirectories(folderPath));
  ipcMain.handle('fs:media', (_event, folderPath) => listMediaFiles(folderPath));
  ipcMain.handle('shell:open-video', (_event, filePath) => openVideo(filePath));
  ipcMain.handle('video:thumbnail', (_event, filePath, timeSeconds) => generateVideoThumbnail(filePath, timeSeconds));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
