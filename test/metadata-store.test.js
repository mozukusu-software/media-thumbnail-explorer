const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MetadataStore } = require('../src/metadata/metadata-store');

function withStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mte-metadata-'));
  const dbPath = path.join(dir, 'mte.db');
  const store = new MetadataStore(dbPath);
  store.initialize();
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, dbPath };
}

test('creates schema v1 and persists tags', (t) => {
  const { store, dbPath } = withStore(t);
  assert.equal(store.getSchemaVersion(), 1);
  assert.deepEqual(store.createTag('旅行'), { id: 1, name: '旅行' });
  store.close();
  const reopened = new MetadataStore(dbPath);
  reopened.initialize();
  assert.deepEqual(reopened.getTags(), [{ id: 1, name: '旅行' }]);
  reopened.close();
});

test('tag names are trimmed and case-insensitive unique', (t) => {
  const { store } = withStore(t);
  const first = store.createTag(' Favorite ');
  const second = store.createTag('favorite');
  assert.equal(first.id, second.id);
  assert.equal(store.getTags().length, 1);
});

test('assigns multiple tags to a file and avoids duplicate assignments', (t) => {
  const { store } = withStore(t);
  const travel = store.createTag('旅行');
  const favorite = store.createTag('お気に入り');
  const file = { path: 'D:\\Media\\a.mp4', name: 'a.mp4', size: 123, mtimeMs: 456 };
  store.assignTag(file, travel.id);
  store.assignTag(file, travel.id);
  store.assignTag(file, favorite.id);
  assert.deepEqual(store.getTagsForPaths([file.path])[file.path], [
    { id: favorite.id, name: 'お気に入り' },
    { id: travel.id, name: '旅行' }
  ]);
});

test('unassigns tags and removes untagged file metadata', (t) => {
  const { store } = withStore(t);
  const tag = store.createTag('test');
  const file = { path: 'D:\\Media\\a.jpg', name: 'a.jpg', size: 1, mtimeMs: 2 };
  store.assignTag(file, tag.id);
  assert.equal(store.unassignTag(file.path, tag.id), true);
  assert.deepEqual(store.getTagsForPaths([file.path])[file.path], []);
});

test('deleting a tag cascades file_tags', (t) => {
  const { store } = withStore(t);
  const tag = store.createTag('delete-me');
  const file = { path: '\\\\server\\share\\a.mkv', name: 'a.mkv', size: 10, mtimeMs: 20 };
  store.assignTag(file, tag.id);
  assert.equal(store.deleteTag(tag.id), true);
  assert.deepEqual(store.getTagsForPaths([file.path])[file.path], []);
});

test('bulk tag update creates new tags, adds checked tags, removes unchecked tags, and preserves tag definitions', (t) => {
  const { store } = withStore(t);
  const travel = store.createTag('旅行');
  const favorite = store.createTag('お気に入り');
  const a = { path: 'D:\\Media\\a.jpg', name: 'a.jpg', size: 1, mtimeMs: 2 };
  const b = { path: 'D:\\Media\\b.jpg', name: 'b.jpg', size: 3, mtimeMs: 4 };
  store.assignTag(a, favorite.id);
  store.assignTag(b, favorite.id);

  store.updateTagsForFiles([a, b], {
    addTagIds: [travel.id],
    removeTagIds: [favorite.id],
    newTagNames: ['2026', ' 九州 ', '2026']
  });

  for (const file of [a, b]) {
    assert.deepEqual(store.getTagsForPaths([file.path])[file.path].map((tag) => tag.name), ['2026', '九州', '旅行']);
  }
  assert.ok(store.getTags().some((tag) => tag.id === favorite.id && tag.name === 'お気に入り'));
});
