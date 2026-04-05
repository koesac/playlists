# Bulk Harvester with Z-Depth Slicing — Corrected Agent Instructions

Implement Shift-drag marquee selection on the Library Graph that sends a batch
of tracks to the Studio canvas. All bugs identified in the code review have been
corrected in these instructions. Follow every step exactly.

---

## Files to create or modify

| Action | File |
|--------|------|
| CREATE | `web/src/StudioContext.jsx` |
| MODIFY | `web/src/main.jsx` (or `index.jsx` — your React entry point) |
| MODIFY | `web/src/LibraryGraph.jsx` |
| MODIFY | `web/src/App.jsx` (inside the `FlowApp` component function) |

---

## Step 1 — Create `web/src/StudioContext.jsx`

Create this file exactly as shown. No changes to `providers.js` are needed —
that file is the server-side API module and has nothing to do with React context.

```jsx
import React, { createContext, useState, useContext } from 'react';

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const [importQueue, setImportQueue] = useState([]);

  const queueForImport = (trackNodes) => {
    const items = Array.isArray(trackNodes) ? trackNodes : [trackNodes];
    setImportQueue(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      return [...prev, ...items.filter(t => !existingIds.has(t.id))];
    });
  };

  const clearQueue = () => setImportQueue([]);

  return (
    <StudioContext.Provider value={{ importQueue, queueForImport, clearQueue }}>
      {children}
    </StudioContext.Provider>
  );
}

export const useStudio = () => useContext(StudioContext);
```

---

## Step 2 — Inject `StudioProvider` in the React entry file

Open `web/src/main.jsx` (or `index.jsx` — whichever file calls `ReactDOM.createRoot`
and wraps `<App />` in `<BrowserRouter>`). Wrap `<BrowserRouter>` with `<StudioProvider>`.

```jsx
import { StudioProvider } from './StudioContext';

// Before:
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

// After:
root.render(
  <StudioProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StudioProvider>
);
```

`StudioProvider` must be OUTSIDE `<BrowserRouter>` so its state persists across
route changes. If the file already has a `<React.StrictMode>` wrapper, place
`<StudioProvider>` inside it.

---

## Step 3 — Modify `web/src/LibraryGraph.jsx`

### 3a — Add import

At the top of the file, alongside the existing imports:

```js
import { useStudio } from './StudioContext';
```

### 3b — Add state inside the `LibraryGraph` component

Add these three declarations alongside the existing filter/colour state block
(near `const colorMode, setColorMode = useState('genre')`):

```js
const { queueForImport } = useStudio();
const [isShiftPressed, setIsShiftPressed] = useState(false);
const [dragBox, setDragBox]           = useState(null); // { x1, y1, x2, y2 }
const [bulkSelection, setBulkSelection] = useState(new Set());
```

### 3c — Add Shift key tracking useEffect

Add this useEffect SEPARATELY from the existing `handleKeyDown` useEffect that
manages Arrow/number navigation. The two listeners handle different keys and will
not conflict.

```js
// Track Shift key for marquee selection mode
useEffect(() => {
  const onDown = (e) => { if (e.key === 'Shift') setIsShiftPressed(true);  };
  const onUp   = (e) => { if (e.key === 'Shift') setIsShiftPressed(false); };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup',   onUp);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup',   onUp);
  };
}, []); // empty — key listeners never need to change
```

### 3d — Disable OrbitControls when Shift is held

`enableNavigation` is NOT a valid react-force-graph-3d prop. The correct approach
is to mutate the Three.js OrbitControls object directly. Add this useEffect after
the existing post-processing init block:

```js
// Freeze camera rotation while the user is drawing a selection box
useEffect(() => {
  if (!graphRef.current) return;
  const controls = graphRef.current.controls();
  if (controls) controls.enabled = !isShiftPressed;
}, [isShiftPressed]);
```

### 3e — Add pointer-event handlers to the existing outer container div

Locate the `return` statement's top-level div:
```jsx
<div className="graph-view-container" ref={containerRef} onMouseMove={handleMouseMove}>
```

Add the three pointer handlers to THIS div — do NOT wrap it in another div.
The `onMouseMove` stays as-is.

```jsx
<div
  className="graph-view-container"
  ref={containerRef}
  onMouseMove={handleMouseMove}
  onPointerDown={(e) => {
    if (!isShiftPressed) return;
    e.stopPropagation();
    e.preventDefault();
    setDragBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  }}
  onPointerMove={(e) => {
    if (!dragBox) return;
    e.stopPropagation();
    setDragBox(prev => ({ ...prev, x2: e.clientX, y2: e.clientY }));
  }}
  onPointerUp={(e) => {
    if (!dragBox) return;
    e.stopPropagation();

    const minX = Math.min(dragBox.x1, dragBox.x2);
    const maxX = Math.max(dragBox.x1, dragBox.x2);
    const minY = Math.min(dragBox.y1, dragBox.y2);
    const maxY = Math.max(dragBox.y1, dragBox.y2);

    // Only process boxes with meaningful size (avoids accidental clicks)
    if (maxX - minX > 8 && maxY - minY > 8 && graphRef.current) {
      const camera    = graphRef.current.camera();
      const boxedNodes = [];

      graphData.nodes.forEach(node => {
        if (node.kind !== 'track') return;
        if (!passesFilters(node)) return;

        const sc = graphRef.current.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
        if (sc.x >= minX && sc.x <= maxX && sc.y >= minY && sc.y <= maxY) {
          const dist = Math.hypot(
            (node.x ?? 0) - camera.position.x,
            (node.y ?? 0) - camera.position.y,
            (node.z ?? 0) - camera.position.z
          );
          boxedNodes.push({ node, dist });
        }
      });

      if (boxedNodes.length > 0) {
        // Z-depth slicing: keep only the foreground cluster
        const minDist        = Math.min(...boxedNodes.map(n => n.dist));
        const maxAllowedDist = minDist * Z_DEPTH_TOLERANCE;

        setBulkSelection(prev => {
          const next = new Set(prev);
          boxedNodes.forEach(({ node, dist }) => {
            if (dist <= maxAllowedDist) next.add(node.id);
          });
          return next;
        });
      }
    }

    setDragBox(null);
  }}
>
```

### 3f — Add the Z-depth tolerance constant

Add this constant at the module level (near the top of the file, alongside
`stringToColor`, `bpmToColor`, etc.):

```js
// Nodes within this multiple of the minimum camera distance are considered
// "foreground". Increase to grab more depth; decrease for tighter slicing.
const Z_DEPTH_TOLERANCE = 1.35;
```

### 3g — Update `nodeColor` prop on `<ForceGraph3D>`

Merge the bulk-selection highlight into the existing `nodeColor` logic.
The bulk-selection colour (hot pink) takes priority after now-playing and
selected, and before the colour-mode logic:

```js
nodeColor={node => {
  if (nowPlayingNode?.id === node.id) return '#10b981';  // green  — now playing
  if (selectedNode?.id  === node.id) return '#f59e0b';  // amber  — selected
  if (bulkSelection.has(node.id))    return '#ec4899';  // pink   — bulk selected

  // Existing colour modes — unchanged
  if (colorMode === 'genre') return stringToColor(node.genre);
  if (colorMode === 'bpm')   return bpmToColor(node.bpm);
  if (colorMode === 'year')  return yearToColor(node.year);
  return defaultNodeColor(node);
}}
```

### 3h — Update `nodeVal` prop on `<ForceGraph3D>`

Replace the existing `nodeVal` prop with:

```js
nodeVal={node => {
  const base = nodeVal(node); // calls the module-level nodeVal helper function
  if (nowPlayingNode?.id === node.id) return base * 2.5;
  if (selectedNode?.id  === node.id) return base * 1.5;
  if (bulkSelection.has(node.id))    return base * 1.4;
  return base;
}}
```

### 3i — Add the marquee box and action bar UI

Place both fragments INSIDE the outer `<div className="graph-view-container">`,
after the closing `/>` of `<ForceGraph3D>` and after all existing overlay panels:

```jsx
{/* Marquee selection box — visible while Shift-dragging */}
{dragBox && (
  <div style={{
    position:        'absolute',
    zIndex:          2000,
    pointerEvents:   'none',
    left:            Math.min(dragBox.x1, dragBox.x2),
    top:             Math.min(dragBox.y1, dragBox.y2),
    width:           Math.abs(dragBox.x2 - dragBox.x1),
    height:          Math.abs(dragBox.y2 - dragBox.y1),
    backgroundColor: 'rgba(236, 72, 153, 0.12)',
    border:          '1.5px solid #ec4899',
    borderRadius:    4,
  }} />
)}

{/* Floating action bar — appears when tracks are bulk-selected */}
{bulkSelection.size > 0 && (
  <div style={{
    position:       'absolute',
    bottom:         24,
    left:           '50%',
    transform:      'translateX(-50%)',
    zIndex:         1500,
    background:     'rgba(15, 23, 42, 0.92)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border:         '1px solid #ec4899',
    borderRadius:   32,
    padding:        '8px 20px',
    display:        'flex',
    alignItems:     'center',
    gap:            16,
    boxShadow:      '0 4px 24px rgba(236,72,153,0.25)',
  }}>
    <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14 }}>
      {bulkSelection.size} track{bulkSelection.size !== 1 ? 's' : ''} selected
    </span>

    <button
      onClick={() => {
        const nodes = Array.from(bulkSelection)
          .map(id => graphData.nodes.find(n => n.id === id))
          .filter(Boolean);
        queueForImport(nodes);
        setBulkSelection(new Set());
      }}
      style={{
        background:   '#ec4899',
        color:        '#fff',
        border:       'none',
        padding:      '6px 18px',
        borderRadius: 20,
        cursor:       'pointer',
        fontWeight:   700,
        fontSize:     13,
      }}
    >
      ➕ Send to Studio
    </button>

    <button
      onClick={() => setBulkSelection(new Set())}
      style={{
        background:   'transparent',
        color:        '#94a3b8',
        border:       'none',
        cursor:       'pointer',
        fontSize:     13,
        padding:      '4px 8px',
      }}
    >
      Clear
    </button>
  </div>
)}
```

### 3j — Show the Shift-mode hint in all three control panel layouts

In the mobile slide-in menu, compact settings panel, and full top-bar controls,
add a small status indicator that appears when `isShiftPressed` is true. Place it
near the top of each panel:

```jsx
{isShiftPressed && (
  <div style={{
    padding:      '6px 12px',
    borderRadius: 8,
    background:   'rgba(236, 72, 153, 0.15)',
    border:       '1px solid rgba(236, 72, 153, 0.4)',
    color:        '#f9a8d4',
    fontSize:     12,
    fontWeight:   600,
    textAlign:    'center',
  }}>
    Drag to select tracks
  </div>
)}
```

Do NOT add `enableNavigation` as a prop to `<ForceGraph3D>`. The OrbitControls
are already frozen via the `useEffect` in Step 3d.

---

## Step 4 — Modify `web/src/App.jsx` inside `FlowApp`

### 4a — Add import at the top of `App.jsx`

```js
import { useStudio } from './StudioContext';
```

### 4b — Destructure the context inside the `FlowApp` function body

Add this near the top of the `FlowApp` component, alongside other state declarations:

```js
const { importQueue, clearQueue } = useStudio();
```

### 4c — Add the import-queue processing `useEffect`

Add this useEffect inside `FlowApp`. Place it near the bottom of the hooks block,
after the existing `fetchDrafts` useEffect.

IMPORTANT NOTES on this implementation:
- `getViewportRef.current` is a **function** (`getViewport` from ReactFlow).
  Call it as `getViewportRef.current?.()` to get the `{ x, y, zoom }` object.
- Node data must include `entity`, `inPlaylist`, `isPlaying`, and `onTogglePlaylist`.
  Use `syncNodes` to stamp these correctly.
- Use `buildTrackEntityStub` (already defined in `FlowApp`) to create proper
  expandable entities with `loaded: false` and `links: []`.
- Library nodes from the graph use `artworkurl` (lowercase) and `previewUrl` (camelCase).

```js
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
  //    buildTrackEntityStub is defined earlier in FlowApp via useCallback.
  //    It returns { id, kind, label, subtitle, loaded: false, links: [], ... }
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
```

---

## Step 5 — Verify `graph2ScreenCoords` availability

Before shipping, add a one-time runtime guard. In `LibraryGraph.jsx`, inside the
`onPointerUp` handler (Step 3e), the code calls `graphRef.current.graph2ScreenCoords`.
This method exists in `react-force-graph-3d` but confirm it is available before
using it in bulk:

```js
// Add this guard inside onPointerUp, before the forEach:
if (typeof graphRef.current.graph2ScreenCoords !== 'function') {
  console.warn('graph2ScreenCoords not available — update react-force-graph-3d');
  setDragBox(null);
  return;
}
```

---

## Behaviour contract after implementation

| User action | Expected result |
|---|---|
| Hold Shift | Cursor hint appears in controls panel; OrbitControls frozen |
| Shift + drag on 3D graph | Pink marquee box drawn; no camera rotation |
| Release drag | Z-depth slicing runs; foreground track nodes highlighted pink; action bar appears |
| Shift + drag again | Additional nodes ADDED to existing selection (cumulative) |
| Click "Send to Studio" | Queue written to context; bulk selection cleared |
| Navigate back to Studio (`/`) | Import queue useEffect fires; tracks placed as a grid on the visible canvas; each entity has `loaded: false` and can be expanded; tracks added to playlist |
| Click an imported track node | Opens detail panel; clicking expand arrow loads full recommendations from API |
| Escape key or "Clear" | `bulkSelection` cleared; action bar hidden |

---

## What does NOT need to change

- `db.js` — no schema or query changes
- `providers.js` — server-side file; untouched
- `App.jsx` routing structure — no route changes
- The existing keyboard navigation (`ArrowUp`/`ArrowDown`/`1-9`) in `LibraryGraph.jsx`
  — the new Shift listener is a separate `useEffect` and does not interfere
