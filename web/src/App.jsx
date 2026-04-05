import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Routes, Route } from "react-router-dom";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import ThemeToggle from "./ThemeToggle";
import LibraryGraph from "./LibraryGraph";
import { useStudio } from './StudioContext';

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

function entityColor(kind) {
  return {
    track: "#a855f7", // brighter purple
    artist: "#0ea5e9",
    album: "#f59e0b",
    genre: "#22c55e"
  }[kind] || "#94a3b8";
}

function ghostAccentColor(relation) {
  const map = {
    'related-track':  'a78bfa',  // violet — similar tracks
    'artist-track':   '0ea5e9',  // cyan   — matches artist node color
    'album-track':    'f59e0b',  // amber  — matches album node color
    'track':          '94a3b8',  // gray   — generic from artist/album
    'top-track':      'a78bfa',  // violet — genre top tracks
    'top-artist':     '0ea5e9',  // cyan
    'top-album':      'f59e0b',  // amber
    'genre':          '22c55e',  // green
    'artist':         '0ea5e9',  // cyan
    'album':          'f59e0b',  // amber
  };
  return map[relation] ?? '94a3b8';
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeId(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function normalizeSearchText(text) {
  return String(text || "").trim().toLowerCase();
}

function normalizePreviewMatchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, " ")
    .replace(/\b(remaster(?:ed)?|remix|mix|edit|version|live|acoustic|instrumental|demo|session|radio edit|extended|club mix|dub|mono|stereo)\b/gi, " ")
    .replace(/[-–—:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scorePreviewSearchCandidate(candidate, wantedArtist, wantedTitle, wantedAlbum = "") {
  const artist = normalizeSearchText(candidate?.artist);
  const title = normalizePreviewMatchText(candidate?.title);
  const album = normalizeSearchText(candidate?.album);
  const wantedArtistNorm = normalizeSearchText(wantedArtist);
  const wantedTitleNorm = normalizePreviewMatchText(wantedTitle);
  const wantedAlbumNorm = normalizeSearchText(wantedAlbum);
  let score = 0;
  if (artist && wantedArtistNorm && artist === wantedArtistNorm) score += 100;
  else if (artist && wantedArtistNorm && (artist.includes(wantedArtistNorm) || wantedArtistNorm.includes(artist))) score += 40;
  if (title && wantedTitleNorm && title === wantedTitleNorm) score += 140;
  else if (title && wantedTitleNorm && (title.includes(wantedTitleNorm) || wantedTitleNorm.includes(title))) score += 50;
  if (album && wantedAlbumNorm && album === wantedAlbumNorm) score += 15;
  if (candidate?.previewUrl) score += 25;
  return score;
}

function trackKey(artist, title) {
  return safeId(`${artist}:${title}`);
}

function albumKey(artist, album) {
  return safeId(`${artist}:${album}`);
}

function artistSearchScore(query, artist) {
  const q = normalizeSearchText(query);
  const name = normalizeSearchText(artist?.name);
  if (!q || !name) return 0;
  if (name === q) return 200;
  if (name.startsWith(q)) return 160;
  if (q.startsWith(name)) return 130; // "beatles hey jude" — query begins with artist
  if (name.includes(q)) return 90;
  const qWords = q.split(/\s+/).filter(Boolean);
  const hits = qWords.filter(w => name.includes(w));
  if (!hits.length) return 0;
  // Penalise if it looks like a composite query (not all words match artist name)
  return hits.length === qWords.length
    ? 50 + hits.length * 12
    : 20 + hits.length * 8;
}

function scoreTrack(track, query) {
  const q = normalizeSearchText(query);
  const words = q.split(/\s+/).filter(Boolean);
  const title = normalizePreviewMatchText(track.title || '');
  const artist = normalizeSearchText(track.artist || '');
  const combined = `${artist} ${title}`;
  const combinedAlt = `${title} ${artist}`;
  let score = 0;

  // Title matches
  if (title === q)              score += 200;
  else if (title.startsWith(q)) score += 150;
  else if (title.includes(q))   score += 85;

  // Artist matches
  if (artist === q)               score += 160;
  else if (artist.startsWith(q))  score += 110;
  else if (artist.includes(q))    score += 55;

  // Composite "artist title" or "title artist" matches
  if (combined === q || combinedAlt === q)             score += 260;
  else if (combined.startsWith(q) || combinedAlt.startsWith(q)) score += 190;
  else if (combined.includes(q) || combinedAlt.includes(q))     score += 110;

  // All query words appear somewhere in artist+title (word-soup like "lucky punk")
  if (words.length > 1) {
    const allHit = words.every(w => combined.includes(w));
    if (allHit) score += 50 + words.length * 12;
    else {
      const hits = words.filter(w => combined.includes(w)).length;
      score += hits * 14;
    }
  }

  if (track.previewUrl) score += 20; // slight boost for playable tracks
  return score;
}

function distance(a, b) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function entityFootprint(node) {
  return String(node?.id || "").startsWith("ghost:") ? 220 : 280;
}

function svgArtwork(label, color) {
  const char = String(label || "?").trim().charAt(0).toUpperCase() || "?";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${color}" />
          <stop offset="100%" stop-color="#020617" />
        </linearGradient>
      </defs>
      <rect width="300" height="300" rx="34" fill="url(#g)" />
      <circle cx="150" cy="120" r="58" fill="rgba(255,255,255,0.09)" />
      <text x="150" y="190" text-anchor="middle" font-family="Inter, Arial" font-size="108" font-weight="700" fill="#e2e8f0">${char}</text>
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function normalizeArtworkUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  const absolute = value.startsWith("//") ? `https:${value}` : value;
  return absolute.replace(/\b(\d{2,4})x(\d{2,4})(bb)?\b/g, (_match, _w, _h, suffix = "") => {
    const tag = suffix || (absolute.includes("bb.") ? "bb" : "");
    return `600x600${tag}`;
  });
}

function artworkFromLastfmImage(images) {
  if (!Array.isArray(images)) return "";
  const picked = [...images].reverse().find((img) => img?.["#text"]);
  return normalizeArtworkUrl(picked?.["#text"] || "");
}

function artworkCandidatesForEntity(entity) {
  return [
    entity?.artworkUrl,
    entity?.raw?.artworkUrl,
    entity?.raw?.payload?.artworkUrl,
    entity?.payload?.artworkUrl,
    entity?.raw?.detail?.track?.artworkUrl,
    entity?.raw?.detail?.artist?.artworkUrl,
    entity?.raw?.detail?.album?.artworkUrl,
    entity?.raw?.detail?.genre?.artworkUrl,
    entity?.raw?.track?.artworkUrl,
    entity?.raw?.artist?.artworkUrl,
    entity?.raw?.album?.artworkUrl,
    artworkFromLastfmImage(entity?.raw?.image),
    artworkFromLastfmImage(entity?.raw?.detail?.artist?.image),
    artworkFromLastfmImage(entity?.raw?.detail?.album?.image),
    artworkFromLastfmImage(entity?.raw?.detail?.track?.album?.image)
  ].map(normalizeArtworkUrl).filter(Boolean);
}

function artworkForEntity(entity) {
  return artworkCandidatesForEntity(entity)[0] || svgArtwork(entity?.label || entity?.name || entity?.title || "?", entityColor(entity?.kind));
}

function fallbackArtworkForEntity(entity) {
  return svgArtwork(entity?.label || entity?.name || entity?.title || "?", entityColor(entity?.kind || "track"));
}

function trackNodeId(track) {
  return track.mbid ? `track:${track.mbid}` : `track:${trackKey(track.artist, track.title)}`;
}

function artistNodeId(name) {
  return `artist:${safeId(name)}`;
}

function albumNodeId(artist, album) {
  return `album:${albumKey(artist, album)}`;
}

function genreNodeId(name) {
  return `genre:${safeId(name)}`;
}

function mergeEntity(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    meta: uniqBy([...(existing.meta || []), ...(incoming.meta || [])], (item) => item),
    links: uniqBy([...(existing.links || []), ...(incoming.links || [])], (item) => `${item.kind}:${item.id}:${item.relation}`),
    loaded: existing.loaded || incoming.loaded,
    details: incoming.loaded || !existing.loaded ? incoming.details : existing.details,
    previewUrl: incoming.previewUrl || existing.previewUrl || "",
    artworkUrl: incoming.artworkUrl || existing.artworkUrl || "",
    raw: { ...(existing.raw || {}), ...(incoming.raw || {}) }
  };
}

function normalizeTrackEntity(track, detail = null) {
  const id = trackNodeId(track);
  const tags = (detail?.track?.tags || []).filter(Boolean);
  const links = [];
  if (track.artist) links.push({ id: artistNodeId(track.artist), relation: "artist", label: track.artist, kind: "artist", artist: track.artist });
  if (track.album) links.push({ id: albumNodeId(track.artist, track.album), relation: "album", label: track.album, kind: "album", artist: track.artist, album: track.album });
  tags.slice(0, 6).forEach((tag) => links.push({ id: genreNodeId(tag), relation: "genre", label: tag, kind: "genre", tag }));
  [...(detail?.similar || [])].sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 10).forEach((item) => item.title && item.artist && links.push({ id: trackNodeId(item), relation: "related-track", label: `${item.title} · ${item.artist}`, kind: "track", payload: item, similarity: item.similarity || 0 }));
  (detail?.artistTracks || []).slice(0, 8).forEach((item) => item.title && item.artist && links.push({ id: trackNodeId(item), relation: "artist-track", label: `${item.title} · ${item.artist}`, kind: "track", payload: item }));

  // Normalise listener counts to a 0–1 relative scale within this track's artist-track links
  const artistTrackLinks = links.filter(l => l.relation === "artist-track");
  const maxArtistTrackListeners = Math.max(1, ...artistTrackLinks.map(l => l.payload?.listeners || 0));
  artistTrackLinks.forEach(l => {
    const raw = l.payload?.listeners || 0;
    l.relativePopularity = raw > 0 ? raw / maxArtistTrackListeners : 0;
  });

  (detail?.albumTracks || []).slice(0, 12).forEach((item) => item.title && item.artist && links.push({ id: trackNodeId(item), relation: "album-track", label: `${item.title} · ${item.artist}`, kind: "track", payload: item }));
  return {
    id,
    kind: "track",
    label: track.title,
    subtitle: [track.artist, track.album].filter(Boolean).join(" · "),
    meta: [
      (detail?.track?.year || track.year) ? String(detail?.track?.year || track.year) : null,
      detail?.popularity?.listeners ? `${formatCompactNumber(detail.popularity.listeners)} listeners` : null,
      detail?.popularity?.playcount ? `${formatCompactNumber(detail.popularity.playcount)} plays` : null,
      tags[0] || null,
    ].filter(Boolean).slice(0, 3),
    previewUrl: track.previewUrl || detail?.track?.previewUrl || "",
    artworkUrl: track.artworkUrl || detail?.track?.artworkUrl || "",
    year: track.year || detail?.track?.year || detail?.year || null,
    popularity: detail?.popularity || track.popularity || null,
    raw: { ...track, detail },
    details: {
      lines: [
        detail?.track?.duration
          ? `${Math.floor(detail.track.duration / 60)}:${String(detail.track.duration % 60).padStart(2, '0')}`
          : null,
      ].filter(Boolean)
    },
    links: uniqBy(links, (item) => `${item.kind}:${item.id}:${item.relation}`),
    loaded: Boolean(detail)
  };
}

function normalizeArtistEntity(artist, detail = null) {
  const id = artist.id || artistNodeId(artist.name);
  const tags = detail?.artist?.tags || artist.tags || [];
  const links = [];
  (detail?.tracks || []).slice(0, 16).forEach((track) => {
    if (!track.title || !track.artist) return;
    links.push({ id: trackNodeId(track), relation: "track", label: `${track.title} · ${track.artist}`, kind: "track", payload: track });
  });
  tags.slice(0, 8).forEach((tag) => links.push({ id: genreNodeId(tag), relation: "genre", label: tag, kind: "genre", tag }));
  (detail?.artist?.albums || []).slice(0, 10).forEach((album) => {
    if (!album.name) return;
    links.push({
      id: albumNodeId(artist.name, album.name),
      relation: "album",
      label: album.name,
      kind: "album",
      artist: artist.name,
      album: album.name,
      payload: album,
      listeners: album.playcount || 0,
    });
  });

  // Normalise listener counts to a 0–1 relative scale within this artist's tracks
  const trackLinks = links.filter(l => l.kind === "track");
  const maxListeners = Math.max(1, ...trackLinks.map(l => l.payload?.listeners || 0));
  trackLinks.forEach(l => {
    const raw = l.payload?.listeners || 0;
    l.relativePopularity = raw > 0 ? raw / maxListeners : 0;
  });

  return {
    id,
    kind: "artist",
    label: artist.name,
    subtitle: [artist.country || "", artist.area || ""].filter(Boolean).join(" · ") || "Artist",
    meta: [artist.disambiguation || "", tags[0] || "", detail?.artist?.listeners ? `${formatCompactNumber(detail.artist.listeners)} listeners` : ""].filter(Boolean).slice(0, 3),
    artworkUrl: artist.artworkUrl || detail?.artist?.artworkUrl || "",
    raw: { ...artist, detail },
    details: { lines: [stripHtml(detail?.artist?.bio || "") || "Open this artist to explore tracks, albums, and genres."] },
    links: uniqBy(links, (item) => `${item.kind}:${item.id}:${item.relation}`),
    loaded: Boolean(detail)
  };
}

function normalizeAlbumEntity(detail, fallbackArtist = "", fallbackAlbum = "") {
  const artist = detail?.album?.artist || fallbackArtist;
  const album = detail?.album?.name || fallbackAlbum;
  const tracks = detail?.tracks || [];
  const tags = detail?.album?.tags || [];
  const links = [];
  if (artist) links.push({ id: artistNodeId(artist), relation: "artist", label: artist, kind: "artist", artist });
  tracks.slice(0, 20).forEach((track) => track.title && track.artist && links.push({ id: trackNodeId(track), relation: "track", label: `${track.title} · ${track.artist}`, kind: "track", payload: track }));
  tags.slice(0, 8).forEach((tag) => links.push({ id: genreNodeId(tag), relation: "genre", label: tag, kind: "genre", tag }));
  return {
    id: albumNodeId(artist, album),
    kind: "album",
    label: album,
    subtitle: artist || "Album",
    meta: [detail?.album?.listeners ? `${formatCompactNumber(detail.album.listeners)} listeners` : "", detail?.album?.playcount ? `${formatCompactNumber(detail.album.playcount)} plays` : "", tags[0] || ""].filter(Boolean).slice(0, 3),
    raw: detail,
    artworkUrl: detail?.album?.artworkUrl || "",
    details: { lines: [stripHtml(detail?.album?.wiki)].filter(Boolean) },
    links: uniqBy(links, (item) => `${item.kind}:${item.id}:${item.relation}`),
    loaded: true
  };
}

function normalizeGenreEntity(detail, fallbackTag = "") {
  const tag = detail?.genre?.name || fallbackTag;
  const links = [];
  (detail?.tracks || []).slice(0, 10).forEach((track) => track.title && track.artist && links.push({ id: trackNodeId(track), relation: "top-track", label: `${track.title} · ${track.artist}`, kind: "track", payload: track }));
  (detail?.artists || []).slice(0, 10).forEach((artist) => artist.name && links.push({ id: artistNodeId(artist.name), relation: "top-artist", label: artist.name, kind: "artist", payload: artist }));
  (detail?.albums || []).slice(0, 10).forEach((album) => album.name && album.artist && links.push({ id: albumNodeId(album.artist, album.name), relation: "top-album", label: `${album.name} · ${album.artist}`, kind: "album", artist: album.artist, album: album.name, payload: album }));
  return {
    id: genreNodeId(tag),
    kind: "genre",
    label: tag,
    subtitle: "Genre / tag",
    meta: [detail?.tracks?.length ? `${detail.tracks.length} tracks` : "", detail?.artists?.length ? `${detail.artists.length} artists` : "", detail?.albums?.length ? `${detail.albums.length} albums` : ""].filter(Boolean).slice(0, 3),
    raw: detail,
    artworkUrl: detail?.genre?.artworkUrl || "",
    details: { lines: [stripHtml(detail?.genre?.description)].filter(Boolean) },
    links: uniqBy(links, (item) => `${item.kind}:${item.id}:${item.relation}`),
    loaded: true
  };
}

// Directional sectors per relation — angles in radians from positive x-axis
const SECTOR_CENTER = {
  'related-track':  0,                  // → right
  'artist-track':   Math.PI,            // ← left
  'album-track':    Math.PI * 0.65,     // ↙ below-left
  'genre':         -Math.PI * 0.5,      // ↑ above
  'artist':        -Math.PI * 0.72,     // ↖ upper-left
  'track':          0.3,                // slight right
  'top-track':      0,
  'top-artist':     Math.PI,
  'top-album':      Math.PI * 0.5,      // ↓ below
};

const SECTOR_SPREAD = {
  'related-track':  Math.PI * 0.55,     // widest — most items
  'artist-track':   Math.PI * 0.45,
  'album-track':    Math.PI * 0.45,
  'genre':          Math.PI * 0.4,
  'artist':         0.4,
  'album':          0.5,
  'track':          Math.PI * 0.4,
  'top-track':      Math.PI * 0.5,
  'top-artist':     Math.PI * 0.4,
  'top-album':      Math.PI * 0.5,
};

function sectorOffset(relation, indexInSector, totalInSector, baseRadius = 320, weight = 1.0) {
  const centerAngle = SECTOR_CENTER[relation] ?? 0;
  const spread      = SECTOR_SPREAD[relation]  ?? (Math.PI * 0.4);
  const n           = Math.max(totalInSector, 1);

  // Spread items evenly across the sector arc
  const angleStep = n > 1 ? spread / (n - 1) : 0;
  const angle     = centerAngle - spread / 2 + indexInSector * angleStep;

  // Similarity-based distance: higher similarity (weight→1) = closer to node
  let radius = baseRadius;
  if (relation === 'related-track' && weight > 0) {
    radius = baseRadius * (0.5 + 0.5 * (1 - weight));
  }

  // Multi-row overflow: push extra items outward in concentric arcs
  const itemsPerRow = Math.max(Math.ceil(n / 2), 4);
  const row = Math.floor(indexInSector / itemsPerRow);
  radius += row * 150;

  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.88 };
}

function nudgeFromCollision(rawPos, anchorPos, stableNodes, plannedPositions) {
  let candidate = rawPos;
  for (let tries = 0; tries < 14; tries++) {
    const hitStable  = stableNodes.some(n => distance(candidate, n.position) < Math.max(entityFootprint(n), 220));
    const hitPlanned = plannedPositions.some(p => distance(candidate, p) < 210);
    if (!hitStable && !hitPlanned) return candidate;
    // Push radially outward from the anchor
    const dx = candidate.x - anchorPos.x || 1;
    const dy = candidate.y - anchorPos.y || 0;
    const d = Math.hypot(dx, dy);
    candidate = { x: candidate.x + (dx / d) * 55, y: candidate.y + (dy / d) * 55 };
  }
  return candidate;
}

function resolveGhostPosition(parentNode, stableNodes, plannedPositions, rawCandidate) {
  const anchorPos = parentNode.position;
  return nudgeFromCollision(rawCandidate, anchorPos, stableNodes, plannedPositions);
}

function resolveOpenedNodePosition(anchor, blockedNodes, blockedPositions = [], preferredIndex = 0) {
  let best = anchor;
  const collides = (candidate) => {
    const hitNode = blockedNodes.some((node) => distance(candidate, node.position) < entityFootprint(node));
    const hitPlanned = blockedPositions.some((position) => distance(candidate, position) < 240);
    return hitNode || hitPlanned;
  };
  if (!collides(anchor)) return anchor;
  for (let ring = 0; ring < 8; ring += 1) {
    const steps = 10 + ring * 4;
    const radius = 180 + ring * 90;
    for (let step = 0; step < steps; step += 1) {
      const angle = ((preferredIndex + step) % steps) * (Math.PI * 2 / steps);
      const candidate = {
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius * 0.88
      };
      best = candidate;
      if (!collides(candidate)) return candidate;
    }
  }
  return best;
}

function entityCanonicalKey(entity) {
  if (!entity) return "";
  if (entity.kind === "track") {
    const artist = entity.raw?.artist || entity.subtitle?.split(" · ")[0] || "";
    return `track:${trackKey(artist, entity.label)}`;
  }
  if (entity.kind === "artist") return `artist:${safeId(entity.raw?.name || entity.label)}`;
  if (entity.kind === "album") {
    const artist = entity.raw?.album?.artist || entity.subtitle || "";
    return `album:${albumKey(artist, entity.label)}`;
  }
  if (entity.kind === "genre") return `genre:${safeId(entity.raw?.genre?.name || entity.label)}`;
  return "";
}

function linkCanonicalKey(link, sourceEntity = null) {
  if (!link) return "";
  if (link.kind === "track") {
    const title = link.payload?.title || link.label?.split(" · ")[0] || "";
    const artist = link.payload?.artist || link.artist || link.label?.split(" · ")[1] || sourceEntity?.label || "";
    return `track:${trackKey(artist, title)}`;
  }
  if (link.kind === "artist") return `artist:${safeId(link.payload?.name || link.label)}`;
  if (link.kind === "album") return `album:${albumKey(link.artist || sourceEntity?.label || "", link.album || link.label?.split(" · ")[0] || "")}`;
  if (link.kind === "genre") return `genre:${safeId(link.tag || link.label)}`;
  return "";
}

function formatArtistMeta(artist) {
  return [artist.disambiguation || "", artist.country || artist.area || "", artist.listeners ? `${formatCompactNumber(artist.listeners)} listeners` : ""]
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}

function formatTrackMeta(track) {
  const duration = track.durationMs
    ? `${Math.floor(track.durationMs / 60000)}:${String(Math.floor((track.durationMs % 60000) / 1000)).padStart(2, '0')}`
    : null;
  return [
    duration,
    track.listeners ? `${formatCompactNumber(track.listeners)} listeners` : null,
  ].filter(Boolean).slice(0, 2).join(" · ");
}

function formatCompactNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: num >= 100 ? 0 : 1
  }).format(num).toLowerCase();
}

function GraphNode({ data, selected }) {
  const entity = data?.entity;
  const inPlaylist = data?.inPlaylist;
  const isPlaying = data?.isPlaying;
  if (!entity) {
    return (
      <div className="entity-card kind-track ghost-loading" style={{ "--accent": entityColor("track") }}>
        <div className="entity-topline"><span className="entity-kind">loading</span></div>
        <div className="entity-title">Loading…</div>
      </div>
    );
  }
  return (
    <div className={`entity-card kind-${entity.kind} ${selected ? "selected" : ""} ${inPlaylist ? "in-playlist" : ""} ${isPlaying ? "is-playing" : ""}`} style={{ "--accent": entityColor(entity.kind) }}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="entity-topline">
        <span className="entity-kind">{entity.kind}</span>
      </div>
      <div className="entity-body">
        <img className="entity-artwork" src={artworkForEntity(entity)} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackArtworkForEntity(entity); }} />
        <div className="entity-copy">
          <div className="entity-title">{entity.label}</div>
          <div className="entity-subtitle">{entity.subtitle}</div>
          <div className="chip-row">
            {(entity.meta || []).slice(0, 3).map((item) => <span key={item} className="chip">{item}</span>)}
          </div>
        </div>
      </div>
      {entity.kind === "track" && <div className="track-hint">{inPlaylist ? "Double-click removes from playlist" : "Hover or click plays · double-click adds"}</div>}
      {entity.kind === "track" && isPlaying && (
        <div className="soundwave-cluster" aria-hidden="true"><span /><span /><span /><span /></div>
      )}
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

function GhostNode({ data }) {
  const simPct = data.similarity > 0 ? Math.round(data.similarity * 100) : null;
  const relPop = data.relativePopularity > 0 ? data.relativePopularity : null;
  const showBar = simPct !== null || relPop !== null;
  const barWidth = simPct !== null
    ? Math.max(8, simPct)
    : Math.max(8, Math.round(relPop * 100));
  const barClass = simPct !== null ? "ghost-bar sim" : "ghost-bar pop";

  // Use separate title/artist fields instead of the concatenated label
  const title = (data.kind === "track" && data.trackTitle) ? data.trackTitle : data.label;
  const artist = data.kind === "track" ? data.trackArtist : null;

  return (
    <div className={`ghost-card kind-${data.kind} relation-${data.relation} ${data.opened ? "opened" : "new"} ${data.kind === "track" ? "hover-preview" : ""} ${data.isPlaying ? "is-playing" : ""}`} style={{ "--accent": `#${ghostAccentColor(data.relation)}` }}>
      <div className="ghost-kind">{data.relation}</div>
      <div className="ghost-label">{title}</div>
      {artist && <div className="ghost-subtitle">{artist}</div>}
      {(data.rank || showBar) && (
        <div className="ghost-meta">
          {data.rank && <span className="ghost-badge rank">#{data.rank}</span>}
          {showBar && (
            <div className="ghost-similarity-bar">
              <div
                className={barClass}
                style={{ width: `${barWidth}%` }}
              />
            </div>
          )}
        </div>
      )}
      {data.isPlaying && data.kind === "track" && (
        <div className="ghost-tap-hint">Tap again to add ›</div>
      )}
    </div>
  );
}

const nodeTypes = { entity: GraphNode, ghost: GhostNode };

function ResultButton({ item, kind, featured = false, onClick, onHover }) {
  const pseudo = kind === "track"
    ? { kind, label: item.title, artworkUrl: item.artworkUrl, raw: item }
    : { kind, label: item.name, artworkUrl: item.artworkUrl, raw: item };
  const title = kind === "track" ? item.title : item.name;
  const meta = kind === "track" ? formatTrackMeta(item) : formatArtistMeta(item);
  return (
    <button
      className={`result-chip ${kind} ${featured ? "featured" : ""}`}
      onClick={onClick}
      onMouseEnter={kind === "track" ? () => onHover?.(item) : undefined}
      onFocus={kind === "track" ? () => onHover?.(item) : undefined}
    >
      <img className="result-artwork" src={artworkForEntity(pseudo)} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackArtworkForEntity(pseudo); }} />
      <div className="result-copy">
        <span>{kind}</span>
        <strong>{title}</strong>
        {kind === "track" && item.artist && (
          <em className="result-artist">{item.artist}</em>
        )}
        {kind === "track" && item.album && (
          <em className="result-album">{item.album}</em>
        )}
        {meta ? <em className="result-meta">{meta}</em> : null}
      </div>
    </button>
  );
}

function IconButton({ title, children, onClick, active = false }) {
  return (
    <button className={`icon-button ${active ? "active" : ""}`} onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  );
}

function DetailsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function PlaylistIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h10" />
      <path d="M4 12h10" />
      <path d="M4 17h6" />
      <path d="M17 6v10.5" />
      <circle cx="15.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function ChevronIcon({ direction = "left" }) {
  const rotations = { left: 0, right: 180, up: 90, down: -90 };
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rotations[direction] || 0}deg)` }}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </svg>
  );
}

function DraftsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

const STORAGE_KEY = "ai-playlist-studio-state-v1";
const PLAYLIST_BRIDGE_KEY = "ai-playlist-bridge-v1";
const PENDING_ADD_KEY = "ai-playlist-pending-add-v1";

function FlowApp() {
  const { importQueue, clearQueue } = useStudio();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState({
    deezer: { artists: [], tracks: [] },
    itunes: { tracks: [] },
  });
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [message]);
  const [entityMap, setEntityMap] = useState({});
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState("");
  const [playlist, setPlaylist] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const [audioSrc, setAudioSrc] = useState("");
  const [activePreviewId, setActivePreviewId] = useState("");
  const [nowPlayingOverride, setNowPlayingOverride] = useState(null);
  const [nowPlayingVersion, setNowPlayingVersion] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [previewCache, setPreviewCache] = useState({});
  const previewCacheRef = useRef(previewCache);
  useEffect(() => {
    previewCacheRef.current = previewCache;
  }, [previewCache]);
  const [drafts, setDrafts] = useState([]);
  const [currentDraftId, setCurrentDraftId] = useState("");
  const [draftTitle, setDraftTitle] = useState("Untitled Studio");
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const seeded = useRef(false);
  const hydrated = useRef(false);
  const getViewportRef = useRef(null);
  const hoverPreviewTimerRef = useRef(null);
  const hoverPreviewTokenRef = useRef(0);
  const previewPromiseCacheRef = useRef({});
  const userActivatedRef = useRef(false);
  const audioRef = useRef(null);
  const playbackRequestRef = useRef(0);
  const lastAppliedAudioSrcRef = useRef("");
  const lastTimeUpdateSecondRef = useRef(-1);
  const crossfadeTimerRef = useRef(null);
  const graphPanelRef = useRef(null);
  const searchBoxRef = useRef(null);
  const searchInputRef = useRef(null);
  const playlistDrawerRef = useRef(null);
  
const isTouchDeviceRef = useRef(
  typeof window !== "undefined" && window.matchMedia("(hover: none)").matches
);
  const { screenToFlowPosition, setCenter, getViewport, setViewport } = useReactFlow();

  // Keep a stable ref to getViewport (it changes identity every render)
  useEffect(() => {
    getViewportRef.current = getViewport;
  }, [getViewport]);

  const playlistIds = useMemo(() => playlist.map((item) => item.id), [playlist]);
  const committedCanvasEntityIds = useMemo(() => new Set(
    nodes
      .filter((node) => !String(node.id).startsWith("ghost:"))
      .map((node) => node.id)
  ), [nodes]);
  const blockedRecommendationIds = useMemo(() => new Set([
    ...Array.from(committedCanvasEntityIds),
    ...playlistIds
  ]), [committedCanvasEntityIds, playlistIds]);
  const blockedRecommendationKeys = useMemo(() => {
    const keys = new Set();

    nodes
      .filter((node) => !String(node.id).startsWith("ghost:"))
      .map((node) => entityMap[node.id])
      .filter(Boolean)
      .forEach((entity) => {
        const key = entityCanonicalKey(entity);
        if (key) keys.add(key);
      });

    playlist
      .filter(Boolean)
      .forEach((entity) => {
        const key = entityCanonicalKey(entity);
        if (key) keys.add(key);
      });

    return keys;
  }, [nodes, entityMap, playlist]);
  const isRecommendationBlocked = useCallback((link, sourceId = "") => {
    const sourceEntity = sourceId ? entityMap[sourceId] : null;
    const canonicalKey = linkCanonicalKey(link, sourceEntity);
    if (blockedRecommendationIds.has(link.id)) return true;
    if (canonicalKey && blockedRecommendationKeys.has(canonicalKey)) return true;
    return false;
  }, [blockedRecommendationIds, blockedRecommendationKeys, entityMap]);
  const visibleLinksForEntity = useCallback((entityId) => {
    const entity = entityMap[entityId];
    if (!entity) return [];
    return (entity.links || []).filter((link) => !isRecommendationBlocked(link, entityId));
  }, [entityMap, isRecommendationBlocked]);

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await api("/api/drafts");
      setDrafts(res.data || []);
    } catch (err) {
      setMessage(`Failed to fetch drafts: ${err.message}`);
    }
  }, []);

  const saveCurrentDraft = useCallback(async (title = draftTitle) => {
    setSaving(true);
    try {
      const persistentNodes = nodes.filter((node) => !String(node.id).startsWith("ghost:"));
      const persistentEdges = edges.filter((edge) => !String(edge.id).startsWith("ghost-edge:"));

      const payload = {
        id: currentDraftId || undefined,
        title: title || "Untitled Studio",
        data: {
          entityMap,
          nodes: persistentNodes,
          edges: persistentEdges,
          playlist,
          selectedId,
          drawerOpen,
          detailOpen,
          previewCache,
          viewport: getViewportRef.current()
        }
      };

      const saved = await api("/api/drafts", {
        method: "POST",
        body: payload
      });

      setCurrentDraftId(saved.id);
      setDraftTitle(saved.title);
      setMessage(`Saved "${saved.title}"`);
      fetchDrafts();
    } catch (err) {
      setMessage(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [currentDraftId, draftTitle, entityMap, nodes, edges, playlist, selectedId, drawerOpen, detailOpen, previewCache, fetchDrafts]);

  const loadDraft = useCallback(async (id) => {
    try {
      const draft = await api(`/api/drafts/${id}`);
      const saved = draft.data;

      // Stop audio
      setAudioSrc("");
      setActivePreviewId("");
      setNowPlayingOverride(null);

      setEntityMap(saved.entityMap || {});
      setNodes((saved.nodes || []).filter((node) => !String(node.id).startsWith("ghost:")));
      setEdges((saved.edges || []).filter((edge) => !String(edge.id).startsWith("ghost-edge:")));
      setPlaylist(saved.playlist || []);
      setSelectedId(saved.selectedId || "");
      setDrawerOpen(Boolean(saved.drawerOpen));
      setDetailOpen(saved.detailOpen !== false);
      setPreviewCache(saved.previewCache || {});

      setCurrentDraftId(draft.id);
      setDraftTitle(draft.title);
      setDraftsOpen(false);

      if (saved.viewport) {
        requestAnimationFrame(() => {
          setViewport(saved.viewport, { duration: 400 });
        });
      }

      setMessage(`Loaded "${draft.title}"`);
    } catch (err) {
      setMessage(`Load failed: ${err.message}`);
    }
  }, [setNodes, setEdges, setViewport]);

  const deleteDraftById = useCallback(async (id) => {
    if (!window.confirm("Delete this playlist?")) return;
    try {
      await api(`/api/drafts/${id}`, { method: "DELETE" });
      if (id === currentDraftId) {
        setCurrentDraftId("");
        setDraftTitle("Untitled Studio");
      }
      fetchDrafts();
    } catch (err) {
      setMessage(`Delete failed: ${err.message}`);
    }
  }, [currentDraftId, fetchDrafts]);

  const createNewStudio = useCallback(() => {
    if (!window.confirm("Create new studio? Current unsaved changes might be lost if not saved to a playlist.")) return;
    setAudioSrc("");
    setActivePreviewId("");
    setNowPlayingOverride(null);
    setEntityMap({});
    setNodes([]);
    setEdges([]);
    setPlaylist([]);
    setSelectedId("");
    setCurrentDraftId("");
    setDraftTitle("Untitled Studio");
    setDraftsOpen(false);
  }, []);

  const selectedEntity = selectedId ? entityMap[selectedId] : null;
  const nowPlayingEntity = nowPlayingOverride || (activePreviewId ? entityMap[activePreviewId] : null);
  const selectedTrackEntity = selectedEntity?.kind === "track" ? selectedEntity : null;
  const spotlightTrackEntity = nowPlayingEntity || selectedTrackEntity || null;
  const spotlightTrackStats = spotlightTrackEntity?.kind === "track"
    ? [
        spotlightTrackEntity.year ? String(spotlightTrackEntity.year) : "",
        spotlightTrackEntity.popularity?.listeners ? `${formatCompactNumber(spotlightTrackEntity.popularity.listeners)} listeners` : "",
        spotlightTrackEntity.popularity?.playcount ? `${formatCompactNumber(spotlightTrackEntity.popularity.playcount)} plays` : ""
      ].filter(Boolean)
    : [];
  const artistResults = useMemo(() => {
    return [...(searchResults.deezer.artists)]
      .filter(artist => {
        const id = artist.id || artistNodeId(artist.name);
        const key = `artist${safeId(artist.name)}`;
        return !blockedRecommendationIds.has(id) && !blockedRecommendationKeys.has(key);
      })
      .sort((a, b) => artistSearchScore(query, b) - artistSearchScore(query, a));
  }, [searchResults, query, blockedRecommendationIds, blockedRecommendationKeys]);
  const topArtistMatch = useMemo(() => artistResults[0] && artistSearchScore(query, artistResults[0]) >= 95 ? artistResults[0] : null, [artistResults, query]);
  const otherArtistResults = useMemo(() => artistResults.filter((artist) => artist !== topArtistMatch).slice(0, 5), [artistResults, topArtistMatch]);

  const deezerTrackResults = useMemo(() => {
    return (searchResults.deezer.tracks).filter(track => {
      const id = trackNodeId(track);
      const key = `track${trackKey(track.artist, track.title)}`;
      return !blockedRecommendationIds.has(id) && !blockedRecommendationKeys.has(key);
    }).slice(0, 6);
  }, [searchResults, blockedRecommendationIds, blockedRecommendationKeys]);

  const itunesTrackResults = useMemo(() => {
    return (searchResults.itunes.tracks).filter(track => {
      const id = trackNodeId(track);
      const key = `track${trackKey(track.artist, track.title)}`;
      return !blockedRecommendationIds.has(id) && !blockedRecommendationKeys.has(key);
    }).slice(0, 6);
  }, [searchResults, blockedRecommendationIds, blockedRecommendationKeys]);

  // Keep trackResults alias for any other references (mobile path)
  const trackResults = deezerTrackResults;
useEffect(() => {
  const el = audioRef.current;
  if (!el) return;

  const syncPlaybackState = () => {
    setIsAudioPlaying(Boolean(el.currentSrc) && !el.paused && !el.ended);
  };

  syncPlaybackState();

  const events = [
    "loadstart",
    "loadedmetadata",
    "canplay",
    "play",
    "playing",
    "pause",
    "ended",
    "emptied",
    "abort"
  ];

  events.forEach((type) => el.addEventListener(type, syncPlaybackState));

  return () => {
    events.forEach((type) => el.removeEventListener(type, syncPlaybackState));
  };
}, [nowPlayingEntity?.id, nowPlayingVersion]);

const handleMiniPlayToggle = (event) => {
  event.stopPropagation();

  const el = audioRef.current;
  if (!el) return;

  userActivatedRef.current = true;

  if (!audioSrc && spotlightTrackEntity) {
    playEntity(spotlightTrackEntity, "mini-play-toggle");
    return;
  }

  if (el.paused || el.ended) {
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        console.debug("[audio-debug] mini play failed", {
          message: error?.message,
          name: error?.name
        });
      });
    }
  } else {
    el.pause();
  }
};

  useEffect(() => {
    if (!searchOpen) return;
    const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [searchOpen]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const inSearchBox = searchBoxRef.current?.contains(event.target);
      const inPlaylistDrawer = playlistDrawerRef.current?.contains(event.target);
      if (!inSearchBox && !inPlaylistDrawer) {
        setSearchOpen(false);
        setDraftsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (hydrated.current || typeof window === "undefined") return;
    hydrated.current = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const savedNodes = (saved.nodes || []).filter((node) => !String(node.id).startsWith("ghost:"));
      const savedEdges = (saved.edges || []).filter((edge) => !String(edge.id).startsWith("ghost-edge:"));
      const savedEntityMap = saved.entityMap || {};
      const hasUsableState = Object.keys(savedEntityMap).length > 0 || savedNodes.length > 0;
      if (!hasUsableState) return;
      setEntityMap(savedEntityMap);
      setNodes(savedNodes);
      setEdges(savedEdges);
      setPlaylist(saved.playlist || []);
      setSelectedId(saved.selectedId || "");
      setDrawerOpen(Boolean(saved.drawerOpen));
      setDetailOpen(saved.detailOpen !== false);
      setActivePreviewId("");
      setAudioSrc("");
      setPreviewCache(saved.previewCache || {});
      setDraftTitle(saved.draftTitle || "Untitled Studio");
      if (saved.currentDraftId) setCurrentDraftId(saved.currentDraftId);
      seeded.current = true;

      // After nodes are rendered, pan to show all restored nodes
      // Use setTimeout to ensure ReactFlow has fully rendered the nodes
      setTimeout(() => {
        const persistentNodes = (saved.nodes || []).filter((node) => !String(node.id).startsWith("ghost:"));
        if (persistentNodes.length === 0) return;
        const minX = Math.min(...persistentNodes.map((n) => n.position.x));
        const maxX = Math.max(...persistentNodes.map((n) => n.position.x));
        const minY = Math.min(...persistentNodes.map((n) => n.position.y));
        const maxY = Math.max(...persistentNodes.map((n) => n.position.y));
        const centerX = (minX + maxX) / 2 + 140;
        const centerY = (minY + maxY) / 2 + 80;
        setCenter(centerX, centerY, {
          zoom: Math.max(saved.viewport?.zoom || 0.6, 0.6),
          duration: 320
        });
      }, 100);
    } catch {
    }
  }, [setNodes, setEdges, setCenter]);


  const togglePlaylist = useCallback((entity) => {
    if (!entity || entity.kind !== "track") return;
    setPlaylist((current) => {
      if (current.some((item) => item.id === entity.id)) {
        setMessage("Removed from playlist");
        return current.filter((item) => item.id !== entity.id);
      }
      setMessage("Added to playlist");
      return [...current, entity];
    });
  }, []);

  const syncNodes = useCallback((nodeList, nextEntityMap, nextPlaylistIds, nextActivePreviewId = activePreviewId) => {
    return nodeList.map((node) => {
      if (String(node.id).startsWith("ghost:")) {
        return {
          ...node,
          data: {
            ...node.data,
            opened: Boolean(nextEntityMap[node.data.entityId]),
            inPlaylist: nextPlaylistIds.includes(node.data.entityId),
            isPlaying: nextActivePreviewId === node.data.entityId,
            previewUrl: node.data.previewUrl || nextEntityMap[node.data.entityId]?.previewUrl || "",
            artworkUrl: node.data.artworkUrl
              || previewCache[node.data.entityId]?.artworkUrl
              || nextEntityMap[node.data.entityId]?.artworkUrl
              || "",
            onTogglePlaylist: togglePlaylist
          }
        };
      }
      return {
        ...node,
        data: {
          // Preserve existing entity from restored state if not found in map
          entity: nextEntityMap[node.id] || node.data?.entity,
          inPlaylist: nextPlaylistIds.includes(node.id),
          isPlaying: nextActivePreviewId === node.id,
          onTogglePlaylist: togglePlaylist
        }
      };
    }).filter((node) => String(node.id).startsWith("ghost:") || node.data?.entity);
  }, [activePreviewId, togglePlaylist]);

  useEffect(() => {
    setNodes((current) => syncNodes(current, entityMap, playlistIds, activePreviewId));
  }, [entityMap, playlistIds, activePreviewId, setNodes, syncNodes]);

  useEffect(() => {
    if (!hydrated.current || typeof window === "undefined") return;
    try {
      const persistentNodes = nodes.filter((node) => !String(node.id).startsWith("ghost:"));
      const persistentEdges = edges.filter((edge) => !String(edge.id).startsWith("ghost-edge:"));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        entityMap,
        nodes: persistentNodes,
        edges: persistentEdges,
        playlist,
        selectedId,
        drawerOpen,
        detailOpen,
        activePreviewId,
        audioSrc,
        previewCache,
        currentDraftId,
        draftTitle,
        viewport: getViewportRef.current()
      }));
    } catch {
    }
  }, [entityMap, nodes, edges, playlist, selectedId, drawerOpen, detailOpen, activePreviewId, audioSrc, previewCache, currentDraftId, draftTitle]);

  // Write playlist to bridge key for Library Graph cross-matching
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const bridgePayload = {
        tracks: playlist.map((entity) => {
          const artist = entity.raw?.artist ?? entity.subtitle?.split(" · ")[0] ?? "";
          const title = entity.label ?? "";
          return {
            id: entity.id,
            title,
            artist,
            normalizedKey: safeId(artist) + safeId(title),
          };
        }),
        updatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(PLAYLIST_BRIDGE_KEY, JSON.stringify(bridgePayload));
    } catch (e) {
      // localStorage may be blocked in some iframe contexts; fail silently
    }
  }, [playlist]);

  // Auto-save draft on changes with debounce
  useEffect(() => {
    if (!hydrated.current || typeof window === "undefined") return;
    if (!currentDraftId) return; // Only auto-save if a draft exists

    const handler = setTimeout(() => {
      const persistentNodes = nodes.filter((node) => !String(node.id).startsWith("ghost:"));
      const persistentEdges = edges.filter((edge) => !String(edge.id).startsWith("ghost-edge:"));

      api("/api/drafts", {
        method: "POST",
        body: {
          id: currentDraftId,
          title: draftTitle,
          data: {
            entityMap,
            nodes: persistentNodes,
            edges: persistentEdges,
            playlist,
            selectedId,
            drawerOpen,
            detailOpen,
            previewCache: previewCacheRef.current,
            viewport: getViewportRef.current()
          }
        }
      }).then(() => {
        fetchDrafts();
      }).catch(() => {});
    }, 1500);

    return () => clearTimeout(handler);
  }, [entityMap, nodes, edges, playlist, selectedId, drawerOpen, detailOpen, currentDraftId, draftTitle, getViewport, fetchDrafts]);

  const debugAudio = useCallback((event, payload = {}) => {
    const el = audioRef.current;
    console.debug(`[audio-debug] ${event}`, {
      ...payload,
      state: {
        activePreviewId,
        audioSrc,
        currentSrc: el?.currentSrc || "",
        src: el?.src || "",
        paused: el?.paused,
        currentTime: el?.currentTime,
        readyState: el?.readyState,
        networkState: el?.networkState,
        ended: el?.ended
      }
    });
  }, [activePreviewId, audioSrc]);


useEffect(() => {
    const activateAudio = () => {
      if (userActivatedRef.current) return;
      userActivatedRef.current = true;
      document.body.classList.add("audio-unlocked");
    };
    document.addEventListener("pointerdown", activateAudio, { passive: true });
    document.addEventListener("keydown", activateAudio);
    return () => {
      document.removeEventListener("pointerdown", activateAudio);
      document.removeEventListener("keydown", activateAudio);
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = 1;
  }, []);

  useEffect(() => {
    const el = audioRef.current;

    if (!el) {
      console.warn("[audio-debug] audio element missing", {
        requestId: playbackRequestRef.current,
        audioSrc,
        activePreviewId
      });
      return;
    }

    if (!audioSrc) {
      debugAudio("clear-audio");
      if (crossfadeTimerRef.current) {
        cancelAnimationFrame(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
      el.pause();
      el.removeAttribute("src");
      el.load();
      lastAppliedAudioSrcRef.current = "";
      return;
    }

    const requestId = playbackRequestRef.current;
    const srcChanged = lastAppliedAudioSrcRef.current !== audioSrc || el.currentSrc !== audioSrc;

    debugAudio("apply-audio-src", {
      requestId,
      srcChanged,
      requestedSrc: audioSrc
    });

    el.pause();

    if (srcChanged) {
      el.src = audioSrc;
      lastAppliedAudioSrcRef.current = audioSrc;
      el.load();
    }

    el.currentTime = 0;

    if (!userActivatedRef.current) {
      debugAudio("autoplay-blocked-no-user-activation", { requestId });
      return;
    }

    const playPromise = el.play();
    if (playPromise?.then) {
      playPromise
        .then(() => {
          debugAudio("play-resolved", { requestId });
          // Crossfade in: ramp volume back up over ~300ms
          if (crossfadeTimerRef.current) {
            cancelAnimationFrame(crossfadeTimerRef.current);
            crossfadeTimerRef.current = null;
          }
          const fadeStart = performance.now();
          const fadeDuration = 300;
          const fadeIn = (now) => {
            const elapsed = now - fadeStart;
            const progress = Math.min(elapsed / fadeDuration, 1);
            el.volume = Math.max(0, Math.min(1, progress));
            if (progress < 1) {
              crossfadeTimerRef.current = requestAnimationFrame(fadeIn);
            } else {
              el.volume = 1;
              crossfadeTimerRef.current = null;
            }
          };
          crossfadeTimerRef.current = requestAnimationFrame(fadeIn);
        })
        .catch((err) => {
          console.warn("[audio-debug] play failed", {
            requestId,
            message: err?.message,
            name: err?.name
          });
        });
    } else {
      debugAudio("play-called-no-promise", { requestId });
    }
  }, [audioSrc, activePreviewId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;

    const events = [
      "loadstart",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "play",
      "playing",
      "pause",
      "waiting",
      "stalled",
      "suspend",
      "seeking",
      "seeked",
      "ended",
      "emptied",
      "error",
      "timeupdate"
    ];

    const onEvent = (e) => {
  if (e.type === "play" || e.type === "playing") {
    setIsAudioPlaying(true);
  }

  if (e.type === "pause" || e.type === "ended" || e.type === "emptied") {
    setIsAudioPlaying(false);
  }

  if (e.type === "timeupdate") {
    const sec = Math.floor(el.currentTime || 0);
    if (sec === lastTimeUpdateSecondRef.current) return;
    lastTimeUpdateSecondRef.current = sec;
  }

  const error = el.error
    ? {
        code: el.error.code,
        message: el.error.message
      }
    : null;

  console.debug("[audio-debug] media-event", {
    type: e.type,
    currentSrc: el.currentSrc,
    currentTime: el.currentTime,
    duration: el.duration,
    paused: el.paused,
    readyState: el.readyState,
    networkState: el.networkState,
    error
  });
};


    events.forEach((name) => el.addEventListener(name, onEvent));
    return () => events.forEach((name) => el.removeEventListener(name, onEvent));
  }, []);

  const centerFlowPosition = useCallback(() => {
    const rect = graphPanelRef.current?.getBoundingClientRect();
    if (!rect) return { x: 300, y: 220 };
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [screenToFlowPosition]);

  const safeCenterFlowPosition = useCallback((targetId = "") => {
    const blockedNodes = nodes.filter((node) => node.id !== targetId);
    return resolveOpenedNodePosition(centerFlowPosition(), blockedNodes, [], 0);
  }, [nodes, centerFlowPosition]);

    const startPlayback = useCallback((id, previewUrl, options = {}) => {
    const selectId = options.selectId || "";
    const source = options.source || "unknown";
    const requestId = ++playbackRequestRef.current;
    const overrideEntity = options.nowPlayingEntity === undefined ? null : options.nowPlayingEntity;

    if (!previewUrl || previewUrl === "null" || previewUrl === "undefined") {
      console.warn("[audio-debug] rejected playback request", {
        requestId,
        source,
        id,
        previewUrl
      });
      return false;
    }

    const absolutePreviewUrl = typeof window !== "undefined"
      ? new URL(previewUrl, window.location.href).href
      : previewUrl;

    const audioEl = audioRef.current;
    const sameTrackAlreadyActive = Boolean(
      id &&
      id === activePreviewId &&
      audioSrc === absolutePreviewUrl &&
      audioEl &&
      !audioEl.paused &&
      !audioEl.ended
    );

    if (sameTrackAlreadyActive) {
      console.debug("[audio-debug] skip duplicate playback request", {
        requestId,
        source,
        id,
        absolutePreviewUrl
      });
      if (selectId) setSelectedId(selectId);
      if (overrideEntity) setNowPlayingOverride(overrideEntity);
      return true;
    }

    console.debug("[audio-debug] queue playback", {
      requestId,
      source,
      id,
      selectId,
      previewUrl,
      absolutePreviewUrl,
      hasOverrideEntity: Boolean(overrideEntity)
    });

    // Crossfade: if audio is currently playing, fade out before swapping
    const isCurrentlyPlaying = audioEl && audioEl.currentSrc && !audioEl.paused && !audioEl.ended;
    const needsCrossfade = isCurrentlyPlaying && audioEl.volume > 0.01;
    const swapAndFadeIn = () => {
      setNowPlayingOverride(overrideEntity);
      if (id) setActivePreviewId(id);
      if (selectId) setSelectedId(selectId);
      setAudioSrc(absolutePreviewUrl);
      setNowPlayingVersion((current) => current + 1);
    };

    if (needsCrossfade) {
      if (crossfadeTimerRef.current) {
        cancelAnimationFrame(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
      const fadeStart = performance.now();
      const fadeDuration = 300;
      const startVolume = audioEl.volume;
      const fadeOut = (now) => {
        const elapsed = now - fadeStart;
        const progress = Math.min(elapsed / fadeDuration, 1);
        audioEl.volume = Math.max(0, Math.min(1, startVolume * (1 - progress)));
        if (progress < 1) {
          crossfadeTimerRef.current = requestAnimationFrame(fadeOut);
        } else {
          audioEl.volume = 0;
          crossfadeTimerRef.current = null;
          swapAndFadeIn();
        }
      };
      crossfadeTimerRef.current = requestAnimationFrame(fadeOut);
    } else {
      // Not crossfading — ensure volume is restored to 1 before swapping
      if (audioEl) audioEl.volume = 1;
      if (crossfadeTimerRef.current) {
        cancelAnimationFrame(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
      swapAndFadeIn();
    }

    return true;
  }, [activePreviewId, audioSrc]);

  const playPreviewUrl = useCallback((id, previewUrl, source = "preview-url", options = {}) => {
    console.debug("[audio-debug] playPreviewUrl", {
      source,
      id,
      previewUrl,
      hasOverrideEntity: Boolean(options.nowPlayingEntity)
    });

    startPlayback(id, previewUrl, {
      source,
      nowPlayingEntity: options.nowPlayingEntity
    });
  }, [startPlayback]);

  const buildPreviewNowPlayingEntity = useCallback((trackLike, targetId, previewUrl = "", artworkUrl = "") => {
    const artist = trackLike?.artist || trackLike?.payload?.artist || trackLike?.raw?.artist || "";
    const title = trackLike?.title || trackLike?.payload?.title || trackLike?.label?.split(" · ")[0] || trackLike?.label || "";
    const album = trackLike?.album || trackLike?.payload?.album || trackLike?.raw?.album || "";
    return {
      id: targetId,
      kind: "track",
      label: title,
      subtitle: [artist, album].filter(Boolean).join(" · "),
      previewUrl,
      artworkUrl,
      raw: {
        artist,
        title,
        album,
        artworkUrl,
        previewUrl
      },
      meta: [album ? "Album" : ""].filter(Boolean)
    };
  }, []);

  const buildTrackEntityStub = useCallback((trackLike, targetId, previewUrl = "", artworkUrl = "") => {
    const stub = buildPreviewNowPlayingEntity(trackLike, targetId, previewUrl, artworkUrl);
    return {
      ...stub,
      loaded: false,
      links: [],
      details: {
        lines: [stub.subtitle].filter(Boolean)
      }
    };
  }, [buildPreviewNowPlayingEntity]);

  // Process pending "add to playlist" additions from Library Graph
  // NOTE: Must be defined AFTER buildTrackEntityStub to avoid TDZ error
  useEffect(() => {
    const processPendingAdds = () => {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem(PENDING_ADD_KEY);
        if (!raw) return;
        const pending = JSON.parse(raw);
        if (!Array.isArray(pending) || pending.length === 0) return;
        window.localStorage.removeItem(PENDING_ADD_KEY);
        pending.forEach((stub) => {
          const entity = buildTrackEntityStub(stub, trackNodeId(stub), null, stub.artworkUrl);
          setPlaylist((current) => {
            if (current.some((item) => item.id === entity.id)) return current;
            return [...current, entity];
          });
        });
      } catch (e) {}
    };

    // Process on mount (in case Studio was closed and reopened)
    processPendingAdds();

    // Process whenever the window regains focus (user comes back from Library Graph tab)
    window.addEventListener("focus", processPendingAdds);
    return () => window.removeEventListener("focus", processPendingAdds);
  }, [buildTrackEntityStub]);

  const warmTrackPreview = useCallback(async (trackLike, preferredId = "", options = {}) => {
    const artist = trackLike?.artist || trackLike?.payload?.artist || "";
    const title = trackLike?.title || trackLike?.payload?.title || trackLike?.label?.split(" · ")[0] || "";
    const album = trackLike?.album || trackLike?.payload?.album || "";
    const autoplay = options.autoplay !== false;
    const requestToken = options.requestToken;
    const source = options.source || "warmTrackPreview";
    const nowPlayingEntityOverride = options.nowPlayingEntity || null;
    if (!artist || !title) return "";

    const cacheKey = `track:${trackKey(artist, title)}`;
    const targetId = preferredId || trackNodeId({ artist, title });

    console.debug("[audio-debug] warmTrackPreview start", {
      source,
      targetId,
      artist,
      title,
      album,
      cacheKey,
      autoplay,
      requestToken,
      currentHoverToken: hoverPreviewTokenRef.current,
      cacheHit: Boolean(previewCache[cacheKey])
    });

    if (previewCache[cacheKey]) {
      if (autoplay && (requestToken == null || requestToken === hoverPreviewTokenRef.current)) {
        playPreviewUrl(targetId, previewCache[cacheKey], `${source}:cache-hit`, {
          nowPlayingEntity: nowPlayingEntityOverride || buildPreviewNowPlayingEntity(trackLike, targetId, previewCache[cacheKey], trackLike?.artworkUrl || trackLike?.payload?.artworkUrl || "")
        });
      }
      return previewCache[cacheKey];
    }

    try {
      if (!previewPromiseCacheRef.current[cacheKey]) {
        previewPromiseCacheRef.current[cacheKey] = (async () => {
          console.debug("[audio-debug] warmTrackPreview preview-fetch-start", {
            source,
            targetId,
            cacheKey,
            artist,
            title,
            album
          });

          const preview = await api(`/api/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}&album=${encodeURIComponent(album)}`);
          const previewUrl = preview?.previewUrl || "";
          const artworkUrl = preview?.artworkUrl || "";

          console.debug("[audio-debug] warmTrackPreview preview-fetch-result", {
            source,
            targetId,
            cacheKey,
            previewUrl,
            artworkUrl
          });

          return { previewUrl, artworkUrl };
        })().finally(() => {
          delete previewPromiseCacheRef.current[cacheKey];
        });
      }

      const result = await previewPromiseCacheRef.current[cacheKey];
      const previewUrl = result?.previewUrl || "";
      const artworkUrl = result?.artworkUrl || "";

      if (!previewUrl && !artworkUrl) {
        console.debug("[audio-debug] warmTrackPreview no-preview-and-no-artwork", {
          source,
          targetId,
          cacheKey,
          artist,
          title,
          album
        });
        return "";
      }

      if (previewUrl) {
        setPreviewCache((current) => current[cacheKey] ? current : { ...current, [cacheKey]: previewUrl });
        // Always back-propagate previewUrl to the entity
        setEntityMap((current) => {
          const existing = current[targetId];
          if (existing?.previewUrl) return current; // already has one, skip
          return { ...current, [targetId]: { ...(existing || {}), previewUrl } };
        });
      }

      if (artworkUrl) {
        setEntityMap((current) => {
          const existing = current[targetId];
          if (existing && existing.artworkUrl) return current;
          return { ...current, [targetId]: { ...(existing || {}), artworkUrl } };
        });
      }

      setEntityMap((current) => {
        const stub = buildTrackEntityStub({ artist, title, album, artworkUrl }, targetId, previewUrl, artworkUrl);
        const existing = current[targetId];
        return {
          ...current,
          [targetId]: mergeEntity(existing || stub, {
            ...stub,
            previewUrl: previewUrl || existing?.previewUrl || "",
            artworkUrl: artworkUrl || existing?.artworkUrl || ""
          })
        };
      });

      setNodes((current) => current.map((node) => {
        if (!String(node.id).startsWith("ghost:")) return node;
        const sameKey = node.data?.kind === "track" && trackKey(node.data?.trackArtist, node.data?.trackTitle) === trackKey(artist, title);
        return sameKey ? { ...node, data: { ...node.data, previewUrl } } : node;
      }));

      if (previewUrl && autoplay && (requestToken == null || requestToken === hoverPreviewTokenRef.current)) {
        playPreviewUrl(targetId, previewUrl, `${source}:resolved`, {
          nowPlayingEntity: nowPlayingEntityOverride || buildPreviewNowPlayingEntity(trackLike, targetId, previewUrl, artworkUrl)
        });
      }
      return previewUrl;
    } catch (err) {
      console.warn("[audio-debug] warmTrackPreview failed", {
        source,
        targetId,
        cacheKey,
        message: err?.message || String(err)
      });
      return "";
    }
  }, [buildPreviewNowPlayingEntity, buildTrackEntityStub, previewCache, playPreviewUrl, setNodes]);

  const playEntity = useCallback((entity, source = "entity", options = {}) => {
    if (!entity || entity.kind !== "track") {
      console.debug("[audio-debug] playEntity skipped", { source, entity });
      return;
    }

    const resolvedPreviewUrl =
      entity.previewUrl ||
      previewCache[`track:${trackKey(
        entity.raw?.artist || entity.subtitle?.split(" · ")[0] || "",
        entity.label
      )}`] ||
      "";

    console.debug("[audio-debug] playEntity", {
      source,
      id: entity.id,
      label: entity.label,
      previewUrl: resolvedPreviewUrl,
      hadPreviewUrl: Boolean(entity.previewUrl)
    });

    if (!resolvedPreviewUrl) {
      // Entity has no preview URL yet — route through warmTrackPreview
      // which handles previewCache lookup → fetch → token cancellation
      const artist = entity.raw?.artist || entity.subtitle?.split(" · ")[0] || "";
      const title = entity.label;
      const album = entity.raw?.album || entity.raw?.detail?.track?.album?.name || "";
      warmTrackPreview(
        { artist, title, album },
        entity.id,
        {
          autoplay: true,
          source: `${source}-warm`,
          nowPlayingEntity: options.nowPlayingEntity || entity
        }
      );
      return;
    }

    startPlayback(entity.id, resolvedPreviewUrl, {
      selectId: entity.id,
      source,
      nowPlayingEntity: options.nowPlayingEntity || entity
    });
  }, [startPlayback, warmTrackPreview, previewCache]);

  const focusEntity = useCallback((entityId) => {
    if (!entityId) return;
    setDetailOpen(true);
    setSelectedId(entityId);
  }, []);

  const zoomToNode = useCallback((nodeId, zoom = 1.18) => {
    const targetNode = nodes.find((node) => node.id === nodeId && !String(node.id).startsWith("ghost:"));
    if (!targetNode) return;
    setCenter(targetNode.position.x + 146, targetNode.position.y + 78, { zoom, duration: 380 });
  }, [nodes, setCenter]);

  const cancelScheduledTrackPreview = useCallback(() => {
    hoverPreviewTokenRef.current += 1;
    console.debug("[audio-debug] cancelScheduledTrackPreview", {
      nextHoverToken: hoverPreviewTokenRef.current,
      hadTimer: Boolean(hoverPreviewTimerRef.current)
    });
    if (hoverPreviewTimerRef.current) clearTimeout(hoverPreviewTimerRef.current);
    hoverPreviewTimerRef.current = null;
  }, []);

  const preloadTrackLinks = useCallback(() => [], []);

  const upsertEntities = useCallback((entities) => {
    setEntityMap((current) => {
      const next = { ...current };
      entities.forEach((entity) => {
        next[entity.id] = mergeEntity(next[entity.id], entity);
      });
      setNodes((nodeList) => syncNodes(nodeList, next, playlistIds, activePreviewId));
      return next;
    });
  }, [playlistIds, activePreviewId, setNodes, syncNodes]);

  useEffect(() => {
    return () => {
      if (hoverPreviewTimerRef.current) clearTimeout(hoverPreviewTimerRef.current);
      if (crossfadeTimerRef.current) cancelAnimationFrame(crossfadeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!Object.keys(previewCache).length) return;
    setNodes((current) => current.map((node) => {
      if (!String(node.id).startsWith("ghost:")) return node;
      if (node.data?.kind !== "track" || node.data?.previewUrl) return node;
      const artist = node.data?.trackArtist || "";
      const title = node.data?.trackTitle || "";
      const cacheKey = artist && title ? `track:${trackKey(artist, title)}` : "";
      const previewUrl = cacheKey ? previewCache[cacheKey] : "";
      return previewUrl ? { ...node, data: { ...node.data, previewUrl } } : node;
    }));
  }, [previewCache, setNodes]);

  const ensureNode = useCallback((entityOrId, position) => {
    const entity = typeof entityOrId === "string" ? entityMap[entityOrId] : entityOrId;
    const entityId = typeof entityOrId === "string" ? entityOrId : entityOrId?.id;
    if (!entityId) return;
    setNodes((current) => {
      const filtered = current.filter((node) => !String(node.id).startsWith("ghost:"));
      const nextMap = entity ? { ...entityMap, [entityId]: entity } : entityMap;
      if (filtered.some((node) => node.id === entityId)) {
        return syncNodes(filtered, nextMap, playlistIds, activePreviewId);
      }
      return syncNodes([
        ...filtered,
        { id: entityId, type: "entity", position, data: { entity: entity || entityMap[entityId], inPlaylist: playlistIds.includes(entityId), isPlaying: activePreviewId === entityId, onTogglePlaylist: togglePlaylist } }
      ], nextMap, playlistIds, activePreviewId);
    });
  }, [entityMap, playlistIds, activePreviewId, setNodes, syncNodes, togglePlaylist]);

  const ensureEdge = useCallback((source, target, relation) => {
    if (!source || !target || source === target) return;
    setEdges((current) => {
      const filtered = current.filter((edge) => !String(edge.id).startsWith("ghost-edge:"));
      const id = `edge:${source}:${target}`;
      if (filtered.some((edge) => edge.id === id)) return filtered;
      return [...filtered, { id, source, target, label: relation, labelShowBg: false, labelStyle: { fill: "#94a3b8", fontSize: 11 }, style: { stroke: "#475569", strokeWidth: 1.5 } }];
    });
  }, [setEdges]);

  const findCanvasNodeForLink = useCallback((link, sourceId = "") => {
    const sourceEntity = sourceId ? entityMap[sourceId] : null;
    const desiredKey = linkCanonicalKey(link, sourceEntity);
    const match = nodes.find((node) => {
      if (String(node.id).startsWith("ghost:")) return false;
      if (node.id === link.id) return true;
      const entity = entityMap[node.id];
      return desiredKey && entityCanonicalKey(entity) === desiredKey;
    });
    return match?.id || "";
  }, [nodes, entityMap]);

  const positionForLink = useCallback((sourceId, link, targetId = "") => {
    const sourceNode = nodes.find((node) => node.id === sourceId);
    const blockedNodes = nodes.filter((node) => node.id !== sourceId && node.id !== targetId);
    if (!sourceNode) return resolveOpenedNodePosition(centerFlowPosition(), blockedNodes, [], 0);
    const sourceEntity = entityMap[sourceId];
    const list = sourceEntity?.links || [];
    const index = Math.max(list.findIndex((item) => item.id === link.id && item.relation === link.relation), 0);
    const totalInSector = list.filter((item) => item.relation === link.relation).length;
    const offset = sectorOffset(link.relation, index, totalInSector, 360, link.similarity || 0);
    const anchor = { x: sourceNode.position.x + offset.x, y: sourceNode.position.y + offset.y };
    return resolveOpenedNodePosition(anchor, blockedNodes, [], index);
  }, [entityMap, nodes, centerFlowPosition]);

  const clearGhosts = useCallback(() => {
    setNodes((current) => current.filter((node) => !String(node.id).startsWith("ghost:")));
    setEdges((current) => current.filter((edge) => !String(edge.id).startsWith("ghost-edge:")));
  }, [setEdges, setNodes]);

  const deleteEntity = useCallback((entityId) => {
    if (!entityId) return;
    setNodes((current) => current.filter((node) => node.id !== entityId && !String(node.id).startsWith("ghost:")));
    setEdges((current) => current.filter((edge) => edge.source !== entityId && edge.target !== entityId && !String(edge.id).startsWith("ghost-edge:")));
    setEntityMap((current) => {
      const next = { ...current };
      delete next[entityId];
      return next;
    });
    if (selectedId === entityId) setSelectedId("");
    if (activePreviewId === entityId) {
      setActivePreviewId("");
      setAudioSrc("");
      setNowPlayingOverride(null);
    }
    setPlaylist((current) => current.filter((item) => item.id !== entityId));
  }, [selectedId, activePreviewId]);

  const revealGhosts = useCallback((entityId) => {
    const entity = entityMap[entityId];
    const parentNode = nodes.find((n) => n.id === entityId);
    if (!entity || !parentNode) return;

    const stableNodes = nodes.filter((n) => !n.id.startsWith("ghost:") && n.id !== entityId);
    const plannedPositions = [];

    // Segment all visible links by relation group
    const allLinks = visibleLinksForEntity(entityId);
    const structural = allLinks.filter((l) => ["artist", "album"].includes(l.relation)).slice(0, 10);
    const similar = allLinks.filter((l) => l.relation === "related-track").slice(0, 10);
    const genres = allLinks.filter((l) => l.kind === "genre").slice(0, 6);
    const artistTracks = allLinks.filter((l) => l.relation === "artist-track").slice(0, 10);
    const albumTracks = allLinks.filter((l) => l.relation === "album-track").slice(0, 10);
    const genericTracks = allLinks.filter((l) => l.relation === "track").slice(0, 8);

    // Check if the artist entity node is already on the canvas
    // If so, anchor artist-track ghosts to it instead of the parent track node
    const artistLink = structural.find((l) => l.kind === "artist");
    const artistCanvasNodeId = artistLink ? findCanvasNodeForLink(artistLink, entityId) : null;
    const artistAnchorNode = artistCanvasNodeId ? nodes.find((n) => n.id === artistCanvasNodeId) : null;

    preloadTrackLinks(entity);

    // Helper: build a ghost node for one link with sector-based positioning
    function makeGhost(link, indexInSector, totalInSector, anchorNode, weight) {
      const offset = sectorOffset(link.relation, indexInSector, totalInSector, 320, weight ?? 1.0);
      const rawPos = { x: anchorNode.position.x + offset.x, y: anchorNode.position.y + offset.y };
      const position = nudgeFromCollision(rawPos, anchorNode.position, stableNodes, plannedPositions);
      plannedPositions.push(position);
      return {
        id: `ghost::${entityId}::${link.id}::${link.relation}`,
        type: "ghost",
        position,
        draggable: false,
        selectable: false,
        data: {
          entityId: link.id,
          parentId: entityId,
          edgeSourceId: anchorNode.id, // may differ from entityId for artist-track
          relation: link.relation,
          label: link.label,
          kind: link.kind,
          similarity: link.similarity ?? null,
          relativePopularity: link.relativePopularity ?? null,
          rank: link.rank ?? null,
          listeners: link.payload?.listeners ?? 0,
          opened: Boolean(findCanvasNodeForLink(link, entityId) || entityMap[link.id]?.loaded),
          inPlaylist: playlistIds.includes(link.id),
          previewUrl:
            link.payload?.previewUrl ??
            entityMap[findCanvasNodeForLink(link, entityId)]?.previewUrl ??
            entityMap[link.id]?.previewUrl ??
            previewCache[linkCanonicalKey(link, entity)] ??
            null,
          trackArtist: link.payload?.artist ?? link.artist,
          trackTitle: link.payload?.title ?? link.label?.split("\n")[0],
          trackAlbum: link.payload?.album,
          onTogglePlaylist: togglePlaylist,
        },
      };
    }

    const ghostNodes = [
      ...structural.map((l, i) => makeGhost(l, i, structural.length, parentNode, null)),
      ...similar.map((l, i) => makeGhost(l, i, similar.length, parentNode, l.similarity ?? 0.5)),
      ...genres.map((l, i) => makeGhost(l, i, genres.length, parentNode, null)),
      // Artist tracks: anchor to artist canvas node if present, otherwise use parent
      ...artistTracks.map((l, i) => makeGhost(l, i, artistTracks.length, artistAnchorNode ?? parentNode, null)),
      ...albumTracks.map((l, i) => makeGhost(l, i, albumTracks.length, parentNode, null)),
      ...genericTracks.map((l, i) => makeGhost(l, i, genericTracks.length, parentNode, null)),
    ];

    setNodes((current) => [...current.filter((n) => !n.id.startsWith("ghost:")), ...ghostNodes]);

    setEdges((current) => {
      const filtered = current.filter((e) => !e.id.startsWith("ghost-edge:"));
      const ghostEdges = ghostNodes.map((gn) => ({
        id: `ghost-edge::${gn.data.edgeSourceId}::${gn.id}`,
        source: gn.data.edgeSourceId, // artist-track edges source from artist node
        target: gn.id,
        animated: !findCanvasNodeForLink(
          entity.links.find((l) => l.id === gn.data.entityId && l.relation === gn.data.relation),
          entityId
        ),
        style: {
          stroke: `#${ghostAccentColor(gn.data.relation)}`,
          strokeDasharray: gn.data.opened ? "0" : "0 6 6",
          opacity: 0.7,
          strokeWidth: 1.5,
        },
        labelShowBg: false,
      }));
      return [...filtered, ...ghostEdges];
    });

  }, [entityMap, nodes, playlistIds, setEdges, setNodes, togglePlaylist, findCanvasNodeForLink, previewCache, preloadTrackLinks, visibleLinksForEntity]);

  const loadTrack = useCallback(async (track, sourceId = "", relation = "") => {
    const detail = await api(`/api/track/detail?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&album=${encodeURIComponent(track.album || "")}`);
    const main = normalizeTrackEntity({ ...track, previewUrl: track.previewUrl || detail?.track?.previewUrl || "", artworkUrl: track.artworkUrl || detail?.track?.artworkUrl || "" }, detail);
    upsertEntities([main]);
    preloadTrackLinks(main);
    ensureNode(main, sourceId ? positionForLink(sourceId, { id: main.id, relation }, main.id) : safeCenterFlowPosition(main.id));
    if (sourceId) ensureEdge(sourceId, main.id, relation || "track");
    playEntity(main);
    return main;
  }, [ensureEdge, ensureNode, positionForLink, upsertEntities, safeCenterFlowPosition, playEntity]);

  const loadArtist = useCallback(async (artist, sourceId = "", relation = "") => {
    const detail = await api(`/api/artist/detail?name=${encodeURIComponent(artist.name)}`);
    const main = normalizeArtistEntity({ ...artist, id: artist.id || artistNodeId(artist.name) }, detail);
    upsertEntities([main]);
    preloadTrackLinks(main);
    ensureNode(main, sourceId ? positionForLink(sourceId, { id: main.id, relation }, main.id) : safeCenterFlowPosition(main.id));
    if (sourceId) ensureEdge(sourceId, main.id, relation || "artist");
    setSelectedId(main.id);
    return main;
  }, [ensureEdge, ensureNode, positionForLink, upsertEntities, safeCenterFlowPosition]);

  const loadAlbum = useCallback(async (artist, album, sourceId = "", relation = "") => {
    const detail = await api(`/api/album/detail?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`);
    const main = normalizeAlbumEntity(detail, artist, album);
    upsertEntities([main]);
    preloadTrackLinks(main);
    ensureNode(main, sourceId ? positionForLink(sourceId, { id: main.id, relation }, main.id) : safeCenterFlowPosition(main.id));
    if (sourceId) ensureEdge(sourceId, main.id, relation || "album");
    setSelectedId(main.id);
    return main;
  }, [ensureEdge, ensureNode, positionForLink, upsertEntities, safeCenterFlowPosition]);

  const loadGenre = useCallback(async (tag, sourceId = "", relation = "") => {
    const detail = await api(`/api/genre/detail?tag=${encodeURIComponent(tag)}`);
    const main = normalizeGenreEntity(detail, tag);
    upsertEntities([main]);
    preloadTrackLinks(main);
    ensureNode(main, sourceId ? positionForLink(sourceId, { id: main.id, relation }, main.id) : safeCenterFlowPosition(main.id));
    if (sourceId) ensureEdge(sourceId, main.id, relation || "genre");
    setSelectedId(main.id);
    return main;
  }, [ensureEdge, ensureNode, positionForLink, upsertEntities, safeCenterFlowPosition]);

  const openLink = useCallback(async (sourceId, link, explicitPosition = null) => {
    try {
      setMessage("");
      clearGhosts();
      const existingCanvasId = findCanvasNodeForLink(link, sourceId);
      if (existingCanvasId) {
        if (sourceId) ensureEdge(sourceId, existingCanvasId, link.relation);
        setSelectedId(existingCanvasId);
        zoomToNode(existingCanvasId);
        const existingEntity = entityMap[existingCanvasId];
        if (existingEntity?.kind === "track") playEntity(existingEntity);
        return;
      }
      const loadedEntity = entityMap[link.id];
      if (loadedEntity?.loaded) {
        ensureNode(loadedEntity, explicitPosition || positionForLink(sourceId, link, loadedEntity.id));
        if (sourceId) ensureEdge(sourceId, loadedEntity.id, link.relation);
        setSelectedId(loadedEntity.id);
        if (loadedEntity.kind === "track") playEntity(loadedEntity);
        return;
      }
      if (link.kind === "track" && link.payload) {
        const ghostNodeId = `ghost::${sourceId}::${link.id}::${link.relation}`;
        const ghostNode = nodes.find((n) => n.id === ghostNodeId);
        const cachedPreview = ghostNode?.data?.entityId ? previewCache[linkCanonicalKey(link, entityMap[sourceId]) || ""] : null;
        const seededTrack = {
          ...link.payload,
          artworkUrl: link.payload.artworkUrl || cachedPreview?.artworkUrl || "",
          previewUrl: link.payload.previewUrl || cachedPreview?.previewUrl || ""
        };
        return loadTrack(seededTrack, sourceId, link.relation);
      }
      if (link.kind === "artist") return loadArtist({ name: link.payload?.name || link.label, id: link.id, artworkUrl: link.payload?.artworkUrl || "" }, sourceId, link.relation);
      if (link.kind === "album") return loadAlbum(link.artist || entityMap[sourceId]?.label || "", link.album || link.label.split(" · ")[0], sourceId, link.relation);
      if (link.kind === "genre") return loadGenre(link.tag || link.label, sourceId, link.relation);
    } catch (err) {
      setMessage(err.message);
    }
  }, [clearGhosts, entityMap, ensureEdge, ensureNode, loadAlbum, loadArtist, loadGenre, loadTrack, playEntity, positionForLink, findCanvasNodeForLink, zoomToNode]);

  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  const search = useCallback(async () => {
    const q = queryRef.current.trim();
    if (!q) return;
    setSearching(true);
    setMessage("");
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      setSearchResults({
        deezer: { artists: data.deezer?.artists || [], tracks: data.deezer?.tracks || [] },
        itunes: { tracks: data.itunes?.tracks || [] },
      });
      setSearchOpen(true);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSearching(false);
    }
  }, []); // stable — no deps

  const searchDebounceRef = useRef(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults({
        deezer: { artists: [], tracks: [] },
        itunes: { tracks: [] },
      });
      return;
    }
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(search, 280);
    return () => clearTimeout(searchDebounceRef.current);
  }, [query]); // search() is stable now

  useEffect(() => {
    if (!hydrated.current) return;
    nodes
      .filter((node) => !String(node.id).startsWith("ghost:"))
      .map((node) => entityMap[node.id])
      .filter(Boolean)
      .forEach((entity) => {
        preloadTrackLinks(entity);
      });
  }, [nodes, entityMap, preloadTrackLinks]);

  const selectSearchResult = useCallback((kind, item) => {
    setSearchOpen(false);
    if (kind === "track") return loadTrack(item);
    return loadArtist({ ...item, name: item.name, id: item.id || artistNodeId(item.name) });
  }, [loadArtist, loadTrack]);

  const previewSearchResult = useCallback((item) => {
    if (!item?.previewUrl) return;

    const previewEntity = normalizeTrackEntity({
      ...item,
      previewUrl: item.previewUrl,
      artworkUrl: item.artworkUrl,
    });

    // Cancel any in-progress crossfade and reset volume immediately
    if (crossfadeTimerRef.current) {
      cancelAnimationFrame(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }

    // Update UI display instantly
    setNowPlayingOverride(previewEntity);
    setActivePreviewId(previewEntity.id);

    // Drive the audio element directly — bypasses state → useEffect latency entirely
    const el = audioRef.current;
    if (el && userActivatedRef.current) {
      const absoluteUrl = new URL(item.previewUrl, window.location.href).href;
      el.volume = 1;
      if (el.currentSrc !== absoluteUrl) {
        el.pause();
        el.src = absoluteUrl;
        lastAppliedAudioSrcRef.current = absoluteUrl; // keep ref in sync so useEffect doesn't re-apply
        el.load();
      }
      el.play().catch(err => console.warn('audio-debug search-hover play failed', err.message));
    }

    // Sync React audio state so the rest of the system (useEffect, persistence) stays consistent
    ++playbackRequestRef.current;
    setAudioSrc(item.previewUrl);
    setNowPlayingVersion(v => v + 1);

  }, [setNowPlayingOverride, setActivePreviewId, setAudioSrc, setNowPlayingVersion]);

  const previewLinkItem = useCallback((link) => {
    if (!link || link.kind !== 'track') return;
    const artist = link.payload?.artist;
    const title = link.payload?.title || link.label?.split(' — ')[0] || link.label;
    const album = link.payload?.album;
    const artworkUrl = link.payload?.artworkUrl;
    if (!artist || !title) return;

    const cacheKey = `track${trackKey(artist, title)}`;
    const cachedUrl = previewCache[cacheKey] || link.payload?.previewUrl;

    const nowPlayingEntity = buildPreviewNowPlayingEntity(
      { artist, title, album, artworkUrl },
      link.id, cachedUrl, artworkUrl
    );

    if (cachedUrl) {
      if (crossfadeTimerRef.current) {
        cancelAnimationFrame(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
      setNowPlayingOverride(nowPlayingEntity);
      setActivePreviewId(link.id);
      const el = audioRef.current;
      if (el && userActivatedRef.current) {
        const absoluteUrl = new URL(cachedUrl, window.location.href).href;
        el.volume = 1;
        if (el.currentSrc !== absoluteUrl) {
          el.pause();
          el.src = absoluteUrl;
          lastAppliedAudioSrcRef.current = absoluteUrl;
          el.load();
          el.play().catch(err =>
            console.warn('audio-debug detail-link-hover play failed', err.message)
          );
        }
        playbackRequestRef.current++;
        setAudioSrc(cachedUrl);
        setNowPlayingVersion(v => v + 1);
      }
    } else {
      const token = ++hoverPreviewTokenRef.current;
      warmTrackPreview(
        { artist, title, album, artworkUrl },
        link.id,
        { autoplay: true, source: 'detail-link-hover-fetch', requestToken: token, nowPlayingEntity }
      );
    }
  }, [buildPreviewNowPlayingEntity, previewCache, warmTrackPreview,
      setNowPlayingOverride, setActivePreviewId, setAudioSrc, setNowPlayingVersion]);

  const previewPlaylistItem = useCallback((entity) => {
    if (!entity || entity.kind !== 'track') return;
    const artist = entity.raw?.artist || entity.subtitle?.split(' · ')[0];
    const title = entity.label;
    const cacheKey = `track${trackKey(artist, title)}`;
    const cachedUrl = entity.previewUrl || previewCache[cacheKey];

    if (cachedUrl) {
      if (crossfadeTimerRef.current) {
        cancelAnimationFrame(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
      setNowPlayingOverride(entity);
      setActivePreviewId(entity.id);
      const el = audioRef.current;
      if (el && userActivatedRef.current) {
        const absoluteUrl = new URL(cachedUrl, window.location.href).href;
        el.volume = 1;
        if (el.currentSrc !== absoluteUrl) {
          el.pause();
          el.src = absoluteUrl;
          lastAppliedAudioSrcRef.current = absoluteUrl;
          el.load();
          el.play().catch(err =>
            console.warn('audio-debug playlist-hover play failed', err.message)
          );
        }
        playbackRequestRef.current++;
        setAudioSrc(cachedUrl);
        setNowPlayingVersion(v => v + 1);
      }
    } else {
      const token = ++hoverPreviewTokenRef.current;
      warmTrackPreview(
        { artist, title, album: entity.raw?.album },
        entity.id,
        { autoplay: true, source: 'playlist-hover-fetch', requestToken: token, nowPlayingEntity: entity }
      );
    }
  }, [previewCache, warmTrackPreview,
      setNowPlayingOverride, setActivePreviewId, setAudioSrc, setNowPlayingVersion]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // Process bulk harvester import queue from Library Graph
  useEffect(() => {
    if (!importQueue.length) return;

    // ── 1. Compute canvas drop position ──────────────────────────────────────
    const vp = getViewportRef.current?.() ?? { x: 0, y: 0, zoom: 1 };
    // Convert screen centre to flow-space coordinates
    const COLS      = 5;
    const H_GAP     = 260;
    const V_GAP     = 160;
    const centerX   = (window.innerWidth  / 2 - vp.x) / vp.zoom;
    const centerY   = (window.innerHeight / 2 - vp.y) / vp.zoom;

    // ── 2. Build entity stubs from library nodes ──────────────────────────────
    const newEntities = {};
    importQueue.forEach(libNode => {
      const entity = buildTrackEntityStub(
        { title: libNode.title, artist: libNode.artist },
        libNode.id,          // library node IDs match Studio IDs (track:artist-title)
        libNode.previewUrl,  // camelCase — set by SQL alias in getLibraryGraphData
        libNode.artworkurl   // lowercase — raw column from librarynodes table
      );
      newEntities[entity.id] = entity;
    });

    const newIds         = Object.keys(newEntities);
    const nextEntityMap  = { ...entityMap, ...newEntities };
    const nextPlaylistIds = [...new Set([...playlistIds, ...newIds])];

    // ── 3. Update entity map and playlist ────────────────────────────────────
    setEntityMap(nextEntityMap);
    setPlaylist(prev => {
      const existingIds = new Set(prev.map(p => p.id));
      return [...prev, ...Object.values(newEntities).filter(e => !existingIds.has(e.id))];
    });

    // ── 4. Place nodes on the canvas via syncNodes ────────────────────────────
    setNodes(current => {
      const filtered    = current.filter(n => !String(n.id).startsWith('ghost'));
      const existingIds = new Set(filtered.map(n => n.id));

      const toAdd = newIds
        .filter(id => !existingIds.has(id))
        .map((id, i) => {
          const absIdx = importQueue.findIndex(n => n.id === id);
          const col    = absIdx % COLS;
          const row    = Math.floor(absIdx / COLS);
          return {
            id,
            type:     'entity',
            position: {
              x: centerX + (col - Math.floor(COLS / 2)) * H_GAP,
              y: centerY + row * V_GAP - 80,
            },
            data: {},   // syncNodes will populate all data fields below
          };
        });

      return syncNodes(
        [...filtered, ...toAdd],
        nextEntityMap,
        nextPlaylistIds,
        activePreviewId
      );
    });

    // ── 5. Notify and clean up ────────────────────────────────────────────────
    setMessage(`Added ${newIds.length} track${newIds.length !== 1 ? 's' : ''} from Library`);
    clearQueue();
  }, [
    importQueue,
    entityMap,
    playlistIds,
    activePreviewId,
    buildTrackEntityStub,
    syncNodes,
    clearQueue,
    setMessage,
  ]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !String(selectedId).startsWith("ghost:")) {
        const target = event.target;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
        event.preventDefault();
        deleteEntity(selectedId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, deleteEntity]);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    loadTrack({ title: "Midnight City", artist: "M83", album: "Hurry Up, We're Dreaming" }).catch(() => {});
  }, [loadTrack]);

  return (
    <div className="graph-shell minimal-shell">
      <div className="graph-main compact-layout">
        <section className="graph-panel full-canvas" ref={graphPanelRef}>
          <div className={`floating-search ${searchOpen ? "open" : "collapsed"}`} ref={searchBoxRef}>
            {searchOpen ? (
              <>
                <div className="search-bar-shell">
                  <div className="search-bar-row">
                    <div className="search-input-wrap">
                      <span className="search-leading-icon"><SearchIcon /></span>
                      <input
                        ref={searchInputRef}
                        className="search-input minimal"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search artists or tracks"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") search();
                          if (e.key === "Escape") setSearchOpen(false);
                        }}
                      />
                      {query && (
                        <button className="search-clear-btn" onClick={() => setQuery('')} title="Clear search" aria-label="Clear search">
                          <CloseIcon />
                        </button>
                      )}
                    </div>
                    <button className="search-go" onClick={search} disabled={searching}>
                      {searching ? '…' : 'Go'}
                    </button>
                  </div>
                  <div className="search-bar-utility">
                    <ThemeToggle />
                  </div>
                  {!query && !searching && (
                    <p className="search-empty-hint">
                      Search for an artist or track to start exploring
                    </p>
                  )}
                </div>

                {(topArtistMatch || otherArtistResults.length > 0 || deezerTrackResults.length > 0 || itunesTrackResults.length > 0) && (
                  <div className="result-flyout">
                    {/* Artist row — Deezer, shown on both layouts */}
                    {topArtistMatch && (
                      <ResultButton
                        item={topArtistMatch} kind="artist" featured
                        onClick={() => selectSearchResult('artist', topArtistMatch)}
                      />
                    )}
                    {otherArtistResults.map(item => (
                      <ResultButton key={item.id || item.name} item={item} kind="artist"
                        onClick={() => selectSearchResult('artist', item)}
                      />
                    ))}

                    {/* Track columns — side by side on desktop, Deezer only on mobile */}
                    {(deezerTrackResults.length > 0 || itunesTrackResults.length > 0) && (
                      <div className="result-tracks-grid">
                        <div className="result-column">
                          <div className="result-column-header">
                            <span className="source-dot deezer" />Deezer
                          </div>
                          {deezerTrackResults.map(item => (
                            <ResultButton key={item.artist + item.title} item={item} kind="track"
                              onClick={() => selectSearchResult('track', item)}
                              onHover={previewSearchResult}
                            />
                          ))}
                          {deezerTrackResults.length === 0 && (
                            <div className="result-column-empty">No results</div>
                          )}
                        </div>

                        <div className="result-column itunes-col">
                          <div className="result-column-header">
                            <span className="source-dot itunes" />iTunes
                          </div>
                          {itunesTrackResults.map(item => (
                            <ResultButton key={item.artist + item.title} item={item} kind="track"
                              onClick={() => selectSearchResult('track', item)}
                              onHover={previewSearchResult}
                            />
                          ))}
                          {itunesTrackResults.length === 0 && (
                            <div className="result-column-empty">No results</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(topArtistMatch || otherArtistResults.length > 0 || deezerTrackResults.length > 0 || itunesTrackResults.length > 0) ? null : (!searching && query.trim().length >= 2 && (
                  <p className="search-empty-hint">No results for "{query}"</p>
                ))}
              </>
            ) : (
              <div className="collapsed-search-bar">
                <button className="search-launch-button" onClick={() => setSearchOpen(true)} aria-label="Open search" title="Open search">
                  <SearchIcon />
                </button>
              </div>
            )}

            {message ? <div className="message-box floating">{message}</div> : null}
          </div>


          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(params) => setEdges((eds) => addEdge({ ...params, labelShowBg: false, style: { stroke: "#475569", strokeWidth: 1.5 } }, eds))}
            panOnDrag={true}
            zoomOnPinch={true}
            zoomOnScroll={true}
            preventScrolling={true}
            style={{ touchAction: 'none' }}
            onNodeClick={(event, node) => {
              console.debug("[audio-debug] onNodeClick", {
                nodeId: node.id,
                ghost: String(node.id).startsWith("ghost:"),
                kind: node.data?.kind || entityMap[node.id]?.kind,
                label: node.data?.label || entityMap[node.id]?.label
              });

     if (String(node.id).startsWith("ghost:")) {
  const parent = entityMap[node.data.parentId];
  const link = parent?.links?.find((item) => item.id === node.data.entityId && item.relation === node.data.relation);

  // Mobile two-tap: first tap previews, second tap places on canvas.
  // KEY FIX: do NOT call setActivePreviewId(null) on second tap —
  // leaving it set keeps sameTrackAlreadyActive=true in startPlayback,
  // so the already-playing audio is NOT restarted.
  if (isTouchDeviceRef.current && node.data?.kind === "track") {
    if (activePreviewId === node.data.entityId) {
      // Second tap — place on canvas, playback continues uninterrupted
      if (link) openLink(node.data.parentId, link, node.position);
    } else {
      // First tap — start preview only, do not place yet
      setActivePreviewId(node.data.entityId);
      const url = node.data.previewUrl;
      if (url && url !== "null" && url !== "undefined") {
        playPreviewUrl(node.data.entityId, url, "ghost-tap-direct", {
          nowPlayingEntity: buildPreviewNowPlayingEntity(
            {
              artist: node.data.trackArtist || "",
              title: node.data.trackTitle || node.data.label?.split(" · ")[0] || "",
              album: node.data.trackAlbum || "",
              artworkUrl: node.data.artworkUrl || ""
            },
            node.data.entityId, url, node.data.artworkUrl || ""
          )
        });
      } else {
        const artist = node.data.trackArtist;
        const title = node.data.trackTitle;
        if (artist && title) {
          const token = hoverPreviewTokenRef.current;
          warmTrackPreview(
            { artist, title, album: node.data.trackAlbum || "", artworkUrl: node.data.artworkUrl || "" },
            node.data.entityId,
            {
              autoplay: true,
              source: "ghost-tap-fetch",
              requestToken: token,
              nowPlayingEntity: buildPreviewNowPlayingEntity(
                { artist, title, album: node.data.trackAlbum || "", artworkUrl: node.data.artworkUrl || "" },
                node.data.entityId, null, node.data.artworkUrl || ""
              )
            }
          ).catch((err) => console.warn("[audio-debug] ghost tap warmTrackPreview failed", err));
        }
      }
    }
    return;
  }

  // Desktop: original single-click-to-canvas behaviour (unchanged)
  if (link) openLink(node.data.parentId, link, node.position);
  return;
}
              setSelectedId(node.id);
              const entity = entityMap[node.id];
              if (entity?.kind === "track") playEntity(entity, "node-click");
              else {
                console.debug("[audio-debug] node click did not request playback", {
                  nodeId: node.id,
                  kind: entity?.kind || node.data?.kind || "unknown",
                  activePreviewId,
                  audioSrc
                });
              }
            }}
            onNodeDoubleClick={(event, node) => {
              if (String(node.id).startsWith("ghost:")) return;
              const entity = entityMap[node.id];
              if (entity?.kind === "track") togglePlaylist(entity);
            }}
            onNodeMouseEnter={(event, node) => {
              console.debug("[audio-debug] onNodeMouseEnter", {
                nodeId: node.id,
                ghost: String(node.id).startsWith("ghost:"),
                kind: node.data?.kind || entityMap[node.id]?.kind,
                label: node.data?.label || entityMap[node.id]?.label,
                previewUrl: node.data?.previewUrl || entityMap[node.id]?.previewUrl || ""
              });

              if (String(node.id).startsWith("ghost:")) {
                if (node.data?.kind === "track") {
                  const url = node.data.previewUrl;
                  if (url && url !== "null" && url !== "undefined") {
                    playPreviewUrl(
                      node.data.entityId,
                      url,
                      "ghost-hover-direct",
                      {
                        nowPlayingEntity: buildPreviewNowPlayingEntity(
                          {
                            artist: node.data.trackArtist || "",
                            title: node.data.trackTitle || node.data.label?.split(" · ")[0] || "",
                            album: node.data.trackAlbum || "",
                            artworkUrl: node.data.artworkUrl || ""
                          },
                          node.data.entityId,
                          url,
                          node.data.artworkUrl || ""
                        )
                      }
                    );
                    return;
                  }
                  const artist = node.data.trackArtist;
                  const title = node.data.trackTitle;
                  if (artist && title) {
                    const token = hoverPreviewTokenRef.current;
                    warmTrackPreview(
                      { artist, title, album: node.data.trackAlbum || "", artworkUrl: node.data.artworkUrl || "" },
                      node.data.entityId,
                      {
                        autoplay: true,
                        source: "ghost-hover-fetch",
                        requestToken: token,
                        nowPlayingEntity: buildPreviewNowPlayingEntity(
                          { artist, title, album: node.data.trackAlbum || "", artworkUrl: node.data.artworkUrl || "" },
                          node.data.entityId,
                          "",
                          node.data.artworkUrl || ""
                        )
                      }
                    ).catch((err) => {
                      console.warn("[audio-debug] ghost hover warmTrackPreview failed", err);
                    });
                    return;
                  }
                }
                return;
              }

              const entity = entityMap[node.id];
              if (entity?.kind === "track") {
                const url = entity.previewUrl;
                if (url && url !== "null" && url !== "undefined") {
                  playEntity(entity, "node-hover-direct");
                } else {
                  const artist = entity.raw?.artist || entity.subtitle?.split(" · ")[0] || "";
                  const title = entity.label;
                  if (artist && title) {
                    warmTrackPreview(
                      { artist, title, album: entity.raw?.album || "", artworkUrl: entity.artworkUrl || entity.raw?.artworkUrl || "" },
                      entity.id,
                      { autoplay: true, source: "node-hover-fetch", nowPlayingEntity: entity }
                    ).catch((err) => {
                      console.warn("[audio-debug] node hover warmTrackPreview failed", err);
                    });
                  }
                }
              }
              revealGhosts(node.id);
            }}
            onNodeMouseLeave={() => {
              cancelScheduledTrackPreview();
            }}
            onPaneMouseEnter={() => {
              cancelScheduledTrackPreview();
            }}
            onPaneClick={() => {
              cancelScheduledTrackPreview();
              clearGhosts();
              setSearchOpen(false);
            }}
            minZoom={0.25}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => entityColor(node?.data?.entity?.kind || node?.data?.kind || "track")}
              style={{
                right: detailOpen ? 434 : 10,
                transition: 'right 0.3s ease'
              }}
            />
            <Controls
              showInteractive={false}
              style={{
                left: drawerOpen ? 394 : 10,
                transition: 'left 0.3s ease'
              }}
            />
            <Background gap={22} size={1} color="#1f2937" />
          </ReactFlow>
        </section>

        <aside className="now-playing-overlay">
  <div
    className={`now-playing-shell ${nowPlayingEntity ? "is-active" : ""}`}
    key={`now-playing:${spotlightTrackEntity?.id || "empty"}:${nowPlayingVersion}`}
  >
    <div className="now-playing-desktop">
      <div className="now-playing-topline">
        <span className="detail-kind">
          {nowPlayingEntity ? "Now playing" : spotlightTrackEntity ? "Track" : "Now playing"}
        </span>
        {nowPlayingEntity ? <span className="detail-star playing-indicator">●</span> : null}
      </div>

      {spotlightTrackEntity ? (
        <>
          <div className="now-playing-hero" key={`hero:${spotlightTrackEntity.id}:${nowPlayingVersion}`}>
            <img
              className="detail-artwork"
              src={artworkForEntity(spotlightTrackEntity)}
              alt=""
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = fallbackArtworkForEntity(spotlightTrackEntity);
              }}
            />
            <div className="now-playing-copy">
              <strong>{spotlightTrackEntity.label}</strong>
              <div className="detail-subtitle">{spotlightTrackEntity.subtitle}</div>

              {spotlightTrackStats.length ? (
                <div className="chip-row compact">
                  {spotlightTrackStats.map((item) => (
                    <span key={`${spotlightTrackEntity.id}:${item}`} className="chip">
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <p className="detail-subtitle">Hover or click a track to start a preview.</p>
      )}

      <audio
        ref={audioRef}
        className={`now-playing-audio ${!nowPlayingEntity ? "hidden-audio" : ""}`}
        controls
        preload="auto"
      />
    </div>

    <div className={`now-playing-mini ${nowPlayingEntity ? "is-active" : ""}`}>
      {spotlightTrackEntity ? (
        <>
          <button
            type="button"
            className="now-playing-main"
            onClick={() => {
              focusEntity(spotlightTrackEntity.id);
              setDetailOpen(true);
            }}
            aria-label={`Open details for ${spotlightTrackEntity.label}`}
          >
            <img
              className="now-playing-mini-artwork"
              src={artworkForEntity(spotlightTrackEntity)}
              alt=""
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = fallbackArtworkForEntity(spotlightTrackEntity);
              }}
            />
            <div className="now-playing-mini-copy">
              <strong>{spotlightTrackEntity.label}</strong>
              <div className="detail-subtitle">{spotlightTrackEntity.subtitle}</div>
            </div>
          </button>

          <button
            type="button"
            className="now-playing-mini-toggle"
            aria-label={isAudioPlaying ? "Pause preview" : "Play preview"}
            aria-pressed={isAudioPlaying}
            onClick={handleMiniPlayToggle}
          >
            <span className={`mini-toggle-glyph ${isAudioPlaying ? "pause" : "play"}`} />
          </button>
        </>
      ) : null}
    </div>
  </div>
</aside>

        <aside className={`detail-panel minimal-detail ${detailOpen ? "open" : "collapsed"}`}>
          <div className="panel-floating-togglebar">
            {detailOpen ? (
              <div className="panel-title">
                <DetailsIcon />
                <span className="detail-kind">Details</span>
              </div>
            ) : null}
            <div className="panel-actions">
              <button
                className="icon-button panel-toggle-button"
                onClick={() => setDetailOpen((open) => !open)}
                title={detailOpen ? "Collapse details" : "Expand details"}
                aria-label={detailOpen ? "Collapse details" : "Expand details"}
              >
                {detailOpen ? <ChevronIcon direction="right" /> : <DetailsIcon />}
              </button>
            </div>
          </div>

          {detailOpen ? (
            <div className="detail-scroll-area">
              {selectedEntity ? (
                <>
                  <div className={`detail-card kind-${selectedEntity.kind}`} style={{ "--accent": entityColor(selectedEntity.kind) }}>
                    <div className="detail-topline">
                      <span className="detail-kind">{selectedEntity.kind}</span>
                      {playlistIds.includes(selectedEntity.id) ? <span className="detail-star">★</span> : null}
                    </div>
                    <div className="detail-hero">
                      <img className="detail-artwork" src={artworkForEntity(selectedEntity)} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackArtworkForEntity(selectedEntity); }} />
                      <div>
                        <h2>{selectedEntity.label}</h2>
                        <p className="detail-subtitle">{selectedEntity.subtitle}</p>
                        <div className="chip-row compact">
                          {(selectedEntity.meta || []).map((item) => <span key={item} className="chip">{item}</span>)}
                          {(selectedEntity.details?.lines || []).filter(Boolean).map((line, index) => <span key={`${selectedEntity.id}:${index}`} className="chip">{line}</span>)}
                        </div>
                      </div>
                    </div>
                    <div className="detail-actions compact">
                      <button className="ui-button small delete-entity-button" onClick={() => deleteEntity(selectedEntity.id)} title="Delete from canvas">
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  <div className="detail-card secondary-card slim-section">
                    <div className="link-list compact-list">
                      {(() => {
                        const allLinks = visibleLinksForEntity(selectedEntity.id).slice(0, 30);
                        const groups = [
                          { label: 'Similar Tracks',  links: allLinks.filter(l => l.relation === 'related-track') },
                          { label: 'By This Artist',  links: allLinks.filter(l => l.relation === 'artist-track') },
                          { label: 'On This Album',   links: allLinks.filter(l => l.relation === 'album-track') },
                          { label: 'Genres',          links: allLinks.filter(l => l.kind === 'genre') },
                          { label: 'Connections',     links: allLinks.filter(l => ['artist','album','track','top-track','top-artist','top-album'].includes(l.relation)) },
                        ].filter(g => g.links.length > 0);

                        return groups.map(group => (
                          <div key={group.label} className="link-group">
                            <div className="link-group-header">{group.label}</div>
                            {group.links.map(link => (
                              <button
                                key={selectedEntity.id + link.id + link.relation}
                                className={`detail-link-row link-${link.kind} relation-${link.relation} ${
                                  findCanvasNodeForLink(link, selectedEntity.id) ? 'opened' : 'pending'
                                } ${activePreviewId === link.id ? 'is-playing' : ''}`}
                                onClick={() => openLink(selectedEntity.id, link)}
                                onMouseEnter={() => previewLinkItem(link)}
                                onMouseLeave={cancelScheduledTrackPreview}
                              >
                                <div className="detail-link-main">
                                  <strong className="detail-link-title">
                                    {link.payload?.title || link.label?.split('\n')[0] || link.label}
                                  </strong>

                                  {(link.payload?.artist || link.artist || link.payload?.album || link.album) && (
                                    <div className="detail-link-subline">
                                      <span className="detail-link-artist">
                                        {link.payload?.artist || link.artist}
                                      </span>
                                      {(link.payload?.album || link.album) && (
                                        <>
                                          <span className="detail-link-sep">/</span>
                                          <span className="detail-link-album">
                                            {link.payload?.album || link.album}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {link.similarity > 0 && (
                                    <div className="detail-link-similarity">
                                      <div
                                        className="detail-link-similarity-bar"
                                        style={{ width: `${Math.max(8, Math.round(link.similarity * 100))}%` }}
                                      />
                                    </div>
                                  )}

                                  {link.relation === "artist-track" && link.relativePopularity > 0 ? (
                                    <div className="detail-link-similarity">
                                      <div
                                        className="detail-link-similarity-bar pop"
                                        style={{ width: `${Math.max(8, Math.round(link.relativePopularity * 100))}%` }}
                                      />
                                    </div>
                                  ) : null}
                                </div>

                                <div className="detail-link-meta">
                                  {link.rank ? <span className="detail-link-rank">#{link.rank}</span> : null}
                                  {link.relation !== "artist-track" && (link.payload?.listeners || link.listeners) ? (
                                    <span className="detail-link-popularity">
                                      {formatCompactNumber(link.payload?.listeners || link.listeners)}
                                    </span>
                                  ) : null}
                                  {activePreviewId === link.id && link.kind === 'track' && (
                                    <div className="soundwave-cluster detail-soundwave" aria-hidden="true">
                                      <span /><span /><span />
                                    </div>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </>
              ) : (
                <div className="detail-card secondary-card slim-section"><p className="detail-subtitle">Select a node</p></div>
              )}
            </div>
          ) : null}
        </aside>

        <aside className={`playlist-drawer minimal-drawer ${drawerOpen ? "open" : "closed"}`} ref={playlistDrawerRef}>
          <div className="panel-floating-togglebar playlist-togglebar">
            {!drawerOpen ? (
              <button
                className="icon-button panel-toggle-button"
                onClick={() => setDrawerOpen((open) => !open)}
                title="Expand playlist"
                aria-label="Expand playlist"
              >
                <PlaylistIcon />
              </button>
            ) : (
              <>
                <div className="panel-title">
                  <PlaylistIcon />
                  <span className="detail-kind">Playlist</span>
                  <span className="detail-kind">({playlist.length})</span>
                </div>
                <div className="panel-actions">
                  {playlist.length > 0 && (
                    <button
                      className="icon-button copy-playlist-button"
                      onClick={async () => {
                        try {
                          const text = playlist.map(track => {
                            const artist = track.subtitle?.split(' · ')[0] || '';
                            const song = track.label || '';
                            return `${artist} - ${song}`;
                          }).filter(line => line.trim()).join('\n');
                          await navigator.clipboard.writeText(text);
                          setMessage('Playlist copied to clipboard!');
                        } catch (err) {
                          setMessage('Failed to copy playlist');
                        }
                      }}
                      title="Copy playlist to clipboard"
                      aria-label="Copy playlist to clipboard"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                    </button>
                  )}
                  <button
                    className="icon-button panel-toggle-button"
                    onClick={() => setDrawerOpen((open) => !open)}
                    title="Collapse playlist"
                    aria-label="Collapse playlist"
                  >
                    <ChevronIcon direction="left" />
                  </button>
                </div>
              </>
            )}
          </div>

          {drawerOpen ? (
            <>
              <div className="drawer-list compact-drawer">
                {playlist.length === 0 ? <div className="empty-drawer">No tracks yet.</div> : null}
                {playlist.map((track) => (
                  <div
                    key={track.id}
                    className={`drawer-track${activePreviewId === track.id ? ' is-playing' : ''}`}
                    onClick={() => zoomToNode(track.id)}
                    onMouseEnter={() => previewPlaylistItem(track)}
                    onMouseLeave={cancelScheduledTrackPreview}
                  >
                    <img className="drawer-artwork" src={artworkForEntity(track)} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackArtworkForEntity(track); }} />
                    <div className="drawer-track-info">
                      <strong>{track.label}</strong>
                      <div>{track.subtitle}</div>
                    </div>
                    <div className="drawer-track-controls">
                      {activePreviewId === track.id && (
                        <div className="soundwave-cluster drawer-soundwave" aria-hidden="true">
                          <span /><span /><span />
                        </div>
                      )}
                      <button className="icon-button remove-track-button" onClick={(e) => { e.stopPropagation(); togglePlaylist(track); }} title="Remove from playlist">
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="playlist-drawer-footer">
                <Link to="/library" className="library-universe-link">
                  View Library Universe
                </Link>
                <div className="studio-title-bar">
                  <input
                    className="studio-title-input"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => saveCurrentDraft()}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    placeholder="Studio name"
                  />
                  <button className={`save-studio-button ${saving ? "saving" : ""}`} onClick={() => saveCurrentDraft()} title="Save studio">
                    <SaveIcon />
                  </button>
                </div>
                <button
                  className="ui-button secondary small open-drafts-button"
                  style={{ marginTop: '8px', width: '100%' }}
                  onClick={() => { setDraftsOpen((v) => !v); fetchDrafts(); }}
                >
                  <DraftsIcon />
                  <span>Saved Studios</span>
                </button>

                {draftsOpen && (
                  <div className="drafts-overlay">
                    <div className="drafts-overlay-header">
                      <strong>Saved Studios</strong>
                      <button className="icon-button close-drafts-button" onClick={() => setDraftsOpen(false)} title="Close">
                        <CloseIcon />
                      </button>
                    </div>
                    <button className="result-chip featured add-new-studio" onClick={createNewStudio}>
                      <span className="result-artwork-placeholder"><PlusIcon /></span>
                      <div className="result-copy">
                        <strong>Create New Studio</strong>
                        <em>Start fresh on the canvas</em>
                      </div>
                    </button>
                    {drafts.length === 0 ? (
                      <div className="empty-flyout-state">No saved studios yet.</div>
                    ) : (
                      drafts.map((d) => (
                        <div key={d.id} className={`draft-item-row ${d.id === currentDraftId ? "active" : ""}`}>
                          <button className="result-chip draft-load-button" onClick={() => loadDraft(d.id)}>
                            <div className="result-copy">
                              <strong>
                                {d.id === currentDraftId && <span className="active-dot">●</span>}
                                {d.title}
                              </strong>
                              <em>Updated {new Date(d.updated_at).toLocaleDateString()}</em>
                            </div>
                          </button>
                          <button className="icon-button delete-draft-button" onClick={() => deleteDraftById(d.id)} title="Delete">
                            <TrashIcon />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ReactFlowProvider><FlowApp /></ReactFlowProvider>} />
      <Route path="/library" element={<LibraryGraph />} />
    </Routes>
  );
}
