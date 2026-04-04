const { upsertLibraryNode, insertLibraryEdge, getExistingLibraryTrackIds, findLibraryNodeByNormalizedTitle } = require("./db");
const { lastfmSimilar, getAudioFeatures } = require("./providers");

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

    // 1. Extract genres as comma-separated string (top 3 tags)
    let genres = null;
    if (track.tags && track.tags.length > 0) {
      genres = track.tags.slice(0, 3).join(', ');
    } else if (track.details && track.details.track && track.details.track.tags) {
      genres = track.details.track.tags.slice(0, 3).join(', ');
    }

    // 2. Extract Release Year - will be overridden by audio features if available
    let year = track.year || null;
    if (!year && track.meta && track.meta[0]) {
      const parsed = parseInt(String(track.meta[0]).replace(/\D/g, ''));
      if (!isNaN(parsed) && parsed > 1900) year = parsed;
    }

    // 3. Fetch audio features (bpm, danceability, acousticness, year, album, genres) using the GetSong API provider
    // (This uses Redis caching under the hood, so it's safe to call in a loop)
    let bpm = track.bpm || null;
    let danceability = track.danceability || null;
    let acousticness = track.acousticness || null;
    // Fetch if any of these fields are missing, or if genres are not set
    if (!bpm || !danceability || !year || !genres) {
      try {
        const features = await getAudioFeatures(trackArtist, trackTitle);
        if (features) {
          if (features.bpm) bpm = parseInt(features.bpm);
          if (features.danceability != null) danceability = parseFloat(features.danceability);
          if (features.acousticness != null) acousticness = parseFloat(features.acousticness);
          // Use GetSong year as the primary source (more accurate than meta parsing)
          if (features.year) year = features.year;
          // Use GetSong genres as fallback if not already set from track tags
          if (features.genres && !genres) {
            genres = features.genres;
          }
        }
      } catch (err) {
        console.warn(`[Sync] Failed to fetch audio features for ${trackTitle} by ${trackArtist}`);
      }
    }

    // 4. Derive single genre from genres array (for filtering/backwards compat)
    const genre = genres ? genres.split(', ')[0] : (track.genre || null);

    // 5. Upsert the track as a library node with enriched metadata
    upsertLibraryNode({
      id: track.id,
      title: trackTitle,
      artist: trackArtist,
      kind: track.kind || "track",
      bpm,
      genre,
      genres,
      listeners: track.listeners || track.popularity?.listeners || null,
      artwork_url: track.artworkUrl || null,
      previewUrl: track.previewUrl || null,
      year,
      danceability,
      acousticness
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