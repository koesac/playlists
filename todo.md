Implement "Now Playing" Node & Link Animations
The user wants the currently playing node (nowPlayingNode) to be visually distinct from the clicked/selected node, featuring a unique color, a larger bulging size, and animated "pulsing" connections to its related tracks.

Apply these exact updates to LibraryGraph.jsx:

1. Update nodeColor and nodeVal (The Glowing Node)
Give the playing node a distinct Neon Emerald Green (#10b981) color and dramatically increase its size so it bulges out from the galaxy. Ensure this overrides the standard colorMode filters.

jsx
<ForceGraph3D
  // ... existing props

  nodeColor={(node) => {
    // 1. Highest Priority: Playing Node
    if (nowPlayingNode && node.id === nowPlayingNode.id) return '#10b981'; // Neon Emerald
    
    // 2. Second Priority: Selected Node
    if (selectedNode && node.id === selectedNode.id) return '#f59e0b'; // Orange
    
    // 3. Fallback to existing colorMode logic
    if (colorMode === 'genre') return stringToColor(node.genre);
    if (colorMode === 'bpm') return bpmToColor(node.bpm);
    if (colorMode === 'year') return yearToColor(node.year);
    
    return node.kind === 'track' ? '#7c3aed' : '#0ea5e9';
  }}

  nodeVal={(node) => {
    const baseSize = Math.max(2, Math.log10(node.listeners || 10));
    if (nowPlayingNode && node.id === nowPlayingNode.id) return baseSize * 2.5; // Bulge while playing
    if (selectedNode && node.id === selectedNode.id) return baseSize * 1.5;
    return baseSize;
  }}
2. Update linkVisibility and linkColor
Ensure the links for the playing node are visible and given a lighter, highly visible color (rgba(16, 185, 129, 0.8)).

jsx
  linkVisibility={(link) => {
    if (!hoveredNode && !selectedNode && !nowPlayingNode) return false;
    
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    
    const isHovered = hoveredNode && (sourceId === hoveredNode.id || targetId === hoveredNode.id);
    const isSelected = selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id);
    const isPlaying = nowPlayingNode && (sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id);
    
    return isHovered || isSelected || isPlaying;
  }}

  linkColor={(link) => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    
    if (nowPlayingNode && (sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id)) {
      return 'rgba(16, 185, 129, 0.8)'; // Bright Emerald for playing
    }
    if (selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id)) {
      return '#f59e0b'; // Orange for selected
    }
    return '#7c3aed'; // Purple for hovered
  }}
3. Add linkDirectionalParticles (The Pulsing Animation)
Use the WebGL engine's native particle feature to animate energy flowing out of the currently playing node along its visible links.

jsx
  // Add these props to <ForceGraph3D>
  
  linkDirectionalParticles={(link) => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    
    // Only animate particles for the currently playing track
    if (nowPlayingNode && (sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id)) {
      return 4; // Number of particles flowing along each line
    }
    return 0; // No particles for hovered/selected nodes to save GPU power
  }}
  linkDirectionalParticleWidth={2}
  linkDirectionalParticleSpeed={0.01}


































































   Implement Spatial Keyboard Navigation & Targets Aside
The user wants to navigate the 3D graph using keyboard shortcuts. When a node is selected or playing, pressing ArrowRight (Forward) or ArrowLeft (Back) should move the selection to the closest related tracks based on the graph's link weights. We also need a visual list showing these navigable targets.

1. Compute Navigable Targets
In LibraryGraph.jsx, we need to calculate the immediate neighbors of the selectedNode (or nowPlayingNode), sorted by how strong their connection is (their weight).

Add a new React state and a useMemo hook to compute the targets whenever the selection changes:

jsx
const [navigationHistory, setNavigationHistory] = useState([]); // To allow "Back" traversal

// Compute the nearest neighbors of the currently focused node
const activeFocusNode = selectedNode || nowPlayingNode;

const navigableTargets = useMemo(() => {
  if (!activeFocusNode || !graphData.links) return [];

  // Find all links connected to the focused node
  const connections = graphData.links.filter(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    return sourceId === activeFocusNode.id || targetId === activeFocusNode.id;
  });

  // Map to the actual node objects and sort by highest similarity weight
  const targets = connections.map(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    const targetNodeId = sourceId === activeFocusNode.id ? targetId : sourceId;
    
    const targetNode = graphData.nodes.find(n => n.id === targetNodeId);
    return { node: targetNode, weight: link.weight };
  })
  .filter(t => t.node) // Ensure the node exists
  .sort((a, b) => b.weight - a.weight); // Strongest connections first

  return targets;
}, [activeFocusNode, graphData]);
2. Implement Keyboard Event Listeners
Add a useEffect that listens for ArrowRight (jump to the #1 closest target) and ArrowLeft (jump back to the previous node). Number keys 1 through 9 should jump to that specific target in the list.

jsx
useEffect(() => {
  const handleKeyDown = (e) => {
    // Don't trigger if user is typing in the search bar
    if (document.activeElement.tagName === 'INPUT') return;

    if (!activeFocusNode) return;

    // JUMP TO #1 TARGET (Forward)
    if (e.key === 'ArrowRight') {
      if (navigableTargets.length > 0) {
        const nextNode = navigableTargets[0].node;
        setNavigationHistory(prev => [...prev, activeFocusNode]);
        setSelectedNode(nextNode);
        flyToNode(nextNode); // Assuming you extracted the cameraPosition logic into a flyToNode(node) function
      }
    }

    // JUMP BACK (Backward)
    if (e.key === 'ArrowLeft') {
      if (navigationHistory.length > 0) {
        const prevNode = navigationHistory[navigationHistory.length - 1];
        setNavigationHistory(prev => prev.slice(0, -1)); // Pop history
        setSelectedNode(prevNode);
        flyToNode(prevNode);
      }
    }

    // JUMP TO SPECIFIC TARGET (Number keys 1-9)
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9 && num <= navigableTargets.length) {
      const nextNode = navigableTargets[num - 1].node;
      setNavigationHistory(prev => [...prev, activeFocusNode]);
      setSelectedNode(nextNode);
      flyToNode(nextNode);
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [activeFocusNode, navigableTargets, navigationHistory]);
3. Render the Targets Aside (Bottom Right)
Create a new floating panel on the right side of the screen that lists these navigable targets, displaying their number keys.

jsx
{/* Navigable Targets Aside */}
{activeFocusNode && navigableTargets.length > 0 && (
  <div style={{
    position: 'absolute', bottom: 24, right: 24, width: 280,
    background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
    border: '1px solid #334155', borderRadius: 8, padding: 12,
    color: '#f8fafc', zIndex: 1000, maxHeight: '50vh', overflowY: 'auto'
  }}>
    <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
      <span>Similar Tracks</span>
      <span>Use 1-9 or ➡</span>
    </div>
    
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {navigableTargets.slice(0, 9).map((target, index) => (
        <div 
          key={target.node.id}
          onClick={() => {
            setNavigationHistory(prev => [...prev, activeFocusNode]);
            setSelectedNode(target.node);
            flyToNode(target.node);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px',
            background: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px',
            cursor: 'pointer', border: '1px solid transparent',
            transition: 'border-color 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = '#7c3aed'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
        >
          {/* Number Key Badge */}
          <div style={{ 
            width: 20, height: 20, background: '#334155', borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', fontWeight: 'bold', flexShrink: 0
          }}>
            {index + 1}
          </div>
          
          {/* Target Info */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {target.node.label || target.node.title}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {target.node.artist}
            </div>
          </div>
          
          {/* Match Score (Optional) */}
          <div style={{ fontSize: '10px', color: '#10b981' }}>
            {Math.round(target.weight * 100)}%
          </div>
        </div>
      ))}
    </div>
  </div>
)}