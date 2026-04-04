import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Link } from "react-router-dom";
import ForceGraph3D from "react-force-graph-3d";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";

// Generates a distinct color for a string (Genre)
function stringToColor(str) {
  if (!str) return '#475569';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 75%, 60%)`;
}

// Generates a Heatmap color for BPM (Blue = Slow, Red = Fast)
function bpmToColor(bpm) {
  if (!bpm) return '#475569';
  const clamped = Math.max(60, Math.min(200, bpm));
  const hue = (1 - (clamped - 60) / 140) * 240; // 240 (Blue) to 0 (Red)
  return `hsl(${hue}, 80%, 55%)`;
}

// Generates a Sequential color for Year (Sepia/Orange = Old, Cyan = New)
function yearToColor(year) {
  if (!year) return '#475569';
  const clamped = Math.max(1960, Math.min(2026, year));
  const hue = 30 + ((clamped - 1960) / 66) * 150; // 30 (Orange) to 180 (Cyan)
  return `hsl(${hue}, 80%, 55%)`;
}

// Default node color by kind
function defaultNodeColor(node) {
  switch (node.kind) {
    case "track":  return "#a855f7";
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
  const searchInputRef = useRef(null);
  const composerRef = useRef(null);
  const bloomPassRef = useRef(null);
  const lastInteractionRef = useRef(Date.now());
  const isPostProcessingReady = useRef(false);
  const [isIdle, setIsIdle] = useState(false);

  // Filter and color state
  const [colorMode, setColorMode] = useState('default'); // 'default', 'genre', 'bpm', 'year'
  const [filters, setFilters] = useState({
    genre: 'All',
    minBpm: 0,
    maxBpm: 300,
    minYear: 1900,
    maxYear: new Date().getFullYear()
  });

  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [nowPlayingNode, setNowPlayingNode] = useState(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // Fuzzy match helper
  function fuzzyMatch(text, query) {
    if (!query) return true;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let textIdx = 0;
    let queryIdx = 0;
    while (textIdx < lowerText.length && queryIdx < lowerQuery.length) {
      if (lowerText[textIdx] === lowerQuery[queryIdx]) {
        queryIdx++;
      }
      textIdx++;
    }
    return queryIdx === lowerQuery.length;
  }

  // Memoized filtered search results (top 8 matches)
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || graphData.nodes.length === 0) return [];
    const query = searchQuery.trim();
    const matches = graphData.nodes.filter((node) => {
      const title = node.label || node.title || node.name || "";
      const artist = node.artist || "";
      return fuzzyMatch(title, query) || fuzzyMatch(artist, query);
    });
    return matches.slice(0, 8);
  }, [searchQuery, graphData.nodes]);

  // Handle search result hover for audio preview
  const handleSearchResultHover = useCallback((node) => {
    if (audioRef.current && node?.previewUrl) {
      if (audioRef.current.src !== node.previewUrl) {
        audioRef.current.src = node.previewUrl;
      }
      audioRef.current.play().catch((e) => console.warn("Playback prevented:", e));
    }
  }, []);

  const handleSearchResultLeave = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  // Handle search result click — fly camera to node
  const handleSearchResultClick = useCallback((node) => {
    setSearchQuery("");
    setShowDropdown(false);
    setSelectedNode(node);
    onNodeSelect?.(node);

    if (graphRef.current) {
      const distance = 100;
      const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
      graphRef.current.cameraPosition(
        { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
        { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
        1500
      );
    }
  }, [onNodeSelect]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Track idle state for auto-rotation and control OrbitControls directly
  useEffect(() => {
    const checkIdle = () => {
      const idle = Date.now() - lastInteractionRef.current > 3000;
      setIsIdle(idle);

      // Directly control OrbitControls autoRotate
      if (graphRef.current) {
        const controls = graphRef.current.controls();
        if (controls) {
          controls.autoRotate = idle;
          controls.autoRotateSpeed = 0.3;
        }
      }
    };
    const interval = setInterval(checkIdle, 500);
    return () => clearInterval(interval);
  }, []);

  // Initialize post-processing (Bloom) after ForceGraph3D mounts
  useEffect(() => {
    const initPostProcessing = () => {
      if (!graphRef.current || !containerRef.current) return;

      const renderer = graphRef.current.renderer();
      const scene = graphRef.current.scene();
      const camera = graphRef.current.camera();

      if (!renderer || !scene || !camera) return;

      // Set up renderer tone mapping
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;

      // Create EffectComposer
      const composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        ),
        1.5,  // strength
        0.4,  // radius
        0.85  // threshold
      );
      composer.addPass(bloomPass);

      composerRef.current = composer;
      bloomPassRef.current = bloomPass;
      isPostProcessingReady.current = true;
    };

    // Delay to ensure ForceGraph3D is fully initialized
    const timer = setTimeout(initPostProcessing, 500);
    return () => clearTimeout(timer);
  }, []);

  // Handle resize for bloom pass
  useEffect(() => {
    const handleResize = () => {
      if (composerRef.current && containerRef.current && bloomPassRef.current) {
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        composerRef.current.setSize(width, height);
        bloomPassRef.current.resolution.set(width, height);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [nodeLimit]);

  // Track mouse position for hover overlay and reset idle timer
  const handleMouseMove = useCallback((e) => {
    lastInteractionRef.current = Date.now();
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
              setNowPlayingNode(node); // Track the currently playing node
            }
            audioRef.current.play().catch(e => console.warn("Playback prevented:", e));
          }
        }, 400); // Wait 400ms of resting on the node before playing
      }
    } else {
      // Mouse moved off into empty space
      // Note: Do NOT pause audio or clear nowPlayingNode — let playback continue
    }
  }, []);

  // Handle node click — set as selected and fly camera
  const handleNodeClick = useCallback((node) => {
    if (!graphRef.current || !node) return;

    // 1. Set as selected (turns orange)
    setSelectedNode(node);

    // 2. Notify parent component
    onNodeSelect?.(node);

    // 3. Play audio preview if available (keeps playing even when mouse moves away)
    if (audioRef.current && node.previewUrl) {
      if (audioRef.current.src !== node.previewUrl) {
        audioRef.current.src = node.previewUrl;
      }
      audioRef.current.play().catch((e) => console.warn("Playback prevented:", e));
    }

    // 4. Fly camera to node
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

  // Filter check function
  const passesFilters = useCallback((node) => {
    if (!node) return false;
    if (node.kind !== 'track') return true; // Always show artists/genres
    if (filters.genre !== 'All' && node.genre !== filters.genre) return false;
    if (node.bpm && (node.bpm < filters.minBpm || node.bpm > filters.maxBpm)) return false;
    if (node.year && (node.year < filters.minYear || node.year > filters.maxYear)) return false;
    return true;
  }, [filters]);

  // Get unique genres from graph data
  const uniqueGenres = useMemo(() => {
    return Array.from(new Set(graphData.nodes.map(n => n.genre).filter(Boolean))).sort();
  }, [graphData.nodes]);

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

      {/* Control Panel Overlay */}
      <div style={{
        position: 'absolute', top: 20, right: 20, width: 280,
        background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
        padding: 16, borderRadius: 8, color: '#f8fafc', zIndex: 1000, border: '1px solid #334155'
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
            {uniqueGenres.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Floating Search Bar */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          width: 400,
        }}
        ref={searchInputRef}
      >
        <input
          type="text"
          placeholder="Search tracks, artists, genres…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: "14px",
            color: "#e2e8f0",
            background: "rgba(15, 23, 42, 0.85)",
            border: "1px solid #334155",
            borderRadius: "12px",
            outline: "none",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxSizing: "border-box",
          }}
        />

        {/* Search Results Dropdown */}
        {showDropdown && searchResults.length > 0 && (
          <div
            style={{
              marginTop: 8,
              background: "rgba(15, 23, 42, 0.92)",
              border: "1px solid #334155",
              borderRadius: "12px",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              overflow: "hidden",
              maxHeight: 480,
              overflowY: "auto",
            }}
          >
            {searchResults.map((node) => (
              <div
                key={node.id}
                onMouseEnter={() => handleSearchResultHover(node)}
                onMouseLeave={handleSearchResultLeave}
                onClick={() => handleSearchResultClick(node)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(51, 65, 85, 0.5)",
                  transition: "background 0.15s ease",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "rgba(124, 58, 237, 0.15)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {/* Artwork */}
                {node.artwork_url ? (
                  <img
                    src={node.artwork_url}
                    alt=""
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 6,
                      objectFit: "cover",
                      flexShrink: 0,
                    }}
                    onError={(e) => {
                      e.target.style.display = "none";
                      e.target.nextElementSibling.style.display = "flex";
                    }}
                  />
                ) : null}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 6,
                    background: node.kind === "track" ? "#a855f7" : node.kind === "artist" ? "#0ea5e9" : node.kind === "album" ? "#f59e0b" : "#22c55e",
                    display: node.artwork_url ? "none" : "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  {node.kind === "track" ? "♪" : node.kind === "artist" ? "♫" : node.kind === "album" ? "◉" : "◆"}
                </div>

                {/* Text info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#ffffff",
                      fontSize: 13,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {node.label || node.title || node.name || node.id}
                  </div>
                  {node.artist && (
                    <div
                      style={{
                        color: "#94a3b8",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {node.artist}
                    </div>
                  )}

                  {/* Metadata badges */}
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {node.genres && (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          fontSize: 10,
                          borderRadius: 4,
                          background: "rgba(34, 197, 94, 0.2)",
                          color: "#4ade80",
                          border: "1px solid rgba(34, 197, 94, 0.3)",
                        }}
                      >
                        {node.genres}
                      </span>
                    )}
                    {node.bpm && (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          fontSize: 10,
                          borderRadius: 4,
                          background: "rgba(245, 158, 11, 0.2)",
                          color: "#fbbf24",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                        }}
                      >
                        {Math.round(node.bpm)} BPM
                      </span>
                    )}
                    {node.danceability != null && (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          fontSize: 10,
                          borderRadius: 4,
                          background: "rgba(168, 85, 247, 0.2)",
                          color: "#c084fc",
                          border: "1px solid rgba(168, 85, 247, 0.3)",
                        }}
                        title="Danceability"
                      >
                        💃 {Math.round(node.danceability * 100)}%
                      </span>
                    )}
                    {node.energy != null && (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          fontSize: 10,
                          borderRadius: 4,
                          background: "rgba(239, 68, 68, 0.2)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                        }}
                        title="Energy"
                      >
                        ⚡ {Math.round(node.energy * 100)}%
                      </span>
                    )}
                    {node.acousticness != null && (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          fontSize: 10,
                          borderRadius: 4,
                          background: "rgba(34, 211, 238, 0.2)",
                          color: "#22d3ee",
                          border: "1px solid rgba(34, 211, 238, 0.3)",
                        }}
                        title="Acousticness"
                      >
                        🎸 {Math.round(node.acousticness * 100)}%
                      </span>
                    )}
                    {node.liveliness != null && (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          fontSize: 10,
                          borderRadius: 4,
                          background: "rgba(251, 191, 36, 0.2)",
                          color: "#fbbf24",
                          border: "1px solid rgba(251, 191, 36, 0.3)",
                        }}
                        title="Liveliness"
                      >
                        🎤 {Math.round(node.liveliness * 100)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Preview indicator */}
                {node.previewUrl && (
                  <span style={{ color: "#64748b", fontSize: 14, flexShrink: 0 }}>▶</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* No results message */}
        {showDropdown && searchQuery.trim() && searchResults.length === 0 && (
          <div
            style={{
              marginTop: 8,
              padding: "14px 16px",
              background: "rgba(15, 23, 42, 0.92)",
              border: "1px solid #334155",
              borderRadius: "12px",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              color: "#94a3b8",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            No results found for "{searchQuery}"
          </div>
        )}
      </div>

      {/* Now Playing Aside */}
      {nowPlayingNode && (
        <div
          className="entity-card"
          style={{
            position: 'absolute',
            bottom: 24,
            left: 24,
            width: 'fit-content',
            maxWidth: 300,
            height: 'fit-content',
            minHeight: 0,
            padding: 0,
            background: 'rgba(15, 23, 42, 0.9)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid #334155',
            zIndex: 1000,
            cursor: 'pointer',
            '--accent': '#7c3aed'
          }}
          onClick={() => {
            // 1. Highlight it
            setSelectedNode(nowPlayingNode);
            setSearchQuery('');

            // 2. Fly the camera back to the playing node
            const distance = 100;
            const distRatio = 1 + distance / Math.hypot(nowPlayingNode.x, nowPlayingNode.y, nowPlayingNode.z);
            graphRef.current.cameraPosition(
              { x: nowPlayingNode.x * distRatio, y: nowPlayingNode.y * distRatio, z: nowPlayingNode.z * distRatio },
              nowPlayingNode,
              1500
            );
          }}
        >
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 12px' }}>
            {nowPlayingNode.artwork_url ? (
              <img
                src={nowPlayingNode.artwork_url}
                style={{ width: '48px', height: '48px', borderRadius: '6px', flexShrink: 0 }}
                alt="artwork"
              />
            ) : (
              <div style={{ width: '48px', height: '48px', borderRadius: '6px', background: '#334155', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 'bold', color: 'white', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlayingNode.label || nowPlayingNode.title || nowPlayingNode.name || 'Unknown Track'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlayingNode.artist || 'Unknown Artist'}
              </div>
            </div>
            <span className="soundwave-cluster" aria-hidden="true" style={{ flexShrink: 0 }}>
              <span></span><span></span><span></span>
            </span>
          </div>
          <div style={{ padding: '0 12px 10px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {nowPlayingNode.genres && <span className="chip" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', color: '#cbd5e1' }}>{nowPlayingNode.genres}</span>}
            {nowPlayingNode.bpm && <span className="chip" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', color: '#cbd5e1' }}>{Math.round(nowPlayingNode.bpm)} BPM</span>}
            {nowPlayingNode.year && <span className="chip" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', color: '#cbd5e1' }}>{nowPlayingNode.year}</span>}
            {nowPlayingNode.danceability != null && <span className="chip" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', color: '#cbd5e1' }} title="Danceability">💃 {Math.round(nowPlayingNode.danceability * 100)}%</span>}
            {nowPlayingNode.energy != null && <span className="chip" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', color: '#cbd5e1' }} title="Energy">⚡ {Math.round(nowPlayingNode.energy * 100)}%</span>}
            {nowPlayingNode.acousticness != null && <span className="chip" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', color: '#cbd5e1' }} title="Acousticness">🎸 {Math.round(nowPlayingNode.acousticness * 100)}%</span>}
            {nowPlayingNode.liveliness != null && <span className="chip" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', color: '#cbd5e1' }} title="Liveliness">🎤 {Math.round(nowPlayingNode.liveliness * 100)}%</span>}
          </div>
        </div>
      )}

      {/* Back to Studio link */}
      <Link to="/" className="back-to-studio-link">← Back to Studio</Link>

      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}

        // ── Performance optimizations (CRITICAL for 10k nodes) ──
        warmupTicks={100}
        cooldownTicks={0}
        nodeResolution={8}
        nodeColor={(n) => {
          if (n.id === selectedNode?.id) return "#f59e0b";
          if (!passesFilters(n)) return defaultNodeColor(n); // Color doesn't matter if hidden
          if (colorMode === 'genre') return stringToColor(n.genre);
          if (colorMode === 'bpm') return bpmToColor(n.bpm);
          if (colorMode === 'year') return yearToColor(n.year);
          return defaultNodeColor(n);
        }}
        nodeVal={(n) =>
          n.id === selectedNode?.id ? 15 : nodeVal(n)
        }
        nodeRelSize={1}
        backgroundColor="#020617"
        showNavInfo={false}

        // ── Node visibility based on filters ──
        nodeVisibility={passesFilters}

        // ── Interaction ──
        onNodeHover={(node) => {
          lastInteractionRef.current = Date.now();
          handleNodeHover(node);
        }}
        onNodeClick={(node) => {
          lastInteractionRef.current = Date.now();
          handleNodeClick(node);
        }}
        onNodeDoubleClick={handleNodeDoubleClick}
        onBackgroundClick={() => {
          setSelectedNode(null);
          if (audioRef.current) {
            audioRef.current.pause();
          }
        }}

        // ── Link visibility: show links connected to hovered or selected node AND passing filters ──
        linkVisibility={(link) => {
          const sourceId = typeof link.source === "object" ? link.source.id : link.source;
          const targetId = typeof link.target === "object" ? link.target.id : link.target;

          // Check if both source and target pass filters
          const sourceNode = graphData.nodes.find(n => n.id === sourceId);
          const targetNode = graphData.nodes.find(n => n.id === targetId);
          if (!passesFilters(sourceNode) || !passesFilters(targetNode)) return false;

          if (!hoveredNode && !selectedNode) return false;

          const isHovered = hoveredNode && (sourceId === hoveredNode.id || targetId === hoveredNode.id);
          const isSelected = selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id);

          return isHovered || isSelected;
        }}
        linkColor={(link) => {
          const sourceId = typeof link.source === "object" ? link.source.id : link.source;
          const targetId = typeof link.target === "object" ? link.target.id : link.target;

          if (selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id)) {
            return "#f59e0b"; // Amber/Orange for the clicked/searched node
          }
          return "#a855f7"; // Brighter purple for mouse hover
        }}
        linkWidth={1}
        linkOpacity={0.8}

        // ── Custom render frame for bloom ──
        onRenderFrame={(ctx) => {
          // Use post-processing composer if available
          if (isPostProcessingReady.current && composerRef.current) {
            composerRef.current.render();
          }
        }}

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
            "--accent": defaultNodeColor(hoveredNode),
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
                {hoveredNode.genres && <span className="chip">{hoveredNode.genres}</span>}
                {hoveredNode.bpm && <span className="chip">{Math.round(hoveredNode.bpm)} BPM</span>}
                {hoveredNode.danceability != null && (
                  <span className="chip" title="Danceability">💃 {Math.round(hoveredNode.danceability * 100)}%</span>
                )}
                {hoveredNode.energy != null && (
                  <span className="chip" title="Energy">⚡ {Math.round(hoveredNode.energy * 100)}%</span>
                )}
                {hoveredNode.acousticness != null && (
                  <span className="chip" title="Acousticness">🎸 {Math.round(hoveredNode.acousticness * 100)}%</span>
                )}
                {hoveredNode.liveliness != null && (
                  <span className="chip" title="Liveliness">🎤 {Math.round(hoveredNode.liveliness * 100)}%</span>
                )}
                {hoveredNode.playcount != null && (
                  <span className="chip">{hoveredNode.playcount.toLocaleString()} plays</span>
                )}
                {hoveredNode.listeners != null && (
                  <span className="chip">{hoveredNode.listeners.toLocaleString()} listeners</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LibraryGraph;