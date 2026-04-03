Implement Data Slicing, Filtering, and Colorizing
We need to add a control panel to the LibraryGraph that allows the user to slice, filter, and colorize the 10,000-node graph dynamically based on metadata (BPM, Genre, Year).

1. Backend Schema Update (Add year)
If year is not currently in the library_nodes table, update the SQLite schema and sync worker.

In api/db.js, add year INTEGER to the library_nodes table.

In api/librarySync.js, ensure year: track.meta?.[0] ? parseInt(track.meta[0]) : null (or wherever year is stored in your payload) is saved during upsertLibraryNode.

2. State Management for Filters & Coloring
In LibraryGraph.jsx, add the following React state to manage the user's view preferences:

jsx
const [colorMode, setColorMode] = useState('default'); // 'default', 'genre', 'bpm', 'year'
const [filters, setFilters] = useState({
  genre: 'All',
  minBpm: 0,
  maxBpm: 300,
  minYear: 1900,
  maxYear: new Date().getFullYear()
});
3. Dynamic Color Generation Logic
Implement helper functions inside the component to generate colors dynamically based on the selected mode without needing external D3 libraries.

jsx
// Generates a distinct color for a string (Genre)
const stringToColor = (str) => {
  if (!str) return '#475569'; // slate-600
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 75%, 60%)`;
};

// Generates a Heatmap color for BPM (Blue = Slow, Red = Fast)
const bpmToColor = (bpm) => {
  if (!bpm) return '#475569';
  const clamped = Math.max(60, Math.min(200, bpm));
  const hue = (1 - (clamped - 60) / 140) * 240; // 240 (Blue) to 0 (Red)
  return `hsl(${hue}, 80%, 55%)`;
};

// Generates a Sequential color for Year (Sepia/Orange = Old, Cyan = New)
const yearToColor = (year) => {
  if (!year) return '#475569';
  const clamped = Math.max(1960, Math.min(2026, year));
  const hue = 30 + ((clamped - 1960) / 66) * 150; // 30 (Orange) to 180 (Cyan)
  return `hsl(${hue}, 80%, 55%)`;
};
4. Apply Props to <ForceGraph3D>
Update the graph component to conditionally render visibility and colors based on the state. react-force-graph-3d supports nodeVisibility and linkVisibility which efficiently hides nodes without recalculating the physics layout.

jsx
// Filter check function
const passesFilters = (node) => {
  if (node.kind !== 'track') return true; // Always show artists/genres if they exist
  if (filters.genre !== 'All' && node.genre !== filters.genre) return false;
  if (node.bpm && (node.bpm < filters.minBpm || node.bpm > filters.maxBpm)) return false;
  if (node.year && (node.year < filters.minYear || node.year > filters.maxYear)) return false;
  return true;
};

<ForceGraph3D
  // ... existing props (warmupTicks, etc.)

  nodeVisibility={passesFilters}
  linkVisibility={(link) => passesFilters(link.source) && passesFilters(link.target)}
  
  nodeColor={(node) => {
    if (colorMode === 'genre') return stringToColor(node.genre);
    if (colorMode === 'bpm') return bpmToColor(node.bpm);
    if (colorMode === 'year') return yearToColor(node.year);
    
    // Default
    return node.kind === 'track' ? '#7c3aed' : '#0ea5e9';
  }}
/>
5. Implement the UI Control Panel
Render a floating absolute <div> on the right side of the screen with <select> and <input type="range"> elements to control the state.

Extract all unique genres from graphData.nodes into an array to populate the Genre <select> dropdown.

Build a styled control panel over the canvas:

jsx
{/* Control Panel Overlay */}
<div style={{
  position: 'absolute', top: 20, right: 20, width: 280, 
  background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
  padding: 16, borderRadius: 8, color: '#f8fafc', zIndex: 1000,
  border: '1px solid #334155'
}}>
  <h3 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>Library Controls</h3>
  
  {/* Color Mode */}
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 4 }}>Colorize By</label>
    <select 
      value={colorMode} 
      onChange={(e) => setColorMode(e.target.value)}
      style={{ width: '100%', background: '#1e293b', color: 'white', border: '1px solid #475569', padding: 6, borderRadius: 4 }}
    >
      <option value="default">Default (Entity Type)</option>
      <option value="genre">Genre</option>
      <option value="bpm">BPM Heatmap</option>
      <option value="year">Release Year</option>
    </select>
  </div>

  {/* BPM Filter */}
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 4 }}>
      Max BPM: {filters.maxBpm}
    </label>
    <input 
      type="range" min="60" max="300" value={filters.maxBpm}
      onChange={(e) => setFilters({...filters, maxBpm: parseInt(e.target.value)})}
      style={{ width: '100%' }}
    />
  </div>

  {/* Genre Filter */}
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 4 }}>Filter Genre</label>
    <select 
      value={filters.genre} 
      onChange={(e) => setFilters({...filters, genre: e.target.value})}
      style={{ width: '100%', background: '#1e293b', color: 'white', border: '1px solid #475569', padding: 6, borderRadius: 4 }}
    >
      <option value="All">All Genres</option>
      {Array.from(new Set(graphData.nodes.map(n => n.genre).filter(Boolean))).sort().map(g => (
        <option key={g} value={g}>{g}</option>
      ))}
    </select>
  </div>
</div>






































Implement "The Telescope" (Rich Local Search)
We need a search bar overlaid on the LibraryGraph that allows the user to find specific tracks within the 10,000-node WebGL universe. This search must feel exactly like the rich search in the main FlowApp, featuring artwork, metadata badges, and hover-to-play audio previews.

1. Search State & Filtering Logic
This search operates strictly on the local graphData.nodes array, not external APIs.

Add state: const [searchQuery, setSearchQuery] = useState('');

Add state: const [selectedNode, setSelectedNode] = useState(null);

Create a memoized filtered list that fuzzy-matches the query against node.label (title) and node.artist. Limit the results to the top 8 matches to keep the DOM light.

2. The Floating Search UI
Render a search container at the top center of the screen (position: absolute, top: 20, left: 50%, transform: translateX(-50%), zIndex: 1000, width: 400px).

The <input> should have a glassmorphism dark theme (background: rgba(15, 23, 42, 0.85), border: 1px solid #334155).

The dropdown results container should match this dark theme.

3. Rich Result Cards (Mirroring the Main App)
Do not use a plain <ul>. Map over the filtered results and render a rich card for each node that mimics the ResultButton from the main app.

Artwork: Render <img src={node.artwork_url}> (40x40px, rounded corners). If null, render a fallback colored square.

Typography: Render the node.label (Title) in white, bold text, and the node.artist in slate-400 text below it.

Metadata Badges: Render small pills/chips for node.genre and node.bpm next to the artist.

4. Hover Audio Previews in Search
The search results must support the exact same audio preview logic as the 3D WebGL nodes.

On the search result <div>, add onMouseEnter. If node.previewUrl exists, set audioRef.current.src = node.previewUrl and call audioRef.current.play().

Add onMouseLeave to call audioRef.current.pause().

5. Camera Fly-To and 3D Highlighting
When the user clicks a rich search result:

Call setSearchQuery('') to close the dropdown.

Call setSelectedNode(node) so the 3D graph knows which node is active.

Use graphRef.current.cameraPosition() to fly the camera directly to node.x, node.y, node.z.

Highlighting the Node: Update the <ForceGraph3D> props to make the selectedNode visually pop out of the galaxy.

Update nodeColor: (n) => n.id === selectedNode?.id ? '#f59e0b' : (n.kind === 'track' ? '#7c3aed' : '#0ea5e9')

Update nodeVal: (n) => n.id === selectedNode?.id ? 15 : Math.max(2, Math.log10(n.listeners || 10))