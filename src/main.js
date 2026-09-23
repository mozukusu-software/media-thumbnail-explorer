const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { LocalStorageProvider, classifyStorageError } = require('./storage/local-storage-provider');

let ffmpegExecutable = null;
let ffprobeExecutable = null;
const activeChildProcesses = new Set();
let uncMediaServer = null;
let uncMediaServerPort = null;
const uncMediaServerToken = randomBytes(24).toString('hex');

function getFfmpegExecutable() {
  if (ffmpegExecutable) return ffmpegExecutable;

  if (process.env.FFMPEG_PATH) {
    ffmpegExecutable = process.env.FFMPEG_PATH;
    return ffmpegExecutable;
  }

  ffmpegExecutable = 'ffmpeg';
  return ffmpegExecutable;
}

function getFfprobeExecutable() {
  if (ffprobeExecutable) return ffprobeExecutable;

  if (process.env.FFPROBE_PATH) {
    ffprobeExecutable = process.env.FFPROBE_PATH;
    return ffprobeExecutable;
  }

  ffprobeExecutable = 'ffprobe';
  return ffprobeExecutable;
}

const PROCESS_TIMEOUT_MS = 30_000;
const MAX_STDERR_BYTES = 1024 * 1024;
const thumbnailProcesses = new Map();
const cancelledThumbnailJobs = new Set();

function runProcess(executable, args, maxOutputBytes = 10 * 1024 * 1024, { jobId = null } = {}) {
  return new Promise((resolve, reject) => {
    if (jobId && cancelledThumbnailJobs.has(jobId)) {
      reject(new Error('Thumbnail generation was cancelled.'));
      return;
    }

    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    activeChildProcesses.add(child);
    if (jobId) thumbnailProcesses.set(jobId, child);

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      activeChildProcesses.delete(child);
      if (jobId && thumbnailProcesses.get(jobId) === child) {
        thumbnailProcesses.delete(jobId);
      }
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('メディア処理がタイムアウトしました。')));
    }, PROCESS_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        child.kill();
        finish(() => reject(new Error('プロセスの出力が大きすぎます。')));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on('data', (chunk) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      const remaining = MAX_STDERR_BYTES - stderrBytes;
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stderr.push(kept);
      stderrBytes += kept.length;
    });

    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      finish(() => resolve({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8').trim()
      }));
    });
  });
}

function cancelThumbnailProcess(jobId) {
  if (typeof jobId !== 'string' || !jobId) return false;
  cancelledThumbnailJobs.add(jobId);
  const child = thumbnailProcesses.get(jobId);
  if (!child) return true;
  thumbnailProcesses.delete(jobId);
  try {
    child.kill();
  } catch {
    // The cancellation state still prevents this job from spawning another process.
  }
  return true;
}

function clearThumbnailCancellation(jobId) {
  if (typeof jobId === 'string' && jobId) {
    cancelledThumbnailJobs.delete(jobId);
  }
}

function terminateChildProcesses() {
  for (const child of activeChildProcesses) {
    try {
      child.kill();
    } catch {
      // The process may already have exited between iteration and kill().
    }
  }
  activeChildProcesses.clear();
}


const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp',
  '.png', '.apng', '.gif', '.bmp', '.webp', '.avif', '.svg', '.ico',
  '.tif', '.tiff', '.heic', '.heif', '.jxl'
]);
const TRANSCODE_IMAGE_EXTENSIONS = new Set(['.tif', '.tiff', '.heic', '.heif', '.jxl']);
const IMAGE_CONTENT_TYPES = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.jfif', 'image/jpeg'], ['.pjpeg', 'image/jpeg'], ['.pjp', 'image/jpeg'],
  ['.png', 'image/png'], ['.apng', 'image/apng'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'],
  ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon']
]);
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

function isUncPath(filePath) {
  return typeof filePath === 'string' && /^\\\\[^\\]+\\[^\\]+/.test(filePath);
}

function encodeUncVideoUrl(filePath) {
  if (!uncMediaServerPort) return null;
  const encodedPath = Buffer.from(filePath, 'utf8').toString('base64url');
  return `http://127.0.0.1:${uncMediaServerPort}/${uncMediaServerToken}/${encodedPath}`;
}

function parseSingleByteRange(rangeHeader, size) {
  if (!rangeHeader) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start;
  let end;
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return null;
  }
  return { start, end: Math.min(end, size - 1), partial: true };
}

async function isRegisteredNetworkMediaPath(filePath) {
  if (!isUncPath(filePath)) return false;
  const normalized = path.win32.normalize(filePath).toLowerCase();
  const settings = await loadAppSettings();
  return settings.networkRoots.some((root) => {
    const normalizedRoot = path.win32.normalize(root).replace(/\\+$/, '').toLowerCase();
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}\\`);
  });
}

function startUncMediaServer() {
  if (uncMediaServer) return Promise.resolve();

  uncMediaServer = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }

      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      const parts = requestUrl.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== uncMediaServerToken) {
        response.writeHead(404);
        response.end();
        return;
      }

      const filePath = Buffer.from(parts[1], 'base64url').toString('utf8');
      const extension = path.extname(filePath).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(extension) || !(await isRegisteredNetworkMediaPath(filePath))) {
        response.writeHead(403);
        response.end();
        return;
      }

      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        response.writeHead(404);
        response.end();
        return;
      }

      const range = parseSingleByteRange(request.headers.range, stat.size);
      if (!range) {
        response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        response.end();
        return;
      }

      const contentLength = range.end - range.start + 1;
      const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Length': contentLength,
        'Content-Type': 'video/mp4'
      };
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;

      response.writeHead(range.partial ? 206 : 200, headers);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }

      const stream = fsSync.createReadStream(filePath, { start: range.start, end: range.end });
      stream.on('error', () => {
        if (!response.headersSent) response.writeHead(500);
        response.destroy();
      });
      stream.pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });

  return new Promise((resolve, reject) => {
    const handleStartupError = (error) => {
      uncMediaServer = null;
      uncMediaServerPort = null;
      reject(error);
    };
    uncMediaServer.once('error', handleStartupError);
    uncMediaServer.listen(0, '127.0.0.1', () => {
      uncMediaServer.off('error', handleStartupError);
      const address = uncMediaServer.address();
      uncMediaServerPort = typeof address === 'object' && address ? address.port : null;
      resolve();
    });
  });
}

function stopUncMediaServer() {
  if (!uncMediaServer) return;
  uncMediaServer.close();
  uncMediaServer = null;
  uncMediaServerPort = null;
}

const storageProvider = new LocalStorageProvider();

async function listMediaFiles(folderPath) {
  const files = await storageProvider.listMediaFiles(folderPath);
  return files.map((file) => {
    if (file.type !== 'video') {
      return { ...file, url: encodeMediaUrl(file.path) };
    }
    if (!isUncPath(file.path)) {
      return { ...file, url: pathToFileURL(file.path).toString() };
    }

    const url = encodeUncVideoUrl(file.path);
    return {
      ...file,
      url,
      playbackError: url ? null : 'UNC動画再生サーバーを起動できなかったため、内蔵プレイヤーでは再生できません。ファイル一覧と画像閲覧は利用できます。'
    };
  });
}

async function storageResult(targetPath, operation) {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error('Storage access failed:', targetPath, error);
    return { ok: false, error: classifyStorageError(error, targetPath) };
  }
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


async function extractVideoFrame(filePath, timeSeconds, width = 320, height = 240, jobId = null) {
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
    result = await runProcess(getFfmpegExecutable(), args, 10 * 1024 * 1024, { jobId });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('FFmpegが見つかりません。FFmpegをインストールしてPATHに追加するか、FFMPEG_PATHを設定してください。');
    }
    throw error;
  }

  if (result.code !== 0 || result.stdout.length === 0) {
    throw new Error(result.stderr || `FFmpegが終了コード ${result.code} で失敗しました。`);
  }
  return result.stdout;
}

async function generateVideoThumbnail(filePath, timeSeconds, jobId = null) {
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
    const image = await extractVideoFrame(filePath, timeSeconds, 320, 240, jobId);
    return { ok: true, mime: 'image/jpeg', data: image.toString('base64') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getVideoDuration(filePath, jobId = null) {
  const args = [
    '-v', 'error',
    '-select_streams', 'V:0',
    '-show_entries', 'format=duration:stream=duration',
    '-of', 'json',
    filePath
  ];

  let result;
  try {
    result = await runProcess(getFfprobeExecutable(), args, 1024 * 1024, { jobId });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('FFprobeが見つかりません。FFmpegをインストールしてPATHに追加するか、FFPROBE_PATHを設定してください。');
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

function isExternalToolConfigurationError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('FFmpegが見つかりません') || message.includes('FFprobeが見つかりません');
}

async function createVideoListThumbnail(filePath, jobId = null) {
  const duration = await getVideoDuration(filePath, jobId);
  const fractions = duration < 3 ? [0.5] : [0.1, 0.25, 0.4];
  let bestImage = null;
  let bestScore = -Infinity;
  let actionableError = null;

  for (const fraction of fractions) {
    const time = Math.min(Math.max(duration * fraction, 0), Math.max(0, duration - 0.1));
    try {
      const image = await extractVideoFrame(filePath, time, 160, 100, jobId);
      const score = await scoreThumbnail(image);
      if (score > bestScore) {
        bestScore = score;
        bestImage = image;
      }
    } catch (error) {
      if (isExternalToolConfigurationError(error)) actionableError = error;
      // Try the next representative position for media-specific extraction failures.
    }
  }

  if (!bestImage) {
    if (actionableError) throw actionableError;
    throw new Error('動画から代表サムネイルを取得できませんでした。');
  }
  return bestImage;
}

async function getListThumbnail(filePath, type, jobId = null) {
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
        : await createVideoListThumbnail(filePath, jobId);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, image);
    }

    return { ok: true, dataUrl: `data:image/jpeg;base64,${image.toString('base64')}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

const DEFAULT_WINDOW_BOUNDS = { width: 1440, height: 900 };
const WINDOW_STATE_FILE = 'window-state.json';
const APP_SETTINGS_FILE = 'app-settings.json';


function getAppSettingsPath() {
  return path.join(app.getPath('userData'), APP_SETTINGS_FILE);
}

function normalizeNetworkRoot(input) {
  if (typeof input !== 'string') throw new Error('UNCパスを入力してください。');
  const candidate = input.trim().replaceAll('/', '\\');
  if (!/^\\\\[^\\]+\\[^\\]+(?:\\.*)?$/.test(candidate)) {
    throw new Error('\\\\server\\share またはその配下のUNCパスを入力してください。');
  }
  return path.win32.normalize(candidate);
}

async function loadAppSettings() {
  try {
    const settings = JSON.parse(await fs.readFile(getAppSettingsPath(), 'utf8'));
    const networkRoots = Array.isArray(settings?.networkRoots)
      ? settings.networkRoots.filter((item) => typeof item === 'string')
      : [];
    return { networkRoots };
  } catch {
    return { networkRoots: [] };
  }
}

async function saveAppSettings(settings) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getAppSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

async function addNetworkRoot(input) {
  const networkRoot = normalizeNetworkRoot(input);
  const settings = await loadAppSettings();
  if (settings.networkRoots.some((item) => item.toLowerCase() === networkRoot.toLowerCase())) {
    return { ok: false, error: 'このUNCパスはすでに登録されています。' };
  }
  settings.networkRoots.push(networkRoot);
  await saveAppSettings(settings);
  storageProvider.setNetworkRoots(settings.networkRoots);
  return { ok: true, path: networkRoot };
}

async function removeNetworkRoot(input) {
  const networkRoot = normalizeNetworkRoot(input);
  const settings = await loadAppSettings();
  const nextRoots = settings.networkRoots.filter((item) => item.toLowerCase() !== networkRoot.toLowerCase());
  if (nextRoots.length === settings.networkRoots.length) {
    return { ok: false, error: '登録されたUNCパスが見つかりません。' };
  }
  settings.networkRoots = nextRoots;
  await saveAppSettings(settings);
  storageProvider.setNetworkRoots(settings.networkRoots);
  return { ok: true };
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

async function loadWindowState() {
  try {
    const state = JSON.parse(await fs.readFile(getWindowStatePath(), 'utf8'));
    const bounds = state?.bounds;
    const validBounds = bounds
      && Number.isFinite(bounds.width)
      && Number.isFinite(bounds.height)
      && bounds.width >= 960
      && bounds.height >= 640;

    return {
      bounds: validBounds ? bounds : DEFAULT_WINDOW_BOUNDS,
      isMaximized: state?.isMaximized === true
    };
  } catch {
    return { bounds: DEFAULT_WINDOW_BOUNDS, isMaximized: false };
  }
}

async function saveWindowState(window) {
  if (window.isDestroyed()) return;

  // getNormalBounds() preserves the last non-maximized/non-minimized geometry,
  // so closing while minimized never restores the app minimized next time.
  const state = {
    bounds: window.getNormalBounds(),
    isMaximized: window.isMaximized()
  };

  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save window state:', error);
  }
}

async function createWindow() {
  const state = await loadWindowState();
  const window = new BrowserWindow({
    ...state.bounds,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#10141c',
    title: 'Media Thumbnail Explorer',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.removeMenu();

  window.webContents.on('before-input-event', (event, input) => {
    const isDevToolsShortcut =
      input.type === 'keyDown' &&
      input.control &&
      input.shift &&
      input.key.toLowerCase() === 'i';

    if (!isDevToolsShortcut) return;

    event.preventDefault();
    window.webContents.toggleDevTools();
  });

  let closePending = false;
  window.on('close', (event) => {
    if (closePending) return;
    event.preventDefault();
    closePending = true;
    saveWindowState(window).finally(() => window.destroy());
  });

  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (state.isMaximized) window.maximize();
}

app.whenReady().then(async () => {
  const settings = await loadAppSettings();
  storageProvider.setNetworkRoots(settings.networkRoots);
  try {
    await startUncMediaServer();
  } catch (error) {
    console.error('UNC media server could not be started; UNC video playback is disabled:', error);
  }
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
      if (!IMAGE_EXTENSIONS.has(extension)) {
        return new Response('Unsupported media type', { status: 415 });
      }
      return fs.readFile(filePath)
        .then((output) => new Response(output, {
          headers: { 'Content-Type': IMAGE_CONTENT_TYPES.get(extension) || 'application/octet-stream' }
        }))
        .catch((error) => new Response(`Image read failed: ${error.message}`, { status: 404 }));
    } catch {
      return new Response('Bad media path', { status: 400 });
    }
  });

  ipcMain.handle('fs:drives', () => storageProvider.getRoots());
  ipcMain.handle('settings:add-network-root', (_event, networkPath) => addNetworkRoot(networkPath));
  ipcMain.handle('settings:remove-network-root', (_event, networkPath) => removeNetworkRoot(networkPath));
  ipcMain.handle('fs:directories', (_event, folderPath) =>
    storageResult(folderPath, () => storageProvider.listDirectories(folderPath)));
  ipcMain.handle('fs:media', (_event, folderPath) =>
    storageResult(folderPath, () => listMediaFiles(folderPath)));
  ipcMain.handle('shell:open-video', (_event, filePath) => openVideo(filePath));
  ipcMain.handle('video:thumbnail', async (_event, filePath, timeSeconds, jobId) => {
    try {
      return await generateVideoThumbnail(filePath, timeSeconds, jobId);
    } finally {
      clearThumbnailCancellation(jobId);
    }
  });
  ipcMain.handle('video:cancel-thumbnail', (_event, jobId) => cancelThumbnailProcess(jobId));
  ipcMain.handle('media:list-thumbnail', async (_event, filePath, type, jobId) => {
    try {
      return await getListThumbnail(filePath, type, jobId);
    } finally {
      clearThumbnailCancellation(jobId);
    }
  });
  ipcMain.handle('media:cancel-thumbnail', (_event, jobId) => cancelThumbnailProcess(jobId));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopUncMediaServer();
  terminateChildProcesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
