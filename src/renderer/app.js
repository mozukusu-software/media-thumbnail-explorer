const tree = document.querySelector('#folderTree');
const fileList = document.querySelector('#fileList');
const fileEmpty = document.querySelector('#fileEmpty');
const fileCount = document.querySelector('#fileCount');
const currentPath = document.querySelector('#currentPath');
const selectedName = document.querySelector('#selectedName');
const previewContent = document.querySelector('#previewContent');
const intervalControl = document.querySelector('#intervalControl');
const intervalSelect = document.querySelector('#intervalSelect');
const imageViewer = document.querySelector('#imageViewer');
const imageViewerImage = document.querySelector('#imageViewerImage');
const imageViewerName = document.querySelector('#imageViewerName');
const imageViewerClose = document.querySelector('#imageViewerClose');

let selectedTreeRow = null;
let selectedFileRow = null;
let selectedFile = null;
let generationToken = 0;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function showError(target, error) {
  target.replaceChildren();
  const message = document.createElement('div');
  message.className = 'error';
  message.textContent = error?.message || String(error);
  target.append(message);
}

function openImageViewer(file) {
  imageViewerImage.src = file.url;
  imageViewerImage.alt = file.name;
  imageViewerName.textContent = file.name;
  imageViewer.classList.remove('hidden');
  imageViewerClose.focus();
  imageViewer.requestFullscreen?.().catch(() => { /* The in-window overlay remains available. */ });
}

async function closeImageViewer() {
  imageViewer.classList.add('hidden');
  imageViewerImage.removeAttribute('src');
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

imageViewerClose.addEventListener('click', closeImageViewer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !imageViewer.classList.contains('hidden')) closeImageViewer();
});

function createTreeNode(item, depth = 0) {
  const node = document.createElement('div');
  node.className = 'tree-node';
  node.dataset.path = item.path;

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${depth * 16 + 4}px`;
  row.title = item.path;

  const toggle = document.createElement('button');
  toggle.className = 'tree-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', '展開');
  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.textContent = '●';
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = item.name;
  row.append(toggle, icon, label);

  const children = document.createElement('div');
  children.className = 'tree-children';
  node.append(row, children);

  async function expand() {
    if (node.classList.contains('expanded')) {
      node.classList.remove('expanded');
      return;
    }
    node.classList.add('expanded');
    if (node.dataset.loaded === 'true') return;
    toggle.classList.add('loading');
    try {
      const directories = await window.mediaExplorer.getDirectories(item.path);
      directories.forEach((directory) => children.append(createTreeNode(directory, depth + 1)));
      node.dataset.loaded = 'true';
      if (!directories.length) toggle.style.visibility = 'hidden';
    } catch (error) {
      node.classList.remove('expanded');
      alert(`フォルダーを開けませんでした。\n${error.message}`);
    } finally {
      toggle.classList.remove('loading');
    }
  }

  toggle.addEventListener('click', (event) => { event.stopPropagation(); expand(); });
  row.addEventListener('dblclick', expand);
  row.addEventListener('click', () => selectFolder(item.path, row));
  return node;
}

async function selectFolder(folderPath, row) {
  if (selectedTreeRow) selectedTreeRow.classList.remove('selected');
  selectedTreeRow = row;
  row.classList.add('selected');
  currentPath.textContent = folderPath;
  currentPath.title = folderPath;
  fileList.replaceChildren();
  fileEmpty.textContent = '読み込み中…';
  fileCount.textContent = '…';
  clearPreview();
  try {
    const files = await window.mediaExplorer.getMediaFiles(folderPath);
    fileCount.textContent = `${files.length}件`;
    fileEmpty.textContent = files.length ? '' : 'このフォルダに対応する画像・動画はありません';
    files.forEach((file) => fileList.append(createFileRow(file)));
  } catch (error) {
    fileCount.textContent = '0件';
    fileEmpty.textContent = 'フォルダを読み込めませんでした';
    showError(fileList, error);
  }
}

function createFileRow(file) {
  const row = document.createElement('div');
  row.className = 'file-row';
  row.title = file.path;
  const icon = document.createElement('div');
  icon.className = 'file-type';
  icon.textContent = file.type === 'image' ? '▧' : '▶';
  const details = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = file.name;
  const meta = document.createElement('div');
  meta.className = 'file-meta';
  meta.textContent = `${file.type === 'image' ? '画像' : '動画'} · ${formatBytes(file.size)}`;
  details.append(name, meta);
  row.append(icon, details);
  row.addEventListener('click', () => {
    if (selectedFileRow) selectedFileRow.classList.remove('selected');
    selectedFileRow = row;
    row.classList.add('selected');
    selectFile(file);
  });
  if (file.type === 'video') {
    row.addEventListener('dblclick', async () => {
      const result = await window.mediaExplorer.openVideo(file.path);
      if (!result.ok) alert(`既定のアプリで動画を開けませんでした。\n${result.error}`);
    });
  } else {
    row.addEventListener('dblclick', () => openImageViewer(file));
  }
  return row;
}

function clearPreview() {
  generationToken += 1;
  selectedFile = null;
  selectedName.textContent = 'ファイル未選択';
  intervalControl.classList.add('hidden');
  previewContent.innerHTML = '<div class="preview-placeholder">画像または動画をクリックすると<br>ここに表示されます</div>';
}

function selectFile(file) {
  generationToken += 1;
  selectedFile = file;
  selectedName.textContent = file.name;
  selectedName.title = file.path;
  previewContent.replaceChildren();
  if (file.type === 'image') {
    intervalControl.classList.add('hidden');
    const image = new Image();
    image.className = 'image-preview';
    image.alt = file.name;
    image.src = file.url;
    image.onerror = () => showError(previewContent, new Error('画像を表示できませんでした。'));
    previewContent.append(image);
  } else {
    intervalControl.classList.remove('hidden');
    renderVideo(file);
  }
}

function once(target, eventName) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('動画を読み込めませんでした。Electronが対応していないコーデックの可能性があります。')); };
    const cleanup = () => { target.removeEventListener(eventName, onSuccess); target.removeEventListener('error', onError); };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.05 && video.readyState >= 2) return;
  const done = once(video, 'seeked');
  video.currentTime = time;
  await done;
}

async function renderVideo(file) {
  const token = ++generationToken;
  previewContent.replaceChildren();
  const player = document.createElement('video');
  player.className = 'video-player';
  player.controls = true;
  player.preload = 'metadata';
  player.src = file.url;
  const extractor = document.createElement('video');
  extractor.preload = 'auto';
  extractor.muted = true;
  extractor.src = file.url;
  const status = document.createElement('div');
  status.className = 'generation-status';
  const statusText = document.createElement('span');
  statusText.textContent = '動画を読み込み中…';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cancel-button';
  cancel.textContent = '生成を中止';
  cancel.addEventListener('click', () => { generationToken += 1; statusText.textContent = 'サムネイル生成を中止しました'; cancel.remove(); });
  status.append(statusText, cancel);
  const grid = document.createElement('div');
  grid.className = 'thumbnail-grid';
  previewContent.append(player, status, grid);

  try {
    await Promise.all([once(player, 'loadedmetadata'), once(extractor, 'loadedmetadata')]);
    if (token !== generationToken) return;
    if (!Number.isFinite(extractor.duration) || extractor.duration <= 0) throw new Error('動画の長さを取得できませんでした。');
    const interval = Number(intervalSelect.value);
    const times = [];
    for (let time = 0; time < extractor.duration; time += interval) times.push(time);
    statusText.textContent = `0 / ${times.length}枚を生成中`;
    const canvas = document.createElement('canvas');
    const scale = Math.min(320 / extractor.videoWidth, 240 / extractor.videoHeight, 1);
    canvas.width = Math.max(1, Math.round(extractor.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(extractor.videoHeight * scale));
    const context = canvas.getContext('2d');

    for (let index = 0; index < times.length; index += 1) {
      if (token !== generationToken) return;
      await seekVideo(extractor, Math.min(times[index], Math.max(0, extractor.duration - 0.05)));
      if (token !== generationToken) return;
      context.drawImage(extractor, 0, 0, canvas.width, canvas.height);
      const card = document.createElement('div');
      card.className = 'thumbnail-card';
      const image = new Image();
      image.alt = `${formatTime(times[index])} のサムネイル`;
      image.src = canvas.toDataURL('image/jpeg', 0.82);
      const timeLabel = document.createElement('div');
      timeLabel.className = 'thumbnail-time';
      timeLabel.textContent = formatTime(times[index]);
      card.append(image, timeLabel);
      grid.append(card);
      statusText.textContent = `${index + 1} / ${times.length}枚を生成中`;
      if (index % 4 === 3) await new Promise(requestAnimationFrame);
    }
    if (token === generationToken) {
      statusText.textContent = `${times.length}枚のサムネイルを生成しました`;
      cancel.remove();
    }
  } catch (error) {
    if (token === generationToken) showError(status, error);
  }
}

intervalSelect.addEventListener('change', () => {
  if (selectedFile?.type === 'video') renderVideo(selectedFile);
});

async function initialize() {
  try {
    const drives = await window.mediaExplorer.getDrives();
    drives.forEach((drive) => tree.append(createTreeNode(drive)));
    if (!drives.length) tree.textContent = 'ドライブを取得できませんでした';
  } catch (error) {
    showError(tree, error);
  }
}

initialize();
