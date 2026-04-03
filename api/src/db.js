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

  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    bpm INTEGER,
    genre TEXT,
    playcount INTEGER,
    data_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT,
    target_id TEXT,
    weight REAL,
    PRIMARY KEY (source_id, target_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
  CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
  CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON tracks(bpm);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
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

function deleteDraft(id) {
  db.prepare(`
    DELETE FROM drafts
    WHERE id = ?
  `).run(id);
}

// --- Track operations ---
function upsertTrack(track) {
  const { id, title, artist, bpm, genre, playcount, data } = track;
  db.prepare(`
    INSERT INTO tracks (id, title, artist, bpm, genre, playcount, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      bpm = excluded.bpm,
      genre = excluded.genre,
      playcount = excluded.playcount,
      data_json = excluded.data_json
  `).run(id, title, artist, bpm || null, genre || null, playcount || null, JSON.stringify(data || {}));
}

function getTrack(id) {
  const row = db.prepare(`
    SELECT id, title, artist, bpm, genre, playcount, data_json
    FROM tracks
    WHERE id = ?
  `).get(id);

  if (!row) return null;

  return {
    ...row,
    data: JSON.parse(row.data_json)
  };
}

function listTracks(limit = 1000) {
  return db.prepare(`
    SELECT id, title, artist, bpm, genre, playcount
    FROM tracks
    ORDER BY playcount DESC
    LIMIT ?
  `).all(limit);
}

function deleteTrack(id) {
  db.prepare(`DELETE FROM tracks WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM edges WHERE source_id = ? OR target_id = ?`).run(id, id);
}

// --- Edge operations ---
function upsertEdge(sourceId, targetId, weight) {
  db.prepare(`
    INSERT INTO edges (source_id, target_id, weight)
    VALUES (?, ?, ?)
    ON CONFLICT(source_id, target_id) DO UPDATE SET
      weight = excluded.weight
  `).run(sourceId, targetId, weight);
}

function upsertEdgesBulk(edgeList) {
  const stmt = db.prepare(`
    INSERT INTO edges (source_id, target_id, weight)
    VALUES (?, ?, ?)
    ON CONFLICT(source_id, target_id) DO UPDATE SET
      weight = excluded.weight
  `);

  const insertMany = db.transaction((edges) => {
    for (const { sourceId, targetId, weight } of edges) {
      stmt.run(sourceId, targetId, weight);
    }
  });

  insertMany(edgeList);
}

function getEdgesForTrack(trackId) {
  return db.prepare(`
    SELECT source_id, target_id, weight
    FROM edges
    WHERE source_id = ? OR target_id = ?
  `).all(trackId, trackId);
}

function getAllEdges() {
  return db.prepare(`
    SELECT source_id, target_id, weight
    FROM edges
  `).all();
}

function deleteEdgesForTrack(trackId) {
  db.prepare(`DELETE FROM edges WHERE source_id = ? OR target_id = ?`).run(trackId, trackId);
}

// --- Graph data export ---
function getGraphData(limit = 1000) {
  const tracks = db.prepare(`
    SELECT id, title, artist, bpm, genre, playcount
    FROM tracks
    ORDER BY playcount DESC
    LIMIT ?
  `).all(limit);

  if (tracks.length === 0) {
    return { nodes: [], links: [] };
  }

  const trackIds = tracks.map(t => t.id);

  // Create a temporary table to handle the IN clause efficiently
  db.exec(`CREATE TEMPORARY TABLE IF NOT EXISTS temp_graph_track_ids (id TEXT PRIMARY KEY)`);
  db.exec(`DELETE FROM temp_graph_track_ids`);

  const insertStmt = db.prepare(`INSERT INTO temp_graph_track_ids (id) VALUES (?)`);
  const insertMany = db.transaction((ids) => {
    for (const id of ids) {
      insertStmt.run(id);
    }
  });
  insertMany(trackIds);

  const edges = db.prepare(`
    SELECT source_id, target_id, weight
    FROM edges
    WHERE source_id IN (SELECT id FROM temp_graph_track_ids)
      AND target_id IN (SELECT id FROM temp_graph_track_ids)
  `).all();

  return {
    nodes: tracks.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      bpm: t.bpm,
      genre: t.genre,
      playcount: t.playcount
    })),
    links: edges.map(e => ({
      source: e.source_id,
      target: e.target_id,
      weight: e.weight
    }))
  };
}

module.exports = {
  listDrafts,
  getDraft,
  saveDraft,
  deleteDraft,
  upsertTrack,
  getTrack,
  listTracks,
  deleteTrack,
  upsertEdge,
  upsertEdgesBulk,
  getEdgesForTrack,
  getAllEdges,
  deleteEdgesForTrack,
  getGraphData
};
