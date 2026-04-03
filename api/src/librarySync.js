const { upsertLibraryNode, insertLibraryEdge, getExistingLibraryTrackIds } = require("./db");
const { lastfmSimilar } = require("./providers");

/**
 * Sync a playlist's tracks to the library graph tables.
 * @param {Array} playlistTracks - Array of track objects from a draft playlist
 */
async function syncPlaylistToLibrary(playlistTracks) {
  if (!Array.isArray(playlistTracks)) return;

  const existingIds = getExistingLibraryTrackIds();

  for (const track of playlistTracks) {
    if (!track || !track.id) continue;

    // Upsert the track as a library node
    upsertLibraryNode({
      id: track.id,
      title: track.title || "",
      artist: track.artist || "",
      kind: track.kind || "track",
      bpm: track.bpm || null,
      genre: track.genre || null,
      listeners: track.listeners || track.popularity?.listeners || null,
      artwork_url: track.artworkUrl || null
    });

    // For tracks, fetch similar tracks from Last.fm
    if (track.kind === "track" && track.artist && track.title) {
      try {
        const similar = await lastfmSimilar(track.artist, track.title, 50);

        for (const sim of similar) {
          // Build a candidate ID for the similar track
          const simId = sim.trackKey || `lfm:${(sim.artist || "").toLowerCase()}::${(sim.title || "").toLowerCase()}`;

          // Only draw an edge if the similar track already exists in our library
          if (existingIds.has(simId)) {
            // Bidirectional edges
            insertLibraryEdge(track.id, simId, sim.similarity || 0.5);
            insertLibraryEdge(simId, track.id, sim.similarity || 0.5);
          }
        }

        // Rate limit: avoid Last.fm rate limits
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        // Log but continue — one failed track shouldn't block the whole sync
        console.error(`[librarySync] Failed to fetch similar for "${track.title}" by ${track.artist}:`, err.message);
      }
    }
  }
}

module.exports = { syncPlaylistToLibrary };