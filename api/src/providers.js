const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379");

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const GETSONGBPM_API_KEY = process.env.GETSONGBPM_API_KEY;
const LASTFM_NO_IMAGE_HASH = "2a96cbd8b46e442fc41c2b86b821562f";
const MUSICBRAINZ_USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT || "AIPlaylistStudio/0.1.0 (dev@example.com)";
const PREVIEW_DEBUG = process.env.PREVIEW_DEBUG === "1";

let mbNextSlot = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cacheJson(key, ttlSeconds, fn) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  const fresh = await fn();
  await redis.set(key, JSON.stringify(fresh), "EX", ttlSeconds);
  return fresh;
}

async function cacheJsonWithTtls(key, successTtlSeconds, missTtlSeconds, fn) {
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached);
  const fresh = await fn();
  const ttl = fresh ? successTtlSeconds : missTtlSeconds;
  if (ttl > 0) {
    await redis.set(key, JSON.stringify(fresh), "EX", ttl);
  }
  return fresh;
}

function isRetryableMusicBrainzStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function musicbrainzFetch(url, attempt = 0) {
  const now = Date.now();
  const wait = Math.max(0, mbNextSlot - now);
  if (wait) await sleep(wait);
  mbNextSlot = Date.now() + 1100;

  const res = await fetch(url, {
    headers: {
      "User-Agent": MUSICBRAINZ_USER_AGENT,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    if (attempt < 2 && isRetryableMusicBrainzStatus(res.status)) {
      await sleep(800 * (attempt + 1));
      return musicbrainzFetch(url, attempt + 1);
    }
    const error = new Error(`MusicBrainz error ${res.status}`);
    error.musicbrainz = true;
    error.status = res.status;
    throw error;
  }

  return res.json();
}

async function withMusicBrainzFallback(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    if (err?.musicbrainz || /^MusicBrainz error\s+\d+/.test(String(err?.message || ""))) {
      return typeof fallback === "function" ? fallback(err) : fallback;
    }
    throw err;
  }
}

function normalizeArtworkUrl(url = "") {
  const value = String(url || "").trim();
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;

  // Only upscale Apple/iTunes artwork. Last.fm and others might not support 600x600 via simple replacement.
  if (value.includes("mzstatic.com") || value.includes("itunes.apple.com")) {
    return value.replace(/\b(\d{2,4})x(\d{2,4})(bb)?\b/g, (_m, _w, _h, suffix = "") => {
      const tag = suffix || (value.includes("bb.") ? "bb" : "");
      return `600x600${tag}`;
    });
  }
  return value;
}

function coverArtArchiveUrl(releaseId, size = 250) {
  return releaseId ? `https://coverartarchive.org/release/${releaseId}/front-${size}` : null;
}

function bestLastfmImage(images = []) {
  const picked = [...images].reverse().find((img) => {
    const text = img["#text"];
    return text && !text.includes(LASTFM_NO_IMAGE_HASH);
  });
  return normalizeArtworkUrl(picked?.["#text"] || null);
}

function extractYear(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    const match = text.match(/\b(19|20)\d{2}\b/);
    if (match) return Number(match[0]);
  }
  return null;
}

function previewLog(event, payload = {}) {
  if (!PREVIEW_DEBUG) return;
  try {
    console.log(`[preview-debug] ${event}`, JSON.stringify(payload));
  } catch {
    console.log(`[preview-debug] ${event}`, payload);
  }
}

const APPLE_PREVIEW_CONCURRENCY = Math.max(1, Number(process.env.APPLE_PREVIEW_CONCURRENCY || 2));
let appleActiveRequests = 0;
const appleWaitQueue = [];

async function acquireAppleSlot() {
  if (appleActiveRequests < APPLE_PREVIEW_CONCURRENCY) {
    appleActiveRequests += 1;
    return;
  }
  await new Promise((resolve) => appleWaitQueue.push(resolve));
  appleActiveRequests += 1;
}

function releaseAppleSlot() {
  appleActiveRequests = Math.max(0, appleActiveRequests - 1);
  const next = appleWaitQueue.shift();
  if (next) next();
}

function isRetryableAppleStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function appleFetchJson(url, meta = {}, attempt = 0) {
  await acquireAppleSlot();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (attempt < 3 && isRetryableAppleStatus(res.status)) {
        const retryAfter = Number(res.headers.get("retry-after") || 0);
        const baseDelay = retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt);
        const jitter = Math.floor(Math.random() * 250);
        previewLog("apple-search-retry", { ...meta, status: res.status, attempt: attempt + 1, waitMs: baseDelay + jitter });
        await sleep(baseDelay + jitter);
        return appleFetchJson(url, meta, attempt + 1);
      }
      previewLog("apple-search-http-error", { ...meta, status: res.status, attempt });
      return null;
    }
    return res.json();
  } finally {
    releaseAppleSlot();
  }
}

function normalizeTitleForMatch(title = "") {
  return String(title || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, " ")
    .replace(/\b(remaster(?:ed)?|remix|mix|edit|version|live|acoustic|instrumental|karaoke|demo|session|radio edit|extended|club mix|dub|mono|stereo)\b/gi, " ")
    .replace(/[-–—:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVariantTitle(title = "") {
  return /\b(remaster(?:ed)?|remix|mix|edit|version|live|acoustic|instrumental|karaoke|demo|session|radio edit|extended|club mix|dub|mono|stereo)\b/i.test(String(title || ""));
}

function scoreAppleTrackHit(hit, track = {}) {
  const wantedArtist = String(track.artist || track.artists?.[0] || "").toLowerCase().trim();
  const wantedAlbum = String(track.album || "").toLowerCase().trim();
  const wantedTitle = normalizeTitleForMatch(track.title || "");
  const hitArtist = String(hit.artistName || "").toLowerCase().trim();
  const hitAlbum = String(hit.collectionName || "").toLowerCase().trim();
  const hitTitle = normalizeTitleForMatch(hit.trackName || "");
  const requestedVariant = isVariantTitle(track.title || "");
  const hitVariant = isVariantTitle(hit.trackName || "");

  let score = 0;
  if (wantedArtist && hitArtist === wantedArtist) score += 80;
  else if (wantedArtist && hitArtist.includes(wantedArtist)) score += 40;

  if (wantedTitle && hitTitle === wantedTitle) score += 120;
  else if (wantedTitle && hitTitle.includes(wantedTitle)) score += 50;
  else if (wantedTitle && wantedTitle.includes(hitTitle)) score += 25;

  if (wantedAlbum && hitAlbum === wantedAlbum) score += 18;
  if (hit.previewUrl) score += 12;
  if (!requestedVariant && hitVariant) score -= 90;
  if (track.title && String(hit.trackName || "").toLowerCase() === String(track.title).toLowerCase()) score += 20;

  return score;
}

function dedupeTracks(tracks) {
  const seen = new Set();
  return (tracks || []).filter((t) => {
    const key = `${(t.artist || "").toLowerCase()}::${normalizeTitleForMatch(t.title || "")}`;
    if (!t.artist || !t.title || !normalizeTitleForMatch(t.title || "") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterRecommendationTracks(tracks, options = {}) {
  const seedArtist = String(options.seedArtist || "").toLowerCase().trim();
  const seedTitle = normalizeTitleForMatch(options.seedTitle || "");
  const sameArtistOnly = Boolean(options.sameArtistOnly);
  const excludeSeedArtist = Boolean(options.excludeSeedArtist);
  const allowVariantSeed = isVariantTitle(options.seedTitle || "");

  return dedupeTracks(tracks).filter((track) => {
    const artist = String(track.artist || "").toLowerCase().trim();
    const title = normalizeTitleForMatch(track.title || "");
    if (!artist || !title) return false;
    if (seedArtist && seedTitle && artist === seedArtist && title === seedTitle) return false;
    if (sameArtistOnly && seedArtist && artist !== seedArtist) return false;
    if (excludeSeedArtist && seedArtist && artist === seedArtist) return false;
    if (!allowVariantSeed && isVariantTitle(track.title || "")) return false;
    return true;
  });
}

function mbRecordingToTrack(rec) {
  const artistCredits = rec["artist-credit"] || [];
  const artists = artistCredits.map((a) => a.name).filter(Boolean);
  const firstRelease = (rec.releases || [])[0] || null;

  return {
    type: "track",
    trackKey: `mb:${rec.id}`,
    title: rec.title,
    artists,
    artist: artists[0] || "",
    album: firstRelease?.title || "",
    durationMs: rec.length || null,
    mbid: rec.id,
    releaseMbid: firstRelease?.id || null,
    artworkUrl: coverArtArchiveUrl(firstRelease?.id, 250),
    providerRefs: [{ source: "musicbrainz", mbid: rec.id }]
  };
}

function mbArtistToArtist(artist) {
  return {
    type: "artist",
    artistKey: `mb-artist:${artist.id}`,
    id: artist.id,
    name: artist.name,
    sortName: artist["sort-name"] || "",
    country: artist.country || "",
    disambiguation: artist.disambiguation || "",
    area: artist.area?.name || "",
    tags: (artist.tags || []).slice(0, 6).map((t) => t.name),
    artworkUrl: null
  };
}

async function enrichArtistSearchResult(baseArtist) {
  if (!baseArtist?.name) return baseArtist;
  const info = await lastfmArtistInfo(baseArtist.name);
  return {
    ...baseArtist,
    artworkUrl: baseArtist.artworkUrl || bestLastfmImage(info?.image || []) || null
  };
}

async function searchMusicBrainzTracks(q, limit = 12) {
  const key = `mb:search:tracks:${q}:${limit}`;
  return withMusicBrainzFallback(() => cacheJson(key, 3600, async () => {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    return (json.recordings || []).map(mbRecordingToTrack);
  }), []);
}

async function searchMusicBrainzArtists(q, limit = 8) {
  const key = `mb:search:artists:${q}:${limit}`;
  return withMusicBrainzFallback(() => cacheJson(key, 3600, async () => {
    const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    const artists = (json.artists || []).map(mbArtistToArtist);
    return Promise.all(artists.map(enrichArtistSearchResult));
  }), []);
}

async function searchMusicBrainzReleases(artist, album, limit = 10) {
  const key = `mb:search:releases:${artist}:${album}:${limit}`;
  return withMusicBrainzFallback(() => cacheJson(key, 3600, async () => {
    const q = [artist ? `artist:"${artist}"` : "", album ? `release:"${album}"` : ""].filter(Boolean).join(" AND ");
    const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    return json.releases || [];
  }), []);
}

async function getArtistTracks(artist, limit = 12) {
  const key = `mb:artisttracks:${artist}:${limit}`;
  return withMusicBrainzFallback(() => cacheJson(key, 3600, async () => {
    const q = `artist:"${artist}"`;
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    return dedupeTracks((json.recordings || []).map(mbRecordingToTrack));
  }), []);
}

async function getAlbumTracks(artist, album, limit = 20) {
  const key = `mb:albumtracks:${artist}:${album}:${limit}`;
  return withMusicBrainzFallback(() => cacheJson(key, 3600, async () => {
    const q = `artist:"${artist}" AND release:"${album}"`;
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    return dedupeTracks((json.recordings || []).map(mbRecordingToTrack));
  }), []);
}

async function lastfmRequest(params, cacheKey, ttlSeconds = 86400) {
  if (!LASTFM_API_KEY) return null;

  return cacheJson(cacheKey, ttlSeconds, async () => {
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    url.searchParams.set("api_key", LASTFM_API_KEY);
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("format", "json");

    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  });
}

async function lastfmTrackInfo(artist, track) {
  const json = await lastfmRequest(
    { method: "track.getInfo", artist, track },
    `lfm:info:${artist}:${track}`
  );
  return json?.track || null;
}

async function lastfmArtistInfo(name) {
  const json = await lastfmRequest(
    { method: "artist.getInfo", artist: name },
    `lfm:artistinfo:${name}`
  );
  return json?.artist || null;
}

async function lastfmAlbumInfo(artist, album) {
  const json = await lastfmRequest(
    { method: "album.getInfo", artist, album },
    `lfm:albuminfo:${artist}:${album}`
  );
  return json?.album || null;
}

async function lastfmArtistTopTracks(artist, limit = 18) {
  const json = await lastfmRequest(
    { method: "artist.getTopTracks", artist, limit },
    `lfm:artist:toptracks:${artist}:${limit}`
  );

  return (json?.toptracks?.track || []).map((t) => ({
    type: "track",
    trackKey: `lfm-top:${(t.artist?.name || artist || "").toLowerCase()}::${normalizeTitleForMatch(t.name || "")}`,
    title: t.name,
    artist: t.artist?.name || artist || "",
    artists: [t.artist?.name || artist || ""].filter(Boolean),
    listeners: Number(t.listeners || 0),
    playcount: Number(t.playcount || 0),
    artworkUrl: bestLastfmImage(t.image),
    providerRefs: [{ source: "lastfm", url: t.url || null }]
  }));
}

async function lastfmArtistTopAlbums(artist, limit = 12) {
  const json = await lastfmRequest(
    { method: "artist.getTopAlbums", artist, limit },
    `lfmartisttopalbums:${artist}:${limit}`
  );
  return (json?.topalbums?.album || []).map((a) => ({
    name: a.name,
    artist,
    playcount: Number(a.playcount || 0),
    artworkUrl: bestLastfmImage(a.image),
  }));
}

async function lastfmTagTopTracks(tag, limit = 12) {
  const json = await lastfmRequest(
    { method: "tag.getTopTracks", tag, limit },
    `lfm:tag:tracks:${tag}:${limit}`
  );
  return json?.tracks?.track || [];
}

async function lastfmTagTopArtists(tag, limit = 12) {
  const json = await lastfmRequest(
    { method: "tag.getTopArtists", tag, limit },
    `lfm:tag:artists:${tag}:${limit}`
  );
  return json?.topartists?.artist || [];
}

async function lastfmTagTopAlbums(tag, limit = 12) {
  const json = await lastfmRequest(
    { method: "tag.getTopAlbums", tag, limit },
    `lfm:tag:albums:${tag}:${limit}`
  );
  return json?.albums?.album || [];
}

async function lastfmSimilar(artist, track, limit = 12) {
  const json = await lastfmRequest(
    { method: "track.getSimilar", artist, track, limit },
    `lfm:similar:${artist}:${track}:${limit}`
  );

  return (json?.similartracks?.track || []).map((t) => ({
    type: "track",
    trackKey: `lfm:${(t.artist?.name || "").toLowerCase()}::${(t.name || "").toLowerCase()}`,
    title: t.name,
    artist: t.artist?.name || "",
    artists: [t.artist?.name || ""].filter(Boolean),
    similarity: Number(t.match || 0),
    artworkUrl: bestLastfmImage(t.image),
    providerRefs: [{ source: "lastfm", url: t.url || null }]
  }));
}

async function appleSearchTrack(track) {
  const artist = track.artist || track.artists?.[0] || "";
  const title = track.title || "";
  const album = track.album || "";
  const term = [artist, title].filter(Boolean).join(" ");
  const key = `apple:search:${term}`;

  return cacheJsonWithTtls(key, 86400, 300, async () => {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", term);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "8");

    const json = await appleFetchJson(url, { term, artist, title, album });
    if (!json) return null;

    const ranked = (json.results || [])
      .map((hit) => ({
        hit,
        score: scoreAppleTrackHit(hit, track),
        hasPreview: Boolean(hit.previewUrl),
        artistName: hit.artistName || "",
        trackName: hit.trackName || "",
        collectionName: hit.collectionName || ""
      }))
      .sort((a, b) => b.score - a.score);

    previewLog("apple-search-ranked", {
      term,
      requested: { artist, title, album },
      top: ranked.slice(0, 5).map((item) => ({
        score: item.score,
        hasPreview: item.hasPreview,
        artistName: item.artistName,
        trackName: item.trackName,
        collectionName: item.collectionName
      }))
    });

    return ranked[0]?.score > 0 ? ranked[0].hit : null;
  });
}

async function resolveTrackPreview(track, options = {}) {
  const context = options.context || "preview";
  const startedAt = Date.now();
  let hit = await appleSearchTrack(track);

  // Fallback to MusicBrainz for artwork if Apple failed
  let mbTrack = null;
  if (!hit) {
    const artist = track.artist || track.artists?.[0] || "";
    const title = track.title || "";
    const mbResults = await searchMusicBrainzTracks(`artist:"${artist}" AND recording:"${title}"`, 1);
    mbTrack = mbResults[0];
  }

  previewLog("attach-apple-preview-result", {
    context,
    artist: track.artist || track.artists?.[0] || "",
    title: track.title || "",
    album: track.album || "",
    matched: Boolean(hit),
    hasPreview: Boolean(hit?.previewUrl),
    mbMatched: Boolean(mbTrack),
    durationMs: Date.now() - startedAt,
    chosen: hit ? {
      artistName: hit.artistName || "",
      trackName: hit.trackName || "",
      collectionName: hit.collectionName || ""
    } : (mbTrack ? { mbMatched: true } : null)
  });

  if (!hit) {
    return {
      previewUrl: "",
      artworkUrl: track.artworkUrl || mbTrack?.artworkUrl || "",
      durationMs: track.durationMs || mbTrack?.durationMs || null,
      providerRef: mbTrack?.providerRefs?.[0] || null
    };
  }

  const appleArt = normalizeArtworkUrl(hit.artworkUrl100 || hit.artworkUrl60 || "");
  return {
    previewUrl: hit.previewUrl || track.previewUrl || "",
    artworkUrl: appleArt || track.artworkUrl || "",
    durationMs: track.durationMs || hit.trackTimeMillis || null,
    providerRef: { source: "apple", id: String(hit.trackId || ""), url: hit.trackViewUrl || null }
  };
}

async function attachApplePreview(track, options = {}) {
  const preview = await resolveTrackPreview(track, options);

  return {
    ...track,
    previewUrl: preview.previewUrl || track.previewUrl || "",
    artworkUrl: normalizeArtworkUrl(track.artworkUrl || preview.artworkUrl || "") || null,
    durationMs: track.durationMs || preview.durationMs || null,
    providerRefs: [
      ...(track.providerRefs || []),
      ...(preview.providerRef ? [preview.providerRef] : [])
    ]
  };
}

async function hydrateSearchResults(tracks) {
  if (!tracks) return [];

  // Hydrate tracks missing artwork using Apple Music as a fallback.
  return Promise.all((tracks || []).map(async (track) => {
    if (track.artworkUrl) return track;
    const hit = await appleSearchTrack(track);
    if (hit) {
      return {
        ...track,
        artworkUrl: normalizeArtworkUrl(hit.artworkUrl100 || hit.artworkUrl60 || "") || ""
      };
    }
    return track;
  }));
}

async function getArtistDetail(name) {
  const [artistInfo, topTracks, mbTracks, topAlbums] = await Promise.all([
    lastfmArtistInfo(name),
    lastfmArtistTopTracks(name, 24),
    getArtistTracks(name, 24),
    lastfmArtistTopAlbums(name, 12)
  ]);

  const tunedTracks = filterRecommendationTracks(
    topTracks.length ? [...topTracks, ...mbTracks] : mbTracks,
    { seedArtist: name, sameArtistOnly: true }
  ).slice(0, 18);

  return {
    artist: {
      type: "artist",
      name,
      bio: artistInfo?.bio?.summary || "",
      tags: (artistInfo?.tags?.tag || []).slice(0, 8).map((t) => t.name),
      listeners: Number(artistInfo?.stats?.listeners || 0),
      playcount: Number(artistInfo?.stats?.playcount || 0),
      artworkUrl: bestLastfmImage(artistInfo?.image || []) || null,
      albums: topAlbums
    },
    tracks: tunedTracks
  };
}

async function getTrackDetail({ artist, title, album }) {
  const previewSeedPromise = attachApplePreview({
    type: "track",
    trackKey: `track:${artist.toLowerCase()}::${title.toLowerCase()}`,
    title,
    artist,
    artists: [artist],
    album: album || "",
    providerRefs: []
  }, { context: "track-detail-base" });

  const [previewSeed, info, similar, topArtistTracks, fallbackArtistTracks, albumTracks] = await Promise.all([
    previewSeedPromise,
    lastfmTrackInfo(artist, title),
    lastfmSimilar(artist, title, 18),
    lastfmArtistTopTracks(artist, 24),
    getArtistTracks(artist, 24),
    album ? getAlbumTracks(artist, album, 24) : Promise.resolve([])
  ]);

  const inferredYear = extractYear(
    info?.wiki?.published,
    info?.album?.releasedate,
    info?.album?.published,
    previewSeed?.releaseDate,
    previewSeed?.release_date
  );

  const baseTrack = {
    ...previewSeed,
    type: "track",
    trackKey: `track:${artist.toLowerCase()}::${title.toLowerCase()}`,
    title,
    artist,
    artists: [artist],
    album: album || info?.album?.title || previewSeed.album || "",
    year: inferredYear,
    durationMs: previewSeed.durationMs || (info?.duration ? Number(info.duration) : null),
    artworkUrl: previewSeed.artworkUrl || bestLastfmImage(info?.album?.image || []) || null,
    popularity: {
      listeners: Number(info?.listeners || 0),
      playcount: Number(info?.playcount || 0)
    },
    providerRefs: previewSeed.providerRefs || []
  };

  const tunedSimilar = filterRecommendationTracks(similar || [], {
    seedArtist: artist,
    seedTitle: title,
    excludeSeedArtist: true
  })
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 12);

  const tunedArtistTracks = filterRecommendationTracks(
    topArtistTracks.length ? [...topArtistTracks, ...fallbackArtistTracks] : fallbackArtistTracks,
    {
      seedArtist: artist,
      seedTitle: title,
      sameArtistOnly: true
    }
  ).slice(0, 8);

  const tunedAlbumTracks = filterRecommendationTracks(albumTracks || [], {
    seedArtist: artist,
    seedTitle: title,
    sameArtistOnly: true
  }).slice(0, 12);

  return {
    track: {
      ...baseTrack,
      tags: (info?.toptags?.tag || []).slice(0, 8).map((t) => t.name)
    },
    popularity: {
      listeners: Number(info?.listeners || 0),
      playcount: Number(info?.playcount || 0)
    },
    year: inferredYear,
    similar: tunedSimilar,
    artistTracks: tunedArtistTracks,
    albumTracks: tunedAlbumTracks
  };
}

async function getAlbumDetail({ artist, album }) {
  const [albumInfo, albumTracks, releaseHits] = await Promise.all([
    lastfmAlbumInfo(artist, album),
    getAlbumTracks(artist, album, 24),
    searchMusicBrainzReleases(artist, album, 6)
  ]);

  const tags = (albumInfo?.tags?.tag || []).slice(0, 8).map((t) => t.name);
  const release = releaseHits[0] || null;
  const tunedTracks = filterRecommendationTracks(albumTracks || [], {
    seedArtist: artist,
    sameArtistOnly: true
  }).slice(0, 24);

  return {
    album: {
      type: "album",
      name: album,
      artist,
      listeners: Number(albumInfo?.listeners || 0),
      playcount: Number(albumInfo?.playcount || 0),
      tags,
      artworkUrl: bestLastfmImage(albumInfo?.image || []) || coverArtArchiveUrl(release?.id, 250),
      wiki: albumInfo?.wiki?.summary || "",
      mbid: release?.id || null
    },
    tracks: tunedTracks
  };
}

async function getGenreDetail(tag) {
  const [tracks, artists, albums] = await Promise.all([
    lastfmTagTopTracks(tag, 12),
    lastfmTagTopArtists(tag, 12),
    lastfmTagTopAlbums(tag, 12)
  ]);

  const normalizedTracks = (
    (tracks || []).map((t) => ({
      type: "track",
      trackKey: `tag:${tag}:${(t.artist?.name || "").toLowerCase()}::${(t.name || "").toLowerCase()}`,
      title: t.name,
      artist: t.artist?.name || "",
      artists: [t.artist?.name || ""].filter(Boolean),
      durationMs: t.duration ? Number(t.duration) * 1000 : null,
      artworkUrl: bestLastfmImage(t.image),
      providerRefs: [{ source: "lastfm", url: t.url || null }]
    }))
  );

  const normalizedArtists = (artists || []).map((artist) => ({
    type: "artist",
    name: artist.name,
    listeners: Number(artist.listeners || 0),
    artworkUrl: bestLastfmImage(artist.image),
    providerRefs: [{ source: "lastfm", url: artist.url || null }]
  }));

  const normalizedAlbums = (albums || []).map((album) => ({
    type: "album",
    name: album.name,
    artist: album.artist?.name || album.artist || "",
    artworkUrl: bestLastfmImage(album.image),
    providerRefs: [{ source: "lastfm", url: album.url || null }]
  }));

  return {
    genre: { type: "genre", name: tag },
    tracks: normalizedTracks,
    artists: normalizedArtists,
    albums: normalizedAlbums
  };
}

// --- Deezer search ---
async function searchDeezerTracks(q, limit = 12) {
  const key = `dz:search:tracks:${q}:${limit}`;
  return cacheJson(key, 1800, async () => {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}&order=RANKING`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || []).map(t => ({
      type: 'track',
      trackKey: `dz-${t.id}`,
      title: t.title,
      artist: t.artist?.name,
      artists: [t.artist?.name].filter(Boolean),
      album: t.album?.title,
      artworkUrl: t.album?.cover_medium || null,
      previewUrl: t.preview || null,
      rank: t.rank || 0,
      providerRefs: [{ source: 'deezer', id: String(t.id), url: t.link }],
    }));
  });
}

async function searchDeezerArtists(q, limit = 8) {
  const key = `dz:search:artists:${q}:${limit}`;
  return cacheJson(key, 1800, async () => {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || []).map(a => ({
      type: 'artist',
      id: `dz-artist-${a.id}`,
      name: a.name,
      artworkUrl: a.picture_medium || null,
      providerRefs: [{ source: 'deezer', id: String(a.id), url: a.link }],
    }));
  });
}

async function searchItunesTracks(q, limit = 12) {
  const key = `itunes:search:tracks:${q}:${limit}`;
  return cacheJson(key, 1800, async () => {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', q);
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('limit', String(limit));
    const json = await appleFetchJson(url.toString(), { q });
    if (!json) return [];
    return (json.results || []).map(t => ({
      type: 'track',
      trackKey: `itunes-${t.trackId}`,
      title: t.trackName,
      artist: t.artistName,
      artists: [t.artistName].filter(Boolean),
      album: t.collectionName,
      artworkUrl: normalizeArtworkUrl(t.artworkUrl100),
      previewUrl: t.previewUrl || null,
      providerRefs: [{ source: 'apple', id: String(t.trackId), url: t.trackViewUrl }],
    }));
  });
}

// --- GetSongBPM integration ---
async function getBPM(artist, title) {
  const key = `bpm:${artist.toLowerCase()}:${title.toLowerCase()}`;
  return cacheJson(key, 86400 * 30, async () => { // Cache for 30 days
    if (!GETSONGBPM_API_KEY) return null;
    const url = `https://api.getsongbpm.com/v2/search?api_key=${GETSONGBPM_API_KEY}&type=song&lookup=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      // GetSongBPM returns results with tempo information
      const result = json?.result?.[0];
      if (result && result.bpm) {
        return Math.round(result.bpm);
      }
      return null;
    } catch {
      return null;
    }
  });
}

// --- Similarity computation for graph edges ---
function computeSimilarity(trackA, trackB) {
  let weight = 0;

  // BPM similarity (strong signal)
  if (trackA.bpm && trackB.bpm) {
    const bpmDiff = Math.abs(trackA.bpm - trackB.bpm);
    if (bpmDiff === 0) weight += 0.4;
    else if (bpmDiff <= 5) weight += 0.3;
    else if (bpmDiff <= 15) weight += 0.15;
    else if (bpmDiff <= 30) weight += 0.05;
  }

  // Genre similarity
  if (trackA.genre && trackB.genre && trackA.genre.toLowerCase() === trackB.genre.toLowerCase()) {
    weight += 0.3;
  }

  // Artist similarity (bonus for same artist)
  if (trackA.artist && trackB.artist && trackA.artist.toLowerCase() === trackB.artist.toLowerCase()) {
    weight += 0.2;
  }

  return Math.min(weight, 1.0);
}

async function computeAndStoreEdgesForTrack(track) {
  const { listTracks, upsertEdgesBulk } = require('./db');
  const allTracks = listTracks(10000);
  const edges = [];

  for (const other of allTracks) {
    if (other.id === track.id) continue;
    const weight = computeSimilarity(track, other);
    if (weight > 0.1) { // Only store meaningful connections
      edges.push({ sourceId: track.id, targetId: other.id, weight });
    }
  }

  if (edges.length > 0) {
    upsertEdgesBulk(edges);
  }

  return edges;
}

module.exports = {
  redis,
  searchMusicBrainzTracks,
  searchMusicBrainzArtists,
  searchDeezerTracks,
  searchDeezerArtists,
  searchItunesTracks,
  getBPM,
  computeSimilarity,
  computeAndStoreEdgesForTrack,
  hydrateSearchResults,
  resolveTrackPreview,
  getTrackDetail,
  getArtistDetail,
  getAlbumDetail,
  getGenreDetail
};
