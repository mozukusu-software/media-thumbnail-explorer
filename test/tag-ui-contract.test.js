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


test('file list renders tag names in a dedicated Tags column', () => {
  assert.match(app, /file-tags-column/);
  assert.match(app, /tagColumn\.textContent = tags\.map\(\(tag\) => tag\.name\)\.join\(', '\)/);
  assert.match(css, /grid-template-columns:\s*68px\s+minmax\(0, 1fr\)\s+minmax\(90px, 28%\)/);
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
