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
const tagFilterList = document.querySelector('#tagFilterList');
const tagSearchInput = document.querySelector('#tagSearchInput');
const tagFilterClear = document.querySelector('#tagFilterClear');
const selectedFileTags = document.querySelector('#selectedFileTags');
const workspace = document.querySelector('.workspace');
const folderPane = document.querySelector('.folder-pane');
const filePane = document.querySelector('.file-pane');
const previewPane = document.querySelector('.preview-pane');
const folderFileSplitter = document.querySelector('#folderFileSplitter');
const filePreviewSplitter = document.querySelector('#filePreviewSplitter');
const folderSection = document.querySelector('#folderSection');
const folderTagSplitter = document.querySelector('#folderTagSplitter');
const fileContextMenu = document.querySelector('#fileContextMenu');
const editTagsMenuItem = document.querySelector('#editTagsMenuItem');
const tagEditDialog = document.querySelector('#tagEditDialog');
const tagEditTargetSummary = document.querySelector('#tagEditTargetSummary');
const tagEditNewTags = document.querySelector('#tagEditNewTags');
const tagEditExistingTags = document.querySelector('#tagEditExistingTags');
const tagEditError = document.querySelector('#tagEditError');
const tagEditCancel = document.querySelector('#tagEditCancel');
const tagEditSave = document.querySelector('#tagEditSave');
const tagDeleteConfirmDialog = document.querySelector('#tagDeleteConfirmDialog');
const tagDeleteConfirmMessage = document.querySelector('#tagDeleteConfirmMessage');
const tagDeleteConfirmError = document.querySelector('#tagDeleteConfirmError');
const tagDeleteNo = document.querySelector('#tagDeleteNo');
const tagDeleteYes = document.querySelector('#tagDeleteYes');

let selectedTreeRow = null;
let selectedFileRow = null;
let selectedFile = null;
const selectedFilePaths = new Set();
let selectionAnchorPath = null;
let contextMenuFile = null;
let tagMatchMode = 'and';
let currentFolderFiles = [];
let allTags = [];
let tagsByPath = {};
const activeTagIds = new Set();
let imageViewerFile = null;
let generationToken = 0;
let activePreviewThumbnailJobId = null;
const activeListThumbnailJobIds = new Set();
let listThumbnailJobSequence = 0;
let thumbnailLoadToken = 0;
let activeThumbnailJobs = 0;
const thumbnailQueue = [];
const MAX_THUMBNAIL_JOBS = 2;
const LAST_FOLDER_STORAGE_KEY = 'media-thumbnail-explorer:last-folder';
const VIDEO_AUDIO_STORAGE_KEY = 'media-thumbnail-explorer:video-audio';
const FOLDER_TAG_SPLIT_STORAGE_KEY = 'media-thumbnail-explorer:folder-tag-split-ratio';
const WORKSPACE_SPLIT_STORAGE_KEY = 'media-thumbnail-explorer:workspace-split-ratios';
const WORKSPACE_SPLITTER_WIDTH = 7;
const MIN_FOLDER_PANE_WIDTH = 210;
const MIN_FILE_PANE_WIDTH = 260;
const MIN_PREVIEW_PANE_WIDTH = 300;
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

function clampFolderSectionHeight(height) {
  const paneHeight = folderPane.getBoundingClientRect().height;
  const min = 120;
  const max = Math.max(min, paneHeight - 140);
  return Math.max(min, Math.min(max, height));
}

function saveFolderTagSplitRatio() {
  try {
    const paneHeight = folderPane.getBoundingClientRect().height;
    if (paneHeight <= 0) return;
    const ratio = folderSection.getBoundingClientRect().height / paneHeight;
    localStorage.setItem(FOLDER_TAG_SPLIT_STORAGE_KEY, String(ratio));
  } catch {
    // Keep the current layout even if persistent storage is unavailable.
  }
}

function restoreFolderTagSplitRatio() {
  try {
    const ratio = Number(localStorage.getItem(FOLDER_TAG_SPLIT_STORAGE_KEY));
    const paneHeight = folderPane.getBoundingClientRect().height;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1 || paneHeight <= 0) return;
    folderSection.style.flexBasis = `${clampFolderSectionHeight(paneHeight * ratio)}px`;
  } catch {
    // Fall back to the CSS default split.
  }
}

function clampWorkspaceWidths(folderWidth, fileWidth) {
  const total = workspace.getBoundingClientRect().width;
  const available = Math.max(0, total - WORKSPACE_SPLITTER_WIDTH * 2);
  if (available < MIN_FOLDER_PANE_WIDTH + MIN_FILE_PANE_WIDTH + MIN_PREVIEW_PANE_WIDTH) {
    return { folderWidth: Math.max(0, folderWidth), fileWidth: Math.max(0, fileWidth) };
  }
  const maxFolder = available - MIN_FILE_PANE_WIDTH - MIN_PREVIEW_PANE_WIDTH;
  const nextFolder = Math.max(MIN_FOLDER_PANE_WIDTH, Math.min(maxFolder, folderWidth));
  const maxFile = available - nextFolder - MIN_PREVIEW_PANE_WIDTH;
  const nextFile = Math.max(MIN_FILE_PANE_WIDTH, Math.min(maxFile, fileWidth));
  return { folderWidth: nextFolder, fileWidth: nextFile };
}

function applyWorkspaceWidths(folderWidth, fileWidth) {
  const next = clampWorkspaceWidths(folderWidth, fileWidth);
  workspace.style.gridTemplateColumns = `${next.folderWidth}px ${WORKSPACE_SPLITTER_WIDTH}px ${next.fileWidth}px ${WORKSPACE_SPLITTER_WIDTH}px minmax(${MIN_PREVIEW_PANE_WIDTH}px, 1fr)`;
}

function saveWorkspaceSplitRatios() {
  try {
    const total = workspace.getBoundingClientRect().width;
    if (total <= 0) return;
    localStorage.setItem(WORKSPACE_SPLIT_STORAGE_KEY, JSON.stringify({
      folder: folderPane.getBoundingClientRect().width / total,
      file: filePane.getBoundingClientRect().width / total
    }));
  } catch {
    // Keep the current layout even if persistent storage is unavailable.
  }
}

function restoreWorkspaceSplitRatios() {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_SPLIT_STORAGE_KEY));
    const total = workspace.getBoundingClientRect().width;
    if (!Number.isFinite(stored?.folder) || !Number.isFinite(stored?.file) || total <= 0) return;
    applyWorkspaceWidths(total * stored.folder, total * stored.file);
  } catch {
    // Fall back to the CSS default split.
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
    const badge = container.querySelector('.file-tag-badge');
    container.replaceChildren(createThumbnailPlaceholder(file));
    if (badge) container.append(badge);
    container.classList.remove('loading');
  }, { once: true });

  // Put the image in the document before assigning src. This avoids relying on
  // detached-image loading semantics and keeps the loading state visible.
  const badge = container.querySelector('.file-tag-badge');
  container.replaceChildren(image);
  if (badge) container.append(badge);
  image.src = src;
}

function setThumbnailError(container, file, errorMessage) {
  container.replaceChildren(createThumbnailPlaceholder(file));
  container.classList.remove('loading');
  if (errorMessage) {
    const message = `サムネイルを生成できませんでした: ${errorMessage}`;
    container.title = message;
    container.setAttribute('aria-label', `${file.name}: ${message}`);
  }
}

function pumpThumbnailQueue() {
  while (activeThumbnailJobs < MAX_THUMBNAIL_JOBS && thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    if (job.token !== thumbnailLoadToken) continue;
    activeThumbnailJobs += 1;
    const jobId = `list-${job.token}-${++listThumbnailJobSequence}`;
    activeListThumbnailJobIds.add(jobId);
    window.mediaExplorer.getListThumbnail(job.file.path, job.file.type, jobId)
      .then((result) => {
        if (job.token !== thumbnailLoadToken) return;
        if (result?.ok && result.dataUrl) setThumbnailImage(job.container, result.dataUrl, job.file);
        else setThumbnailError(job.container, job.file, result?.error || '原因を取得できませんでした。');
      })
      .catch((error) => setThumbnailError(job.container, job.file, error?.message || '原因を取得できませんでした。'))
      .finally(() => {
        activeListThumbnailJobIds.delete(jobId);
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


function getFileTags(filePath) {
  const direct = tagsByPath[filePath];
  if (direct) return direct;
  const normalized = filePath.toLowerCase();
  const key = Object.keys(tagsByPath).find((candidate) => candidate.toLowerCase() === normalized);
  return key ? tagsByPath[key] : [];
}

function fileMatchesActiveTags(file) {
  if (!activeTagIds.size) return true;
  const fileTagIds = new Set(getFileTags(file.path).map((tag) => tag.id));
  const selectedIds = [...activeTagIds];
  return tagMatchMode === 'or'
    ? selectedIds.some((tagId) => fileTagIds.has(tagId))
    : selectedIds.every((tagId) => fileTagIds.has(tagId));
}

function getVisibleFiles() {
  return currentFolderFiles.filter(fileMatchesActiveTags);
}

function renderCurrentFolderFiles() {
  const thumbnailToken = ++thumbnailLoadToken;
  thumbnailQueue.length = 0;
  for (const jobId of activeListThumbnailJobIds) window.mediaExplorer.cancelListThumbnail(jobId).catch(() => {});
  fileList.replaceChildren();
  const visibleFiles = getVisibleFiles();
  fileCount.textContent = activeTagIds.size ? `${visibleFiles.length}/${currentFolderFiles.length}件` : `${visibleFiles.length}件`;
  fileEmpty.textContent = visibleFiles.length ? '' : (currentFolderFiles.length ? '選択したタグに一致するファイルはありません' : 'このフォルダに対応する画像・動画はありません');
  visibleFiles.forEach((file) => fileList.append(createFileRow(file, thumbnailToken)));
}

function renderTagFilters() {
  tagFilterList.replaceChildren();
  const query = tagSearchInput.value.trim().toLocaleLowerCase('ja');
  const visibleTags = allTags.filter((tag) => !query || tag.name.toLocaleLowerCase('ja').includes(query));
  if (!visibleTags.length) {
    const empty = document.createElement('span');
    empty.className = 'tag-empty';
    empty.textContent = allTags.length ? '一致するタグなし' : 'タグなし';
    tagFilterList.append(empty);
    return;
  }
  for (const tag of visibleTags) {
    const label = document.createElement('label');
    label.className = 'tag-filter-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = activeTagIds.has(tag.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) activeTagIds.add(tag.id); else activeTagIds.delete(tag.id);
      renderCurrentFolderFiles();
    });
    const text = document.createElement('span');
    text.textContent = tag.name;
    label.append(checkbox, text);
    tagFilterList.append(label);
  }
}

function renderSelectedFileTags() {
  selectedFileTags.replaceChildren();
  if (!selectedFile) {
    selectedFileTags.classList.add('hidden');
    return;
  }
  const tags = getFileTags(selectedFile.path);
  if (!tags.length) {
    selectedFileTags.classList.add('hidden');
    return;
  }
  selectedFileTags.classList.remove('hidden');
  const icon = document.createElement('span');
  icon.className = 'preview-tag-icon';
  icon.textContent = '🏷';
  selectedFileTags.append(icon);
  const more = document.createElement('span');
  more.className = 'preview-tag-more hidden';
  selectedFileTags.append(more);
  const chips = tags.map((tag) => {
    const chip = document.createElement('span');
    chip.className = 'preview-tag-name';
    chip.textContent = tag.name;
    chip.title = tag.name;
    selectedFileTags.insertBefore(chip, more);
    return chip;
  });
  requestAnimationFrame(() => {
    chips.forEach((chip) => chip.classList.remove('hidden'));
    more.classList.add('hidden');
    let hiddenCount = 0;
    while (selectedFileTags.scrollWidth > selectedFileTags.clientWidth && chips.length - hiddenCount > 0) {
      hiddenCount += 1;
      chips[chips.length - hiddenCount].classList.add('hidden');
      more.textContent = `ほか${hiddenCount}個`;
      more.classList.remove('hidden');
    }
    more.title = hiddenCount ? tags.slice(tags.length - hiddenCount).map((tag) => tag.name).join('\n') : '';
  });
}

async function refreshTagAssignments() {
  tagsByPath = currentFolderFiles.length ? await window.mediaExplorer.getTagsForPaths(currentFolderFiles.map((file) => file.path)) : {};
  renderCurrentFolderFiles();
  renderSelectedFileTags();
}

async function refreshTags() {
  allTags = await window.mediaExplorer.getTags();
  const validIds = new Set(allTags.map((tag) => tag.id));
  for (const tagId of [...activeTagIds]) if (!validIds.has(tagId)) activeTagIds.delete(tagId);
  renderTagFilters();
  renderSelectedFileTags();
}

tagSearchInput.addEventListener('input', renderTagFilters);
tagFilterClear.addEventListener('click', () => {
  activeTagIds.clear();
  renderTagFilters();
  renderCurrentFolderFiles();
});
document.querySelectorAll('input[name="tagMatchMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    tagMatchMode = radio.value === 'or' ? 'or' : 'and';
    renderCurrentFolderFiles();
  });
});

function updateFileSelectionUi() {
  for (const row of fileList.querySelectorAll('.file-row')) row.classList.toggle('selected', selectedFilePaths.has(row.dataset.path));
}

function selectFileFromRow(file, row, event) {
  const visibleFiles = getVisibleFiles();
  if (event.shiftKey && selectionAnchorPath) {
    const anchorIndex = visibleFiles.findIndex((item) => item.path === selectionAnchorPath);
    const currentIndex = visibleFiles.findIndex((item) => item.path === file.path);
    if (anchorIndex >= 0 && currentIndex >= 0) {
      if (!event.ctrlKey) selectedFilePaths.clear();
      const [start, end] = anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
      visibleFiles.slice(start, end + 1).forEach((item) => selectedFilePaths.add(item.path));
    }
  } else if (event.ctrlKey) {
    if (selectedFilePaths.has(file.path)) selectedFilePaths.delete(file.path); else selectedFilePaths.add(file.path);
    selectionAnchorPath = file.path;
  } else {
    selectedFilePaths.clear();
    selectedFilePaths.add(file.path);
    selectionAnchorPath = file.path;
  }
  if (!selectedFilePaths.size) {
    selectedFileRow = null;
    clearPreview();
  } else {
    const previewFile = selectedFilePaths.has(file.path)
      ? file
      : currentFolderFiles.find((item) => selectedFilePaths.has(item.path));
    selectedFileRow = previewFile?.path === file.path ? row : null;
    if (previewFile) selectFile(previewFile);
  }
  updateFileSelectionUi();
}

function getSelectedFilesForContext(file) {
  if (!selectedFilePaths.has(file.path)) {
    selectedFilePaths.clear();
    selectedFilePaths.add(file.path);
    selectionAnchorPath = file.path;
    selectFile(file);
    updateFileSelectionUi();
  }
  return currentFolderFiles.filter((item) => selectedFilePaths.has(item.path));
}

function closeContextMenu() { fileContextMenu.classList.add('hidden'); }
function openContextMenu(file, x, y) {
  contextMenuFile = file;
  fileContextMenu.classList.remove('hidden');
  const rect = fileContextMenu.getBoundingClientRect();
  fileContextMenu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  fileContextMenu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  editTagsMenuItem.focus();
}

document.addEventListener('click', (event) => { if (!fileContextMenu.contains(event.target)) closeContextMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContextMenu(); });

function tagAssignmentCounts(files) {
  const counts = new Map(allTags.map((tag) => [tag.id, 0]));
  for (const file of files) for (const tag of getFileTags(file.path)) counts.set(tag.id, (counts.get(tag.id) || 0) + 1);
  return counts;
}

function openTagDeleteConfirm(tag, row) {
  tagDeleteConfirmDialog._tag = tag;
  tagDeleteConfirmDialog._row = row;
  tagDeleteConfirmMessage.textContent = `タグ「${tag.name}」を削除しますか？`;
  tagDeleteConfirmError.textContent = '';
  tagDeleteConfirmError.classList.add('hidden');
  tagDeleteConfirmDialog.classList.remove('hidden');
  tagDeleteNo.focus();
}

function closeTagDeleteConfirm() {
  tagDeleteConfirmDialog.classList.add('hidden');
  tagDeleteConfirmDialog._tag = null;
  tagDeleteConfirmDialog._row = null;
  if (!tagEditDialog.classList.contains('hidden')) tagEditNewTags.focus();
}

function createTagDeleteButton(tag, row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tag-delete-button';
  button.setAttribute('aria-label', `タグ「${tag.name}」を削除`);
  button.title = `タグ「${tag.name}」を削除`;
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTagDeleteConfirm(tag, row);
  });
  return button;
}

function appendEmptyExistingTagMessageIfNeeded() {
  if (tagEditExistingTags.querySelector('.tag-edit-item')) return;
  const empty = document.createElement('span');
  empty.className = 'tag-empty';
  empty.textContent = '既存タグなし';
  tagEditExistingTags.append(empty);
}

function openTagEditDialog(files) {
  const counts = tagAssignmentCounts(files);
  tagEditTargetSummary.textContent = files.length === 1 ? files[0].name : `${files.length}ファイルを選択中`;
  tagEditNewTags.value = '';
  tagEditExistingTags.replaceChildren();
  tagEditError.classList.add('hidden');
  tagEditError.textContent = '';
  for (const tag of allTags) {
    const row = document.createElement('div');
    row.className = 'tag-edit-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const count = counts.get(tag.id) || 0;
    checkbox.checked = count === files.length;
    checkbox.indeterminate = count > 0 && count < files.length;
    checkbox.dataset.tagId = String(tag.id);
    checkbox.dataset.initial = count === files.length ? 'checked' : count === 0 ? 'unchecked' : 'mixed';
    checkbox.dataset.touched = 'false';
    checkbox.addEventListener('change', () => { checkbox.indeterminate = false; checkbox.dataset.touched = 'true'; });
    const text = document.createElement('label');
    text.className = 'tag-edit-name';
    text.textContent = tag.name;
    const checkboxId = `tag-edit-${tag.id}`;
    checkbox.id = checkboxId;
    text.htmlFor = checkboxId;
    const countText = document.createElement('span');
    countText.className = 'tag-edit-count';
    countText.textContent = files.length > 1 && count > 0 && count < files.length ? `${count}/${files.length}` : '';
    row.append(checkbox, text, countText, createTagDeleteButton(tag, row));
    tagEditExistingTags.append(row);
  }
  appendEmptyExistingTagMessageIfNeeded();
  tagEditDialog._files = files;
  tagEditDialog.classList.remove('hidden');
  tagEditNewTags.focus();
}

function closeTagEditDialog() {
  if (!tagDeleteConfirmDialog.classList.contains('hidden')) return;
  tagEditDialog.classList.add('hidden');
  tagEditDialog._files = null;
}

editTagsMenuItem.addEventListener('click', () => {
  closeContextMenu();
  if (!contextMenuFile) return;
  openTagEditDialog(getSelectedFilesForContext(contextMenuFile));
});
tagEditCancel.addEventListener('click', closeTagEditDialog);
tagEditDialog.addEventListener('pointerdown', (event) => {
  if (event.target !== tagEditDialog || !tagDeleteConfirmDialog.classList.contains('hidden')) return;
  event.preventDefault();
  tagEditNewTags.focus({ preventScroll: true });
});
tagEditDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && tagDeleteConfirmDialog.classList.contains('hidden')) closeTagEditDialog();
});

tagDeleteNo.addEventListener('click', closeTagDeleteConfirm);
tagDeleteConfirmDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeTagDeleteConfirm();
  }
});
tagDeleteYes.addEventListener('click', async () => {
  const tag = tagDeleteConfirmDialog._tag;
  const row = tagDeleteConfirmDialog._row;
  if (!tag) return;
  tagDeleteYes.disabled = true;
  tagDeleteNo.disabled = true;
  try {
    await window.mediaExplorer.deleteTag(tag.id);
    row?.remove();
    appendEmptyExistingTagMessageIfNeeded();
    await refreshTags();
    await refreshTagAssignments();
    closeTagDeleteConfirm();
  } catch (error) {
    tagDeleteConfirmError.textContent = `タグを削除できませんでした。 ${error.message}`;
    tagDeleteConfirmError.classList.remove('hidden');
  } finally {
    tagDeleteYes.disabled = false;
    tagDeleteNo.disabled = false;
  }
});

async function saveTagEdits() {
  const files = tagEditDialog._files || [];
  if (!files.length || tagEditSave.disabled) return;
  const newTagNames = tagEditNewTags.value.split(/[,、]/).map((name) => name.trim()).filter(Boolean);
  const addTagIds = [];
  const removeTagIds = [];
  for (const checkbox of tagEditExistingTags.querySelectorAll('input[type="checkbox"]')) {
    const tagId = Number(checkbox.dataset.tagId);
    if (!Number.isSafeInteger(tagId) || tagId <= 0) continue;
    const initial = checkbox.dataset.initial;
    const touched = checkbox.dataset.touched === 'true';
    if (initial === 'mixed' && !touched) continue;
    if (checkbox.checked) addTagIds.push(tagId); else removeTagIds.push(tagId);
  }
  tagEditSave.disabled = true;
  tagEditCancel.disabled = true;
  try {
    await window.mediaExplorer.updateTagsForFiles(files, { addTagIds, removeTagIds, newTagNames });
    await refreshTags();
    await refreshTagAssignments();
    closeTagEditDialog();
  } catch (error) {
    tagEditError.textContent = `タグを更新できませんでした。 ${error.message}`;
    tagEditError.classList.remove('hidden');
  } finally {
    tagEditSave.disabled = false;
    tagEditCancel.disabled = false;
  }
}

tagEditSave.addEventListener('click', saveTagEdits);
tagEditNewTags.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  saveTagEdits();
});

let workspaceSplitterDrag = null;
function startWorkspaceSplitterDrag(kind, splitter, event) {
  workspaceSplitterDrag = {
    kind,
    splitter,
    startX: event.clientX,
    folderWidth: folderPane.getBoundingClientRect().width,
    fileWidth: filePane.getBoundingClientRect().width
  };
  splitter.classList.add('dragging');
  splitter.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function moveWorkspaceSplitter(event) {
  if (!workspaceSplitterDrag) return;
  const delta = event.clientX - workspaceSplitterDrag.startX;
  if (workspaceSplitterDrag.kind === 'folder-file') {
    applyWorkspaceWidths(workspaceSplitterDrag.folderWidth + delta, workspaceSplitterDrag.fileWidth);
  } else {
    applyWorkspaceWidths(workspaceSplitterDrag.folderWidth, workspaceSplitterDrag.fileWidth + delta);
  }
}
function finishWorkspaceSplitterDrag() {
  if (!workspaceSplitterDrag) return;
  workspaceSplitterDrag.splitter.classList.remove('dragging');
  workspaceSplitterDrag = null;
  saveWorkspaceSplitRatios();
}
function resizeWorkspaceWithKeyboard(kind, delta) {
  const folderWidth = folderPane.getBoundingClientRect().width;
  const fileWidth = filePane.getBoundingClientRect().width;
  if (kind === 'folder-file') applyWorkspaceWidths(folderWidth + delta, fileWidth);
  else applyWorkspaceWidths(folderWidth, fileWidth + delta);
  saveWorkspaceSplitRatios();
}
folderFileSplitter.addEventListener('pointerdown', (event) => startWorkspaceSplitterDrag('folder-file', folderFileSplitter, event));
filePreviewSplitter.addEventListener('pointerdown', (event) => startWorkspaceSplitterDrag('file-preview', filePreviewSplitter, event));
for (const splitter of [folderFileSplitter, filePreviewSplitter]) {
  splitter.addEventListener('pointermove', moveWorkspaceSplitter);
  splitter.addEventListener('pointerup', finishWorkspaceSplitterDrag);
  splitter.addEventListener('pointercancel', finishWorkspaceSplitterDrag);
  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    resizeWorkspaceWithKeyboard(splitter === folderFileSplitter ? 'folder-file' : 'file-preview', event.key === 'ArrowLeft' ? -20 : 20);
  });
}

let splitterDrag = null;
folderTagSplitter.addEventListener('pointerdown', (event) => {
  splitterDrag = { startY: event.clientY, startHeight: folderSection.getBoundingClientRect().height };
  folderTagSplitter.setPointerCapture(event.pointerId);
});
folderTagSplitter.addEventListener('pointermove', (event) => {
  if (!splitterDrag) return;
  const next = clampFolderSectionHeight(splitterDrag.startHeight + event.clientY - splitterDrag.startY);
  folderSection.style.flexBasis = `${next}px`;
});
function finishSplitterDrag() {
  if (!splitterDrag) return;
  splitterDrag = null;
  saveFolderTagSplitRatio();
}
folderTagSplitter.addEventListener('pointerup', finishSplitterDrag);
folderTagSplitter.addEventListener('pointercancel', finishSplitterDrag);
folderTagSplitter.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const delta = event.key === 'ArrowUp' ? -20 : 20;
  const next = clampFolderSectionHeight(folderSection.getBoundingClientRect().height + delta);
  folderSection.style.flexBasis = `${next}px`;
  saveFolderTagSplitRatio();
});

async function selectFolder(folderPath, row, { silent = false } = {}) {
  const thumbnailToken = ++thumbnailLoadToken;
  thumbnailQueue.length = 0;
  for (const jobId of activeListThumbnailJobIds) {
    window.mediaExplorer.cancelListThumbnail(jobId).catch(() => {});
  }
  try {
    const files = storageDataOrThrow(await window.mediaExplorer.getMediaFiles(folderPath));
    if (thumbnailToken !== thumbnailLoadToken) return false;

    if (selectedTreeRow && selectedTreeRow !== row) selectedTreeRow.classList.remove('selected');
    selectedTreeRow = row;
    row?.classList.add('selected');
    selectedFileRow = null;
    selectedFilePaths.clear();
    selectionAnchorPath = null;
    currentPath.value = folderPath;
    currentPath.title = folderPath;
    rememberFolder(folderPath);
    currentFolderFiles = files;
    tagsByPath = files.length
      ? await window.mediaExplorer.getTagsForPaths(files.map((file) => file.path))
      : {};
    clearPreview();
    renderCurrentFolderFiles();
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
  row.dataset.path = file.path;
  row.title = file.path;
  if (selectedFilePaths.has(file.path)) row.classList.add('selected');

  const thumbnail = document.createElement('div');
  thumbnail.className = 'file-thumbnail';
  thumbnail.append(createThumbnailPlaceholder(file));
  const tags = getFileTags(file.path);
  if (tags.length) {
    const badge = document.createElement('span');
    badge.className = 'file-tag-badge';
    badge.textContent = `🏷 ${tags.length}`;
    badge.title = tags.map((tag) => tag.name).join('\n');
    thumbnail.append(badge);
  }

  const details = document.createElement('div');
  details.className = 'file-details';
  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = file.name;
  const meta = document.createElement('div');
  meta.className = 'file-meta';
  const tagSummary = tags.length ? tags.map((tag) => tag.name).join(', ') : '—';
  meta.textContent = `${file.type === 'image' ? '画像' : '動画'} · ${formatBytes(file.size)} · ${tagSummary}`;
  meta.title = tags.length ? tags.map((tag) => tag.name).join('\n') : '';
  details.append(name, meta);

  row.append(thumbnail, details);
  loadFileThumbnail(file, thumbnail, thumbnailToken);

  row.addEventListener('click', (event) => selectFileFromRow(file, row, event));
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    getSelectedFilesForContext(file);
    openContextMenu(file, event.clientX, event.clientY);
  });
  if (file.type === 'video') {
    row.addEventListener('dblclick', async () => {
      const result = await window.mediaExplorer.openVideo(file.path);
      if (!result.ok) alert(`既定のアプリで動画を開けませんでした。
${result.error}`);
    });
  } else {
    row.addEventListener('dblclick', () => openImageViewer(file));
  }
  return row;
}

function cancelActivePreviewThumbnailJob() {
  const jobId = activePreviewThumbnailJobId;
  if (!jobId) return Promise.resolve(false);
  activePreviewThumbnailJobId = null;
  return window.mediaExplorer.cancelVideoThumbnail(jobId).catch(() => false);
}

function clearPreview() {
  generationToken += 1;
  cancelActivePreviewThumbnailJob();
  selectedFile = null;
  selectedName.textContent = 'ファイル未選択';
  renderSelectedFileTags();
  intervalControl.classList.add('hidden');
  previewContent.innerHTML = '<div class="preview-placeholder">画像または動画をクリックすると<br>ここに表示されます</div>';
}

function selectFile(file) {
  generationToken += 1;
  cancelActivePreviewThumbnailJob();
  selectedFile = file;
  selectedName.textContent = file.name;
  renderSelectedFileTags();
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
    const onError = () => { cleanup(); reject(new Error('動画を読み込めませんでした。Media Thumbnail Explorerが対応していないコーデック、または読み込めない動画形式の可能性があります。')); };
    const cleanup = () => { target.removeEventListener(eventName, onSuccess); target.removeEventListener('error', onError); };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function renderVideo(file) {
  const token = ++generationToken;
  previewContent.replaceChildren();
  if (!file.url) {
    showError(previewContent, new Error(file.playbackError || 'この動画を内蔵プレイヤーで再生できません。'));
    return;
  }
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
  cancel.addEventListener('click', () => {
    generationToken += 1;
    if (activePreviewThumbnailJobId) {
      window.mediaExplorer.cancelVideoThumbnail(activePreviewThumbnailJobId).catch(() => {});
      activePreviewThumbnailJobId = null;
    }
    statusText.textContent = 'サムネイル生成を中止しました';
    cancel.remove();
  });
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
      const jobId = `preview-${token}-${index}`;
      activePreviewThumbnailJobId = jobId;
      const result = await window.mediaExplorer.getVideoThumbnail(file.path, times[index], jobId);
      if (activePreviewThumbnailJobId === jobId) activePreviewThumbnailJobId = null;
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
  generationToken += 1;
  cancelActivePreviewThumbnailJob();
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
    restoreFolderTagSplitRatio();
    restoreWorkspaceSplitRatios();
    await refreshTags();
    const roots = await reloadRoots();
    if (!roots.length) return;
    await restoreRememberedFolder();
  } catch (error) {
    showError(tree, error);
  }
}

initialize();
