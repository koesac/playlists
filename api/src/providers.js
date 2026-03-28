const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379");

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const MUSICBRAINZ_USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT || "AIPlaylistStudio/0.1.0 (dev@example.com)";

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

async function musicbrainzFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, mbNextSlot - now);
  if (wait) await sleep(wait);
  mbNextSlot = Date.now() + 1100;

  const res = await fetch(url, {
    headers: {
      "User-Agent": MUSICBRAINZ_USER_AGENT,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`MusicBrainz error ${res.status}`);
  }

  return res.json();
}

function mbRecordingToTrack(rec) {
  const artistCredits = rec["artist-credit"] || [];
  const artists = artistCredits
    .map((a) => a.name)
    .filter(Boolean);

  const firstRelease = (rec.releases || [])[0] || null;

  return {
    trackKey: `mb:${rec.id}`,
    title: rec.title,
    artists,
    artist: artists[0] || "",
    album: firstRelease?.title || "",
    durationMs: rec.length || null,
    mbid: rec.id,
    releaseMbid: firstRelease?.id || null,
    artworkUrl: firstRelease?.id
      ? `https://coverartarchive.org/release/${firstRelease.id}/front-250`
      : null,
    providerRefs: [
      { source: "musicbrainz", mbid: rec.id }
    ]
  };
}

async function searchMusicBrainzTracks(q, limit = 12) {
  const key = `mb:search:${q}:${limit}`;
  return cacheJson(key, 3600, async () => {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    return (json.recordings || []).map(mbRecordingToTrack);
  });
}

async function getArtistTracks(artist, limit = 12) {
  const key = `mb:artisttracks:${artist}:${limit}`;
  return cacheJson(key, 3600, async () => {
    const q = `artist:"${artist}"`;
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    return dedupeTracks((json.recordings || []).map(mbRecordingToTrack));
  });
}

async function getAlbumTracks(artist, album, limit = 20) {
  const key = `mb:albumtracks:${artist}:${album}:${limit}`;
  return cacheJson(key, 3600, async () => {
    const q = `artist:"${artist}" AND release:"${album}"`;
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const json = await musicbrainzFetch(url);
    return dedupeTracks((json.recordings || []).map(mbRecordingToTrack));
  });
}

async function lastfmTrackInfo(artist, track) {
  if (!LASTFM_API_KEY) return null;

  const key = `lfm:info:${artist}:${track}`;
  return cacheJson(key, 3600, async () => {
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.searchParams.set("method", "track.getInfo");
    url.searchParams.set("api_key", LASTFM_API_KEY);
    url.searchParams.set("artist", artist);
    url.searchParams.set("track", track);
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("format", "json");

    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json.track || null;
  });
}

async function lastfmSimilar(artist, track, limit = 12) {
  if (!LASTFM_API_KEY) return [];

  const key = `lfm:similar:${artist}:${track}:${limit}`;
  return cacheJson(key, 3600, async () => {
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.searchParams.set("method", "track.getSimilar");
    url.searchParams.set("api_key", LASTFM_API_KEY);
    url.searchParams.set("artist", artist);
    url.searchParams.set("track", track);
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");

    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();

    return (json.similartracks?.track || []).map((t) => ({
      trackKey: `lfm:${(t.artist?.name || "").toLowerCase()}::${(t.name || "").toLowerCase()}`,
      title: t.name,
      artist: t.artist?.name || "",
      artists: [t.artist?.name || ""].filter(Boolean),
      similarity: Number(t.match || 0),
      artworkUrl: bestLastfmImage(t.image),
      providerRefs: [{ source: "lastfm", url: t.url || null }]
    }));
  });
}

function bestLastfmImage(images = []) {
  const reversed = [...images].reverse();
  const picked = reversed.find((img) => img["#text"]);
  return picked?.["#text"] || null;
}

async function appleSearchTrack(term) {
  const key = `apple:search:${term}`;
  return cacheJson(key, 86400, async () => {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", term);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "1");

    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json.results?.[0] || null;
  });
}

async function attachApplePreview(track) {
  const term = [track.artist || track.artists?.[0], track.title].filter(Boolean).join(" ");
  const hit = await appleSearchTrack(term);
  if (!hit) return track;

  return {
    ...track,
    previewUrl: hit.previewUrl || track.previewUrl || null,
    artworkUrl: track.artworkUrl || hit.artworkUrl100?.replace("100x100", "300x300") || null,
    durationMs: track.durationMs || hit.trackTimeMillis || null,
    providerRefs: [
      ...(track.providerRefs || []),
      {
        source: "apple",
        id: String(hit.trackId || ""),
        url: hit.trackViewUrl || null
      }
    ]
  };
}

function dedupeTracks(tracks) {
  const seen = new Set();
  return tracks.filter((t) => {
    const key = `${(t.artist || "").toLowerCase()}::${(t.title || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function hydrateSearchResults(tracks) {
  return Promise.all(tracks.map((t) => attachApplePreview(t)));
}

async function getTrackDetail({ artist, title, album }) {
  const [info, similar, artistTracks, albumTracks] = await Promise.all([
    lastfmTrackInfo(artist, title),
    lastfmSimilar(artist, title, 10),
    getArtistTracks(artist, 12),
    album ? getAlbumTracks(artist, album, 20) : Promise.resolve([])
  ]);

  const baseTrack = await attachApplePreview({
    trackKey: `track:${artist.toLowerCase()}::${title.toLowerCase()}`,
    title,
    artist,
    artists: [artist],
    album: album || info?.album?.title || "",
    durationMs: info?.duration ? Number(info.duration) : null,
    artworkUrl: bestLastfmImage(info?.album?.image || []) || null,
    popularity: {
      listeners: Number(info?.listeners || 0),
      playcount: Number(info?.playcount || 0)
    },
    providerRefs: []
  });

  return {
    track: {
      ...baseTrack,
      tags: (info?.toptags?.tag || []).slice(0, 8).map((t) => t.name)
    },
    popularity: {
      listeners: Number(info?.listeners || 0),
      playcount: Number(info?.playcount || 0)
    },
    similar,
    artistTracks,
    albumTracks
  };
}

module.exports = {
  redis,
  searchMusicBrainzTracks,
  hydrateSearchResults,
  getTrackDetail
};
