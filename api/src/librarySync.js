const { upsertLibraryNode, insertLibraryEdge, getExistingLibraryTrackIds, findLibraryNodeByNormalizedTitle } = require("./db");
const { lastfmSimilar } = require("./providers");

/**
 * Normalize a string for matching by removing spaces and special characters.
 * @param {string} str - The string to normalize
 * @returns {string} Normalized string (lowercase, alphanumeric only)
 */
function normalizeMatch(str = "") {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Sync a playlist's tracks to the library graph tables.
 * @param {Array} playlistTracks - Array of track objects from a draft playlist
 */
async function syncPlaylistToLibrary(playlistTracks) {
  if (!Array.isArray(playlistTracks)) return;

  const existingIds = getExistingLibraryTrackIds();

  for (const track of playlistTracks) {
    if (!track || !track.id) continue;

    // Extract title/artist from the track - they can be at top level or nested in raw
    const trackTitle = track.title || track.raw?.title || track.label || "";
    const trackArtist = track.artist || track.raw?.artist || track.subtitle || "";

    // Upsert the track as a library node
    upsertLibraryNode({
      id: track.id,
      title: trackTitle,
      artist: trackArtist,
      kind: track.kind || "track",
      bpm: track.bpm || null,
      genre: track.genre || null,
      listeners: track.listeners || track.popularity?.listeners || null,
      artwork_url: track.artworkUrl || null,
      previewUrl: track.previewUrl || null
    });

    // For tracks, fetch similar tracks from Last.fm
    if (track.kind === "track" && trackArtist && trackTitle) {
      try {
        const similar = await lastfmSimilar(trackArtist, trackTitle, 50);

        for (const sim of similar) {
          // Use SQLite to find the actual track ID based on normalized text matching
          const match = findLibraryNodeByNormalizedTitle(
            normalizeMatch(sim.artist),
            normalizeMatch(sim.title)
          );

          if (match && match.id !== track.id) {
            console.log(`[Sync] Found connection: ${trackTitle} by ${trackArtist} <-> ${sim.title} by ${sim.artist}`);
            // Bidirectional edges
            insertLibraryEdge(track.id, match.id, sim.similarity || 0.5);
            insertLibraryEdge(match.id, track.id, sim.similarity || 0.5);
          }
        }

        // Rate limit: avoid Last.fm rate limits
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        // Log but continue — one failed track shouldn't block the whole sync
        console.error(`[librarySync] Failed to fetch similar for "${trackTitle}" by ${trackArtist}:`, err.message);
      }
    }
  }
}

module.exports = { syncPlaylistToLibrary };