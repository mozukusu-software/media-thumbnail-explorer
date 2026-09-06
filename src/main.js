const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

let ffmpegExecutable = null;
let ffprobeExecutable = null;

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

function getFfprobeExecutable() {
  if (ffprobeExecutable) return ffprobeExecutable;

  if (process.env.FFPROBE_PATH) {
    ffprobeExecutable = process.env.FFPROBE_PATH;
    return ffprobeExecutable;
  }

  try {
    ffprobeExecutable = require('@derhuerst/ffprobe-static');
    return ffprobeExecutable;
  } catch {
    ffprobeExecutable = 'ffprobe';
    return ffprobeExecutable;
  }
}

function runProcess(executable, args, maxOutputBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        child.kill();
        finish(() => reject(new Error('プロセスの出力が大きすぎます。')));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => resolve({
      code,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString('utf8').trim()
    })));
  });
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

const DIRECTORY_PROBE_CONCURRENCY = 8;

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
    // If the directory cannot be inspected, keep the toggle available so the
    // user can still attempt to open it and receive the normal error message.
    return true;
  }
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

async function listDirectories(parentPath) {
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


async function extractVideoFrame(filePath, timeSeconds, width = 320, height = 240) {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', timeSeconds.toFixed(3),
    '-i', filePath,
    '-map', '0:V:0',
    '-frames:v', '1',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    '-q:v', '3',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1'
  ];

  let result;
  try {
    result = await runProcess(getFfmpegExecutable(), args);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('FFmpegが見つかりません。ffmpeg-staticをインストールするか、FFMPEG_PATHを設定してください。');
    }
    throw error;
  }

  if (result.code !== 0 || result.stdout.length === 0) {
    throw new Error(result.stderr || `FFmpegが終了コード ${result.code} で失敗しました。`);
  }
  return result.stdout;
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
    const image = await extractVideoFrame(filePath, timeSeconds);
    return { ok: true, mime: 'image/jpeg', data: image.toString('base64') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getVideoDuration(filePath) {
  const args = [
    '-v', 'error',
    '-select_streams', 'V:0',
    '-show_entries', 'format=duration:stream=duration',
    '-of', 'json',
    filePath
  ];

  let result;
  try {
    result = await runProcess(getFfprobeExecutable(), args, 1024 * 1024);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('FFprobeが見つかりません。@derhuerst/ffprobe-staticをインストールするか、FFPROBE_PATHを設定してください。');
    }
    throw error;
  }
  if (result.code !== 0) throw new Error(result.stderr || 'FFprobeで動画情報を取得できませんでした。');

  const info = JSON.parse(result.stdout.toString('utf8'));
  const candidates = [
    Number(info?.format?.duration),
    ...(Array.isArray(info?.streams) ? info.streams.map((stream) => Number(stream.duration)) : [])
  ].filter((duration) => Number.isFinite(duration) && duration > 0);
  if (!candidates.length) throw new Error('動画の長さを取得できませんでした。');
  return Math.max(...candidates);
}

async function scoreThumbnail(image) {
  const stats = await sharp(image).stats();
  const channels = stats.channels.slice(0, 3);
  const mean = channels.reduce((sum, channel) => sum + channel.mean, 0) / Math.max(1, channels.length);
  const contrast = channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, channels.length);
  const entropy = Number.isFinite(stats.entropy) ? stats.entropy : 0;
  const extremePenalty = mean < 20 || mean > 245 ? 120 : 0;
  return contrast * 1.5 + entropy * 12 + Math.min(mean, 255 - mean) * 0.25 - extremePenalty;
}

function getThumbnailCachePath(filePath, stat, type) {
  const cacheKey = createHash('sha1')
    .update(`${type}\0${filePath.toLowerCase()}\0${stat.size}\0${stat.mtimeMs}`)
    .digest('hex');
  return path.join(app.getPath('temp'), 'media-thumbnail-explorer', 'thumbnails', `${cacheKey}.jpg`);
}

async function createImageListThumbnail(filePath) {
  return sharp(filePath, { pages: 1, animated: false })
    .rotate()
    .resize(160, 100, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#090d13' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

async function createVideoListThumbnail(filePath) {
  const duration = await getVideoDuration(filePath);
  const fractions = duration < 3 ? [0.5] : [0.1, 0.25, 0.4];
  let bestImage = null;
  let bestScore = -Infinity;

  for (const fraction of fractions) {
    const time = Math.min(Math.max(duration * fraction, 0), Math.max(0, duration - 0.1));
    try {
      const image = await extractVideoFrame(filePath, time, 160, 100);
      const score = await scoreThumbnail(image);
      if (score > bestScore) {
        bestScore = score;
        bestImage = image;
      }
    } catch {
      // Try the next representative position.
    }
  }

  if (!bestImage) throw new Error('動画から代表サムネイルを取得できませんでした。');
  return bestImage;
}

async function getListThumbnail(filePath, type) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    return { ok: false, error: 'メディアのパスが正しくありません。' };
  }

  const extension = path.extname(filePath).toLowerCase();
  if (type === 'image' && !IMAGE_EXTENSIONS.has(extension)) {
    return { ok: false, error: '画像ファイルではありません。' };
  }
  if (type === 'video' && !VIDEO_EXTENSIONS.has(extension)) {
    return { ok: false, error: '動画ファイルではありません。' };
  }
  if (type !== 'image' && type !== 'video') {
    return { ok: false, error: '対応していないメディア種別です。' };
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, error: 'メディアファイルが見つかりません。' };

    const cachePath = getThumbnailCachePath(filePath, stat, type);
    let image;
    try {
      image = await fs.readFile(cachePath);
    } catch {
      image = type === 'image'
        ? await createImageListThumbnail(filePath)
        : await createVideoListThumbnail(filePath);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, image);
    }

    return { ok: true, dataUrl: `data:image/jpeg;base64,${image.toString('base64')}` };
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
  ipcMain.handle('media:list-thumbnail', (_event, filePath, type) => getListThumbnail(filePath, type));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
