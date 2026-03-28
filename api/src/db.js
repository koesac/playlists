const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || "/data/app.db";
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function listDrafts() {
  return db.prepare(`
    SELECT id, title, created_at, updated_at
    FROM drafts
    ORDER BY updated_at DESC
  `).all();
}

function getDraft(id) {
  const row = db.prepare(`
    SELECT id, title, data, created_at, updated_at
    FROM drafts
    WHERE id = ?
  `).get(id);

  if (!row) return null;

  return {
    ...row,
    data: JSON.parse(row.data)
  };
}

function saveDraft({ id, title, data }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO drafts (id, title, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(id, title, JSON.stringify(data), now, now);

  return getDraft(id);
}

module.exports = {
  listDrafts,
  getDraft,
  saveDraft
};
