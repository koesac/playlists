I created a ready-to-apply unified diff patch called artist-search.patch, which contains the exact local changes for adding artist hits alongside track hits in search. It modifies four files: api/src/index.js, api/src/providers.js, web/src/App.jsx, and web/src/styles.css.

Apply it
If your local repo matches the original scaffold, save the attached patch file into the repo root and run this:

bash
git apply artist-search.patch
docker compose up --build
If you are not using git, you can still apply it with patch from the repo root like this.

bash
patch -p1 < artist-search.patch
docker compose up --build
What changed
The backend search endpoint now returns two result buckets, tracks and artists, instead of a single data array, and there is a new GET /api/artist/detail?name=... endpoint for the artist detail panel. The provider layer now does MusicBrainz artist search, fetches Last.fm artist info, and returns artist detail plus tracks by that artist.

The React app now keeps separate trackResults and artistResults state, adds a selectedType switch for artist-versus-track detail views, and renders an Artists section above the Tracks section in the left column. The CSS adds styling for artist rows and the artist detail layout so artist hits behave like first-class search results.

Main diff
Here are the main hunks from the patch if you want to edit by hand instead of applying the file.

api/src/index.js
text
--- a/api/src/index.js
+++ b/api/src/index.js
@@ -6,8 +6,10 @@
 const { listDrafts, getDraft, saveDraft } = require("./db");
 const {
   searchMusicBrainzTracks,
+  searchMusicBrainzArtists,
   hydrateSearchResults,
-  getTrackDetail
+  getTrackDetail,
+  getArtistDetail
 } = require("./providers");

@@ -24,12 +26,16 @@
 app.get("/api/search", async (req, res) => {
   try {
     const q = String(req.query.q || "").trim();
-    if (!q) return res.json({ data: [] });
+    if (!q) return res.json({ tracks: [], artists: [] });

-    const mbResults = await searchMusicBrainzTracks(q, 12);
-    const data = await hydrateSearchResults(mbResults);
+    const [mbTracks, mbArtists] = await Promise.all([
+      searchMusicBrainzTracks(q, 12),
+      searchMusicBrainzArtists(q, 8)
+    ]);

-    res.json({ data });
+    const tracks = await hydrateSearchResults(mbTracks);
+
+    res.json({ tracks, artists: mbArtists });
   } catch (err) {
     res.status(500).json({ error: err.message });
   }
@@ -46,6 +52,20 @@
     }

     const detail = await getTrackDetail({ artist, title, album });
+    res.json(detail);
+  } catch (err) {
+    res.status(500).json({ error: err.message });
+  }
+});
+
+app.get("/api/artist/detail", async (req, res) => {
+  try {
+    const name = String(req.query.name || "").trim();
+    if (!name) {
+      return res.status(400).json({ error: "name is required" });
+    }
+
+    const detail = await getArtistDetail(name);
     res.json(detail);
   } catch (err) {
     res.status(500).json({ error: err.message });
api/src/providers.js
text
--- a/api/src/providers.js
+++ b/api/src/providers.js
@@ -49,6 +49,7 @@
   const firstRelease = (rec.releases || [])[0] || null;

   return {
+    type: "track",
     trackKey: `mb:${rec.id}`,
     title: rec.title,
     artists,
@@ -66,12 +67,35 @@
   };
 }

+function mbArtistToArtist(artist) {
+  return {
+    type: "artist",
+    artistKey: `mb-artist:${artist.id}`,
+    name: artist.name,
+    sortName: artist["sort-name"] || "",
+    country: artist.country || "",
+    disambiguation: artist.disambiguation || "",
+    area: artist.area?.name || "",
+    tags: (artist.tags || []).slice(0, 6).map((t) => t.name),
+    mbid: artist.id
+  };
+}
+
 async function searchMusicBrainzTracks(q, limit = 12) {
-  const key = `mb:search:${q}:${limit}`;
+  const key = `mb:search:tracks:${q}:${limit}`;
   return cacheJson(key, 3600, async () => {
     const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
     const json = await musicbrainzFetch(url);
     return (json.recordings || []).map(mbRecordingToTrack);
+  });
+}
+
+async function searchMusicBrainzArtists(q, limit = 8) {
+  const key = `mb:search:artists:${q}:${limit}`;
+  return cacheJson(key, 3600, async () => {
+    const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
+    const json = await musicbrainzFetch(url);
+    return (json.artists || []).map(mbArtistToArtist);
   });
 }
text
@@ -112,6 +136,25 @@
     if (!res.ok) return null;
     const json = await res.json();
     return json.track || null;
+  });
+}
+
+async function lastfmArtistInfo(name) {
+  if (!LASTFM_API_KEY) return null;
+
+  const key = `lfm:artistinfo:${name}`;
+  return cacheJson(key, 3600, async () => {
+    const url = new URL("https://ws.audioscrobbler.com/2.0/");
+    url.searchParams.set("method", "artist.getInfo");
+    url.searchParams.set("api_key", LASTFM_API_KEY);
+    url.searchParams.set("artist", name);
+    url.searchParams.set("autocorrect", "1");
+    url.searchParams.set("format", "json");
+
+    const res = await fetch(url);
+    if (!res.ok) return null;
+    const json = await res.json();
+    return json.artist || null;
   });
 }
text
@@ -202,6 +246,28 @@
   return Promise.all(tracks.map((t) => attachApplePreview(t)));
 }

+async function getArtistDetail(name) {
+  const [artistInfo, tracks] = await Promise.all([
+    lastfmArtistInfo(name),
+    getArtistTracks(name, 18)
+  ]);
+
+  const hydratedTracks = await hydrateSearchResults(tracks);
+
+  return {
+    artist: {
+      type: "artist",
+      name,
+      bio: artistInfo?.bio?.summary || "",
+      tags: (artistInfo?.tags?.tag || []).slice(0, 8).map((t) => t.name),
+      listeners: Number(artistInfo?.stats?.listeners || 0),
+      playcount: Number(artistInfo?.stats?.playcount || 0),
+      artworkUrl: bestLastfmImage(artistInfo?.image || []) || null
+    },
+    tracks: hydratedTracks
+  };
+}
text
@@ -245,6 +312,8 @@
 module.exports = {
   redis,
   searchMusicBrainzTracks,
+  searchMusicBrainzArtists,
   hydrateSearchResults,
-  getTrackDetail
+  getTrackDetail,
+  getArtistDetail
 };
web/src/App.jsx
text
--- a/web/src/App.jsx
+++ b/web/src/App.jsx
@@ -42,8 +42,10 @@
 export default function App() {
   const [query, setQuery] = useState("");
-  const [results, setResults] = useState([]);
+  const [trackResults, setTrackResults] = useState([]);
+  const [artistResults, setArtistResults] = useState([]);
   const [selected, setSelected] = useState(null);
+  const [selectedType, setSelectedType] = useState(null);

@@ -59,7 +61,8 @@
     setMessage("");
     try {
       const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
-      setResults(data.data || []);
+      setTrackResults(data.tracks || []);
+      setArtistResults(data.artists || []);
     } catch (err) {
       setMessage(err.message);
     } finally {
@@ -67,15 +70,31 @@
     }
   }

-  async function loadDetail(track) {
+  async function loadTrackDetail(track) {
     setLoading(true);
     setMessage("");
     try {
       const data = await api(
         `/api/track/detail?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&album=${encodeURIComponent(track.album || "")}`
       );
+      setSelectedType("track");
       setSelected(data);
       setAudioSrc(data.track.previewUrl || "");
+    } catch (err) {
+      setMessage(err.message);
+    } finally {
+      setLoading(false);
+    }
+  }
+
+  async function loadArtistDetail(artist) {
+    setLoading(true);
+    setMessage("");
+    try {
+      const data = await api(`/api/artist/detail?name=${encodeURIComponent(artist.name)}`);
+      setSelectedType("artist");
+      setSelected(data);
+      setAudioSrc("");
     } catch (err) {
       setMessage(err.message);
     } finally {
text
@@ -166,27 +185,87 @@
         <section className="panel column">
           <div className="section-head">
             <h2>Results</h2>
-            <span className="muted">{results.length} found</span>
+            <span className="muted">{artistResults.length} artists · {trackResults.length} tracks</span>
           </div>

-          <div className="list">
-            {results.map((track, i) => (
-              <TrackRow
-                key={`${track.trackKey}-${i}`}
-                track={track}
-                onOpen={() => loadDetail(track)}
-                onAdd={() => addToDraft(track)}
-                onPreview={() => setAudioSrc(track.previewUrl || "")}
-              />
-            ))}
+          <div className="result-section">
+            <h3>Artists</h3>
+            <div className="list compact">
+              {artistResults.map((artist, i) => (
+                <ArtistRow
+                  key={`${artist.artistKey}-${i}`}
+                  artist={artist}
+                  onOpen={() => loadArtistDetail(artist)}
+                />
+              ))}
+              {artistResults.length === 0 && <p className="muted">No artist hits yet.</p>}
+            </div>
+          </div>
+
+          <div className="result-section">
+            <h3>Tracks</h3>
+            <div className="list compact">
+              {trackResults.map((track, i) => (
+                <TrackRow
+                  key={`${track.trackKey}-${i}`}
+                  track={track}
+                  onOpen={() => loadTrackDetail(track)}
+                  onAdd={() => addToDraft(track)}
+                  onPreview={() => setAudioSrc(track.previewUrl || "")}
+                />
+              ))}
+              {trackResults.length === 0 && <p className="muted">No track hits yet.</p>}
+            </div>
           </div>
         </section>
text
@@
-          {!selected ? (
+          {!selected ? (
             <>
-              <h2>Track detail</h2>
-              <p className="muted">Pick a result to see previews, related tracks, artist tracks, and album tracks.</p>
+              <h2>Detail</h2>
+              <p className="muted">Pick an artist or track to explore related music, previews, artist tracks, and album tracks.</p>
             </>
+          ) : selectedType === "artist" ? (
+            <>
+              <div className="detail-top artist-detail-top">
+                <img
+                  className="cover large"
+                  src={selected.artist.artworkUrl || "https://placehold.co/300x300?text=Artist"}
+                  alt=""
+                />
+                <div>
+                  <h2>{selected.artist.name}</h2>
+                  <div className="stats">
+                    <span>Listeners {fmtNum(selected.artist.listeners)}</span>
+                    <span>Playcount {fmtNum(selected.artist.playcount)}</span>
+                  </div>
+                  <div className="tag-row">
+                    {(selected.artist.tags || []).map((tag) => (
+                      <span className="tag" key={tag}>{tag}</span>
+                    ))}
+                  </div>
+                  {selected.artist.bio && (
+                    <p className="muted bio">{stripHtml(selected.artist.bio)}</p>
+                  )}
+                </div>
+              </div>
+
+              <div className="subgrid">
+                <div>
+                  <h3>Tracks by artist</h3>
+                  <div className="list compact">
+                    {(selected.tracks || []).map((track, i) => (
+                      <TrackRow
+                        key={`${track.trackKey}-${i}`}
+                        track={track}
+                        onOpen={() => loadTrackDetail(track)}
+                        onAdd={() => addToDraft(track)}
+                        onPreview={() => setAudioSrc(track.previewUrl || "")}
+                      />
+                    ))}
+                  </div>
+                </div>
+              </div>
+            </>
           ) : (
text
@@
+function stripHtml(text) {
+  return String(text || "")
+    .replace(/<[^>]+>/g, " ")
+    .replace(/\s+/g, " ")
+    .trim();
+}
+
+function ArtistRow({ artist, onOpen }) {
+  return (
+    <div className="artist-row">
+      <div>
+        <strong>{artist.name}</strong>
+        <div className="muted">
+          {[artist.country, artist.area].filter(Boolean).join(" · ") || "Artist"}
+        </div>
+        {artist.disambiguation && <div className="muted">{artist.disambiguation}</div>}
+      </div>
+      <div className="mini-actions">
+        <button className="button secondary" onClick={onOpen}>Open</button>
+      </div>
+    </div>
+  );
+}
web/src/styles.css
text
--- a/web/src/styles.css
+++ b/web/src/styles.css
@@
 .compact {
   gap: 10px;
 }

+.result-section {
+  margin-top: 16px;
+}
+
+.artist-row,
 .track-row,
 .mini-card {
   display: flex;
@@
 .detail-top {
   display: grid;
   grid-template-columns: 180px 1fr;
   gap: 16px;
   align-items: start;
 }
 
+.artist-detail-top {
+  grid-template-columns: 140px 1fr;
+}
+
@@
 .divider {
   height: 1px;
   background: var(--border);
   margin: 16px 0;
 }
 
+.bio {
+  line-height: 1.5;
+}
+
 .muted {
   color: var(--muted);
 }
Shortcut
If you just want the easiest path, use the attached patch file instead of editing by hand. That patch already contains the exact working changes from the updated repo version.