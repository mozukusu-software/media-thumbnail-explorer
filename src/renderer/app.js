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
const addNetworkRoot = document.querySelector('#addNetworkRoot');
const networkRootDialog = document.querySelector('#networkRootDialog');
const networkRootInput = document.querySelector('#networkRootInput');
const networkRootError = document.querySelector('#networkRootError');
const networkRootCancel = document.querySelector('#networkRootCancel');
const networkRootSubmit = document.querySelector('#networkRootSubmit');

let selectedTreeRow = null;
let selectedFileRow = null;
let selectedFile = null;
let currentFolderFiles = [];
let imageViewerFile = null;
let generationToken = 0;
let thumbnailLoadToken = 0;
let activeThumbnailJobs = 0;
const thumbnailQueue = [];
const MAX_THUMBNAIL_JOBS = 2;
const LAST_FOLDER_STORAGE_KEY = 'media-thumbnail-explorer:last-folder';
const VIDEO_AUDIO_STORAGE_KEY = 'media-thumbnail-explorer:video-audio';
const initialVideoAudio = loadVideoAudioPreference();
let videoVolume = initialVideoAudio.volume;
let videoMuted = initialVideoAudio.muted;

function loadVideoAudioPreference() {
  try {
    const stored = JSON.parse(localStorage.getItem(VIDEO_AUDIO_STORAGE_KEY));
    const volume = Number.isFinite(stored?.volume)
      ? Math.min(1, Math.max(0, stored.volume))
      : 1;
    const muted = typeof stored?.muted === 'boolean' ? stored.muted : false;
    return { volume, muted };
  } catch {
    return { volume: 1, muted: false };
  }
}

function saveVideoAudioPreference() {
  try {
    localStorage.setItem(VIDEO_AUDIO_STORAGE_KEY, JSON.stringify({
      volume: videoVolume,
      muted: videoMuted
    }));
  } catch {
    // Keep the in-memory preference even if persistent storage is unavailable.
  }
}

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

function getStorageErrorMessage(error) {
  switch (error?.type) {
    case 'access-denied':
      return 'このフォルダーへのアクセスが拒否されました。共有またはフォルダーのアクセス権を確認してください。';
    case 'not-found':
      return 'フォルダーが見つかりません。移動・削除されたか、共有先が現在利用できない可能性があります。';
    case 'unavailable':
      return 'ネットワークフォルダーに接続できません。接続先PC、ネットワーク、共有設定を確認してください。';
    case 'timeout':
      return 'ネットワークフォルダーから応答がありませんでした。接続先PCとネットワークを確認してください。';
    default:
      return 'フォルダーを開けませんでした。';
  }
}

function storageDataOrThrow(result) {
  if (result?.ok) return result.data;
  const error = new Error(getStorageErrorMessage(result?.error));
  error.storageError = result?.error || null;
  throw error;
}

function showImageInViewer(file) {
  imageViewerFile = file;
  imageViewerImage.src = file.url;
  imageViewerImage.alt = file.name;
  imageViewerName.textContent = file.name;
}

function openImageViewer(file) {
  showImageInViewer(file);
  imageViewer.classList.remove('hidden');
  imageViewerClose.focus();
  imageViewer.requestFullscreen?.().catch(() => { /* The in-window overlay remains available. */ });
}

function navigateImageViewer(direction) {
  if (!imageViewerFile) return;
  const images = currentFolderFiles.filter((file) => file.type === 'image');
  const currentIndex = images.findIndex((file) => file.path === imageViewerFile.path);
  if (currentIndex < 0) return;
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= images.length) return;
  showImageInViewer(images[nextIndex]);
}

async function closeImageViewer() {
  imageViewer.classList.add('hidden');
  imageViewerImage.removeAttribute('src');
  imageViewerFile = null;
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

imageViewerClose.addEventListener('click', closeImageViewer);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !imageViewer.classList.contains('hidden')) {
    closeImageViewer();
  }
});
document.addEventListener('keydown', (event) => {
  if (imageViewer.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    closeImageViewer();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigateImageViewer(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    navigateImageViewer(1);
  }
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
    container.classList.remove('loading');
  }, { once: true });
  image.addEventListener('error', () => {
    container.replaceChildren(createThumbnailPlaceholder(file));
    container.classList.remove('loading');
  }, { once: true });

  // Put the image in the document before assigning src. This avoids relying on
  // detached-image loading semantics and keeps the loading state visible.
  container.replaceChildren(image);
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
  toggle.setAttribute('aria-expanded', 'false');
  if (!item.hasChildren) {
    toggle.style.visibility = 'hidden';
    toggle.disabled = true;
  }
  const icon = createFolderIcon();
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = item.name;
  row.append(toggle, icon, label);
  if (item.networkRoot) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'network-root-remove';
    remove.textContent = '×';
    remove.title = 'UNC登録を解除';
    remove.setAttribute('aria-label', `${item.path} の登録を解除`);
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm(`${item.path} の登録を解除しますか？\n共有フォルダー内のファイルは削除されません。`)) return;
      const result = await window.mediaExplorer.removeNetworkRoot(item.path);
      if (!result?.ok) {
        alert(result?.error || 'UNC登録を解除できませんでした。');
        return;
      }
      if (selectedTreeRow && node.contains(selectedTreeRow)) {
        selectedTreeRow = null;
        currentPath.value = '';
        currentPath.title = '';
        fileList.replaceChildren();
        fileCount.textContent = '0件';
        fileEmpty.textContent = '左のツリーからフォルダを選択してください';
        clearPreview();
        forgetRememberedFolder();
      }
      node.remove();
    });
    row.append(remove);
  }

  const children = document.createElement('div');
  children.className = 'tree-children';
  node.append(row, children);

  async function expand(forceOpen = false, { silent = false } = {}) {
    if (!item.hasChildren) return false;
    if (node.classList.contains('expanded')) {
      if (forceOpen) return true;
      node.classList.remove('expanded');
      toggle.setAttribute('aria-label', '展開');
      toggle.setAttribute('aria-expanded', 'false');
      return false;
    }
    node.classList.add('expanded');
    toggle.setAttribute('aria-label', '折りたたむ');
    toggle.setAttribute('aria-expanded', 'true');
    if (node.dataset.loaded === 'true') return true;
    toggle.classList.add('loading');
    try {
      const directories = storageDataOrThrow(await window.mediaExplorer.getDirectories(item.path));
      directories.forEach((directory) => children.append(createTreeNode(directory, depth + 1)));
      node.dataset.loaded = 'true';
      if (!directories.length) {
        toggle.style.visibility = 'hidden';
        toggle.disabled = true;
      }
      return true;
    } catch (error) {
      node.classList.remove('expanded');
      toggle.setAttribute('aria-label', '展開');
      toggle.setAttribute('aria-expanded', 'false');
      if (!forceOpen && !silent) alert(`フォルダーを開けませんでした。\n${error.message}`);
      return false;
    } finally {
      toggle.classList.remove('loading');
    }
  }

  node._row = row;
  node._children = children;
  node._expand = expand;

  toggle.addEventListener('click', (event) => { event.stopPropagation(); expand(); });
  row.addEventListener('click', () => {
    const selecting = selectedTreeRow !== row;
    if (selecting) selectFolder(item.path, row);
    expand(false, { silent: selecting });
  });
  return node;
}

function rememberFolder(folderPath) {
  try {
    localStorage.setItem(LAST_FOLDER_STORAGE_KEY, folderPath);
  } catch {
    // Folder persistence is optional; browsing must continue if storage is unavailable.
  }
}

function forgetRememberedFolder() {
  try {
    localStorage.removeItem(LAST_FOLDER_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the normal initial state.
  }
}

function getRememberedFolder() {
  try {
    return localStorage.getItem(LAST_FOLDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function normalizeWindowsPath(folderPath) {
  return folderPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function buildWindowsFolderPath(rootPath, parts) {
  let current = rootPath;
  return parts.map((part) => {
    current = current.endsWith('\\') ? `${current}${part}` : `${current}\\${part}`;
    return current;
  });
}

async function restoreRememberedFolder() {
  const rememberedPath = getRememberedFolder();
  if (!rememberedPath) return;

  const normalizedRememberedPath = normalizeWindowsPath(rememberedPath);
  const rootNodes = Array.from(tree.children);
  const matchingRoots = rootNodes.filter((node) => {
    const rootPath = normalizeWindowsPath(node.dataset.path || '');
    return normalizedRememberedPath === rootPath || normalizedRememberedPath.startsWith(`${rootPath}/`);
  });
  matchingRoots.sort((a, b) => normalizeWindowsPath(b.dataset.path).length - normalizeWindowsPath(a.dataset.path).length);
  let currentNode = matchingRoots[0];

  if (!currentNode) {
    forgetRememberedFolder();
    return;
  }

  const rootPath = currentNode.dataset.path;
  const relativePath = rememberedPath.slice(rootPath.length).replace(/^\\+/, '');
  const parts = relativePath.split('\\').filter(Boolean);
  const targetPaths = [rootPath, ...buildWindowsFolderPath(rootPath, parts)];

  for (let index = 1; index < targetPaths.length; index += 1) {
    const opened = await currentNode._expand?.(true);
    if (!opened) {
      return;
    }
    const targetPath = targetPaths[index];
    currentNode = Array.from(currentNode._children?.children || []).find(
      (node) => normalizeWindowsPath(node.dataset.path || '') === normalizeWindowsPath(targetPath)
    );
    if (!currentNode) {
      return;
    }
  }

  await selectFolder(rememberedPath, currentNode._row, { silent: true });
  currentNode._row?.scrollIntoView({ block: 'nearest' });
}

async function selectFolder(folderPath, row, { silent = false } = {}) {
  const thumbnailToken = ++thumbnailLoadToken;
  thumbnailQueue.length = 0;
  try {
    const files = storageDataOrThrow(await window.mediaExplorer.getMediaFiles(folderPath));
    if (thumbnailToken !== thumbnailLoadToken) return false;

    if (selectedTreeRow && selectedTreeRow !== row) selectedTreeRow.classList.remove('selected');
    selectedTreeRow = row;
    row?.classList.add('selected');
    selectedFileRow = null;
    currentPath.value = folderPath;
    currentPath.title = folderPath;
    rememberFolder(folderPath);
    fileList.replaceChildren();
    currentFolderFiles = files;
    fileCount.textContent = `${files.length}件`;
    fileEmpty.textContent = files.length ? '' : 'このフォルダに対応する画像・動画はありません';
    clearPreview();
    files.forEach((file) => fileList.append(createFileRow(file, thumbnailToken)));
    return true;
  } catch (error) {
    if (thumbnailToken === thumbnailLoadToken) {
      console.error('Failed to open folder:', folderPath, error);
      if (!silent) alert(`フォルダーを開けませんでした。\n${folderPath}\n\n${error.message}`);
    }
    return false;
  }
}

async function findTreeNodeForPath(folderPath) {
  const normalizedTarget = normalizeWindowsPath(folderPath);
  const rootNodes = Array.from(tree.children).filter((node) => node.dataset.path);
  const matchingRoots = rootNodes.filter((node) => {
    const rootPath = normalizeWindowsPath(node.dataset.path);
    return normalizedTarget === rootPath || normalizedTarget.startsWith(`${rootPath}/`);
  });
  matchingRoots.sort((a, b) => normalizeWindowsPath(b.dataset.path).length - normalizeWindowsPath(a.dataset.path).length);
  let currentNode = matchingRoots[0];
  if (!currentNode) return null;

  const rootPath = currentNode.dataset.path;
  const relativePath = folderPath.slice(rootPath.length).replace(/^\\+/, '');
  const parts = relativePath.split('\\').filter(Boolean);
  const targetPaths = buildWindowsFolderPath(rootPath, parts);

  for (const targetPath of targetPaths) {
    const opened = await currentNode._expand?.(true);
    if (!opened) return null;
    currentNode = Array.from(currentNode._children?.children || []).find(
      (node) => normalizeWindowsPath(node.dataset.path || '') === normalizeWindowsPath(targetPath)
    );
    if (!currentNode) return null;
  }
  return currentNode;
}

function getUncShareRoot(folderPath) {
  const normalized = folderPath.trim().replaceAll('/', '\\');
  const match = normalized.match(/^\\\\([^\\]+)\\([^\\]+)/);
  return match ? `\\\\${match[1]}\\${match[2]}` : null;
}

async function navigateFromAddressBar() {
  const requestedPath = currentPath.value.trim();
  const previousPath = getRememberedFolder() || '';
  if (!requestedPath) {
    currentPath.value = previousPath;
    currentPath.title = previousPath;
    return;
  }

  try {
    let node = await findTreeNodeForPath(requestedPath);
    if (!node) {
      const uncRoot = getUncShareRoot(requestedPath);
      if (!uncRoot) throw new Error('登録済みのルート配下にフォルダーが見つかりません。');

      // Verify the requested folder before persisting a new UNC root.
      storageDataOrThrow(await window.mediaExplorer.getMediaFiles(requestedPath));
      const result = await window.mediaExplorer.addNetworkRoot(uncRoot);
      if (!result?.ok && result?.error !== 'このUNCパスはすでに登録されています。') {
        throw new Error(result?.error || 'UNCパスを登録できませんでした。');
      }
      await reloadRoots();
      node = await findTreeNodeForPath(requestedPath);
    }

    if (!node) throw new Error('フォルダーをツリーで開けませんでした。');
    const opened = await selectFolder(node.dataset.path, node._row);
    if (!opened) throw new Error('フォルダーを開けませんでした。');
    node._row?.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    currentPath.value = previousPath;
    currentPath.title = previousPath;
    alert(`フォルダーへ移動できませんでした。\n${requestedPath}\n\n${error.message}`);
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
  meta.textContent = `${file.type === 'image' ? '画像' : '動画'} · ${formatBytes(file.size)}`;
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
    image.title = 'クリックで全画面表示';
    image.onerror = () => showError(previewContent, new Error('画像を表示できませんでした。'));
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
    const onError = () => { cleanup(); reject(new Error('動画を読み込めませんでした。Electronが対応していないコーデックの可能性があります。')); };
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
  player.volume = videoVolume;
  player.muted = videoMuted;
  player.addEventListener('volumechange', () => {
    videoVolume = player.volume;
    videoMuted = player.muted;
    saveVideoAudioPreference();
  });
  player.src = file.url;
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
    await once(player, 'loadedmetadata');
    if (token !== generationToken) return;
    if (!Number.isFinite(player.duration) || player.duration <= 0) throw new Error('動画の長さを取得できませんでした。');
    const interval = Number(intervalSelect.value);
    const times = [];
    for (let time = 0; time < player.duration; time += interval) times.push(time);
    statusText.textContent = `0 / ${times.length}枚を生成中`;

    for (let index = 0; index < times.length; index += 1) {
      if (token !== generationToken) return;
      const result = await window.mediaExplorer.getVideoThumbnail(file.path, times[index]);
      if (token !== generationToken) return;
      if (!result?.ok) throw new Error(result?.error || 'サムネイルを生成できませんでした。');

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

currentPath.addEventListener('focus', () => currentPath.select());
currentPath.addEventListener('click', () => currentPath.select());
currentPath.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    navigateFromAddressBar();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    const previousPath = getRememberedFolder() || '';
    currentPath.value = previousPath;
    currentPath.title = previousPath;
    currentPath.blur();
  }
});

intervalSelect.addEventListener('change', () => {
  if (selectedFile?.type === 'video') renderVideo(selectedFile);
});

async function reloadRoots() {
  const roots = await window.mediaExplorer.getDrives();
  tree.replaceChildren();
  roots.forEach((root) => tree.append(createTreeNode(root)));
  if (!roots.length) tree.textContent = 'ドライブを取得できませんでした';
  return roots;
}

function closeNetworkRootDialog() {
  networkRootDialog.classList.add('hidden');
  networkRootError.classList.add('hidden');
  networkRootError.textContent = '';
  addNetworkRoot.focus();
}

function openNetworkRootDialog() {
  networkRootInput.value = '';
  networkRootError.classList.add('hidden');
  networkRootError.textContent = '';
  networkRootDialog.classList.remove('hidden');
  networkRootInput.focus();
}

async function submitNetworkRoot() {
  const input = networkRootInput.value.trim();
  if (!input) {
    networkRootError.textContent = 'UNCパスを入力してください。';
    networkRootError.classList.remove('hidden');
    networkRootInput.focus();
    return;
  }

  networkRootSubmit.disabled = true;
  networkRootCancel.disabled = true;
  try {
    const result = await window.mediaExplorer.addNetworkRoot(input);
    if (!result?.ok) {
      networkRootError.textContent = result?.error || 'UNCパスを登録できませんでした。';
      networkRootError.classList.remove('hidden');
      return;
    }
    tree.append(createTreeNode({ name: result.path, path: result.path, hasChildren: true, networkRoot: true }));
    closeNetworkRootDialog();
  } catch (error) {
    networkRootError.textContent = `UNCパスを登録できませんでした。 ${error.message}`;
    networkRootError.classList.remove('hidden');
  } finally {
    networkRootSubmit.disabled = false;
    networkRootCancel.disabled = false;
  }
}

addNetworkRoot.addEventListener('click', openNetworkRootDialog);
networkRootCancel.addEventListener('click', closeNetworkRootDialog);
networkRootSubmit.addEventListener('click', submitNetworkRoot);
networkRootInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitNetworkRoot();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeNetworkRootDialog();
  }
});
networkRootDialog.addEventListener('click', (event) => {
  if (event.target === networkRootDialog) closeNetworkRootDialog();
});

async function initialize() {
  try {
    const roots = await reloadRoots();
    if (!roots.length) return;
    await restoreRememberedFolder();
  } catch (error) {
    showError(tree, error);
  }
}

initialize();
