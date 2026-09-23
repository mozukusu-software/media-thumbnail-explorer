const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function sliceFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} was not found`);
  assert.notEqual(end, -1, `${endMarker} was not found`);
  return source.slice(start, end);
}

test('UNC media listing does not fail when the loopback playback server has no port', async () => {
  const isUnc = sliceFunction(mainSource, 'function isUncPath', 'function parseSingleByteRange');
  const list = sliceFunction(mainSource, 'async function listMediaFiles', 'async function storageResult');
  const context = {
    Buffer,
    URL,
    uncMediaServerPort: null,
    uncMediaServerToken: 'token',
    pathToFileURL: (p) => ({ toString: () => `file://${p}` }),
    encodeMediaUrl: (p) => `media:${p}`,
    storageProvider: {
      listMediaFiles: async () => [
        { name: 'movie.mp4', path: '\\\\server\\share\\movie.mp4', type: 'video' },
        { name: 'image.png', path: '\\\\server\\share\\image.png', type: 'image' }
      ]
    }
  };
  vm.createContext(context);
  vm.runInContext(`${isUnc}\n${list}\nglobalThis.__listMediaFiles = listMediaFiles;`, context);
  const files = await context.__listMediaFiles('\\\\server\\share');
  assert.equal(files.length, 2);
  assert.equal(files[0].url, null);
  assert.match(files[0].playbackError, /一覧と画像閲覧は利用できます/);
  assert.equal(files[1].url, 'media:\\\\server\\share\\image.png');
});

test('list thumbnail keeps an actionable FFmpeg configuration error', async () => {
  const block = sliceFunction(mainSource, 'function isExternalToolConfigurationError', 'async function getListThumbnail');
  const context = {
    Error,
    getVideoDuration: async () => 10,
    extractVideoFrame: async () => {
      throw new Error('FFmpegが見つかりません。FFmpegをインストールしてPATHに追加するか、FFMPEG_PATHを設定してください。');
    },
    scoreThumbnail: async () => 0
  };
  vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.__createVideoListThumbnail = createVideoListThumbnail;`, context);
  await assert.rejects(context.__createVideoListThumbnail('movie.mp4', 'job-1'), /FFmpegが見つかりません.*FFMPEG_PATH/);
});

test('renderer exposes list thumbnail errors instead of silently clearing loading state', () => {
  const pump = sliceFunction(rendererSource, 'function setThumbnailError', 'function loadFileThumbnail');
  assert.match(pump, /result\?\.error/);
  assert.match(pump, /container\.title = message/);
  assert.match(pump, /setAttribute\('aria-label'/);
});

test('preview cancellation helper cancels and clears the active job', async () => {
  const helper = sliceFunction(rendererSource, 'function cancelActivePreviewThumbnailJob', 'function clearPreview');
  const cancelled = [];
  const context = {
    Promise,
    activePreviewThumbnailJobId: 'preview-42',
    window: { mediaExplorer: { cancelVideoThumbnail: async (jobId) => { cancelled.push(jobId); return true; } } }
  };
  vm.createContext(context);
  vm.runInContext(`${helper}\nglobalThis.__cancel = cancelActivePreviewThumbnailJob;`, context);
  const result = await context.__cancel();
  assert.equal(result, true);
  assert.deepEqual(cancelled, ['preview-42']);
  assert.equal(context.activePreviewThumbnailJobId, null);
});

test('interval changes cancel the active preview job before rendering again', () => {
  const start = rendererSource.indexOf("intervalSelect.addEventListener('change'");
  const end = rendererSource.indexOf('\n});', start) + 4;
  assert.notEqual(start, -1);
  const block = rendererSource.slice(start, end);
  assert.match(block, /generationToken \+= 1/);
  assert.match(block, /cancelActivePreviewThumbnailJob\(\)/);
  assert.match(block, /renderVideo\(selectedFile\)/);
  assert.ok(block.indexOf('cancelActivePreviewThumbnailJob()') < block.indexOf('renderVideo(selectedFile)'));
});
