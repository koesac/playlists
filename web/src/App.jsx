import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    track: "#7c3aed",
    artist: "#0ea5e9",
    album: "#f59e0b",
    genre: "#22c55e"
  }[kind] || "#94a3b8";
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
    .replace(/(feat\.?|ft\.?|featuring).*$/i, " ")
    .replace(/(remaster(?:ed)?|remix|mix|edit|version|live|acoustic|instrumental|demo|session|radio edit|extended|club mix|dub|mono|stereo)/gi, " ")
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
  if (name === q) return 120;
  if (name.startsWith(`${q} `) || name.startsWith(q)) return 100;
  if (name.includes(q)) return 82;
  const qWords = q.split(/\s+/).filter(Boolean);
  const matchWords = qWords.filter((word) => name.includes(word)).length;
  return matchWords ? 40 + (matchWords * 12) : 0;
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
  return absolute.replace(/(\d{2,4})x(\d{2,4})(bb)?/g, (_match, _w, _h, suffix = "") => {
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
  (detail?.similar || []).slice(0, 10).forEach((item) => item.title && item.artist && links.push({ id: trackNodeId(item), relation: "related-track", label: `${item.title} · ${item.artist}`, kind: "track", payload: item }));
  (detail?.artistTracks || []).slice(0, 8).forEach((item) => item.title && item.artist && links.push({ id: trackNodeId(item), relation: "artist-track", label: `${item.title} · ${item.artist}`, kind: "track", payload: item }));
  (detail?.albumTracks || []).slice(0, 12).forEach((item) => item.title && item.artist && links.push({ id: trackNodeId(item), relation: "album-track", label: `${item.title} · ${item.artist}`, kind: "track", payload: item }));
  return {
    id,
    kind: "track",
    label: track.title,
    subtitle: [track.artist, track.album].filter(Boolean).join(" · "),
    meta: [track.album ? "Album" : "", tags[0] || ""].filter(Boolean).slice(0, 3),
    previewUrl: track.previewUrl || detail?.track?.previewUrl || "",
    artworkUrl: track.artworkUrl || detail?.track?.artworkUrl || "",
    year: track.year || detail?.track?.year || detail?.year || null,
    popularity: detail?.popularity || track.popularity || null,
    raw: { ...track, detail },
    details: {
      lines: [
        [track.artist, track.album].filter(Boolean).join(" · "),
        detail?.popularity?.listeners ? `Listeners ${Number(detail.popularity.listeners).toLocaleString()}` : "",
        detail?.popularity?.playcount ? `Playcount ${Number(detail.popularity.playcount).toLocaleString()}` : ""
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
    if (track.album) links.push({ id: albumNodeId(track.artist, track.album), relation: "album", label: track.album, kind: "album", artist: track.artist, album: track.album });
  });
  tags.slice(0, 8).forEach((tag) => links.push({ id: genreNodeId(tag), relation: "genre", label: tag, kind: "genre", tag }));
  return {
    id,
    kind: "artist",
    label: artist.name,
    subtitle: [artist.country || "", artist.area || ""].filter(Boolean).join(" · ") || "Artist",
    meta: [artist.disambiguation || "", tags[0] || "", detail?.artist?.listeners ? `Listeners ${Number(detail.artist.listeners).toLocaleString()}` : ""].filter(Boolean).slice(0, 3),
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
    meta: [detail?.album?.listeners ? `Listeners ${Number(detail.album.listeners).toLocaleString()}` : "", detail?.album?.playcount ? `Playcount ${Number(detail.album.playcount).toLocaleString()}` : "", tags[0] || ""].filter(Boolean).slice(0, 3),
    raw: detail,
    artworkUrl: detail?.album?.artworkUrl || "",
    details: { lines: [stripHtml(detail?.album?.wiki || "") || "Album detail loaded from backend album endpoint."] },
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
    details: { lines: ["Genre detail loaded from backend genre endpoint."] },
    links: uniqBy(links, (item) => `${item.kind}:${item.id}:${item.relation}`),
    loaded: true
  };
}

function radialOffset(index, total, baseRadius = 300) {
  const perRing = 6;
  const ring = Math.floor(index / perRing);
  const slot = index % perRing;
  const slotsInRing = Math.min(perRing, Math.max(total - ring * perRing, 1));
  const angle = (-Math.PI / 2) + (slot * (Math.PI * 2 / slotsInRing)) + (ring % 2 ? Math.PI / slotsInRing : 0);
  const radius = baseRadius + (ring * 150);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * (radius * 0.88)
  };
}

function resolveGhostPosition(parentNode, stableNodes, plannedPositions, index, total) {
  let tries = 0;
  let candidate = { x: parentNode.position.x, y: parentNode.position.y };
  while (tries < 10) {
    const offset = radialOffset(index, total, 300 + tries * 80);
    candidate = { x: parentNode.position.x + offset.x, y: parentNode.position.y + offset.y };
    const collidesWithStable = stableNodes.some((node) => distance(candidate, node.position) < Math.max(entityFootprint(node), 230));
    const collidesWithPlanned = plannedPositions.some((position) => distance(candidate, position) < 220);
    if (!collidesWithStable && !collidesWithPlanned) return candidate;
    tries += 1;
  }
  return candidate;
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
  return [artist.disambiguation || "", artist.country || artist.area || "", artist.listeners ? `Listeners ${Number(artist.listeners).toLocaleString()}` : ""]
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}

function formatTrackMeta(track) {
  return [track.album || "", track.previewUrl ? "Preview" : "", track.listeners ? `Listeners ${Number(track.listeners).toLocaleString()}` : ""]
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
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
      {entity.kind === "track" && (
        <div className="entity-track-actions">
          <button
            className={`entity-playlist-button ${inPlaylist ? "active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              data?.onTogglePlaylist?.(entity);
            }}
          >
            {inPlaylist ? "Added" : "+ Playlist"}
          </button>
        </div>
      )}
      {entity.kind === "track" && <div className="track-hint">Hover or click plays · double-click adds</div>}
      {entity.kind === "track" && isPlaying && (
        <div className="soundwave-cluster" aria-hidden="true"><span /><span /><span /><span /></div>
      )}
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

function GhostNode({ data }) {
  return (
    <div className={`ghost-card kind-${data.kind} ${data.opened ? "opened" : "new"} ${data.kind === "track" ? "hover-preview" : ""} ${data.isPlaying ? "is-playing" : ""}`} style={{ "--accent": entityColor(data.kind) }}>
      <div className="ghost-kind">{data.relation}</div>
      <div className="ghost-label">{data.label}</div>
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
  const title = kind === "track" ? `${item.title} · ${item.artist}` : item.name;
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
        {meta ? <em>{meta}</em> : null}
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

function FlowApp() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState({ artists: [], tracks: [] });
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [message, setMessage] = useState("");
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [currentDraftId, setCurrentDraftId] = useState("");
  const [draftTitle, setDraftTitle] = useState("Untitled Studio");
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const seeded = useRef(false);
  const hydrated = useRef(false);
  const hoverPreviewTimerRef = useRef(null);
  const hoverPreviewTokenRef = useRef(0);
  const previewPromiseCacheRef = useRef({});
  const userActivatedRef = useRef(false);
  const audioRef = useRef(null);
  const playbackRequestRef = useRef(0);
  const lastAppliedAudioSrcRef = useRef("");
  const lastTimeUpdateSecondRef = useRef(-1);
  const graphPanelRef = useRef(null);
  const searchBoxRef = useRef(null);
  const searchInputRef = useRef(null);
  
const isTouchDeviceRef = useRef(
  typeof window !== "undefined" && window.matchMedia("(hover: none)").matches
);
  const { screenToFlowPosition, setCenter, getViewport, setViewport } = useReactFlow();

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
          viewport: getViewport()
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
  }, [currentDraftId, draftTitle, entityMap, nodes, edges, playlist, selectedId, drawerOpen, detailOpen, previewCache, getViewport, fetchDrafts]);

  const loadDraft = useCallback(async (id) => {
    try {
      const draft = await api(`/api/drafts/${id}`);
      const saved = draft.data;

      // Stop audio
      setAudioSrc("");
      setActivePreviewId("");

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
    return [...(searchResults.artists || [])]
      .filter((artist) => {
        const id = artist.id || artistNodeId(artist.name);
        const key = `artist:${safeId(artist.name)}`;
        return !blockedRecommendationIds.has(id) && !blockedRecommendationKeys.has(key);
      })
      .sort((a, b) => artistSearchScore(query, b) - artistSearchScore(query, a));
  }, [searchResults, query, blockedRecommendationIds, blockedRecommendationKeys]);
  const topArtistMatch = useMemo(() => artistResults[0] && artistSearchScore(query, artistResults[0]) >= 95 ? artistResults[0] : null, [artistResults, query]);
  const otherArtistResults = useMemo(() => artistResults.filter((artist) => artist !== topArtistMatch).slice(0, 5), [artistResults, topArtistMatch]);
  const trackResults = useMemo(() => {
    return (searchResults.tracks || [])
      .filter((track) => {
        const id = trackNodeId(track);
        const key = `track:${trackKey(track.artist, track.title)}`;
        return !blockedRecommendationIds.has(id) && !blockedRecommendationKeys.has(key);
      })
      .slice(0, 6);
  }, [searchResults, blockedRecommendationIds, blockedRecommendationKeys]);
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
      if (!searchBoxRef.current?.contains(event.target)) {
        setSearchOpen(false);
        setDraftsOpen(false);
        setHelpOpen(false);
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
      if (saved.viewport) {
        requestAnimationFrame(() => {
          setViewport(saved.viewport, { duration: 0 });
        });
      }
      seeded.current = true;
    } catch {
    }
  }, [setNodes, setEdges, setViewport]);

  const togglePlaylist = useCallback((entity) => {
    if (!entity || entity.kind !== "track") return;
    setPlaylist((current) => current.some((item) => item.id === entity.id) ? current.filter((item) => item.id !== entity.id) : [...current, entity]);
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
            onTogglePlaylist: togglePlaylist
          }
        };
      }
      return {
        ...node,
        data: {
          entity: nextEntityMap[node.id],
          inPlaylist: nextPlaylistIds.includes(node.id),
          isPlaying: nextActivePreviewId === node.id,
          onTogglePlaylist: togglePlaylist
        }
      };
    }).filter((node) => String(node.id).startsWith("ghost:") || node.data.entity);
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
        viewport: getViewport()
      }));
    } catch {
    }
  }, [entityMap, nodes, edges, playlist, selectedId, drawerOpen, detailOpen, activePreviewId, audioSrc, previewCache, getViewport, currentDraftId, draftTitle]);

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
      userActivatedRef.current = true;
      console.debug("[audio-debug] user activation captured", {
        activePreviewId,
        audioSrc
      });
    };
    document.addEventListener("pointerdown", activateAudio, { passive: true });
    document.addEventListener("keydown", activateAudio);
    return () => {
      document.removeEventListener("pointerdown", activateAudio);
      document.removeEventListener("keydown", activateAudio);
    };
  }, [activePreviewId, audioSrc]);

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

    setNowPlayingOverride(overrideEntity);
    if (id) setActivePreviewId(id);
    if (selectId) setSelectedId(selectId);
    setAudioSrc(absolutePreviewUrl);
    setNowPlayingVersion((current) => current + 1);

    return true;
  }, [activePreviewId, audioSrc]);

  const playEntity = useCallback((entity, source = "entity", options = {}) => {
    if (!entity || entity.kind !== "track") {
      console.debug("[audio-debug] playEntity skipped", { source, entity });
      return;
    }

    console.debug("[audio-debug] playEntity", {
      source,
      id: entity.id,
      label: entity.label,
      artist: entity.raw?.artist || entity.subtitle?.split(" · ")[0] || "",
      previewUrl: entity.previewUrl
    });

    startPlayback(entity.id, entity.previewUrl, {
      selectId: entity.id,
      source,
      nowPlayingEntity: options.nowPlayingEntity || entity
    });
  }, [startPlayback]);

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

      if (!previewUrl) {
        console.debug("[audio-debug] warmTrackPreview no-preview", {
          source,
          targetId,
          cacheKey,
          artist,
          title,
          album
        });
        return "";
      }

      setPreviewCache((current) => current[cacheKey] ? current : { ...current, [cacheKey]: previewUrl });
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

      if (autoplay && (requestToken == null || requestToken === hoverPreviewTokenRef.current)) {
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
    const offset = radialOffset(index, list.length, 360);
    const anchor = { x: sourceNode.position.x + offset.x, y: sourceNode.position.y + offset.y };
    return resolveOpenedNodePosition(anchor, blockedNodes, [], index);
  }, [entityMap, nodes, centerFlowPosition]);

  const clearGhosts = useCallback(() => {
    setNodes((current) => current.filter((node) => !String(node.id).startsWith("ghost:")));
    setEdges((current) => current.filter((edge) => !String(edge.id).startsWith("ghost-edge:")));
  }, [setEdges, setNodes]);

  const revealGhosts = useCallback((entityId) => {
    const entity = entityMap[entityId];
    const parentNode = nodes.find((node) => node.id === entityId);
    if (!entity || !parentNode) return;
    const stableNodes = nodes.filter((node) => !String(node.id).startsWith("ghost:") && node.id !== entityId);
    const plannedPositions = [];
    const visibleLinks = visibleLinksForEntity(entityId).slice(0, 18);
    preloadTrackLinks(entity);
    const ghostNodes = visibleLinks.map((link, index) => {
      const position = resolveGhostPosition(parentNode, stableNodes, plannedPositions, index, visibleLinks.length);
      plannedPositions.push(position);
      return {
        id: `ghost:${entityId}:${link.id}:${link.relation}`,
        type: "ghost",
        position,
        draggable: false,
        selectable: false,
        data: {
          entityId: link.id,
          parentId: entityId,
          relation: link.relation,
          label: link.label,
          kind: link.kind,
          opened: Boolean(findCanvasNodeForLink(link, entityId) || entityMap[link.id]?.loaded),
          inPlaylist: playlistIds.includes(link.id),
          previewUrl: link.payload?.previewUrl || entityMap[findCanvasNodeForLink(link, entityId)]?.previewUrl || entityMap[link.id]?.previewUrl || previewCache[linkCanonicalKey(link, entity) || ""] || "",
          trackArtist: link.payload?.artist || link.artist || "",
          trackTitle: link.payload?.title || link.label?.split(" · ")[0] || "",
          trackAlbum: link.payload?.album || link.album || "",
          onTogglePlaylist: togglePlaylist
        }
      };
    });
    setNodes((current) => [...current.filter((node) => !String(node.id).startsWith("ghost:")), ...ghostNodes]);
    setEdges((current) => {
      const filtered = current.filter((edge) => !String(edge.id).startsWith("ghost-edge:"));
      const ghostEdges = visibleLinks.map((link) => ({
        id: `ghost-edge:${entityId}:${link.id}:${link.relation}`,
        source: entityId,
        target: `ghost:${entityId}:${link.id}:${link.relation}`,
        animated: !findCanvasNodeForLink(link, entityId),
        style: { stroke: entityColor(link.kind), strokeDasharray: findCanvasNodeForLink(link, entityId) ? "0" : "6 6", opacity: 0.85, strokeWidth: 2 }
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
      if (link.kind === "track" && link.payload) return loadTrack(link.payload, sourceId, link.relation);
      if (link.kind === "artist") return loadArtist({ name: link.payload?.name || link.label, id: link.id, artworkUrl: link.payload?.artworkUrl || "" }, sourceId, link.relation);
      if (link.kind === "album") return loadAlbum(link.artist || entityMap[sourceId]?.label || "", link.album || link.label.split(" · ")[0], sourceId, link.relation);
      if (link.kind === "genre") return loadGenre(link.tag || link.label, sourceId, link.relation);
    } catch (err) {
      setMessage(err.message);
    }
  }, [clearGhosts, entityMap, ensureEdge, ensureNode, loadAlbum, loadArtist, loadGenre, loadTrack, playEntity, positionForLink, findCanvasNodeForLink, zoomToNode]);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setMessage("");
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
      setSearchResults({ artists: data.artists || [], tracks: data.tracks || [] });
      setSearchOpen(true);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSearching(false);
    }
  }, [query]);

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
    if (!item?.artist || !item?.title) {
      console.debug("[audio-debug] previewSearchResult skipped", { item });
      return;
    }

    const previewEntity = normalizeTrackEntity({
      ...item,
      previewUrl: item.previewUrl || "",
      artworkUrl: item.artworkUrl || ""
    });

    console.debug("[audio-debug] previewSearchResult", {
      id: previewEntity.id,
      title: item.title,
      artist: item.artist,
      previewUrl: previewEntity.previewUrl,
      artworkUrl: previewEntity.artworkUrl
    });

    setNowPlayingOverride(previewEntity);
    setActivePreviewId(previewEntity.id);

    if (previewEntity.previewUrl) {
      playPreviewUrl(
        previewEntity.id,
        previewEntity.previewUrl,
        "search-result-hover-direct",
        { nowPlayingEntity: previewEntity }
      );
      return;
    }

    warmTrackPreview(
      {
        artist: item.artist,
        title: item.title,
        album: item.album || ""
      },
      previewEntity.id,
      {
        autoplay: true,
        source: "search-result-hover-fetch",
        nowPlayingEntity: previewEntity
      }
    ).catch((err) => {
      console.warn("[audio-debug] previewSearchResult failed", err);
    });
  }, [playPreviewUrl, warmTrackPreview]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    loadTrack({ title: "Midnight City", artist: "M83", album: "Hurry Up, We're Dreaming" }).catch(() => {});
  }, [loadTrack]);

  return (
    <div className="graph-shell minimal-shell">
      <div className="graph-main compact-layout">
        <section className="graph-panel full-canvas" ref={graphPanelRef}>
          <div className={`floating-search ${(searchOpen || draftsOpen) ? "open" : "collapsed"}`} ref={searchBoxRef}>
            {(searchOpen || draftsOpen) ? (
              <>
                <div className="search-bar-shell search-bar-expanded">
                  {searchOpen ? (
                    <>
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
                            if (e.key === "Escape") {
                              setSearchOpen(false);
                              setHelpOpen(false);
                            }
                          }}
                        />
                      </div>
                      <button className="search-go" onClick={search} disabled={searching}>{searching ? "…" : "Go"}</button>
                    </>
                  ) : (
                    <div className="search-input-wrap drafts-header-wrap">
                      <span className="search-leading-icon"><DraftsIcon /></span>
                      <strong className="panel-header-title">Saved Studios</strong>
                    </div>
                  )}
                  <IconButton title="Help" onClick={() => setHelpOpen((v) => !v)} active={helpOpen}>?</IconButton>
                  <IconButton title="Close" onClick={() => { setSearchOpen(false); setDraftsOpen(false); setHelpOpen(false); }}><CloseIcon /></IconButton>
                </div>

                {helpOpen && (
                  <div className="help-popover">
                    <p>Search, open a result, then hover any opened node to reveal links.</p>
                    <p>Tracks play on hover or click, and double-click adds them to the playlist.</p>
                  </div>
                )}

                {searchOpen && (topArtistMatch || otherArtistResults.length > 0 || trackResults.length > 0) && (
                  <div className="result-flyout">
                    {topArtistMatch ? <ResultButton item={topArtistMatch} kind="artist" featured onClick={() => selectSearchResult("artist", topArtistMatch)} /> : null}
                    {otherArtistResults.map((item) => (
                      <ResultButton key={item.id || item.name} item={item} kind="artist" onClick={() => selectSearchResult("artist", item)} />
                    ))}
                    {trackResults.map((item) => (
                      <ResultButton
                        key={`${item.artist}:${item.title}`}
                        item={item}
                        kind="track"
                        onClick={() => selectSearchResult("track", item)}
                        onHover={previewSearchResult}
                      />
                    ))}
                  </div>
                )}

                {draftsOpen && (
                  <div className="result-flyout drafts-flyout">
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
              </>
            ) : (
              <div className="collapsed-search-bar">
                <button className="search-launch-button" onClick={() => setSearchOpen(true)} aria-label="Open search" title="Open search">
                  <SearchIcon />
                </button>
                <button className="search-launch-button" onClick={() => { setDraftsOpen(true); fetchDrafts(); }} aria-label="Open drafts" title="Open saved studios">
                  <DraftsIcon />
                </button>
                <div className="studio-title-bar">
                  <input
                    className="studio-title-input"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => saveCurrentDraft()}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                  <button className={`save-studio-button ${saving ? "saving" : ""}`} onClick={() => saveCurrentDraft()} title="Save studio">
                    <SaveIcon />
                  </button>
                </div>
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
          warmTrackPreview(
            { artist, title, album: node.data.trackAlbum || "", artworkUrl: node.data.artworkUrl || "" },
            node.data.entityId,
            {
              autoplay: true,
              source: "ghost-tap-fetch",
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
                    warmTrackPreview(
                      { artist, title, album: node.data.trackAlbum || "", artworkUrl: node.data.artworkUrl || "" },
                      node.data.entityId,
                      {
                        autoplay: true,
                        source: "ghost-hover-fetch",
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
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.25}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap pannable zoomable nodeColor={(node) => entityColor(node?.data?.entity?.kind || node?.data?.kind || "track")} />
            <Controls showInteractive={false} />
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

              {spotlightTrackEntity.kind === "track" && spotlightTrackEntity.details?.lines?.length ? (
                <div className="detail-lines compact">
                  {spotlightTrackEntity.details.lines
                    .slice(0, 1)
                    .filter(Boolean)
                    .map((line, index) => (
                      <p key={`${spotlightTrackEntity.id}:spotlight:${index}`}>{line}</p>
                    ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="detail-actions compact now-playing-actions">
            <button
              className="ui-button secondary small"
              onClick={() => revealGhosts(spotlightTrackEntity.id)}
            >
              Links
            </button>

            <button
              className="ui-button secondary small"
              onClick={() => focusEntity(spotlightTrackEntity.id)}
            >
              Focus
            </button>

            {spotlightTrackEntity.kind === "track" ? (
              <button
                className={`ui-button small ${playlistIds.includes(spotlightTrackEntity.id) ? "active" : ""}`}
                onClick={() => togglePlaylist(spotlightTrackEntity)}
              >
                {playlistIds.includes(spotlightTrackEntity.id) ? "Remove" : "Add"}
              </button>
            ) : null}
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
      ) : (
        <div className="now-playing-mini idle">
          <div className="now-playing-mini-copy">
            <strong>Nothing yet</strong>
            <div className="detail-subtitle">Tap a track to preview</div>
          </div>
        </div>
      )}
    </div>
  </div>
</aside>

        <aside className={`detail-panel minimal-detail ${detailOpen ? "open" : "collapsed"}`}>
          <div className="panel-floating-togglebar">
            <div className="panel-title">
              <DetailsIcon />
              <span className="detail-kind">Details</span>
            </div>
            <button
              className="icon-button panel-toggle-button"
              onClick={() => setDetailOpen((open) => !open)}
              title={detailOpen ? "Collapse details" : "Expand details"}
              aria-label={detailOpen ? "Collapse details" : "Expand details"}
            >
              <ChevronIcon direction={detailOpen ? "right" : "left"} />
            </button>
          </div>

          {detailOpen ? (
            <div className="detail-scroll-area">
              {selectedEntity ? (
                <>
                  {selectedEntity.kind !== "track" ? (
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
                          </div>
                        </div>
                      </div>
                      <div className="detail-lines compact">
                        {(selectedEntity.details?.lines || []).filter(Boolean).map((line, index) => <p key={`${selectedEntity.id}:${index}`}>{line}</p>)}
                      </div>
                      <div className="detail-actions compact">
                        <button className="ui-button secondary" onClick={() => revealGhosts(selectedEntity.id)}>Links</button>
                      </div>
                    </div>
                  ) : null}

                  <div className="detail-card secondary-card slim-section">
                    <div className="link-list compact-list">
                      {visibleLinksForEntity(selectedEntity.id).slice(0, 18).map((link) => (
                        <button key={`${selectedEntity.id}:${link.id}:${link.relation}`} className={`link-pill link-${link.kind} ${findCanvasNodeForLink(link, selectedEntity.id) ? "opened" : "pending"}`} onClick={() => openLink(selectedEntity.id, link)}>
                          <span>{link.relation}</span>
                          <strong>{link.label}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="detail-card secondary-card slim-section"><p className="detail-subtitle">Select a node</p></div>
              )}
            </div>
          ) : null}
        </aside>

        <aside className={`playlist-drawer minimal-drawer ${drawerOpen ? "open" : "closed"}`}>
          <div className="panel-floating-togglebar playlist-togglebar">
            {drawerOpen ? (
              <div className="panel-title">
                <PlaylistIcon />
                <span className="detail-kind">Playlist</span>
              </div>
            ) : null}
            <button
              className="icon-button panel-toggle-button"
              onClick={() => setDrawerOpen((open) => !open)}
              title={drawerOpen ? "Collapse playlist" : "Expand playlist"}
              aria-label={drawerOpen ? "Collapse playlist" : "Expand playlist"}
            >
              <PlaylistIcon />
            </button>
          </div>

          {drawerOpen ? (
            <div className="drawer-list compact-drawer">
              {playlist.length === 0 ? <div className="empty-drawer">No tracks yet.</div> : null}
              {playlist.map((track) => (
                <div key={track.id} className="drawer-track">
                  <div className="drawer-track-main">
                    <img className="drawer-artwork" src={artworkForEntity(track)} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackArtworkForEntity(track); }} />
                    <div>
                      <strong>{track.label}</strong>
                      <div>{track.subtitle}</div>
                    </div>
                  </div>
                  <div className="drawer-actions compact">
                    <button className="ui-button secondary small" onClick={() => focusEntity(track.id)}>Focus</button>
                    <button className="ui-button small" onClick={() => togglePlaylist(track)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowApp />
    </ReactFlowProvider>
  );
}
