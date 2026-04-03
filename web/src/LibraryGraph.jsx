import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ForceGraph3D from "react-force-graph-3d";

// Node color by kind
function nodeColor(node) {
  switch (node.kind) {
    case "track":  return "#7c3aed";
    case "artist": return "#0ea5e9";
    case "album":  return "#f59e0b";
    case "genre":  return "#22c55e";
    default:       return "#94a3b8";
  }
}

// Node value based on popularity (log scale to keep sizes manageable)
function nodeVal(node) {
  const pop = node.playcount || node.listeners || 0;
  return Math.max(2, Math.log10(pop + 10) * 1.5);
}

function LibraryGraph({ onNodeSelect, nodeLimit = 10000 }) {
  const graphRef = useRef(null);
  const containerRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const audioRef = useRef(null);

  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [nodeCount, setNodeCount] = useState(0);
  const [linkCount, setLinkCount] = useState(0);

  // Fetch graph data from API
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/library/graph?limit=${nodeLimit}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;

        // Ensure nodes have x/y/z for the force layout
        const nodes = (data.nodes || []).map((n) => ({
          ...n,
          kind: n.kind || "track",
          // Pre-seed positions in a sphere to speed up warmup
          x: (Math.random() - 0.5) * 400,
          y: (Math.random() - 0.5) * 400,
          z: (Math.random() - 0.5) * 400,
        }));

        const links = (data.links || []).map((l) => ({
          source: l.source,
          target: l.target,
          weight: l.weight || 0.5,
        }));

        setGraphData({ nodes, links });
        setNodeCount(nodes.length);
        setLinkCount(links.length);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [nodeLimit]);

  // Track mouse position for hover overlay
  const handleMouseMove = useCallback((e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle node hover — debounced audio preview trigger
  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node || null);

    // Clear any pending audio preview trigger
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (node) {
      // If we hovered over a track with a preview URL, start a new timer
      if (node.kind === "track" && node.previewUrl) {
        hoverTimerRef.current = setTimeout(() => {
          if (audioRef.current) {
            // Prevent DOMException by checking if it's already playing this source
            if (audioRef.current.src !== node.previewUrl) {
              audioRef.current.src = node.previewUrl;
            }
            audioRef.current.play().catch(e => console.warn("Playback prevented:", e));
          }
        }, 400); // Wait 400ms of resting on the node before playing
      }
    } else {
      // Mouse moved off into empty space, pause the audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  }, []);

  // Handle node click — strictly for camera navigation
  const handleNodeClick = useCallback((node) => {
    if (!graphRef.current || !node) return;

    // Notify parent component
    onNodeSelect?.(node);

    // Camera fly-to
    const distance = 100;
    const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
    graphRef.current.cameraPosition(
      { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
      node,
      1500 // Smooth 1.5s flight
    );
  }, [onNodeSelect]);

  // Handle node double-click — fly camera closer (audio preview now triggered by hover)
  const handleNodeDoubleClick = useCallback((node) => {
    if (!node) return;

    // Fly camera closer to node
    const distance = 80;
    const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
    graphRef.current?.cameraPosition(
      {
        x: (node.x || 0) * distRatio,
        y: (node.y || 0) * distRatio,
        z: (node.z || 0) * distRatio,
      },
      { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
      1200
    );
  }, []);

  if (loading) {
    return (
      <div className="graph-view-container">
        <div className="graph-loading-overlay">
          <div className="graph-loading-spinner">
            <div className="spinner-ring" />
            <div className="spinner-ring" />
            <div className="spinner-ring" />
          </div>
          <p>Loading graph data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="graph-view-container">
        <div className="graph-loading-overlay">
          <p style={{ color: "#f87171" }}>Failed to load graph: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="graph-view-container"
      ref={containerRef}
      onMouseMove={handleMouseMove}
    >
      {/* Hidden audio element for preview playback */}
      <audio ref={audioRef} />
      {/* Back to Studio link */}
      <Link to="/" className="back-to-studio-link">← Back to Studio</Link>
      {/* Node count badge */}
      <div className="graph-node-count">
        {nodeCount.toLocaleString()} nodes · {linkCount.toLocaleString()} edges
      </div>

      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}

        // ── Performance optimizations (CRITICAL for 10k nodes) ──
        warmupTicks={100}
        cooldownTicks={0}
        nodeResolution={8}
        nodeColor={nodeColor}
        nodeVal={nodeVal}
        nodeRelSize={1}
        linkColor={() => "rgba(148, 163, 184, 0.15)"}
        linkWidth={0.5}
        backgroundColor="#020617"
        showNavInfo={false}

        // ── Interaction ──
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}

        // ── Force engine tuning ──
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.4}
      />

      {/* Rich HTML hover overlay for hovered nodes */}
      {hoveredNode && (
        <div
          className="entity-card hover-preview"
          style={{
            position: "absolute",
            top: mousePos.y + 15,
            left: mousePos.x + 15,
            pointerEvents: "none",
            zIndex: 1000,
            width: "280px",
            "--accent": nodeColor(hoveredNode),
          }}
        >
          <div className="entity-body" style={{ padding: "12px", display: "flex", gap: "12px" }}>
            {hoveredNode.artwork_url && (
              <img
                src={hoveredNode.artwork_url}
                style={{ width: "48px", height: "48px", borderRadius: "4px", objectFit: "cover" }}
                alt="artwork"
                onError={(e) => { e.target.style.display = "none"; }}
              />
            )}
            <div className="entity-copy">
              <div className="entity-title" style={{ fontWeight: "bold", color: "white" }}>
                {hoveredNode.label || hoveredNode.title || hoveredNode.name || hoveredNode.id}
              </div>
              <div className="entity-subtitle" style={{ color: "#94a3b8", fontSize: "13px" }}>
                {hoveredNode.artist || ""}
              </div>

              {/* Render Badges */}
              <div className="chip-row" style={{ marginTop: "6px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {hoveredNode.genre && <span className="chip">{hoveredNode.genre}</span>}
                {hoveredNode.bpm && <span className="chip">{hoveredNode.bpm} BPM</span>}
                {hoveredNode.playcount != null && (
                  <span className="chip">{hoveredNode.playcount.toLocaleString()} plays</span>
                )}
                {hoveredNode.listeners != null && (
                  <span className="chip">{hoveredNode.listeners.toLocaleString()} listeners</span>
                )}
              </div>
            </div>
          </div>
          {hoveredNode.kind === "track" && (
            <div className="track-hint" style={{ marginTop: "8px", fontSize: "11px", color: "#c4b5fd" }}>
              Hover to play preview
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LibraryGraph;