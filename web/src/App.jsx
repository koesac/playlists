import { useEffect, useMemo, useState } from "react";

async function api(url, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };

  if (opts.body && typeof opts.body !== "string") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) throw new Error(data.error || text || "Request failed");
  return data;
}

function fmtMs(ms) {
  if (!ms) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtNum(n) {
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat().format(n);
}

function clampSimilarity(v) {
  const num = Number(v || 0);
  return Math.round(num * 100);
}

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({
    title: "Untitled draft",
    tracks: []
  });
  const [drafts, setDrafts] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [audioSrc, setAudioSrc] = useState("");
  const [showAllResults, setShowAllResults] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    setMessage("");
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
      setResults(data.data || []);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(track) {
    setLoading(true);
    setMessage("");
    try {
      const data = await api(
        `/api/track/detail?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&album=${encodeURIComponent(track.album || "")}`
      );
      setSelected(data);
      setAudioSrc(data.track.previewUrl || "");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  function addToDraft(track) {
    setDraft((prev) => {
      const exists = prev.tracks.some(
        (t) => t.title === track.title && t.artist === track.artist
      );
      if (exists) return prev;
      return { ...prev, tracks: [...prev.tracks, track] };
    });
  }

  function removeFromDraft(track) {
    setDraft((prev) => ({
      ...prev,
      tracks: prev.tracks.filter(
        (t) => !(t.title === track.title && t.artist === track.artist)
      )
    }));
  }

  async function saveDraft() {
    try {
      const saved = await api("/api/drafts", {
        method: "POST",
        body: {
          title: draft.title,
          data: draft
        }
      });
      setMessage(`Saved draft: ${saved.title}`);
      await loadDrafts();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadDrafts() {
    const data = await api("/api/drafts");
    setDrafts(data.data || []);
  }

  useEffect(() => {
    loadDrafts();
  }, []);

  const draftCount = useMemo(() => draft.tracks.length, [draft.tracks]);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>AI Playlist Studio</h1>
          <p className="muted">
            Search, preview, branch, and build a portable playlist draft.
          </p>
        </div>
        <div className="save-box">
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Draft title"
          />
          <button className="button" onClick={saveDraft}>Save draft</button>
        </div>
      </header>

      {message && <div className="message">{message}</div>}

      <section className="panel search-bar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a track, artist, album, or describe a vibe"
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="button" onClick={search} disabled={loading}>
          {loading ? "Loading..." : "Search"}
        </button>
      </section>

      <main className="layout">
        <section className="panel column">
          <div className="section-head">
            <h2>Results</h2>
            <span className="muted">{results.length} found</span>
          </div>

          <div className="list">
            {(showAllResults ? results : results.slice(0, 2)).map((track, i) => (
              <TrackRow
                key={`${track.trackKey}-${i}`}
                track={track}
                onOpen={() => loadDetail(track)}
                onAdd={() => addToDraft(track)}
                onPreview={() => setAudioSrc(track.previewUrl || "")}
              />
            ))}
          </div>
          {results.length > 2 && (
            <button
              className="button show-more-btn"
              onClick={() => setShowAllResults(!showAllResults)}
              style={{ marginTop: "1rem" }}
            >
              {showAllResults ? "Show less" : "Show more"}
            </button>
          )}
        </section>

        <section className="panel column">
          {!selected ? (
            <>
              <h2>Track detail</h2>
              <p className="muted">Pick a result to see previews, related tracks, artist tracks, and album tracks.</p>
            </>
          ) : (
            <>
              <div className="detail-top">
                <img
                  className="cover large"
                  src={selected.track.artworkUrl || "https://placehold.co/300x300?text=No+Art"}
                  alt=""
                />
                <div>
                  <h2>{selected.track.title}</h2>
                  <p className="muted">
                    {selected.track.artist} {selected.track.album ? `· ${selected.track.album}` : ""}
                  </p>
                  <div className="stats">
                    <span>Duration {fmtMs(selected.track.durationMs)}</span>
                    <span>Listeners {fmtNum(selected.popularity.listeners)}</span>
                    <span>Playcount {fmtNum(selected.popularity.playcount)}</span>
                  </div>
                  <div className="tag-row">
                    {(selected.track.tags || []).map((tag) => (
                      <span className="tag" key={tag}>{tag}</span>
                    ))}
                  </div>
                  <div className="action-row">
                    <button className="button" onClick={() => addToDraft(selected.track)}>Add to draft</button>
                    <button className="button secondary" onClick={() => setAudioSrc(selected.track.previewUrl || "")}>
                      Preview
                    </button>
                  </div>
                </div>
              </div>

              <audio className="player" controls src={audioSrc || undefined}>
                Your browser does not support audio.
              </audio>

              <div className="subgrid">
                <div>
                  <h3>Similar tracks</h3>
                  <div className="list compact">
                    {(selected.similar || []).map((track, i) => (
                      <div className="mini-card" key={`${track.trackKey}-${i}`}>
                        <div>
                          <strong>{track.title}</strong>
                          <div className="muted">{track.artist}</div>
                          <div className="sim">
                            <div className="sim-bar">
                              <span style={{ width: `${clampSimilarity(track.similarity)}%` }} />
                            </div>
                            <small>{clampSimilarity(track.similarity)}% similar</small>
                          </div>
                        </div>
                        <div className="mini-actions">
                          <button className="button secondary" onClick={() => loadDetail(track)}>Open</button>
                          <button className="button" onClick={() => addToDraft(track)}>Add</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3>Other by artist</h3>
                  <div className="list compact">
                    {(selected.artistTracks || []).map((track, i) => (
                      <div className="mini-card" key={`${track.trackKey}-${i}`}>
                        <div>
                          <strong>{track.title}</strong>
                          <div className="muted">{track.album || "Unknown release"}</div>
                        </div>
                        <div className="mini-actions">
                          <button className="button secondary" onClick={() => loadDetail(track)}>Open</button>
                          <button className="button" onClick={() => addToDraft(track)}>Add</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3>Album tracks</h3>
                  <div className="list compact">
                    {(selected.albumTracks || []).map((track, i) => (
                      <div className="mini-card" key={`${track.trackKey}-${i}`}>
                        <div>
                          <strong>{track.title}</strong>
                          <div className="muted">{fmtMs(track.durationMs)}</div>
                        </div>
                        <div className="mini-actions">
                          <button className="button secondary" onClick={() => loadDetail(track)}>Open</button>
                          <button className="button" onClick={() => addToDraft(track)}>Add</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel column">
          <div className="section-head">
            <h2>Draft playlist</h2>
            <span className="muted">{draftCount} tracks</span>
          </div>

          <div className="list">
            {draft.tracks.map((track, i) => (
              <div className="track-row" key={`${track.title}-${track.artist}-${i}`}>
                <div className="track-meta">
                  <img
                    className="cover"
                    src={track.artworkUrl || "https://placehold.co/80x80?text=No+Art"}
                    alt=""
                  />
                  <div>
                    <strong>{track.title}</strong>
                    <div className="muted">{track.artist}</div>
                  </div>
                </div>
                <div className="mini-actions">
                  {track.previewUrl && (
                    <button className="button secondary" onClick={() => setAudioSrc(track.previewUrl)}>
                      Preview
                    </button>
                  )}
                  <button className="button danger" onClick={() => removeFromDraft(track)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="divider" />

          <h3>Saved drafts</h3>
          <div className="list compact">
            {drafts.map((d) => (
              <div className="mini-card" key={d.id}>
                <div>
                  <strong>{d.title}</strong>
                  <div className="muted">{new Date(d.updated_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function TrackRow({ track, onOpen, onAdd, onPreview }) {
  return (
    <div className="track-row">
      <div className="track-meta">
        <img
          className="cover"
          src={track.artworkUrl || "https://placehold.co/80x80?text=No+Art"}
          alt=""
        />
        <div>
          <strong>{track.title}</strong>
          <div className="muted">
            {track.artist} {track.album ? `· ${track.album}` : ""}
          </div>
          <div className="muted">{fmtMs(track.durationMs)}</div>
        </div>
      </div>

      <div className="mini-actions">
        {track.previewUrl && (
          <button className="button secondary" onClick={onPreview}>Preview</button>
        )}
        <button className="button secondary" onClick={onOpen}>Open</button>
        <button className="button" onClick={onAdd}>Add</button>
      </div>
    </div>
  );
}
