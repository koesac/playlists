 Implement "The Bulk Harvester" with Z-Depth Slicing
We need to allow the user to select multiple tracks at once by holding Shift and drawing a selection box over the 3D graph, and then send those tracks back to the Studio workspace. We must also implement Z-Depth slicing so the selection box only grabs the foreground cluster and ignores distant background nodes.

Follow these implementation steps exactly:

1. Create the Global State Context (web/src/StudioContext.jsx)
Create a context to share the import queue between the /library and / routes.

jsx
import React, { createContext, useState, useContext } from 'react';

const StudioContext = createContext();

export function StudioProvider({ children }) {
  const [importQueue, setImportQueue] = useState([]);

  const queueForImport = (trackNodes) => {
    const nodesToAdd = Array.isArray(trackNodes) ? trackNodes : [trackNodes];
    setImportQueue(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      const newNodes = nodesToAdd.filter(t => !existingIds.has(t.id));
      return [...prev, ...newNodes];
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
Important: Wrap your BrowserRouter and Routes inside <StudioProvider> in your root entry file (main.jsx or RootLayout.jsx).

2. Process the Queue in the Studio (web/src/FlowApp.jsx)
When the user navigates back to /, read the queue and drop the nodes onto the canvas.

jsx
import { useStudio } from './StudioContext';

// Inside FlowApp component:
const { importQueue, clearQueue } = useStudio();

useEffect(() => {
  if (importQueue.length === 0) return;

  let nextEntityMap = { ...entityMap };
  let nextPlaylist = [...playlist];
  let newFlowNodes = [];
  const startX = (getViewportRef.current?.x || 0) + 100;
  const startY = (getViewportRef.current?.y || 0) + 100;

  importQueue.forEach((libNode, index) => {
    const entity = {
      id: libNode.id,
      kind: 'track',
      label: libNode.label || libNode.title,
      subtitle: libNode.artist,
      artworkUrl: libNode.artwork_url || libNode.previewUrl,
      previewUrl: libNode.preview_url,
      meta: [libNode.year ? String(libNode.year) : null].filter(Boolean),
      raw: { ...libNode } 
    };

    nextEntityMap[entity.id] = entity;
    if (!nextPlaylist.find(p => p.id === entity.id)) nextPlaylist.push(entity);

    newFlowNodes.push({
      id: entity.id,
      type: 'entity',
      position: { x: startX + (index * 30), y: startY + (index * 30) },
      data: { entityId: entity.id }
    });
  });

  setEntityMap(nextEntityMap);
  setPlaylist(nextPlaylist);
  setNodes(prev => [...prev, ...newFlowNodes]);
  clearQueue();
}, [importQueue]);
3. Implement Marquee State & Z-Depth Slicing (web/src/LibraryGraph.jsx)
Add the Shift-drag logic and 3D-to-2D projection math to your LibraryGraph component.

Add State:

jsx
import { useStudio } from './StudioContext';

const { queueForImport } = useStudio();
const [isShiftPressed, setIsShiftPressed] = useState(false);
const [dragBox, setDragBox] = useState(null); // { x1, y1, x2, y2 }
const [bulkSelection, setBulkSelection] = useState(new Set());

useEffect(() => {
  const handleKeyDown = (e) => { if (e.key === 'Shift') setIsShiftPressed(true); };
  const handleKeyUp = (e) => { if (e.key === 'Shift') setIsShiftPressed(false); };
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
}, []);
Wrap <ForceGraph3D> in a Pointer-Event Container:

jsx
<div 
  style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}
  onPointerDown={(e) => {
    if (isShiftPressed) setDragBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  }}
  onPointerMove={(e) => {
    if (dragBox) setDragBox(prev => ({ ...prev, x2: e.clientX, y2: e.clientY }));
  }}
  onPointerUp={(e) => {
    if (dragBox && graphRef.current) {
      const minX = Math.min(dragBox.x1, dragBox.x2);
      const maxX = Math.max(dragBox.x1, dragBox.x2);
      const minY = Math.min(dragBox.y1, dragBox.y2);
      const maxY = Math.max(dragBox.y1, dragBox.y2);

      const newSelection = new Set(bulkSelection);
      const camera = graphRef.current.camera();
      const boxedNodes = [];

      // Project 3D nodes to 2D screen space
      graphData.nodes.forEach(node => {
        if (node.kind !== 'track') return; 
        if (!passesFilters(node)) return;

        const screenCoords = graphRef.current.graph2ScreenCoords(node.x, node.y, node.z);
        if (screenCoords.x >= minX && screenCoords.x <= maxX && screenCoords.y >= minY && screenCoords.y <= maxY) {
          // Calculate true 3D distance from camera
          const dist = Math.hypot(node.x - camera.position.x, node.y - camera.position.y, node.z - camera.position.z);
          boxedNodes.push({ node, dist });
        }
      });

      // Z-Depth Slicing: Only keep the foreground cluster, discard distant background nodes
      if (boxedNodes.length > 0) {
        const minDist = Math.min(...boxedNodes.map(n => n.dist));
        const maxAllowedDist = minDist * 1.3; // 30% depth tolerance
        boxedNodes.forEach(({ node, dist }) => {
          if (dist <= maxAllowedDist) newSelection.add(node.id);
        });
      }

      setBulkSelection(newSelection);
      setDragBox(null);
    }
  }}
>
  <ForceGraph3D
    // ... your existing props ...
    
    enableNavigation={!isShiftPressed} // Disable camera rotation while drawing box
    
    nodeColor={(node) => {
      if (nowPlayingNode && node.id === nowPlayingNode.id) return '#10b981';
      if (selectedNode && node.id === selectedNode.id) return '#f59e0b';
      if (bulkSelection.has(node.id)) return '#ec4899'; // Hot Pink for bulk selection
      // ... fallback to colorMode logic
    }}
    nodeVal={(node) => {
      const baseSize = Math.max(2, Math.log10(node.listeners || 10));
      if (nowPlayingNode && node.id === nowPlayingNode.id) return baseSize * 2.5;
      if (selectedNode && node.id === selectedNode.id) return baseSize * 1.5;
      if (bulkSelection.has(node.id)) return baseSize * 1.3;
      return baseSize;
    }}
  />

  {/* Marquee Drawing Box UI */}
  {dragBox && (
    <div style={{
      position: 'absolute', zIndex: 2000, pointerEvents: 'none',
      left: Math.min(dragBox.x1, dragBox.x2), top: Math.min(dragBox.y1, dragBox.y2),
      width: Math.abs(dragBox.x2 - dragBox.x1), height: Math.abs(dragBox.y2 - dragBox.y1),
      backgroundColor: 'rgba(236, 72, 153, 0.15)', border: '1px solid #ec4899'
    }} />
  )}

  {/* Floating Action Bar UI */}
  {bulkSelection.size > 0 && (
    <div style={{
      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
      background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(8px)', border: '1px solid #ec4899', 
      borderRadius: 32, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 16
    }}>
      <span style={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '14px' }}>{bulkSelection.size} Tracks Selected</span>
      <button 
        style={{ background: '#ec4899', color: 'white', border: 'none', padding: '6px 16px', borderRadius: 16, cursor: 'pointer', fontWeight: 'bold' }}
        onClick={() => {
          const nodesToQueue = Array.from(bulkSelection).map(id => graphData.nodes.find(n => n.id === id)).filter(Boolean);
          queueForImport(nodesToQueue);
          setBulkSelection(new Set()); // Clear after queuing
        }}
      >
        ➕ Queue for Studio
      </button>
      <button 
        style={{ background: 'transparent', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '12px' }}
        onClick={() => setBulkSelection(new Set())}
      >
        Clear
      </button>
    </div>
  )}
</div>
























asdd two point sliders for year like we have for the others

include track (node) and relations (edge) counts as stats at the bottom of the library controls

allow search to show and add new tracks

allow ghost nodes for related tracks not already saved









