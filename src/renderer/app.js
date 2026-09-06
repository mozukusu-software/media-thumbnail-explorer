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
let thumbnailLoadToken = 0;
let activeThumbnailJobs = 0;
const thumbnailQueue = [];
const MAX_THUMBNAIL_JOBS = 2;

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

function createFolderIcon() {
  const wrapper = document.createElement('span');
  wrapper.className = 'folder-icon';
  wrapper.setAttribute('aria-hidden', 'true');

  const closed = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  closed.classList.add('folder-icon-svg', 'folder-icon-closed');
  closed.setAttribute('viewBox', '0 0 24 24');
  closed.innerHTML = '<path d="M2.5 6.25A2.25 2.25 0 0 1 4.75 4h4.1l2 2H19.25A2.25 2.25 0 0 1 21.5 8.25v9A2.25 2.25 0 0 1 19.25 19H4.75A2.25 2.25 0 0 1 2.5 16.75z"/>';

  const open = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  open.classList.add('folder-icon-svg', 'folder-icon-open');
  open.setAttribute('viewBox', '0 0 24 24');
  open.innerHTML = '<path d="M2.75 7V6.25A2.25 2.25 0 0 1 5 4h3.7l2 2H19a2 2 0 0 1 2 2v.65H6.1A2.4 2.4 0 0 0 3.8 10.4L2.75 14z"/><path d="M5.1 9.5h15.65c.7 0 1.2.68 1 1.35l-1.8 6.15A2.75 2.75 0 0 1 17.3 19H4.5a2 2 0 0 1-1.92-2.56l1.12-4.9A1.45 1.45 0 0 1 5.1 9.5z"/>';

  wrapper.append(closed, open);
  return wrapper;
}

function createThumbnailPlaceholder(file) {
  const placeholder = document.createElement('span');
  placeholder.className = 'file-thumbnail-placeholder';
  placeholder.textContent = file.type === 'image' ? '▧' : '▶';
  return placeholder;
}

function setThumbnailImage(container, src, file) {
  const image = new Image();
  image.alt = `${file.name} のサムネイル`;
  image.addEventListener('load', () => {
    container.replaceChildren(image);
    container.classList.remove('loading');
  }, { once: true });
  image.addEventListener('error', () => {
    container.replaceChildren(createThumbnailPlaceholder(file));
    container.classList.remove('loading');
  }, { once: true });
  image.src = src;
}

function pumpThumbnailQueue() {
  while (activeThumbnailJobs < MAX_THUMBNAIL_JOBS && thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    if (job.token !== thumbnailLoadToken) continue;
    activeThumbnailJobs += 1;
    window.mediaExplorer.getListThumbnail(job.file.path, job.file.type)
      .then((result) => {
        if (job.token !== thumbnailLoadToken) return;
        if (result?.ok && result.dataUrl) setThumbnailImage(job.container, result.dataUrl, job.file);
        else job.container.classList.remove('loading');
      })
      .catch(() => job.container.classList.remove('loading'))
      .finally(() => {
        activeThumbnailJobs -= 1;
        pumpThumbnailQueue();
      });
  }
}

function loadFileThumbnail(file, container, token) {
  container.classList.add('loading');
  thumbnailQueue.push({ file, container, token });
  pumpThumbnailQueue();
}

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
  const icon = createFolderIcon();
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
      toggle.setAttribute('aria-label', '展開');
      toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    node.classList.add('expanded');
    toggle.setAttribute('aria-label', '折りたたむ');
    toggle.setAttribute('aria-expanded', 'true');
    if (node.dataset.loaded === 'true') return;
    toggle.classList.add('loading');
    try {
      const directories = await window.mediaExplorer.getDirectories(item.path);
      directories.forEach((directory) => children.append(createTreeNode(directory, depth + 1)));
      node.dataset.loaded = 'true';
      if (!directories.length) toggle.style.visibility = 'hidden';
    } catch (error) {
      node.classList.remove('expanded');
      alert(`フォルダーを開けませんでした、En${error.message}`);
    } finally {
      toggle.classList.remove('loading');
    }
  }

  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', (event) => { event.stopPropagation(); expand(); });
  row.addEventListener('click', () => {
    if (selectedTreeRow !== row) selectFolder(item.path, row);
    expand();
  });
  return node;
}

async function selectFolder(folderPath, row) {
  const thumbnailToken = ++thumbnailLoadToken;
  thumbnailQueue.length = 0;
  if (selectedTreeRow) selectedTreeRow.classList.remove('selected');
  selectedTreeRow = row;
  selectedFileRow = null;
  row.classList.add('selected');
  currentPath.textContent = folderPath;
  currentPath.title = folderPath;
  fileList.replaceChildren();
  fileEmpty.textContent = '読み込み中…';
  fileCount.textContent = '…';
  clearPreview();
  try {
    const files = await window.mediaExplorer.getMediaFiles(folderPath);
    if (thumbnailToken !== thumbnailLoadToken) return;
    fileCount.textContent = `${files.length}件`;
    fileEmpty.textContent = files.length ? '' : 'こ�Eフォルダに対応する画像�E動画はありません';
    files.forEach((file) => fileList.append(createFileRow(file, thumbnailToken)));
  } catch (error) {
    if (thumbnailToken !== thumbnailLoadToken) return;
    fileCount.textContent = '0件';
    fileEmpty.textContent = 'フォルダを読み込めませんでした';
    showError(fileList, error);
  }
}

function createFileRow(file, thumbnailToken) {
  const row = document.createElement('div');
  row.className = 'file-row';
  row.title = file.path;

  const thumbnail = document.createElement('div');
  thumbnail.className = 'file-thumbnail';
  thumbnail.append(createThumbnailPlaceholder(file));

  const details = document.createElement('div');
  details.className = 'file-details';
  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = file.name;
  const meta = document.createElement('div');
  meta.className = 'file-meta';
  meta.textContent = `${file.type === 'image' ? '画僁E : '動画'} · ${formatBytes(file.size)}`;
  details.append(name, meta);
  row.append(thumbnail, details);
  loadFileThumbnail(file, thumbnail, thumbnailToken);

  row.addEventListener('click', () => {
    if (selectedFileRow) selectedFileRow.classList.remove('selected');
    selectedFileRow = row;
    row.classList.add('selected');
    selectFile(file);
  });
  if (file.type === 'video') {
    row.addEventListener('dblclick', async () => {
      const result = await window.mediaExplorer.openVideo(file.path);
      if (!result.ok) alert(`既定�Eアプリで動画を開けませんでした、En${result.error}`);
    });
  } else {
    row.addEventListener('dblclick', () => openImageViewer(file));
  }
  return row;
}

function clearPreview() {
  generationToken += 1;
  selectedFile = null;
  selectedName.textContent = 'ファイル未選抁E;
  intervalControl.classList.add('hidden');
  previewContent.innerHTML = '<div class="preview-placeholder">画像また�E動画をクリチE��すると<br>ここに表示されまぁE/div>';
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
    image.title = 'クリチE��で全画面表示';
    image.onerror = () => showError(previewContent, new Error('画像を表示できませんでした、E));
    image.addEventListener('click', () => openImageViewer(file));
    previewContent.append(image);
  } else {
    intervalControl.classList.remove('hidden');
    renderVideo(file);
  }
}

function once(target, eventName) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('動画を読み込めませんでした、Electronが対応してぁE��ぁE��ーチE��クの可能性があります、E)); };
    const cleanup = () => { target.removeEventListener(eventName, onSuccess); target.removeEventListener('error', onError); };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function renderVideo(file) {
  const token = ++generationToken;
  previewContent.replaceChildren();
  const player = document.createElement('video');
  player.className = 'video-player';
  player.controls = true;
  player.preload = 'metadata';
  player.src = file.url;
  const status = document.createElement('div');
  status.className = 'generation-status';
  const statusText = document.createElement('span');
  statusText.textContent = '動画を読み込み中…';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cancel-button';
  cancel.textContent = '生�Eを中止';
  cancel.addEventListener('click', () => { generationToken += 1; statusText.textContent = 'サムネイル生�Eを中止しました'; cancel.remove(); });
  status.append(statusText, cancel);
  const grid = document.createElement('div');
  grid.className = 'thumbnail-grid';
  previewContent.append(player, status, grid);

  try {
    await once(player, 'loadedmetadata');
    if (token !== generationToken) return;
    if (!Number.isFinite(player.duration) || player.duration <= 0) throw new Error('動画の長さを取得できませんでした、E);
    const interval = Number(intervalSelect.value);
    const times = [];
    for (let time = 0; time < player.duration; time += interval) times.push(time);
    statusText.textContent = `0 / ${times.length}枚を生�E中`;

    for (let index = 0; index < times.length; index += 1) {
      if (token !== generationToken) return;
      const result = await window.mediaExplorer.getVideoThumbnail(file.path, times[index]);
      if (token !== generationToken) return;
      if (!result?.ok) throw new Error(result?.error || 'サムネイルを生成できませんでした、E);

      const card = document.createElement('div');
      card.className = 'thumbnail-card';
      const image = new Image();
      image.alt = `${formatTime(times[index])} のサムネイル`;
      image.src = `data:${result.mime};base64,${result.data}`;
      const timeLabel = document.createElement('div');
      timeLabel.className = 'thumbnail-time';
      timeLabel.textContent = formatTime(times[index]);
      card.append(image, timeLabel);
      grid.append(card);
      statusText.textContent = `${index + 1} / ${times.length}枚を生�E中`;
      if (index % 4 === 3) await new Promise(requestAnimationFrame);
    }
    if (token === generationToken) {
      statusText.textContent = `${times.length}枚�Eサムネイルを生成しました`;
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
