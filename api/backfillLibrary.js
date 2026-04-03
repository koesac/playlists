const db = require('./src/db');
const { syncPlaylistToLibrary } = require('./src/librarySync');

async function runBackfill() {
  console.log('[Backfill] Starting Library backfill from existing drafts...');

  // 1. Fetch all saved drafts from the SQLite database
  const drafts = db.listDrafts();
  const allTracks = new Map();

  for (const draftMeta of drafts) {
    // Load the full JSON payload
    const draft = db.getDraft(draftMeta.id);
    if (!draft || !draft.data || !draft.data.playlist) continue;

    // 2. Deduplicate tracks across all playlists
    for (const track of draft.data.playlist) {
      if (track.kind === 'track' && track.id) {
        if (!allTracks.has(track.id)) {
          allTracks.set(track.id, track);
        }
      }
    }
  }

  const uniqueTracks = Array.from(allTracks.values());
  console.log(`[Backfill] Found ${uniqueTracks.length} unique tracks across ${drafts.length} drafts.`);

  if (uniqueTracks.length === 0) {
    console.log('[Backfill] No tracks found to sync. Exiting.');
    return;
  }

  // 3. Feed the combined list into the sync worker
  console.log('[Backfill] Initiating Last.fm similarity sync...');
  try {
    await syncPlaylistToLibrary(uniqueTracks);
    console.log('[Backfill] ✅ Backfill complete!');
  } catch (err) {
    console.error('[Backfill] ❌ Error during sync:', err);
  }
}

// Execute the function
runBackfill().then(() => process.exit(0));