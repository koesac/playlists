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

// ─── DualRangeSlider (integer range, e.g. BPM 60-200) ───────────────────────
function DualRangeSlider({ minVal, maxVal, onChange, trackGradient }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'min' or 'max'
  const latestVals = useRef({ min: minVal, max: maxVal });

  // Keep ref in sync with props — fixes stale closure
  useEffect(() => {
    latestVals.current = { min: minVal, max: maxVal };
  }, [minVal, maxVal]);

  const trackMin = 60;
  const trackMax = 200;
  const trackRange = trackMax - trackMin;

  const handlePointerDown = useCallback((which) => (e) => {
    e.preventDefault();
    e.stopPropagation(); // Fix event bubbling
    setDragging(which);
  }, []);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      const handlePointerMove = (e) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const value = Math.round(trackMin + pct * trackRange);
        // Read from ref to avoid stale closure — always gets latest values
        const current = latestVals.current;

        if (dragging === 'min') {
          onChange({ min: Math.min(value, current.max), max: current.max });
        } else {
          onChange({ min: current.min, max: Math.max(value, current.min) });
        }
      };

      window.addEventListener('mousemove', handlePointerMove);
      window.addEventListener('mouseup', handlePointerUp);
      window.addEventListener('touchmove', handlePointerMove);
      window.addEventListener('touchend', handlePointerUp);
      return () => {
        window.removeEventListener('mousemove', handlePointerMove);
        window.removeEventListener('mouseup', handlePointerUp);
        window.removeEventListener('touchmove', handlePointerMove);
        window.removeEventListener('touchend', handlePointerUp);
      };
    }
  }, [dragging, trackMin, trackRange, onChange, handlePointerUp]);

  const minPct = ((minVal - trackMin) / trackRange) * 100;
  const maxPct = ((maxVal - trackMin) / trackRange) * 100;

  return (
    <div
      ref={trackRef}
      style={{ position: 'relative', height: 24, padding: '0 4px', cursor: 'pointer' }}
    >
      {/* Visual track */}
      <div style={{
        position: 'absolute', top: '50%', left: 0, right: 0, height: 6,
        transform: 'translateY(-50%)', borderRadius: 3,
        background: trackGradient || 'linear-gradient(to right, #3b82f6, #ef4444)',
        zIndex: 0
      }} />
      {/* Selected range highlight */}
      <div style={{
        position: 'absolute', top: '50%', height: 6,
        transform: 'translateY(-50%)', borderRadius: 3,
        left: `${minPct}%`,
        width: `${maxPct - minPct}%`,
        background: 'rgba(124, 58, 237, 0.6)',
        zIndex: 1
      }} />
      {/* Min thumb */}
      <div
        onMouseDown={handlePointerDown('min')}
        onTouchStart={handlePointerDown('min')}
        style={{
          position: 'absolute', top: '50%', width: 22, height: 22,
          transform: 'translate(-50%, -50%)', borderRadius: '50%',
          left: `${minPct}%`,
          background: '#3b82f6', border: '2px solid #1e293b',
          boxShadow: dragging === 'min' ? '0 0 0 4px rgba(59, 130, 246, 0.3)' : '0 2px 6px rgba(0,0,0,0.3)',
          zIndex: 3, cursor: 'grab'
        }}
      />
      {/* Max thumb */}
      <div
        onMouseDown={handlePointerDown('max')}
        onTouchStart={handlePointerDown('max')}
        style={{
          position: 'absolute', top: '50%', width: 22, height: 22,
          transform: 'translate(-50%, -50%)', borderRadius: '50%',
          left: `${maxPct}%`,
          background: '#ef4444', border: '2px solid #1e293b',
          boxShadow: dragging === 'max' ? '0 0 0 4px rgba(239, 68, 68, 0.3)' : '0 2px 6px rgba(0,0,0,0.3)',
          zIndex: 3, cursor: 'grab'
        }}
      />
    </div>
  );
}

// ─── NormalizedDualRangeSlider (0-1 range, e.g. danceability) ────────────────
function NormalizedDualRangeSlider({ minVal, maxVal, onChange, label, trackGradient }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const latestVals = useRef({ min: minVal, max: maxVal });

  // Keep ref in sync with props — fixes stale closure
  useEffect(() => {
    latestVals.current = { min: minVal, max: maxVal };
  }, [minVal, maxVal]);

  const handlePointerDown = useCallback((which) => (e) => {
    e.preventDefault();
    e.stopPropagation(); // Fix event bubbling
    setDragging(which);
  }, []);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      const handlePointerMove = (e) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        // Read from ref to avoid stale closure — always gets latest values
        const current = latestVals.current;

        if (dragging === 'min') {
          onChange({ min: Math.min(pct, current.max), max: current.max });
        } else {
          onChange({ min: current.min, max: Math.max(pct, current.min) });
        }
      };

      window.addEventListener('mousemove', handlePointerMove);
      window.addEventListener('mouseup', handlePointerUp);
      window.addEventListener('touchmove', handlePointerMove);
      window.addEventListener('touchend', handlePointerUp);
      return () => {
        window.removeEventListener('mousemove', handlePointerMove);
        window.removeEventListener('mouseup', handlePointerUp);
        window.removeEventListener('touchmove', handlePointerMove);
        window.removeEventListener('touchend', handlePointerUp);
      };
    }
  }, [dragging, onChange, handlePointerUp]);

  const minPct = minVal * 100;
  const maxPct = maxVal * 100;

  return (
    <div
      ref={trackRef}
      style={{ position: 'relative', height: 24, padding: '0 4px', cursor: 'pointer' }}
    >
      {/* Visual track */}
      <div style={{
        position: 'absolute', top: '50%', left: 0, right: 0, height: 6,
        transform: 'translateY(-50%)', borderRadius: 3,
        background: trackGradient,
        zIndex: 0
      }} />
      {/* Selected range highlight */}
      <div style={{
        position: 'absolute', top: '50%', height: 6,
        transform: 'translateY(-50%)', borderRadius: 3,
        left: `${minPct}%`,
        width: `${maxPct - minPct}%`,
        background: 'rgba(124, 58, 237, 0.6)',
        zIndex: 1
      }} />
      {/* Min thumb */}
      <div
        onMouseDown={handlePointerDown('min')}
        onTouchStart={handlePointerDown('min')}
        style={{
          position: 'absolute', top: '50%', width: 22, height: 22,
          transform: 'translate(-50%, -50%)', borderRadius: '50%',
          left: `${minPct}%`,
          background: trackGradient.includes('#8b5cf6') ? '#8b5cf6' : '#22d3ee',
          border: '2px solid #1e293b',
          boxShadow: dragging === 'min' ? '0 0 0 4px rgba(139, 92, 246, 0.3)' : '0 2px 6px rgba(0,0,0,0.3)',
          zIndex: 3, cursor: 'grab'
        }}
      />
      {/* Max thumb */}
      <div
        onMouseDown={handlePointerDown('max')}
        onTouchStart={handlePointerDown('max')}
        style={{
          position: 'absolute', top: '50%', width: 22, height: 22,
          transform: 'translate(-50%, -50%)', borderRadius: '50%',
          left: `${maxPct}%`,
          background: trackGradient.includes('#ec4899') ? '#ec4899' : '#f59e0b',
          border: '2px solid #1e293b',
          boxShadow: dragging === 'max' ? '0 0 0 4px rgba(236, 72, 153, 0.3)' : '0 2px 6px rgba(0,0,0,0.3)',
          zIndex: 3, cursor: 'grab'
        }}
      />
    </div>
  );
}

// ─── LibraryGraph (main component) ───────────────────────────────────────────
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
  const [controlsMinimized, setControlsMinimized] = useState(true);
  const [filters, setFilters] = useState({
    genre: 'All',
    minBpm: 60,
    maxBpm: 200,
    minDanceability: 0,
    maxDanceability: 1,
    minAcousticness: 0,
    maxAcousticness: 1,
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

  // Navigation state
  const [navigationHistory, setNavigationHistory] = useState([]);

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

  // Fly camera to a node (reusable helper)
  const flyToNode = useCallback((node, distance = 100, duration = 1500) => {
    if (!graphRef.current || !node) return;
    const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
    graphRef.current.cameraPosition(
      { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
      { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
      duration
    );
  }, []);

  // Centralized playback logic: triggers audio, updates state, and flies camera
  const triggerPlayAndFly = useCallback((node) => {
    if (!node || node.kind !== 'track') return;

    // 1. Trigger Audio
    if (audioRef.current && node.previewUrl) {
      if (audioRef.current.src !== node.previewUrl) {
        audioRef.current.src = node.previewUrl;
      }
      audioRef.current.play().catch(e => console.warn("Playback prevented:", e));
    }

    // 2. Set State (This instantly updates the Target Pane)
    setNowPlayingNode(node);
    setSelectedNode(node); // Also highlight it orange

    // 3. Fly Camera
    const distance = 100;
    const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
    graphRef.current.cameraPosition(
      { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
      node,
      1500
    );
  }, []);

  // Handle search result click — fly camera to node
  const handleSearchResultClick = useCallback((node) => {
    setSearchQuery("");
    setShowDropdown(false);
    setSelectedNode(node);
    onNodeSelect?.(node);
    flyToNode(node);
  }, [onNodeSelect, flyToNode]);

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
    flyToNode(node);
  }, [onNodeSelect, flyToNode]);

  // Handle node double-click — fly camera closer (audio preview now triggered by hover)
  const handleNodeDoubleClick = useCallback((node) => {
    if (!node) return;
    flyToNode(node, 80, 1200);
  }, [flyToNode]);

  // Filter check function
  const passesFilters = useCallback((node) => {
    if (!node) return false;
    if (node.kind !== 'track') return true; // Always show artists/genres
    if (filters.genre !== 'All' && node.genre !== filters.genre) return false;
    if (node.bpm && (node.bpm < filters.minBpm || node.bpm > filters.maxBpm)) return false;
    if (node.danceability != null && (node.danceability < filters.minDanceability || node.danceability > filters.maxDanceability)) return false;
    if (node.acousticness != null && (node.acousticness < filters.minAcousticness || node.acousticness > filters.maxAcousticness)) return false;
    if (node.year && (node.year < filters.minYear || node.year > filters.maxYear)) return false;
    return true;
  }, [filters]);

  // Get unique genres from graph data
  const uniqueGenres = useMemo(() => {
    return Array.from(new Set(graphData.nodes.map(n => n.genre).filter(Boolean))).sort();
  }, [graphData.nodes]);

  // Compute the nearest neighbors of the currently playing node
  const navigableTargets = useMemo(() => {
    if (!nowPlayingNode || !graphData.links) return [];

    const connections = graphData.links.filter(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      return sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id;
    });

    return connections.map(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      const targetNodeId = sourceId === nowPlayingNode.id ? targetId : sourceId;

      const targetNode = graphData.nodes.find(n => n.id === targetNodeId);
      return { node: targetNode, weight: link.weight };
    })
    .filter(t => t.node)
    .sort((a, b) => b.weight - a.weight);
  }, [nowPlayingNode, graphData]);

  // Keyboard navigation: ArrowUp (forward to #1), ArrowDown (infinite undo), 1-9 (specific target)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if user is typing in the search bar
      if (document.activeElement.tagName === 'INPUT') return;

      if (!nowPlayingNode) return;

      // FORWARD: ArrowUp -> Jump to Target #1
      if (e.key === 'ArrowUp') {
        e.preventDefault(); // Prevent page scrolling
        if (navigableTargets.length > 0) {
          const nextNode = navigableTargets[0].node;
          setNavigationHistory(prev => [...prev, nowPlayingNode]); // Save current to history
          triggerPlayAndFly(nextNode);
        }
      }

      // BACKWARD: ArrowDown -> Infinite Undo
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (navigationHistory.length > 0) {
          const prevNode = navigationHistory[navigationHistory.length - 1];
          setNavigationHistory(prev => prev.slice(0, -1)); // Pop history
          triggerPlayAndFly(prevNode);
        }
      }

      // JUMP TO SPECIFIC TARGET (Number keys 1-9)
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9 && num <= navigableTargets.length) {
        const nextNode = navigableTargets[num - 1].node;
        setNavigationHistory(prev => [...prev, nowPlayingNode]);
        triggerPlayAndFly(nextNode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nowPlayingNode, navigableTargets, navigationHistory, triggerPlayAndFly]);

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
        position: 'absolute', top: 20, right: 20,
        background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
        padding: controlsMinimized ? '8px 12px' : '16px',
        borderRadius: 8, color: '#f8fafc', zIndex: 1000, border: '1px solid #334155',
        minWidth: controlsMinimized ? 'auto' : 280,
        transition: 'all 0.2s ease'
      }}>
        {/* Header with toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: controlsMinimized ? 0 : 16 }}>
          {!controlsMinimized && <h3 style={{ margin: 0, fontSize: '16px' }}>Library Controls</h3>}
          <button
            onClick={() => setControlsMinimized(!controlsMinimized)}
            style={{
              background: 'transparent', border: 'none', color: '#94a3b8',
              cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
              fontSize: 18, lineHeight: 1
            }}
            title={controlsMinimized ? 'Expand controls' : 'Minimize controls'}
          >
            {controlsMinimized ? '⚙' : '✕'}
          </button>
        </div>

        {/* Minimized state - show active filters as pills */}
        {controlsMinimized && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <span
              style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 11,
                background: colorMode !== 'default' ? 'rgba(124, 58, 237, 0.3)' : 'rgba(148, 163, 184, 0.1)',
                border: `1px solid ${colorMode !== 'default' ? 'rgba(124, 58, 237, 0.5)' : 'rgba(148, 163, 184, 0.2)'}`,
                color: colorMode !== 'default' ? '#c084fc' : '#94a3b8',
                cursor: 'pointer'
              }}
              onClick={() => setControlsMinimized(false)}
            >
              {colorMode === 'default' ? 'Default' : colorMode === 'genre' ? 'Genre' : colorMode === 'bpm' ? 'BPM' : 'Year'}
            </span>
            {filters.genre !== 'All' && (
              <span
                style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11,
                  background: 'rgba(34, 197, 94, 0.2)', border: '1px solid rgba(34, 197, 94, 0.4)',
                  color: '#4ade80', cursor: 'pointer'
                }}
                onClick={() => setControlsMinimized(false)}
              >
                {filters.genre}
              </span>
            )}
            {(filters.minBpm > 60 || filters.maxBpm < 200) && (
              <span
                style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11,
                  background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.4)',
                  color: '#fbbf24', cursor: 'pointer'
                }}
                onClick={() => setControlsMinimized(false)}
              >
                {filters.minBpm}-{filters.maxBpm} BPM
              </span>
            )}
            {(filters.minDanceability > 0 || filters.maxDanceability < 1) && (
              <span
                style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11,
                  background: 'rgba(168, 85, 247, 0.2)', border: '1px solid rgba(168, 85, 247, 0.4)',
                  color: '#c084fc', cursor: 'pointer'
                }}
                onClick={() => setControlsMinimized(false)}
              >
                💃 {Math.round(filters.minDanceability * 100)}-{Math.round(filters.maxDanceability * 100)}%
              </span>
            )}
            {(filters.minAcousticness > 0 || filters.maxAcousticness < 1) && (
              <span
                style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11,
                  background: 'rgba(34, 211, 238, 0.2)', border: '1px solid rgba(34, 211, 238, 0.4)',
                  color: '#22d3ee', cursor: 'pointer'
                }}
                onClick={() => setControlsMinimized(false)}
              >
                🎸 {Math.round(filters.minAcousticness * 100)}-{Math.round(filters.maxAcousticness * 100)}%
              </span>
            )}
          </div>
        )}

        {/* Expanded controls */}
        {!controlsMinimized && (
          <>
            {/* Color Mode - Pill Select */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>Colorize By</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { value: 'default', label: 'Default' },
                  { value: 'genre', label: 'Genre' },
                  { value: 'bpm', label: 'BPM' },
                  { value: 'year', label: 'Year' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setColorMode(opt.value)}
                    style={{
                      padding: '6px 14px', borderRadius: 999, fontSize: 12,
                      background: colorMode === opt.value ? 'rgba(124, 58, 237, 0.35)' : 'rgba(148, 163, 184, 0.1)',
                      border: `1px solid ${colorMode === opt.value ? 'rgba(124, 58, 237, 0.7)' : 'rgba(148, 163, 184, 0.25)'}`,
                      color: colorMode === opt.value ? '#c084fc' : '#94a3b8',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                      fontWeight: colorMode === opt.value ? 600 : 400
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* BPM Filter - Two Point Slider */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                BPM Range: {filters.minBpm} – {filters.maxBpm}
              </label>
              <DualRangeSlider
                minVal={filters.minBpm}
                maxVal={filters.maxBpm}
                onChange={({ min, max }) => setFilters(prev => ({ ...prev, minBpm: min, maxBpm: max }))}
                trackGradient="linear-gradient(to right, #3b82f6, #ef4444)"
              />
            </div>

            {/* Danceability Filter - Two Point Slider */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                Danceability: {Math.round(filters.minDanceability * 100)}% – {Math.round(filters.maxDanceability * 100)}%
              </label>
              <NormalizedDualRangeSlider
                minVal={filters.minDanceability}
                maxVal={filters.maxDanceability}
                onChange={({ min, max }) => setFilters(prev => ({ ...prev, minDanceability: min, maxDanceability: max }))}
                trackGradient="linear-gradient(to right, #8b5cf6, #ec4899)"
              />
            </div>

            {/* Acousticness Filter - Two Point Slider */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
                Acousticness: {Math.round(filters.minAcousticness * 100)}% – {Math.round(filters.maxAcousticness * 100)}%
              </label>
              <NormalizedDualRangeSlider
                minVal={filters.minAcousticness}
                maxVal={filters.maxAcousticness}
                onChange={({ min, max }) => setFilters(prev => ({ ...prev, minAcousticness: min, maxAcousticness: max }))}
                trackGradient="linear-gradient(to right, #22d3ee, #f59e0b)"
              />
            </div>

            {/* Genre Filter */}
            <div style={{ marginBottom: 8 }}>
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
          </>
        )}
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

      {/* Navigable Targets Aside */}
      {nowPlayingNode && navigableTargets.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 24, right: 24, width: 280,
          background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid #334155', borderRadius: 8, padding: 12,
          color: '#f8fafc', zIndex: 1000, maxHeight: '50vh', overflowY: 'auto'
        }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Similar Tracks</span>
            <span>Use 1-9 or ↑</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {navigableTargets.slice(0, 9).map((target, index) => (
              <div
                key={target.node.id}
                onClick={() => {
                  setNavigationHistory(prev => [...prev, nowPlayingNode]);
                  triggerPlayAndFly(target.node);
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
                    {target.node.label || target.node.title || target.node.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {target.node.artist || ''}
                  </div>
                </div>

                {/* Match Score */}
                <div style={{ fontSize: '10px', color: '#10b981' }}>
                  {Math.round(target.weight * 100)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          // 1. Highest Priority: Playing Node
          if (nowPlayingNode && n.id === nowPlayingNode.id) return '#10b981'; // Neon Emerald
          // 2. Second Priority: Selected Node
          if (selectedNode && n.id === selectedNode.id) return '#f59e0b'; // Orange
          // 3. Fallback to existing colorMode logic
          if (!passesFilters(n)) return defaultNodeColor(n);
          if (colorMode === 'genre') return stringToColor(n.genre);
          if (colorMode === 'bpm') return bpmToColor(n.bpm);
          if (colorMode === 'year') return yearToColor(n.year);
          return defaultNodeColor(n);
        }}
        nodeVal={(n) => {
          const baseSize = Math.max(2, Math.log10(n.listeners || 10));
          if (nowPlayingNode && n.id === nowPlayingNode.id) return baseSize * 2.5; // Bulge while playing
          if (selectedNode && n.id === selectedNode.id) return baseSize * 1.5;
          return baseSize;
        }}
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
          if (!hoveredNode && !selectedNode && !nowPlayingNode) return false;

          const sourceId = typeof link.source === "object" ? link.source.id : link.source;
          const targetId = typeof link.target === "object" ? link.target.id : link.target;

          // Check if both source and target pass filters
          const sourceNode = graphData.nodes.find(n => n.id === sourceId);
          const targetNode = graphData.nodes.find(n => n.id === targetId);
          if (!passesFilters(sourceNode) || !passesFilters(targetNode)) return false;

          const isHovered = hoveredNode && (sourceId === hoveredNode.id || targetId === hoveredNode.id);
          const isSelected = selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id);
          const isPlaying = nowPlayingNode && (sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id);

          return isHovered || isSelected || isPlaying;
        }}
        linkColor={(link) => {
          const sourceId = typeof link.source === "object" ? link.source.id : link.source;
          const targetId = typeof link.target === "object" ? link.target.id : link.target;

          if (nowPlayingNode && (sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id)) {
            return 'rgba(16, 185, 129, 0.8)'; // Bright Emerald for playing
          }
          if (selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id)) {
            return '#f59e0b'; // Orange for selected
          }
          return '#7c3aed'; // Purple for hovered
        }}
        linkDirectionalParticles={(link) => {
          const sourceId = typeof link.source === "object" ? link.source.id : link.source;
          const targetId = typeof link.target === "object" ? link.target.id : link.target;

          // Only animate particles for the currently playing track
          if (nowPlayingNode && (sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id)) {
            return 4; // Number of particles flowing along each line
          }
          return 0; // No particles for hovered/selected nodes to save GPU power
        }}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleSpeed={0.01}
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