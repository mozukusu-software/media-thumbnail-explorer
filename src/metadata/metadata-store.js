const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;
const PROVIDER_LOCAL = 'local';
const MAX_TAG_NAME_LENGTH = 64;

function normalizeTagName(name) {
  if (typeof name !== 'string') throw new TypeError('タグ名は文字列で指定してください。');
  const normalized = name.trim();
  if (!normalized) throw new Error('タグ名を入力してください。');
  if (normalized.length > MAX_TAG_NAME_LENGTH) throw new Error(`タグ名は${MAX_TAG_NAME_LENGTH}文字以内で指定してください。`);
  return normalized;
}

function validateFileInfo(file) {
  if (!file || typeof file !== 'object') throw new TypeError('ファイル情報が必要です。');
  if (typeof file.path !== 'string' || !file.path.trim()) throw new Error('ファイルパスが必要です。');
  return {
    path: path.win32.normalize(file.path),
    name: typeof file.name === 'string' && file.name ? file.name : path.win32.basename(file.path),
    size: Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : null,
    mtimeMs: Number.isFinite(file.mtimeMs) && file.mtimeMs >= 0 ? Math.trunc(file.mtimeMs) : null
  };
}

class MetadataStore {
  constructor(databasePath) {
    if (typeof databasePath !== 'string' || !databasePath) throw new Error('databasePath is required.');
    this.databasePath = databasePath;
    this.db = null;
  }

  initialize() {
    if (this.db) return;
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.#migrate();
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  #requireDb() {
    if (!this.db) throw new Error('MetadataStore is not initialized.');
    return this.db;
  }

  #migrate() {
    const db = this.#requireDb();
    const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(`Unsupported metadata schema version: ${currentVersion}`);
    }
    if (currentVersion === 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(`
          CREATE TABLE files (
            id INTEGER PRIMARY KEY,
            provider TEXT NOT NULL,
            path TEXT NOT NULL COLLATE NOCASE,
            name TEXT NOT NULL,
            size INTEGER,
            mtime_ms INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(provider, path)
          );

          CREATE TABLE tags (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            created_at INTEGER NOT NULL
          );

          CREATE TABLE file_tags (
            file_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(file_id, tag_id),
            FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
          );

          CREATE INDEX idx_file_tags_tag_id ON file_tags(tag_id);
        `);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  getSchemaVersion() {
    return this.#requireDb().prepare('PRAGMA user_version').get().user_version;
  }

  getTags() {
    return this.#requireDb().prepare('SELECT id, name FROM tags ORDER BY name COLLATE NOCASE').all()
      .map((row) => ({ id: row.id, name: row.name }));
  }

  createTag(name) {
    const normalized = normalizeTagName(name);
    const db = this.#requireDb();
    const existing = db.prepare('SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE').get(normalized);
    if (existing) return { id: existing.id, name: existing.name };
    const info = db.prepare('INSERT INTO tags(name, created_at) VALUES (?, ?)').run(normalized, Date.now());
    return { id: Number(info.lastInsertRowid), name: normalized };
  }

  deleteTag(tagId) {
    if (!Number.isSafeInteger(tagId) || tagId <= 0) throw new Error('Invalid tag id.');
    return this.#requireDb().prepare('DELETE FROM tags WHERE id = ?').run(tagId).changes > 0;
  }

  #upsertFile(provider, file) {
    const db = this.#requireDb();
    const normalizedProvider = typeof provider === 'string' && provider ? provider : PROVIDER_LOCAL;
    const normalized = validateFileInfo(file);
    const now = Date.now();
    db.prepare(`
      INSERT INTO files(provider, path, name, size, mtime_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, path) DO UPDATE SET
        name = excluded.name,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        updated_at = excluded.updated_at
    `).run(normalizedProvider, normalized.path, normalized.name, normalized.size, normalized.mtimeMs, now, now);
    return db.prepare('SELECT id FROM files WHERE provider = ? AND path = ? COLLATE NOCASE')
      .get(normalizedProvider, normalized.path).id;
  }

  assignTag(file, tagId, provider = PROVIDER_LOCAL) {
    if (!Number.isSafeInteger(tagId) || tagId <= 0) throw new Error('Invalid tag id.');
    const db = this.#requireDb();
    if (!db.prepare('SELECT 1 FROM tags WHERE id = ?').get(tagId)) throw new Error('タグが見つかりません。');
    const fileId = this.#upsertFile(provider, file);
    db.prepare('INSERT OR IGNORE INTO file_tags(file_id, tag_id, created_at) VALUES (?, ?, ?)')
      .run(fileId, tagId, Date.now());
    return true;
  }

  unassignTag(filePath, tagId, provider = PROVIDER_LOCAL) {
    if (typeof filePath !== 'string' || !filePath) throw new Error('ファイルパスが必要です。');
    if (!Number.isSafeInteger(tagId) || tagId <= 0) throw new Error('Invalid tag id.');
    const normalizedPath = path.win32.normalize(filePath);
    const db = this.#requireDb();
    const file = db.prepare('SELECT id FROM files WHERE provider = ? AND path = ? COLLATE NOCASE')
      .get(provider, normalizedPath);
    if (!file) return false;
    const changed = db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?').run(file.id, tagId).changes > 0;
    this.#deleteFileIfUntagged(file.id);
    return changed;
  }

  #deleteFileIfUntagged(fileId) {
    const db = this.#requireDb();
    const hasTags = db.prepare('SELECT 1 FROM file_tags WHERE file_id = ? LIMIT 1').get(fileId);
    if (!hasTags) db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  }

  updateTagsForFiles(files, { addTagIds = [], removeTagIds = [], newTagNames = [] } = {}, provider = PROVIDER_LOCAL) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('対象ファイルが必要です。');
    const normalizedAddIds = [...new Set(addTagIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
    const normalizedRemoveIds = [...new Set(removeTagIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
    const normalizedNames = [...new Map(newTagNames.map((name) => {
      const normalized = normalizeTagName(name);
      return [normalized.toLowerCase(), normalized];
    })).values()];
    const db = this.#requireDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const createdTags = normalizedNames.map((name) => this.createTag(name));
      const finalAddIds = [...new Set([...normalizedAddIds, ...createdTags.map((tag) => tag.id)])];
      for (const file of files) {
        const fileId = this.#upsertFile(provider, file);
        for (const tagId of finalAddIds) {
          if (!db.prepare('SELECT 1 FROM tags WHERE id = ?').get(tagId)) throw new Error('タグが見つかりません。');
          db.prepare('INSERT OR IGNORE INTO file_tags(file_id, tag_id, created_at) VALUES (?, ?, ?)').run(fileId, tagId, Date.now());
        }
        for (const tagId of normalizedRemoveIds) {
          db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?').run(fileId, tagId);
        }
        this.#deleteFileIfUntagged(fileId);
      }
      db.exec('COMMIT');
      return { createdTags, addedTagIds: finalAddIds, removedTagIds: normalizedRemoveIds };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  getTagsForPaths(filePaths, provider = PROVIDER_LOCAL) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return {};
    const normalized = [...new Set(filePaths.filter((value) => typeof value === 'string' && value).map((value) => path.win32.normalize(value)))];
    if (!normalized.length) return {};
    const placeholders = normalized.map(() => '?').join(',');
    const rows = this.#requireDb().prepare(`
      SELECT f.path, t.id AS tag_id, t.name AS tag_name
      FROM files f
      JOIN file_tags ft ON ft.file_id = f.id
      JOIN tags t ON t.id = ft.tag_id
      WHERE f.provider = ? AND f.path IN (${placeholders}) COLLATE NOCASE
      ORDER BY t.name COLLATE NOCASE
    `).all(provider, ...normalized);
    const result = Object.fromEntries(normalized.map((filePath) => [filePath, []]));
    for (const row of rows) {
      const key = normalized.find((filePath) => filePath.toLowerCase() === row.path.toLowerCase()) || row.path;
      if (!result[key]) result[key] = [];
      result[key].push({ id: row.tag_id, name: row.tag_name });
    }
    return result;
  }
}

module.exports = { MetadataStore, SCHEMA_VERSION, PROVIDER_LOCAL, normalizeTagName };
