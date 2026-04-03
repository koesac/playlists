import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";

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

// Truncate text for tooltip
function truncateText(text, maxLen = 40) {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

function LibraryGraph({ onNodeSelect, nodeLimit = 10000 }) {
  const graphRef = useRef(null);
  const containerRef = useRef(null);

  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
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

  // Track mouse position for tooltip
  const handleContainerMouseMove = useCallback((e) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle node hover — react-force-graph-3d passes (node, prevNode)
  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node);
  }, []);

  // Handle node click — fly camera to node
  const handleNodeClick = useCallback((node) => {
    if (!graphRef.current || !node) return;

    // Notify parent component
    onNodeSelect?.(node);

    // Camera fly-to
    const distance = 120;
    const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
    graphRef.current.cameraPosition(
      {
        x: (node.x || 0) * distRatio,
        y: (node.y || 0) * distRatio,
        z: (node.z || 0) * distRatio,
      },
      { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
      2000
    );
  }, [onNodeSelect]);

  // Link material — simple line with low opacity
  const linkMaterial = useCallback(() => {
    return new THREE.LineBasicMaterial({
      color: new THREE.Color(0.58, 0.64, 0.72),
      transparent: true,
      opacity: 0.15,
    });
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
    <div className="graph-view-container" ref={containerRef} onMouseMove={handleContainerMouseMove}>
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
        warmupTicks={150}
        cooldownTicks={0}
        nodeResolution={6}
        linkResolution={1}
        linkWidth={0.5}

        // ── Visuals ──
        nodeColor={nodeColor}
        nodeVal={nodeVal}
        nodeRelSize={1}
        linkColor={() => "rgba(148, 163, 184, 0.15)"}
        linkMaterial={linkMaterial}
        backgroundColor="#020617"
        showNavInfo={false}

        // ── Interaction ──
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}

        // ── Force engine tuning ──
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.4}
      />

      {/* HTML tooltip overlay for hovered node */}
      {hoveredNode && (
        <div
          className="graph-tooltip"
          style={{
            left: tooltipPos.x + 16,
            top: tooltipPos.y - 10,
          }}
        >
          <strong>{truncateText(hoveredNode.title || hoveredNode.name || hoveredNode.id)}</strong>
          {hoveredNode.artist && <span>{hoveredNode.artist}</span>}
          {hoveredNode.bpm && <span>BPM: {hoveredNode.bpm}</span>}
          {hoveredNode.genre && <span>Genre: {hoveredNode.genre}</span>}
          {hoveredNode.playcount != null && (
            <span>{hoveredNode.playcount.toLocaleString()} plays</span>
          )}
        </div>
      )}
    </div>
  );
}

export default LibraryGraph;