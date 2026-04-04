# AI Playlist Studio

A Docker Compose stack for an AI-augmented playlist discovery app using:
- MusicBrainz for canonical search and metadata
- Last.fm for related tracks, listeners, playcount, and tags
- Apple iTunes Search API for 30-second previews and artwork fallback
- [GetSongBPM](https://getsongbpm.com) for audio features (BPM, danceability, energy, acousticness, liveliness)
- Redis for caching
- SQLite for local draft persistence
- React + Vite frontend
- Node + Express API

## Features
- Search tracks, artists, and albums
- Show artist hits alongside track hits in search results
- View track detail with artwork, listeners, playcount, and tags
- Preview 30-second audio clips when available
- Browse similar tracks
- Open artist results to browse tracks by that artist
- Browse other tracks by the same artist
- Browse album tracks
- Build and save portable playlist drafts

## Project structure

```text
ai-playlist-studio/
├─ .env.example
├─ docker-compose.yml
├─ README.md
├─ api/
│  ├─ Dockerfile
│  ├─ package.json
│  └─ src/
│     ├─ db.js
│     ├─ providers.js
│     └─ index.js
└─ web/
   ├─ Dockerfile
   ├─ nginx.conf
   ├─ package.json
   ├─ vite.config.js
   ├─ index.html
   └─ src/
      ├─ main.jsx
      ├─ App.jsx
      └─ styles.css
```

## Setup

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and add your API keys:

```bash
LASTFM_API_KEY=your_lastfm_api_key
GETSONGBPM_API_KEY=your_getsongbpm_api_key
REDIS_URL=redis://redis:6379
PORT=3001
MUSICBRAINZ_USER_AGENT=AIPlaylistStudio/0.1.0 (you@example.com)
DB_PATH=/data/app.db
```

To get a GetSongBPM API key, visit [https://getsongbpm.com](https://getsongbpm.com) and register your app. This project is hosted at [https://github.com/koesac/playlists](https://github.com/koesac/playlists).

3. Start the stack:

```bash
docker compose up --build
```

4. Open the app:

```bash
http://localhost:8080
```

## Useful commands

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
curl http://localhost:8080/health
```

## Notes
- MusicBrainz public API should be called from the backend and cached.
- Some tracks will not have preview audio depending on Apple catalog coverage.
- Drafts are stored in SQLite at `/data/app.db` inside the API container volume.


## Graph skeleton

This UI build swaps the list-first search page for a graph-first exploration skeleton.

- Uses `@xyflow/react` for draggable node cards and connection lines.
- Hovering an open card reveals popout ghost nodes for related artists, tracks, genres, and albums.
- Clicking a popout materializes it as a full connected card.
- Track cards can be previewed and added to a playlist drawer.
- Tracks in the playlist drawer are starred and outlined in the graph.
- The current implementation is a front-end skeleton with mock graph data so interaction can be tested before wiring real API search.


## Live graph integration

The graph UI now uses the existing backend endpoints instead of mock-only catalog data.

- Search uses `/api/search` and shows live artist and track hits.
- Opening a track loads `/api/track/detail` and uses existing Redis-backed caching on the API side.
- Opening an artist loads `/api/artist/detail` and uses the same cached backend provider flow.
- Album and genre nodes are assembled client-side from returned detail payloads.
- The graph keeps previously opened nodes on screen and reveals unopened links as hover popouts.


## Full graph endpoints

The API now includes dedicated endpoints for all graph node types used by the UI.

- `GET /api/track/detail`
- `GET /api/artist/detail`
- `GET /api/album/detail`
- `GET /api/genre/detail`

The graph UI uses those endpoints directly while the API continues to cache upstream MusicBrainz, Last.fm, and Apple lookups with Redis.
