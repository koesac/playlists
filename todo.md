













































































































 Implement the 2D Marquee "Bulk Harvester"
We need to allow the user to select multiple tracks at once by holding Shift and drawing a selection box over the 3D graph. Selected nodes should be highlighted in Hot Pink (#ec4899), and a floating action bar should appear to send the bulk selection to the Studio Context queue.

1. Add Marquee State & Keyboard Listeners
In LibraryGraph.jsx, add state to track the Shift key, the dragging box coordinates, and the set of selected node IDs.

jsx
const [isShiftPressed, setIsShiftPressed] = useState(false);
const [dragBox, setDragBox] = useState(null); // { x1, y1, x2, y2 }
const [bulkSelection, setBulkSelection] = useState(new Set());

// Listen for the Shift key to toggle selection mode
useEffect(() => {
  const handleKeyDown = (e) => { if (e.key === 'Shift') setIsShiftPressed(true); };
  const handleKeyUp = (e) => { if (e.key === 'Shift') setIsShiftPressed(false); };
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
}, []);
2. Implement 3D-to-2D Projection Logic
Wrap the main <ForceGraph3D> inside a generic <div> (you likely already have one). Attach onPointerDown, onPointerMove, and onPointerUp to this wrapper to draw the box and calculate which 3D nodes fall inside the 2D screen coordinates.

jsx
<div 
  style={{ width: '100%', height: '100vh', position: 'relative' }}
  onPointerDown={(e) => {
    if (isShiftPressed) {
      setDragBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
    }
  }}
  onPointerMove={(e) => {
    if (dragBox) {
      setDragBox(prev => ({ ...prev, x2: e.clientX, y2: e.clientY }));
    }
  }}
  onPointerUp={(e) => {
    if (dragBox && graphRef.current) {
      const minX = Math.min(dragBox.x1, dragBox.x2);
      const maxX = Math.max(dragBox.x1, dragBox.x2);
      const minY = Math.min(dragBox.y1, dragBox.y2);
      const maxY = Math.max(dragBox.y1, dragBox.y2);

      const newSelection = new Set(bulkSelection);

      // Project 3D nodes to 2D screen space to check if they are in the box
      graphData.nodes.forEach(node => {
        if (node.kind !== 'track') return; 
        if (!passesFilters(node)) return; // Only select currently visible nodes

        const screenCoords = graphRef.current.graph2ScreenCoords(node.x, node.y, node.z);
        if (
          screenCoords.x >= minX && screenCoords.x <= maxX &&
          screenCoords.y >= minY && screenCoords.y <= maxY
        ) {
          newSelection.add(node.id);
        }
      });

      setBulkSelection(newSelection);
      setDragBox(null); // Clear the drawing box
    }
  }}
>
3. Update the Graph Config (Freeze Camera & Colorize)
Update the ForceGraph3D props. Disable camera navigation while Shift is pressed so the user doesn't accidentally spin the galaxy while drawing the box. Update the color logic to paint bulk-selected nodes Hot Pink.

jsx
<ForceGraph3D
  // ... existing props

  // CRITICAL: Disable orbit controls while holding Shift to draw the box
  enableNavigation={!isShiftPressed} 

  nodeColor={(node) => {
    if (nowPlayingNode && node.id === nowPlayingNode.id) return '#10b981'; // Emerald
    if (selectedNode && node.id === selectedNode.id) return '#f59e0b'; // Orange
    
    // NEW: Hot Pink for bulk selection
    if (bulkSelection.has(node.id)) return '#ec4899'; 

    if (colorMode === 'genre') return stringToColor(node.genre);
    if (colorMode === 'bpm') return bpmToColor(node.bpm);
    if (colorMode === 'year') return yearToColor(node.year);
    return node.kind === 'track' ? '#7c3aed' : '#0ea5e9';
  }}

  nodeVal={(node) => {
    const baseSize = Math.max(2, Math.log10(node.listeners || 10));
    if (nowPlayingNode && node.id === nowPlayingNode.id) return baseSize * 2.5;
    if (selectedNode && node.id === selectedNode.id) return baseSize * 1.5;
    
    // Slightly enlarge bulk-selected nodes
    if (bulkSelection.has(node.id)) return baseSize * 1.3; 
    return baseSize;
  }}
/>
4. Render the UI (The Drawn Box & Action Bar)
At the bottom of your main wrapper <div>, render the translucent HTML box the user is actively drawing, and a floating Action Bar to send the tracks to the Studio Context.

jsx
{/* The Translucent Drawing Box */}
{dragBox && (
  <div style={{
    position: 'absolute',
    left: Math.min(dragBox.x1, dragBox.x2),
    top: Math.min(dragBox.y1, dragBox.y2),
    width: Math.abs(dragBox.x2 - dragBox.x1),
    height: Math.abs(dragBox.y2 - dragBox.y1),
    backgroundColor: 'rgba(236, 72, 153, 0.15)', // Translucent Pink
    border: '1px solid #ec4899',
    pointerEvents: 'none',
    zIndex: 2000
  }} />
)}

{/* Bulk Action Bar */}
{bulkSelection.size > 0 && (
  <div style={{
    position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(8px)',
    border: '1px solid #ec4899', borderRadius: 32, padding: '8px 16px',
    display: 'flex', alignItems: 'center', gap: 16, zIndex: 1000,
    boxShadow: '0 10px 25px -5px rgba(236, 72, 153, 0.3)'
  }}>
    <span style={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '14px' }}>
      {bulkSelection.size} Tracks Selected
    </span>
    <button 
      style={{ background: '#ec4899', color: 'white', border: 'none', padding: '6px 16px', borderRadius: 16, cursor: 'pointer', fontWeight: 'bold' }}
      onClick={() => {
        // Send all selected nodes to the Studio Context
        bulkSelection.forEach(id => {
          const node = graphData.nodes.find(n => n.id === id);
          if (node) queueForImport(node);
        });
        setBulkSelection(new Set()); // Clear selection
      }}
    >
      ➕ Send to Studio
    </button>
    <button 
      style={{ background: 'transparent', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '12px' }}
      onClick={() => setBulkSelection(new Set())}
    >
      Clear
    </button>
  </div>
)}