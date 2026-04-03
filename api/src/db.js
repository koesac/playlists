const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || "/data/app.db";
const db = new Database(dbPath);

// Add preview_url column if it doesn't exist (safe to run multiple times)
try {
  db.exec("ALTER TABLE library_nodes ADD COLUMN preview_url TEXT;");
} catch (e) {
  // Column may already exist, ignore the error
}

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

  CREATE TABLE IF NOT EXISTS library_nodes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    kind TEXT NOT NULL,
    bpm INTEGER,
    genre TEXT,
    listeners INTEGER,
    artwork_url TEXT
  );

  CREATE TABLE IF NOT EXISTS library_edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    relation TEXT NOT NULL,
    weight REAL NOT NULL,
    PRIMARY KEY (source, target, relation)
  );

  CREATE INDEX IF NOT EXISTS idx_library_edges_source ON library_edges(source);
  CREATE INDEX IF NOT EXISTS idx_library_edges_target ON library_edges(target);
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

// --- Library graph operations ---
function upsertLibraryNode(node) {
  db.prepare(`
    INSERT INTO library_nodes (id, title, artist, kind, bpm, genre, listeners, artwork_url, preview_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      kind = excluded.kind,
      bpm = excluded.bpm,
      genre = excluded.genre,
      listeners = excluded.listeners,
      artwork_url = excluded.artwork_url,
      preview_url = excluded.preview_url
  `).run(node.id, node.title, node.artist, node.kind, node.bpm || null, node.genre || null, node.listeners || null, node.artwork_url || null, node.previewUrl || null);
}

function insertLibraryEdge(source, target, weight) {
  db.prepare(`
    INSERT INTO library_edges (source, target, relation, weight)
    VALUES (?, ?, 'similar', ?)
    ON CONFLICT(source, target, relation) DO NOTHING
  `).run(source, target, weight);
}

function getExistingLibraryTrackIds() {
  const rows = db.prepare(`SELECT id FROM library_nodes WHERE kind = 'track'`).all();
  return new Set(rows.map(r => r.id));
}

/**
 * Find a library node ID by normalized artist and title matching.
 * @param {string} normalizedArtist - Artist name with spaces/special chars removed, lowercased
 * @param {string} normalizedTitle - Title with spaces/special chars removed, lowercased
 * @returns {{id: string}|null}
 */
function findLibraryNodeByNormalizedTitle(normalizedArtist, normalizedTitle) {
  return db.prepare(`
    SELECT id FROM library_nodes 
    WHERE REPLACE(LOWER(artist), ' ', '') = ? 
    AND REPLACE(LOWER(title), ' ', '') = ?
  `).get(normalizedArtist, normalizedTitle);
}

function getLibraryGraphData() {
  const nodes = db.prepare(`
    SELECT id, title, artist, kind, bpm, genre, listeners, artwork_url, preview_url as previewUrl
    FROM library_nodes
  `).all();

  const links = db.prepare(`
    SELECT source, target, relation, weight
    FROM library_edges
  `).all();

  return {
    nodes: nodes.map(n => ({
      id: n.id,
      title: n.title,
      artist: n.artist,
      kind: n.kind,
      bpm: n.bpm,
      genre: n.genre,
      listeners: n.listeners,
      artwork_url: n.artwork_url,
      previewUrl: n.previewUrl
    })),
    links: links.map(l => ({
      source: l.source,
      target: l.target,
      relation: l.relation,
      weight: l.weight
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
  getGraphData,
  upsertLibraryNode,
  insertLibraryEdge,
  getExistingLibraryTrackIds,
  findLibraryNodeByNormalizedTitle,
  getLibraryGraphData
};
