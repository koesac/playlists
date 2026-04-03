const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const crypto = require("crypto");

const { listDrafts, getDraft, saveDraft, deleteDraft, upsertTrack, getTrack, listTracks, deleteTrack, getGraphData, getLibraryGraphData } = require("./db");
const { syncPlaylistToLibrary } = require("./librarySync");
const {
  searchMusicBrainzTracks,
  searchMusicBrainzArtists,
  searchDeezerTracks,
  searchDeezerArtists,
  searchItunesTracks,
  hydrateSearchResults,
  resolveTrackPreview,
  getTrackDetail,
  getArtistDetail,
  getAlbumDetail,
  getGenreDetail,
  getBPM,
  computeAndStoreEdgesForTrack
} = require("./providers");

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(morgan("dev"));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({
      deezer: { tracks: [], artists: [] },
      itunes: { tracks: [] },
      tracks: [],
      artists: []
    });

    const [dzTracks, dzArtists, itunesTracks] = await Promise.all([
      searchDeezerTracks(q, 12),
      searchDeezerArtists(q, 8),
      searchItunesTracks(q, 12),
    ]);

    res.json({
      deezer:  { tracks: dzTracks,     artists: dzArtists },
      itunes:  { tracks: itunesTracks, artists: [] },
      // keep legacy flat shape so nothing else breaks while you migrate:
      tracks:  dzTracks,
      artists: dzArtists,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/preview", async (req, res) => {
  try {
    const artist = String(req.query.artist || "").trim();
    const title = String(req.query.title || "").trim();
    const album = String(req.query.album || "").trim();

    if (!artist || !title) {
      return res.status(400).json({ error: "artist and title are required" });
    }

    const preview = await resolveTrackPreview(
      { artist, title, album },
      { context: "preview-endpoint" }
    );

    return res.json(preview);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Preview lookup failed" });
  }
});

app.get("/api/track/detail", async (req, res) => {
  try {
    const artist = String(req.query.artist || "").trim();
    const title = String(req.query.title || "").trim();
    const album = String(req.query.album || "").trim();

    if (!artist || !title) {
      return res.status(400).json({ error: "artist and title are required" });
    }

    const detail = await getTrackDetail({ artist, title, album });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/artist/detail", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const detail = await getArtistDetail(name);
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/album/detail", async (req, res) => {
  try {
    const artist = String(req.query.artist || "").trim();
    const album = String(req.query.album || "").trim();
    if (!artist || !album) {
      return res.status(400).json({ error: "artist and album are required" });
    }

    const detail = await getAlbumDetail({ artist, album });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/genre/detail", async (req, res) => {
  try {
    const tag = String(req.query.tag || "").trim();
    if (!tag) {
      return res.status(400).json({ error: "tag is required" });
    }

    const detail = await getGenreDetail(tag);
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/drafts", (req, res) => {
  res.json({ data: listDrafts() });
});

app.get("/api/drafts/:id", (req, res) => {
  const draft = getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "Draft not found" });
  res.json(draft);
});

app.post("/api/drafts", (req, res) => {
  const { id, title, data } = req.body || {};
  if (!title || !data) {
    return res.status(400).json({ error: "title and data are required" });
  }

  const saved = saveDraft({
    id: id || crypto.randomUUID(),
    title,
    data
  });

  // Fire-and-forget: sync playlist to library graph in background
  if (data && Array.isArray(data.playlist)) {
    syncPlaylistToLibrary(data.playlist).catch(err => {
      console.error("[librarySync] Background sync failed:", err.message);
    });
  }

  res.json(saved);
});

app.delete("/api/drafts/:id", (req, res) => {
  deleteDraft(req.params.id);
  res.json({ ok: true });
});

// --- Graph data endpoints ---
app.get("/api/library/graph", (req, res) => {
  try {
    const graphData = getLibraryGraphData();
    res.json(graphData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/graph-data", (req, res) => {
  try {
    const limit = Number(req.query.limit || 1000);
    const graphData = getGraphData(limit);
    res.json(graphData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tracks", (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const tracks = listTracks(limit);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tracks", async (req, res) => {
  try {
    const { id, title, artist, bpm, genre, playcount, data } = req.body || {};
    if (!id || !title || !artist) {
      return res.status(400).json({ error: "id, title, and artist are required" });
    }

    // Fetch BPM if not provided
    let finalBpm = bpm;
    if (!finalBpm) {
      finalBpm = await getBPM(artist, title);
    }

    const track = { id, title, artist, bpm: finalBpm, genre, playcount, data };
    upsertTrack(track);

    // Compute and store edges for this track
    await computeAndStoreEdgesForTrack(track);

    res.json({ ok: true, track: { id, title, artist, bpm: finalBpm, genre, playcount } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tracks/:id", (req, res) => {
  try {
    deleteTrack(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
