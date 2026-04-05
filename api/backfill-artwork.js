#!/usr/bin/env node
/**
 * backfill-artwork.js
 *
 * Replaces missing or placeholder artwork URLs in the `library_nodes` table.
 *
 * "Placeholder" artwork is the grey-star image served by Last.fm when a track
 * has no real artwork — it is identified by the hash 2a96cbd8b46e442fc41c2b86b821562f
 * present in its CDN URL.  Earlier import versions stored this URL directly
 * via the COALESCE upsert logic, which then blocked any future legitimate artwork
 * from overwriting it.
 *
 * Artwork lookup waterfall per node:
 *   1. Apple iTunes Search API  (best quality — upscaled to 600x600, no key required)
 *   2. Deezer Direct (for dz-NNNN node IDs)  (cover_xl, ~500px, no key required)
 *   3. Deezer Search API        (cover_xl, ~500px, no key required)
 *   4. Cover Art Archive        (only for nodes whose ID encodes a MusicBrainz UUID)
 *   5. Last.fm track.getInfo    (tertiary; requires LASTFM_API_KEY env var)
 *
 * Usage:
 *   node backfill-artwork.js [options]
 *
 * Options:
 *   --dry-run        Preview changes without writing to the database
 *   --all            Re-process ALL nodes, not just missing/placeholder ones
 *   --kind KIND      Filter to a specific node kind: track | artist | album | genre
 *   --limit N        Stop after processing N nodes  (default: unlimited)
 *   --delay N        ms between external API calls  (default: 400)
 *   --concurrency N  Parallel requests              (default: 3, max: 6)
 *   --log FILE       Write JSON change-log to FILE  (default: artwork-backfill.log)
 *
 * Environment:
 *   DB_PATH          Path to the SQLite file (default: ./data/app.db)
 *   LASTFM_API_KEY   Optional — enables Last.fm fallback
 *
 * Examples:
 *   node backfill-artwork.js --dry-run
 *   node backfill-artwork.js --limit 500 --delay 300
 *   node backfill-artwork.js --all --kind track
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const { performance } = require('perf_hooks');

// ─── CLI args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const getFlag = (name, defaultVal) => {
  const i = argv.indexOf(name);
  if (i === -1) return defaultVal;
  return typeof defaultVal === 'boolean' ? true : (argv[i + 1] ?? defaultVal);
};

const DRY_RUN     = getFlag('--dry-run', false);
const PROCESS_ALL = getFlag('--all', false);
const KIND_FILTER = getFlag('--kind', null);
const LIMIT       = parseInt(getFlag('--limit', '0'), 10) || Infinity;
const DELAY_MS    = parseInt(getFlag('--delay', '400'), 10);
const CONCURRENCY = Math.min(6, parseInt(getFlag('--concurrency', '3'), 10));
const LOG_FILE    = getFlag('--log', 'artwork-backfill.log');

const DB_PATH      = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const LASTFM_KEY   = process.env.LASTFM_API_KEY || process.env.LASTFMAPIKEY || '';
const MB_UA        = process.env.MUSICBRAINZ_USERAGENT || 'ArtworkBackfill/1.0 backfill@example.com';

const LASTFM_NO_IMAGE_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

// UUID regex — used to detect MusicBrainz IDs embedded in node IDs
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ─── Database ─────────────────────────────────────────────────────────────────

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH, { readonly: DRY_RUN });
} catch (err) {
  console.error(`\n✗ Cannot open database at ${DB_PATH}`);
  console.error(`  ${err.message}`);
  console.error(`\n  Make sure DB_PATH is set correctly and better-sqlite3 is installed.\n`);
  process.exit(1);
}

const updateArtwork = DRY_RUN
  ? () => {}
  : db.prepare(`UPDATE library_nodes SET artwork_url = ? WHERE id = ?`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isPlaceholderUrl(url) {
  if (!url || !url.trim()) return true;
  return url.includes(LASTFM_NO_IMAGE_HASH);
}

function normalizeArtworkUrl(url) {
  if (!url) return null;
  const v = String(url).trim();
  if (!v) return null;
  // Ensure protocol
  const absolute = v.startsWith('//') ? `https:${v}` : v;
  // Upscale Apple / iTunes CDN artwork to 600x600
  if (absolute.includes('mzstatic.com') || absolute.includes('itunes.apple.com')) {
    return absolute.replace(/\d+x\d+bb(\.[a-z]+)$/i, (_, ext) => `600x600bb${ext}`);
  }
  return absolute;
}

function normalizeTitleForMatch(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\b(remaster(ed)?|remix(ed)?|mix|edit|version|live|acoustic|instrumental|karaoke|demo|session|radio edit|extended|club mix|dub|mono|stereo)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreAppleHit(hit, wantedArtist, wantedTitle) {
  const wa = String(wantedArtist).toLowerCase().trim();
  const wt = normalizeTitleForMatch(wantedTitle);
  const ha = String(hit.artistName).toLowerCase().trim();
  const ht = normalizeTitleForMatch(hit.trackName);
  let score = 0;
  if (wa && ha === wa) score += 80; else if (wa && ha.includes(wa)) score += 40;
  if (wt && ht === wt) score += 120; else if (wt && ht.includes(wt)) score += 50;
  if (hit.artworkUrl100) score += 10;
  return score;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  constructor(delayMs, concurrency) {
    this.delay       = delayMs;
    this.concurrency = concurrency;
    this.active      = 0;
    this.queue       = [];
    this.lastCall    = 0;
  }

  async run(fn) {
    if (this.active >= this.concurrency) {
      await new Promise(r => this.queue.push(r));
    }
    this.active++;

    const now     = performance.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.delay) await sleep(this.delay - elapsed);
    this.lastCall = performance.now();

    try {
      return await fn();
    } finally {
      this.active--;
      if (this.queue.length) this.queue.shift()();
    }
  }
}

const limiter = new RateLimiter(DELAY_MS, CONCURRENCY);

// ─── Artwork sources ──────────────────────────────────────────────────────────

/**
 * Apple iTunes Search — primary source.
 * Returns a 600x600 upscaled URL or null.
 */
async function fetchAppleArtwork(title, artist) {
  if (!title && !artist) return null;
  const term = encodeURIComponent([artist, title].filter(Boolean).join(' '));
  const url  = `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=8`;

  return limiter.run(async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.results?.length) return null;

      const ranked = json.results
        .map(hit => ({ hit, score: scoreAppleHit(hit, artist, title) }))
        .sort((a, b) => b.score - a.score);

      if (ranked[0].score < 40) return null;

      const art = ranked[0].hit.artworkUrl100 || ranked[0].hit.artworkUrl60;
      return normalizeArtworkUrl(art);
    } catch {
      return null;
    }
  });
}

/**
 * Deezer Search API — secondary source.
 * Returns cover_xl (~500px) or null.
 */
async function fetchDeezerArtwork(title, artist) {
  if (!title && !artist) return null;
  const q   = encodeURIComponent([artist, title].filter(Boolean).join(' '));
  const url = `https://api.deezer.com/search?q=${q}&limit=5&order=RANKING`;

  return limiter.run(async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = await res.json();
      const hit  = json?.data?.[0];
      if (!hit?.album) return null;
      // Prefer cover_xl then cover_big
      const art = hit.album.cover_xl || hit.album.cover_big || hit.album.cover_medium;
      return art && !art.includes('/nocover') ? art : null;
    } catch {
      return null;
    }
  });
}

/**
 * Deezer direct track lookup by Deezer track ID.
 * Used when the node ID is in `dz-NNNN` format.
 */
async function fetchDeezerArtworkById(deezerId) {
  const url = `https://api.deezer.com/track/${deezerId}`;

  return limiter.run(async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = await res.json();
      const art  = json?.album?.cover_xl || json?.album?.cover_big;
      return art && !art.includes('/nocover') ? art : null;
    } catch {
      return null;
    }
  });
}

/**
 * Cover Art Archive — used when a MusicBrainz release UUID is available.
 * Returns a 250px front cover URL or null.
 */
async function fetchCoverArtArchive(mbid) {
  // The CAA redirects to the actual image; we follow the redirect
  const url = `https://coverartarchive.org/release/${mbid}/front-250`;

  return limiter.run(async () => {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      return res.url || url;
    } catch {
      return null;
    }
  });
}

/**
 * Last.fm track.getInfo — tertiary source.
 * Requires LASTFM_API_KEY environment variable.
 */
async function fetchLastfmArtwork(title, artist) {
  if (!LASTFM_KEY || !title || !artist) return null;
  const params = new URLSearchParams({
    method: 'track.getInfo',
    artist,
    track: title,
    api_key: LASTFM_KEY,
    autocorrect: '1',
    format: 'json',
  });
  const url = `https://ws.audioscrobbler.com/2.0/?${params}`;

  return limiter.run(async () => {
    try {
      const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = await res.json();
      const images = json?.track?.album?.image ?? [];
      // Walk from largest to smallest, skip the no-image placeholder
      const picked = [...images].reverse().find(img => {
        const t = img['#text'] || img.text || '';
        return t && !t.includes(LASTFM_NO_IMAGE_HASH);
      });
      return normalizeArtworkUrl(picked?.['#text'] || picked?.text) || null;
    } catch {
      return null;
    }
  });
}

/**
 * Full artwork resolution waterfall for a single library node.
 * Returns { url: string|null, source: string }
 */
async function resolveArtwork(node) {
  const { id, title, artist } = node;

  // ── 1. Apple iTunes ───────────────────────────────────────────────────────
  if (node.kind === 'track' || node.kind === 'album') {
    const url = await fetchAppleArtwork(title, artist);
    if (url) return { url, source: 'apple' };
  }

  // ── 2. Deezer direct (for nodes ingested from Deezer) ─────────────────────
  const dzMatch = /^dz-(\d+)$/.exec(id);
  if (dzMatch) {
    const url = await fetchDeezerArtworkById(dzMatch[1]);
    if (url) return { url, source: 'deezer-direct' };
  }

  // ── 3. Deezer search ──────────────────────────────────────────────────────
  {
    const url = await fetchDeezerArtwork(title, artist);
    if (url) return { url, source: 'deezer-search' };
  }

  // ── 4. Cover Art Archive (MusicBrainz UUID in node ID) ───────────────────
  const mbidMatch = UUID_RE.exec(id);
  if (mbidMatch) {
    const url = await fetchCoverArtArchive(mbidMatch[0]);
    if (url) return { url, source: 'cover-art-archive' };
  }

  // ── 5. Last.fm fallback ───────────────────────────────────────────────────
  {
    const url = await fetchLastfmArtwork(title, artist);
    if (url) return { url, source: 'lastfm' };
  }

  return { url: null, source: 'none' };
}

// ─── Progress display ─────────────────────────────────────────────────────────

function progressLine(done, total, updated, skipped, failed) {
  const pct  = total ? Math.round((done / total) * 100) : 0;
  const bar  = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(
    `\r  [${bar}] ${pct}%  ${done}/${total}  ✓${updated}  –${skipped}  ✗${failed}  `
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(  '║        Library Artwork Backfill Script       ║');
  console.log(  '╚══════════════════════════════════════════════╝\n');

  if (DRY_RUN)     console.log('  ⚠  DRY RUN — no database writes will occur\n');
  if (PROCESS_ALL) console.log('  ⚠  --all flag: processing every node regardless of current artwork\n');

  // ── Build query based on flags ───────────────────────────────────────────

  let whereClause = PROCESS_ALL
    ? 'WHERE 1=1'
    : `WHERE (artwork_url IS NULL OR artwork_url = '' OR artwork_url LIKE '%${LASTFM_NO_IMAGE_HASH}%')`;

  if (KIND_FILTER) {
    whereClause += ` AND kind = '${KIND_FILTER.replace(/'/g, '')}'`;
  }

  const nodes = db
    .prepare(`SELECT id, title, artist, kind, artwork_url FROM library_nodes ${whereClause} ORDER BY kind, artist, title`)
    .all();

  const toProcess = nodes.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  // ── Stats ────────────────────────────────────────────────────────────────

  const allCount = db.prepare('SELECT COUNT(*) as n FROM library_nodes').get().n;
  const badCount = db.prepare(
    `SELECT COUNT(*) as n FROM library_nodes WHERE artwork_url IS NULL OR artwork_url = '' OR artwork_url LIKE '%${LASTFM_NO_IMAGE_HASH}%'`
  ).get().n;

  console.log(`  Database       : ${DB_PATH}`);
  console.log(`  Total nodes    : ${allCount}`);
  console.log(`  Missing/bad    : ${badCount}`);
  console.log(`  To process     : ${toProcess.length}`);
  console.log(`  Delay          : ${DELAY_MS}ms | Concurrency: ${CONCURRENCY}`);
  if (LASTFM_KEY) console.log('  Last.fm        : enabled (fallback source)');
  console.log('');

  if (toProcess.length === 0) {
    console.log('  ✓ Nothing to backfill — all nodes already have artwork.\n');
    process.exit(0);
  }

  // ── Process ──────────────────────────────────────────────────────────────

  const log        = [];
  let updated = 0, skipped = 0, failed = 0;
  const startTime  = performance.now();

  console.log('  Processing...\n');

  // Process in batches matching concurrency
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async node => {
      const { url, source } = await resolveArtwork(node);

      const entry = {
        id:      node.id,
        title:   node.title,
        artist:  node.artist,
        kind:    node.kind,
        old:     node.artwork_url || null,
        new:     url,
        source,
      };

      if (url) {
        if (!DRY_RUN) updateArtwork.run(url, node.id);
        updated++;
        entry.status = 'updated';
      } else {
        failed++;
        entry.status = 'not-found';
      }

      log.push(entry);
    }));

    progressLine(Math.min(i + CONCURRENCY, toProcess.length), toProcess.length, updated, skipped, failed);
  }

  // Final newline after progress bar
  process.stdout.write('\n\n');

  // ── Summary ───────────────────────────────────────────────────────────────

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

  console.log('  ┌─────────────────────────────────────┐');
  console.log(`  │  Done in ${elapsed.padStart(6)}s                      │`);
  console.log(`  │  Updated  : ${String(updated).padEnd(24)} │`);
  console.log(`  │  Not found: ${String(failed).padEnd(24)} │`);
  console.log(`  │  DRY RUN  : ${String(DRY_RUN).padEnd(24)} │`);
  console.log('  └─────────────────────────────────────┘\n');

  // Source breakdown
  const bySource = {};
  log.filter(e => e.status === 'updated').forEach(e => {
    bySource[e.source] = (bySource[e.source] || 0) + 1;
  });
  if (Object.keys(bySource).length) {
    console.log('  Artwork sources used:');
    Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .forEach(([src, n]) => console.log(`    ${src.padEnd(20)} ${n}`));
    console.log('');
  }

  // Not-found list (capped at 20 to avoid flooding terminal)
  const notFound = log.filter(e => e.status === 'not-found');
  if (notFound.length) {
    console.log(`  ✗ Could not find artwork for ${notFound.length} nodes:`);
    notFound.slice(0, 20).forEach(e =>
      console.log(`    [${e.kind}] "${e.title}" — ${e.artist || '(no artist)'}`)
    );
    if (notFound.length > 20)
      console.log(`    ... and ${notFound.length - 20} more (see ${LOG_FILE})`);
    console.log('');
  }

  // Write log file
  try {
    fs.writeFileSync(
      LOG_FILE,
      JSON.stringify({ runAt: new Date().toISOString(), dryRun: DRY_RUN, updated, failed, entries: log }, null, 2)
    );
    console.log(`  Log written to: ${LOG_FILE}\n`);
  } catch (e) {
    console.warn(`  ⚠ Could not write log file: ${e.message}\n`);
  }

  process.exit(failed === toProcess.length && toProcess.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err.message);
  process.exit(1);
});