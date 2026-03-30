const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const crypto = require("crypto");

const { listDrafts, getDraft, saveDraft } = require("./db");
const {
  searchMusicBrainzTracks,
  searchMusicBrainzArtists,
  hydrateSearchResults,
  resolveTrackPreview,
  getTrackDetail,
  getArtistDetail,
  getAlbumDetail,
  getGenreDetail
} = require("./providers");

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ tracks: [], artists: [] });

    const [mbTracks, mbArtists] = await Promise.all([
      searchMusicBrainzTracks(q, 12),
      searchMusicBrainzArtists(q, 8)
    ]);

    const tracks = await hydrateSearchResults(mbTracks);
    res.json({ tracks, artists: mbArtists });
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

  res.json(saved);
});

app.delete("/api/drafts/:id", (req, res) => {
  deleteDraft(req.params.id);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`API listening on ${port}`);
});