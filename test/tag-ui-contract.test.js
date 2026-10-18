const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');

function includesAll(text, fragments) { for (const fragment of fragments) assert.ok(text.includes(fragment), `missing: ${fragment}`); }

test('tag filter is permanently available below folder tree with AND/OR and draggable splitter', () => {
  includesAll(html, ['id="folderTagSplitter"', 'id="tagSearchInput"', 'value="and"', 'value="or"', 'id="tagFilterList"']);
  includesAll(app, ["folderTagSplitter.addEventListener('pointerdown'", "tagMatchMode === 'or'", "tagSearchInput.addEventListener('input'"]);
  includesAll(css, ['.folder-section', 'flex: 0 0 65%', '.folder-tag-splitter', 'cursor: row-resize']);
});

test('file context menu opens bulk tag editor with comma input and tri-state existing tags', () => {
  includesAll(html, ['タグを追加・削除...', 'id="tagEditNewTags"', 'id="tagEditExistingTags"']);
  includesAll(app, ["row.addEventListener('contextmenu'", 'checkbox.indeterminate', "checkbox.dataset.initial =", 'updateTagsForFiles']);
  includesAll(preload, ['updateTagsForFiles']);
});

test('multi-selection supports Ctrl and Shift and tag badges are rendered', () => {
  includesAll(app, ['event.shiftKey', 'event.ctrlKey', 'selectedFilePaths', "badge.className = 'file-tag-badge'", "badge.textContent = `🏷 ${tags.length}`"]);
});

test('preview uses one-line tag summary with overflow count instead of editable checkboxes', () => {
  includesAll(app, ["more.textContent = `ほか${hiddenCount}個`", "chip.className = 'preview-tag-name'"]);
  assert.ok(!html.includes('タグを作成するとここで設定できます'));
  includesAll(css, ['.selected-file-tags', 'white-space: nowrap', 'overflow: hidden']);
});



test('file list keeps filename on the first line and type, size, and tags together on the second line', () => {
  includesAll(app, [
    "const tagSummary = tags.length ? tags.map((tag) => tag.name).join(', ') : '—';",
    "meta.textContent = `${file.type === 'image' ? '画像' : '動画'} · ${formatBytes(file.size)} · ${tagSummary}`;",
    "row.append(thumbnail, details)"
  ]);
  assert.doesNotMatch(app, /file-tags-column|tagColumn/);
  includesAll(css, [
    '.file-row { display: grid; grid-template-columns: 68px minmax(0, 1fr);',
    '.file-meta { margin-top: 3px; overflow: hidden;'
  ]);
  assert.doesNotMatch(css, /\.file-tags-column/);
});


test('folder/tag splitter ratio persists and is restored on startup', () => {
  includesAll(app, [
    "FOLDER_TAG_SPLIT_STORAGE_KEY = 'media-thumbnail-explorer:folder-tag-split-ratio'",
    'saveFolderTagSplitRatio()',
    'restoreFolderTagSplitRatio()',
    "folderTagSplitter.addEventListener('pointerup', finishSplitterDrag)",
    "folderTagSplitter.addEventListener('pointercancel', finishSplitterDrag)",
    'localStorage.setItem(FOLDER_TAG_SPLIT_STORAGE_KEY, String(ratio))',
    'restoreFolderTagSplitRatio();'
  ]);
});

test('tag editor supports Enter save without swallowing IME composition', () => {
  includesAll(app, [
    "tagEditSave.addEventListener('click', saveTagEdits)",
    "tagEditNewTags.addEventListener('keydown'",
    "event.key !== 'Enter' || event.isComposing || event.keyCode === 229",
    'saveTagEdits();'
  ]);
});

test('tag editor is modal against outside clicks and provides permanent tag deletion confirmation', () => {
  includesAll(html, [
    'id="tagDeleteConfirmDialog"',
    'id="tagDeleteConfirmMessage"',
    'id="tagDeleteNo"',
    'id="tagDeleteYes"',
    '>しない<',
    '>する<'
  ]);
  includesAll(app, [
    'createTagDeleteButton(tag, row)',
    'window.mediaExplorer.deleteTag(tag.id)',
    'タグ「${tag.name}」を削除しますか？',
    "tagDeleteConfirmDialog.classList.contains('hidden')"
  ]);
  assert.ok(!app.includes("tagEditDialog.addEventListener('click', (event) => { if (event.target === tagEditDialog) closeTagEditDialog(); });"));
  includesAll(css, ['.tag-delete-button', '.tag-delete-confirm-dialog', 'z-index: 1500']);
});

test('tag editor keeps the new-tag input focused when the modal backdrop is clicked', () => {
  includesAll(app, [
    "tagEditDialog.addEventListener('pointerdown'",
    'event.target !== tagEditDialog',
    'event.preventDefault();',
    'tagEditNewTags.focus({ preventScroll: true });'
  ]);
});

test('workspace has draggable persistent splitters between folder, media, and preview panes', () => {
  includesAll(html, [
    'id="folderFileSplitter"',
    'id="filePreviewSplitter"',
    'aria-orientation="vertical"'
  ]);
  includesAll(css, [
    '.workspace-splitter',
    'cursor: col-resize',
    'minmax(300px, 1fr)'
  ]);
  includesAll(app, [
    "WORKSPACE_SPLIT_STORAGE_KEY = 'media-thumbnail-explorer:workspace-split-ratios'",
    "folderFileSplitter.addEventListener('pointerdown'",
    "filePreviewSplitter.addEventListener('pointerdown'",
    'applyWorkspaceWidths(',
    'saveWorkspaceSplitRatios()',
    'restoreWorkspaceSplitRatios()',
    'restoreWorkspaceSplitRatios();'
  ]);
});


test('workspace splitters coexist with the two-line media-row layout', () => {
  includesAll(css, [
    '.workspace-splitter',
    'grid-template-columns: minmax(210px, 17vw) 7px minmax(260px, 23vw) 7px minmax(300px, 1fr);',
    '.file-row { display: grid; grid-template-columns: 68px minmax(0, 1fr);'
  ]);
  assert.doesNotMatch(css, /@container media-file-pane \(max-width: 440px\)/);
  assert.doesNotMatch(css, /container-name:\s*media-file-pane/);
});
