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

  // Device detection: separate screen size from input capability
  // isSmallScreen — layout decisions (hamburger, bottom sheet, compact panels)
  // isTouchDevice — interaction decisions (no hover, tap-driven playback)
  const [isSmallScreen, setIsSmallScreen] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const [isTouchDevice, setIsTouchDevice] = useState(
    typeof window !== 'undefined'
      ? window.matchMedia('(hover: none), (pointer: coarse)').matches ||
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0
      : false
  );

  useEffect(() => {
    const updateDeviceFlags = () => {
      setIsSmallScreen(window.innerWidth <= 768);
      setIsTouchDevice(
        window.matchMedia('(hover: none), (pointer: coarse)').matches ||
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0
      );
    };
    updateDeviceFlags();
    window.addEventListener('resize', updateDeviceFlags);
    return () => window.removeEventListener('resize', updateDeviceFlags);
  }, []);

  // Derived mode flags — use these throughout the component
  const useTouchUI = isTouchDevice;            // interaction model
  const useCompactMobileLayout = isSmallScreen; // layout model

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);

  // Viewport tracking for responsive desktop layout
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCompactDesktop = viewportWidth < 1180 && !useCompactMobileLayout;
  const isStackedTopBar = viewportWidth < 980 && !useCompactMobileLayout;

  // Compact bar state for mid-sized devices
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);
  const [compactSettingsOpen, setCompactSettingsOpen] = useState(false);

  // Filter and color state
  const [colorMode, setColorMode] = useState('genre'); // 'genre', 'bpm', 'year'
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
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

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
        setNowPlayingNode(node); // Highlight as now playing and update the card
      }
      audioRef.current.play().catch((e) => console.warn("Playback prevented:", e));
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
    setHighlightedIndex(-1);
    onNodeSelect?.(node);
    flyToNode(node);
  }, [onNodeSelect, flyToNode]);

  // Handle search result keyboard navigation
  const handleSearchKeyDown = useCallback((e) => {
    if (!showDropdown || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIndex = Math.min(highlightedIndex + 1, searchResults.length - 1);
      setHighlightedIndex(newIndex);
      // Start preview like hover does
      if (newIndex >= 0) {
        handleSearchResultHover(searchResults[newIndex]);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIndex = Math.max(highlightedIndex - 1, 0);
      setHighlightedIndex(newIndex);
      // Start preview like hover does
      if (newIndex >= 0) {
        handleSearchResultHover(searchResults[newIndex]);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
        const node = searchResults[highlightedIndex];
        handleSearchResultClick(node);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  }, [showDropdown, searchResults, highlightedIndex, handleSearchResultClick, handleSearchResultHover]);

  const handleSearchResultLeave = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

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

  // Handle node hover — debounced audio preview trigger (disabled on touch devices)
  const handleNodeHover = useCallback((node) => {
    if (useTouchUI) return; // no hover preview on touch devices

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

    // Touch devices: tap = triggerPlayAndFly (audio + state + camera) only
    // Bottom sheet opens only from explicit sheet toggle UI, not from node taps
    // Desktop (mouse): click = select + camera only (hover handles audio)
    if (useTouchUI) {
      setHoveredNode(null);
      triggerPlayAndFly(node);
      return;
    }

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
  }, [useTouchUI, onNodeSelect, flyToNode, triggerPlayAndFly]);

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

  // Clamped tooltip coordinates for desktop hover card (never renders off-screen)
  const tooltipPos = useMemo(() => {
    const cardWidth = 280;
    const cardHeight = 170;
    const gap = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = mousePos.x + gap;
    let top = mousePos.y + gap;

    if (left + cardWidth > vw - 12) {
      left = mousePos.x - cardWidth - gap;
    }
    if (left < 12) {
      left = 12;
    }

    if (top + cardHeight > vh - 12) {
      top = vh - cardHeight - 12;
    }
    if (top < 12) {
      top = 12;
    }

    return { left, top };
  }, [mousePos.x, mousePos.y]);

  // Compute the nearest neighbors of the currently playing node
  const navigableTargets = useMemo(() => {
    if (!nowPlayingNode || !graphData.links) return [];

    const historyIds = new Set(navigationHistory);

    // Accumulate unique targets by node ID, keeping highest weight per pair
    const byNodeId = new Map();

    graphData.links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;

      if (sourceId !== nowPlayingNode.id && targetId !== nowPlayingNode.id) return;

      const targetNodeId = sourceId === nowPlayingNode.id ? targetId : sourceId;

      // Exclude self-references
      if (targetNodeId === nowPlayingNode.id) return;

      const targetNode = graphData.nodes.find(n => n.id === targetNodeId);
      if (!targetNode) return;

      // Keep entry only if it's new or has a higher weight than the existing entry
      if (!byNodeId.has(targetNodeId) || byNodeId.get(targetNodeId).weight < link.weight) {
        byNodeId.set(targetNodeId, { node: targetNode, weight: link.weight });
      }
    });

    return Array.from(byNodeId.values())
      .filter(t => passesFilters(t.node))          // exclude filtered-out nodes
      .filter(t => !historyIds.has(t.node.id))
      .filter(t => t.node.kind === 'track') // only tracks are navigable
      .sort((a, b) => b.weight - a.weight);
  }, [nowPlayingNode?.id, graphData.links, graphData.nodes, navigationHistory, passesFilters]);

  // Keyboard navigation: ArrowUp (forward to #1), ArrowDown (infinite undo), 1-9 (specific target)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      if (!nowPlayingNode) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (navigableTargets.length > 0) {
          const nextNode = navigableTargets[0].node;
          // PUSH THE ID STRING
          setNavigationHistory(prev => [...prev, nowPlayingNode.id]);
          triggerPlayAndFly(nextNode);
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (navigationHistory.length > 0) {
          const newHistory = [...navigationHistory];
          const prevNodeId = newHistory.pop(); // POP THE ID STRING
          setNavigationHistory(newHistory);

          // Find the actual node object from the graph data
          const prevNode = graphData.nodes.find(n => n.id === prevNodeId);
          if (prevNode) triggerPlayAndFly(prevNode);
        }
      }

      const num = parseInt(e.key);
      if (num >= 1 && num <= 9 && num <= navigableTargets.length) {
        e.preventDefault();
        const nextNode = navigableTargets[num - 1].node;
        // PUSH THE ID STRING
        setNavigationHistory(prev => [...prev, nowPlayingNode.id]);
        triggerPlayAndFly(nextNode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nowPlayingNode, navigableTargets, navigationHistory, graphData.nodes]);

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

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* MOBILE HAMBURGER TRIGGER — small screens only */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {useCompactMobileLayout && (
        <button
          onClick={() => setMobileMenuOpen(true)}
          style={{
            position: 'absolute', top: 16, left: 16, zIndex: 2000,
            width: 44, height: 44, borderRadius: 8,
            background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
            border: '1px solid #334155', color: '#f8fafc',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
          }}
          aria-label="Open menu"
        >
          ☰
        </button>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* MOBILE SLIDE-IN MENU PANEL — small screens only */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {useCompactMobileLayout && mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000 }}
          />
          {/* Panel */}
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0, width: '85vw', maxWidth: 340,
            background: 'rgba(15, 23, 42, 0.97)', backdropFilter: 'blur(12px)',
            border: '1px solid #334155', zIndex: 2100, overflowY: 'auto',
            padding: '16px', display: 'flex', flexDirection: 'column', gap: 16
          }}>
            {/* Close Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 16 }}>Library Controls</span>
              <button onClick={() => setMobileMenuOpen(false)} style={{ color: '#94a3b8', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            {/* Search Input */}
            <input
              type="text"
              placeholder="Search tracks, artists..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              style={{
                width: '100%', padding: '10px 14px', fontSize: 14,
                color: '#e2e8f0', background: '#1e293b', border: '1px solid #334155',
                borderRadius: 8, outline: 'none', boxSizing: 'border-box'
              }}
            />

            {/* Search Results Dropdown - Inside Panel */}
            {showDropdown && searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                {searchResults.map(node => (
                  <div
                    key={node.id}
                    onClick={() => { handleSearchResultClick(node); setMobileMenuOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      background: '#1e293b', borderRadius: 6, cursor: 'pointer'
                    }}
                  >
                    {node.artwork_url ? (
                      <img src={node.artwork_url} alt="" style={{ width: 36, height: 36, borderRadius: 4, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: 4, background: '#334155', flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {node.label || node.title}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {node.artist}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Divider */}
            <div style={{ height: 1, background: '#334155' }} />

            {/* Color Mode Pills */}
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Colorize By</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['default', 'genre', 'bpm', 'year'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setColorMode(opt)}
                    style={{
                      padding: '6px 14px', borderRadius: 999, fontSize: 12,
                      background: colorMode === opt ? 'rgba(124, 58, 237, 0.35)' : 'rgba(148, 163, 184, 0.1)',
                      border: `1px solid ${colorMode === opt ? 'rgba(124, 58, 237, 0.7)' : 'rgba(148, 163, 184, 0.25)'}`,
                      color: colorMode === opt ? '#c084fc' : '#94a3b8', cursor: 'pointer'
                    }}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* BPM Slider */}
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>
                BPM: {filters.minBpm} – {filters.maxBpm}
              </div>
              <DualRangeSlider
                minVal={filters.minBpm} maxVal={filters.maxBpm}
                onChange={({ min, max }) => setFilters(prev => ({ ...prev, minBpm: min, maxBpm: max }))}
                trackGradient="linear-gradient(to right, #3b82f6, #ef4444)"
              />
            </div>

            {/* Genre Filter */}
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Genre</div>
              <select
                value={filters.genre}
                onChange={e => setFilters({ ...filters, genre: e.target.value })}
                style={{ width: '100%', background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '8px', borderRadius: 6 }}
              >
                <option value="All">All Genres</option>
                {uniqueGenres.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            {/* Danceability */}
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>
                Danceability: {Math.round(filters.minDanceability * 100)}% – {Math.round(filters.maxDanceability * 100)}%
              </div>
              <NormalizedDualRangeSlider
                minVal={filters.minDanceability} maxVal={filters.maxDanceability}
                onChange={({ min, max }) => setFilters(prev => ({ ...prev, minDanceability: min, maxDanceability: max }))}
                trackGradient="linear-gradient(to right, #8b5cf6, #ec4899)"
              />
            </div>

            {/* Acousticness */}
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>
                Acousticness: {Math.round(filters.minAcousticness * 100)}% – {Math.round(filters.maxAcousticness * 100)}%
              </div>
              <NormalizedDualRangeSlider
                minVal={filters.minAcousticness} maxVal={filters.maxAcousticness}
                onChange={({ min, max }) => setFilters(prev => ({ ...prev, minAcousticness: min, maxAcousticness: max }))}
                trackGradient="linear-gradient(to right, #22d3ee, #f59e0b)"
              />
            </div>

            {/* Back to Studio */}
            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #334155' }}>
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, padding: '10px 16px', borderRadius: 8,
                  background: 'rgba(124, 58, 237, 0.2)', border: '1px solid rgba(124, 58, 237, 0.4)',
                  color: '#c084fc', fontWeight: 600, fontSize: 14, textDecoration: 'none'
                }}
              >
                ← Back to Studio
              </Link>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* COMPACT TOP BAR — mid-sized devices (769px – 1180px) */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {isCompactDesktop && (
        <>
          {/* Compact bar with icon buttons */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              right: 12,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              background: 'rgba(15, 23, 42, 0.9)',
              backdropFilter: 'blur(8px)',
              borderRadius: 10,
              border: '1px solid #334155'
            }}
          >
            {/* Search button / input */}
            <div ref={searchInputRef} style={{ flex: compactSearchOpen ? 1 : 'unset', minWidth: 0 }}>
              {compactSearchOpen ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Search tracks, artists…"
                    value={searchQuery}
                    autoFocus
                    onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); setHighlightedIndex(-1); }}
                    onFocus={() => setShowDropdown(true)}
                    onKeyDown={handleSearchKeyDown}
                    onBlur={() => { if (!searchQuery) setCompactSearchOpen(false); }}
                    style={{
                      flex: 1, minWidth: 0, padding: '8px 12px', fontSize: 13,
                      color: '#e2e8f0', background: '#1e293b', border: '1px solid #334155',
                      borderRadius: 8, outline: 'none', boxSizing: 'border-box'
                    }}
                  />
                  <button onClick={() => { setCompactSearchOpen(false); setSearchQuery(''); setShowDropdown(false); }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, fontSize: 16 }}>✕</button>
                </div>
              ) : (
                <button
                  onClick={() => setCompactSearchOpen(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', background: '#1e293b', border: '1px solid #334155',
                    borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap'
                  }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></svg>
                  Search
                </button>
              )}

              {/* Dropdown */}
              {showDropdown && searchResults.length > 0 && compactSearchOpen && (
                <div
                  style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                    background: 'rgba(15, 23, 42, 0.95)', border: '1px solid #334155',
                    borderRadius: 8, overflow: 'hidden', maxHeight: '40vh', overflowY: 'auto', zIndex: 1001
                  }}
                >
                  {searchResults.map((node, index) => (
                    <div
                      key={node.id}
                      onMouseEnter={() => { handleSearchResultHover(node); setHighlightedIndex(index); }}
                      onMouseLeave={handleSearchResultLeave}
                      onClick={() => { handleSearchResultClick(node); setCompactSearchOpen(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        cursor: 'pointer', borderBottom: '1px solid rgba(51,65,85,0.4)',
                        background: index === highlightedIndex ? 'rgba(124,58,237,0.15)' : 'transparent'
                      }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 4, background: node.kind === 'track' ? '#a855f7' : node.kind === 'artist' ? '#0ea5e9' : '#f59e0b', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                        {node.kind === 'track' ? '♪' : node.kind === 'artist' ? '♫' : '◉'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label || node.title}</div>
                        {node.artist && <div style={{ color: '#94a3b8', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.artist}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1 }} />

            {/* Settings button */}
            <button
              onClick={() => setCompactSettingsOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', background: '#1e293b', border: '1px solid #334155',
                borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap'
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
              Settings
            </button>
          </div>

          {/* Settings panel overlay */}
          {compactSettingsOpen && (
            <>
              <div onClick={() => setCompactSettingsOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1050 }} />
              <div style={{
                position: 'absolute', top: 60, right: 12, width: 300, maxHeight: '80vh', overflowY: 'auto',
                background: 'rgba(15, 23, 42, 0.97)', backdropFilter: 'blur(12px)',
                border: '1px solid #334155', borderRadius: 12, padding: 16, color: '#f8fafc', zIndex: 1100
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Library Controls</h3>
                  <button onClick={() => setCompactSettingsOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>✕</button>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Colorize By</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[{ value: 'default', label: 'Default' }, { value: 'genre', label: 'Genre' }, { value: 'bpm', label: 'BPM' }, { value: 'year', label: 'Year' }].map((opt) => (
                      <button key={opt.value} onClick={() => setColorMode(opt.value)} style={{
                        padding: '6px 14px', borderRadius: 999, fontSize: 12,
                        background: colorMode === opt.value ? 'rgba(124,58,237,0.35)' : 'rgba(148,163,184,0.1)',
                        border: `1px solid ${colorMode === opt.value ? 'rgba(124,58,237,0.7)' : 'rgba(148,163,184,0.25)'}`,
                        color: colorMode === opt.value ? '#c084fc' : '#94a3b8', cursor: 'pointer', fontWeight: colorMode === opt.value ? 600 : 400
                      }}>{opt.label}</button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>BPM: {filters.minBpm} – {filters.maxBpm}</label>
                  <DualRangeSlider minVal={filters.minBpm} maxVal={filters.maxBpm} onChange={({ min, max }) => setFilters(prev => ({ ...prev, minBpm: min, maxBpm: max }))} trackGradient="linear-gradient(to right, #3b82f6, #ef4444)" />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Danceability: {Math.round(filters.minDanceability * 100)} – {Math.round(filters.maxDanceability * 100)}%</label>
                  <NormalizedDualRangeSlider minVal={filters.minDanceability} maxVal={filters.maxDanceability} onChange={({ min, max }) => setFilters(prev => ({ ...prev, minDanceability: min, maxDanceability: max }))} trackGradient="linear-gradient(to right, #8b5cf6, #ec4899)" />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Acousticness: {Math.round(filters.minAcousticness * 100)} – {Math.round(filters.maxAcousticness * 100)}%</label>
                  <NormalizedDualRangeSlider minVal={filters.minAcousticness} maxVal={filters.maxAcousticness} onChange={({ min, max }) => setFilters(prev => ({ ...prev, minAcousticness: min, maxAcousticness: max }))} trackGradient="linear-gradient(to right, #22d3ee, #f59e0b)" />
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Genre</label>
                  <select value={filters.genre} onChange={(e) => setFilters({ ...filters, genre: e.target.value })} style={{ width: '100%', background: '#1e293b', color: 'white', border: '1px solid #475569', padding: 8, borderRadius: 6 }}>
                    <option value="All">All Genres</option>
                    {uniqueGenres.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* FULL TOP BAR — wide desktop (> 1180px) */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {!isCompactDesktop && !useCompactMobileLayout && (
        <div
          style={{
            position: 'absolute', top: 20, left: 20, right: 20, zIndex: 1000,
            display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
            justifyContent: 'space-between', gap: 12, pointerEvents: 'none'
          }}
        >
          {/* ── Search column ── */}
          <div ref={searchInputRef} style={{ flex: 1, minWidth: 0, maxWidth: 560, pointerEvents: 'auto' }}>
            <input
              type="text" placeholder="Search tracks, artists, genres…" value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); setHighlightedIndex(-1); }}
              onFocus={() => setShowDropdown(true)} onKeyDown={handleSearchKeyDown}
              style={{
                width: '100%', padding: '12px 16px', fontSize: 14, color: '#e2e8f0',
                background: 'rgba(15, 23, 42, 0.85)', border: '1px solid #334155',
                borderRadius: 12, outline: 'none', backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)', boxSizing: 'border-box'
              }}
            />
            {showDropdown && searchResults.length > 0 && (
              <div style={{
                marginTop: 8, background: 'rgba(15, 23, 42, 0.92)', border: '1px solid #334155',
                borderRadius: 12, backdropFilter: 'blur(12px)', overflow: 'hidden', maxHeight: 480, overflowY: 'auto'
              }}>
                {searchResults.map((node, index) => (
                  <div key={node.id}
                    onMouseEnter={() => { handleSearchResultHover(node); setHighlightedIndex(index); }}
                    onMouseLeave={handleSearchResultLeave} onClick={() => handleSearchResultClick(node)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      cursor: 'pointer', borderBottom: '1px solid rgba(51,65,85,0.5)',
                      background: index === highlightedIndex ? 'rgba(124,58,237,0.15)' : 'transparent'
                    }}
                  >
                    {node.artwork_url ? (
                      <img src={node.artwork_url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }} />
                    ) : null}
                    <div style={{
                      width: 40, height: 40, borderRadius: 6,
                      background: node.kind === 'track' ? '#a855f7' : node.kind === 'artist' ? '#0ea5e9' : node.kind === 'album' ? '#f59e0b' : '#22c55e',
                      display: node.artwork_url ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0
                    }}>{node.kind === 'track' ? '♪' : node.kind === 'artist' ? '♫' : node.kind === 'album' ? '◉' : '◆'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: '#fff', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label || node.title || node.name || node.id}</div>
                      {node.artist && <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.artist}</div>}
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {node.genres && <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: 10, borderRadius: 4, background: 'rgba(34,197,94,0.2)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>{node.genres}</span>}
                        {node.bpm && <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: 10, borderRadius: 4, background: 'rgba(245,158,11,0.2)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>{Math.round(node.bpm)} BPM</span>}
                        {node.danceability != null && <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: 10, borderRadius: 4, background: 'rgba(168,85,247,0.2)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)' }} title="Danceability">💃 {Math.round(node.danceability * 100)}%</span>}
                        {node.energy != null && <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: 10, borderRadius: 4, background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }} title="Energy">⚡ {Math.round(node.energy * 100)}%</span>}
                        {node.acousticness != null && <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: 10, borderRadius: 4, background: 'rgba(34,211,238,0.2)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)' }} title="Acousticness">🎸 {Math.round(node.acousticness * 100)}%</span>}
                      </div>
                    </div>
                    {node.previewUrl && <span style={{ color: '#64748b', fontSize: 14, flexShrink: 0 }}>▶</span>}
                  </div>
                ))}
              </div>
            )}
            {showDropdown && searchQuery.trim() && searchResults.length === 0 && (
              <div style={{ marginTop: 8, padding: '14px 16px', background: 'rgba(15,23,42,0.92)', border: '1px solid #334155', borderRadius: 12, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>No results found for "{searchQuery}"</div>
            )}
          </div>

          {/* ── Controls column ── */}
          <div style={{ width: controlsMinimized ? 'fit-content' : 280, maxWidth: '100%', pointerEvents: 'auto' }}>
            <div style={{
              background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
              padding: controlsMinimized ? '8px 12px' : 16, borderRadius: 8,
              color: '#f8fafc', border: '1px solid #334155', transition: 'all 0.2s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: controlsMinimized ? 0 : 16 }}>
                {!controlsMinimized && <h3 style={{ margin: 0, fontSize: 16 }}>Library Controls</h3>}
                <button onClick={() => setControlsMinimized(!controlsMinimized)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, fontSize: 18 }} title={controlsMinimized ? 'Expand' : 'Minimize'}>
                  {controlsMinimized ? '⚙' : '–'}
                </button>
              </div>
              {controlsMinimized ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, background: colorMode !== 'default' ? 'rgba(124,58,237,0.3)' : 'rgba(148,163,184,0.1)', border: `1px solid ${colorMode !== 'default' ? 'rgba(124,58,237,0.5)' : 'rgba(148,163,184,0.2)'}`, color: colorMode !== 'default' ? '#c084fc' : '#94a3b8', cursor: 'pointer' }} onClick={() => setControlsMinimized(false)}>
                    {colorMode === 'default' ? 'Default' : colorMode === 'genre' ? 'Genre' : colorMode === 'bpm' ? 'BPM' : 'Year'}
                  </span>
                  {filters.genre !== 'All' && (
                    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80', cursor: 'pointer' }} onClick={() => setControlsMinimized(false)}>{filters.genre}</span>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Colorize By</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[{ value: 'default', label: 'Default' }, { value: 'genre', label: 'Genre' }, { value: 'bpm', label: 'BPM' }, { value: 'year', label: 'Year' }].map((opt) => (
                        <button key={opt.value} onClick={() => setColorMode(opt.value)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, background: colorMode === opt.value ? 'rgba(124,58,237,0.35)' : 'rgba(148,163,184,0.1)', border: `1px solid ${colorMode === opt.value ? 'rgba(124,58,237,0.7)' : 'rgba(148,163,184,0.25)'}`, color: colorMode === opt.value ? '#c084fc' : '#94a3b8', cursor: 'pointer', fontWeight: colorMode === opt.value ? 600 : 400 }}>{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>BPM: {filters.minBpm} – {filters.maxBpm}</label>
                    <DualRangeSlider minVal={filters.minBpm} maxVal={filters.maxBpm} onChange={({ min, max }) => setFilters(prev => ({ ...prev, minBpm: min, maxBpm: max }))} trackGradient="linear-gradient(to right, #3b82f6, #ef4444)" />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Danceability: {Math.round(filters.minDanceability * 100)} – {Math.round(filters.maxDanceability * 100)}%</label>
                    <NormalizedDualRangeSlider minVal={filters.minDanceability} maxVal={filters.maxDanceability} onChange={({ min, max }) => setFilters(prev => ({ ...prev, minDanceability: min, maxDanceability: max }))} trackGradient="linear-gradient(to right, #8b5cf6, #ec4899)" />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Acousticness: {Math.round(filters.minAcousticness * 100)} – {Math.round(filters.maxAcousticness * 100)}%</label>
                    <NormalizedDualRangeSlider minVal={filters.minAcousticness} maxVal={filters.maxAcousticness} onChange={({ min, max }) => setFilters(prev => ({ ...prev, minAcousticness: min, maxAcousticness: max }))} trackGradient="linear-gradient(to right, #22d3ee, #f59e0b)" />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Genre</label>
                    <select value={filters.genre} onChange={(e) => setFilters({ ...filters, genre: e.target.value })} style={{ width: '100%', background: '#1e293b', color: 'white', border: '1px solid #475569', padding: 6, borderRadius: 4 }}>
                      <option value="All">All Genres</option>
                      {uniqueGenres.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* DESKTOP NOW PLAYING ASIDE — non-small screens only */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {!useCompactMobileLayout && nowPlayingNode && (
        <div
          className="entity-card"
          style={{
            position: 'absolute',
            bottom: isCompactDesktop ? 0 : 12,
            left: isCompactDesktop ? 0 : 12,
            right: isCompactDesktop ? 260 : 'auto',
            width: isCompactDesktop ? 'calc(100% - 260px)' : 'fit-content',
            maxWidth: isCompactDesktop ? 'none' : 360,
            padding: 0,
            background: isCompactDesktop ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.9)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: isCompactDesktop ? 'none' : '1px solid #334155',
            borderRadius: isCompactDesktop ? 0 : 8,
            zIndex: 1000,
            cursor: 'pointer',
            '--accent': '#7c3aed'
          }}
          onClick={() => {
            setSelectedNode(nowPlayingNode);
            setSearchQuery('');
            const distance = 100;
            const distRatio = 1 + distance / Math.hypot(nowPlayingNode.x, nowPlayingNode.y, nowPlayingNode.z);
            graphRef.current.cameraPosition(
              { x: nowPlayingNode.x * distRatio, y: nowPlayingNode.y * distRatio, z: nowPlayingNode.z * distRatio },
              nowPlayingNode,
              1500
            );
          }}
        >
          <div style={{ display: 'flex', gap: isCompactDesktop ? 6 : 12, alignItems: 'center', padding: isCompactDesktop ? '4px 10px' : '10px 12px' }}>
            {nowPlayingNode.artwork_url ? (
              <img src={nowPlayingNode.artwork_url} style={{ width: isCompactDesktop ? 32 : 48, height: isCompactDesktop ? 32 : 48, borderRadius: 4, flexShrink: 0 }} alt="artwork" />
            ) : (
              <div style={{ width: isCompactDesktop ? 32 : 48, height: isCompactDesktop ? 32 : 48, borderRadius: 4, background: '#334155', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0, lineHeight: 1 }}>
              <div style={{ fontWeight: 'bold', color: 'white', fontSize: isCompactDesktop ? 11 : 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlayingNode.label || nowPlayingNode.title || nowPlayingNode.name || 'Unknown Track'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: isCompactDesktop ? 9 : 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlayingNode.artist || 'Unknown Artist'}
              </div>
              {!isCompactDesktop && (
                <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                  {nowPlayingNode.genres && <span className="chip" style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 10, fontSize: 10, color: '#cbd5e1', whiteSpace: 'nowrap' }}>{nowPlayingNode.genres}</span>}
                  {nowPlayingNode.bpm && <span className="chip" style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 10, fontSize: 10, color: '#cbd5e1', whiteSpace: 'nowrap' }}>{Math.round(nowPlayingNode.bpm)} BPM</span>}
                  {nowPlayingNode.year && <span className="chip" style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 10, fontSize: 10, color: '#cbd5e1', whiteSpace: 'nowrap' }}>{nowPlayingNode.year}</span>}
                  {nowPlayingNode.danceability != null && <span className="chip" style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 10, fontSize: 10, color: '#cbd5e1', whiteSpace: 'nowrap' }}>💃{Math.round(nowPlayingNode.danceability * 100)}%</span>}
                  {nowPlayingNode.energy != null && <span className="chip" style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 10, fontSize: 10, color: '#cbd5e1', whiteSpace: 'nowrap' }}>⚡{Math.round(nowPlayingNode.energy * 100)}%</span>}
                  {nowPlayingNode.acousticness != null && <span className="chip" style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 10, fontSize: 10, color: '#cbd5e1', whiteSpace: 'nowrap' }}>🎸{Math.round(nowPlayingNode.acousticness * 100)}%</span>}
                </div>
              )}
            </div>
            <span className="soundwave-cluster" aria-hidden="true" style={{ flexShrink: 0, scale: isCompactDesktop ? 0.6 : 1 }}>
              <span></span><span></span><span></span>
            </span>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* DESKTOP NAVIGABLE TARGETS ASIDE — non-small screens only */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {!useCompactMobileLayout && nowPlayingNode && (navigableTargets.length > 0 || navigationHistory.length > 0) && (
        <div
          key={nowPlayingNode.id}
          style={{
            position: 'absolute',
            bottom: isCompactDesktop ? 0 : 12,
            right: isCompactDesktop ? 0 : 12,
            width: isCompactDesktop ? 260 : 280,
            background: isCompactDesktop ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: isCompactDesktop ? 'none' : '1px solid #334155',
            borderRadius: isCompactDesktop ? 0 : 8,
            padding: isCompactDesktop ? '4px 8px' : 12,
            color: '#f8fafc',
            zIndex: 1000,
            maxHeight: isCompactDesktop ? '45vh' : '50vh',
            overflowY: 'auto'
          }}
        >
          {isCompactDesktop ? (
            /* Compact: just prev/next buttons, same height as now-playing bar */
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {navigationHistory.length > 0 && (
                <button
                  onClick={() => {
                    const newHistory = [...navigationHistory];
                    const prevNodeId = newHistory.pop();
                    setNavigationHistory(newHistory);
                    const prevNode = graphData.nodes.find(n => n.id === prevNodeId);
                    if (prevNode) triggerPlayAndFly(prevNode);
                  }}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    padding: '4px 8px', background: 'rgba(245, 158, 11, 0.2)',
                    border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 4,
                    color: '#fbbf24', cursor: 'pointer', fontSize: 11, fontWeight: 600
                  }}
                >
                  ← Back
                </button>
              )}
              {navigableTargets.length > 0 && (
                <button
                  onClick={() => {
                    setNavigationHistory(prev => [...prev, nowPlayingNode.id]);
                    triggerPlayAndFly(navigableTargets[0].node);
                  }}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    padding: '4px 8px', background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: 4,
                    color: '#34d399', cursor: 'pointer', fontSize: 11, fontWeight: 600
                  }}
                >
                  Next →
                </button>
              )}
            </div>
          ) : (
            /* Wide: full track list */
            <>
              <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Similar Tracks</span>
                <span>Use 1-9 or ↑</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {navigableTargets.length > 0 ? navigableTargets.slice(0, 9).map((target, index) => (
                  <div
                    key={target.node.id}
                    onClick={() => {
                      setNavigationHistory(prev => [...prev, nowPlayingNode.id]);
                      triggerPlayAndFly(target.node);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px',
                      background: 'rgba(30, 41, 59, 0.5)', borderRadius: 4,
                      cursor: 'pointer', border: '1px solid transparent',
                      transition: 'border-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = '#7c3aed'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                  >
                    <div style={{
                      width: 20, height: 20, background: '#334155', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 'bold', flexShrink: 0
                    }}>
                      {index + 1}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {target.node.label || target.node.title || target.node.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {target.node.artist || ''}
                      </div>
                    </div>

                    <div style={{ width: 60, flexShrink: 0 }}>
                      <div className="ghost-similarity-bar">
                        <div className="ghost-bar sim" style={{ width: `${Math.max(8, Math.round(target.weight * 100))}%` }} />
                      </div>
                    </div>
                  </div>
                )) : (
                  <div style={{ fontSize: 12, color: '#64748b', padding: '4px 0', textAlign: 'center' }}>
                    No new tracks — use ⬇ to go back
                  </div>
                )}

                {navigationHistory.length > 0 && (
                  <div
                    onClick={() => {
                      const newHistory = [...navigationHistory];
                      const prevNodeId = newHistory.pop();
                      setNavigationHistory(newHistory);
                      const prevNode = graphData.nodes.find(n => n.id === prevNodeId);
                      if (prevNode) triggerPlayAndFly(prevNode);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '8px',
                      background: 'rgba(245, 158, 11, 0.15)',
                      borderRadius: 4, cursor: 'pointer', border: '1px dashed #f59e0b',
                      marginTop: 8, transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.25)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)'}
                  >
                    <div style={{
                      width: 20, height: 20, background: '#f59e0b', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 'bold', color: '#020617', flexShrink: 0
                    }}>
                      ⬇
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#fcd34d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Back to Previous
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(() => {
                          const lastId = navigationHistory[navigationHistory.length - 1];
                          const node = graphData.nodes.find(n => n.id === lastId);
                          return node ? (node.label || node.title) : 'Previous Track';
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* MOBILE BOTTOM SHEET — small screens only */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {useCompactMobileLayout && nowPlayingNode && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2000,
            background: 'rgba(15, 23, 42, 0.97)', backdropFilter: 'blur(12px)',
            border: '1px solid #334155', borderTop: 'none',
            borderRadius: '16px 16px 0 0',
            transition: 'height 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            height: bottomSheetExpanded ? '52vh' : '80px',
            overflow: 'hidden', display: 'flex', flexDirection: 'column'
          }}
        >
          {/* Entire collapsed bar is tappable to expand/collapse */}
          <div
            onClick={() => setBottomSheetExpanded(prev => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px 14px',
              flexShrink: 0,
              minHeight: 80,
              cursor: 'pointer'
            }}
          >
            {/* Drag Handle Pill */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#475569', marginBottom: 0, flexShrink: 0 }} />

            {nowPlayingNode.artwork_url ? (
              <img src={nowPlayingNode.artwork_url} alt="artwork"
                style={{ width: 44, height: 44, borderRadius: 6, flexShrink: 0 }} />
            ) : (
              <div style={{ width: 44, height: 44, borderRadius: 6, background: '#334155', flexShrink: 0 }} />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nowPlayingNode.label || nowPlayingNode.title || 'Unknown Track'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nowPlayingNode.artist || 'Unknown Artist'}
              </div>
            </div>

            {/* Live indicator + Expand chevron */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span className="soundwave-cluster" aria-hidden="true" style={{ scale: 0.8 }}>
                <span></span><span></span><span></span>
              </span>
              <span style={{ color: '#94a3b8', fontSize: 18 }}>
                {bottomSheetExpanded ? '⌄' : '⌃'}
              </span>
            </div>
          </div>

          {/* Expanded Content - Similar Tracks */}
          {bottomSheetExpanded && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', borderTop: '1px solid #334155' }}>
              {/* Metadata Chips */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 0' }}>
                {nowPlayingNode.genres && <span className="chip">{nowPlayingNode.genres}</span>}
                {nowPlayingNode.bpm && <span className="chip">{Math.round(nowPlayingNode.bpm)} BPM</span>}
                {nowPlayingNode.year && <span className="chip">{nowPlayingNode.year}</span>}
                {nowPlayingNode.danceability != null && <span className="chip" title="Danceability">💃 {Math.round(nowPlayingNode.danceability * 100)}%</span>}
                {nowPlayingNode.energy != null && <span className="chip" title="Energy">⚡ {Math.round(nowPlayingNode.energy * 100)}%</span>}
              </div>

              {/* Section Header */}
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Similar Tracks — tap to play
              </div>

              {/* Similar Tracks List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {navigableTargets.slice(0, 9).map((target, index) => (
                  <div
                    key={target.node.id}
                    onClick={() => {
                      setNavigationHistory(prev => [...prev, nowPlayingNode.id]);
                      triggerPlayAndFly(target.node);
                      setBottomSheetExpanded(false);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      background: 'rgba(30, 41, 59, 0.7)', borderRadius: 8, cursor: 'pointer',
                      border: '1px solid transparent', minHeight: 44
                    }}
                  >
                    {/* Number Badge */}
                    <div style={{
                      width: 22, height: 22, background: '#334155', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#94a3b8', flexShrink: 0
                    }}>
                      {index + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {target.node.label || target.node.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {target.node.artist}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#10b981', flexShrink: 0 }}>
                      {Math.round(target.weight * 100)}%
                    </div>
                  </div>
                ))}

                {/* Back to Previous Row */}
                {navigationHistory.length > 0 && (
                  <div
                    onClick={() => {
                      const newHistory = [...navigationHistory];
                      const prevNodeId = newHistory.pop();
                      setNavigationHistory(newHistory);
                      const prevNode = graphData.nodes.find(n => n.id === prevNodeId);
                      if (prevNode) { triggerPlayAndFly(prevNode); setBottomSheetExpanded(false); }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      background: 'rgba(245, 158, 11, 0.15)', borderRadius: 8, cursor: 'pointer',
                      border: '1px dashed #f59e0b', marginTop: 4, minHeight: 44
                    }}
                  >
                    <div style={{ width: 22, height: 22, background: '#f59e0b', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#020617', flexShrink: 0 }}>⬇</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#fcd34d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Back to Previous</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const lastId = navigationHistory[navigationHistory.length - 1];
                          const node = graphData.nodes.find(n => n.id === lastId);
                          return node ? (node.label || node.title) : 'Previous Track';
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Back to Studio link — non-small screens only */}
      {!useCompactMobileLayout && <Link to="/" className="back-to-studio-link">← Back to Studio</Link>}

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
            return 'rgba(16, 185, 129, 0.3)'; // Dimmed green tube so the bright particles pop inside it
          }
          if (selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id)) {
            return '#f59e0b'; // Orange for selected
          }
          return 'rgba(124, 58, 237, 0.6)'; // Purple
        }}
        linkDirectionalParticles={(link) => {
          if (!nowPlayingNode) return 0;
          const sourceId = typeof link.source === "object" ? link.source.id : link.source;
          const targetId = typeof link.target === "object" ? link.target.id : link.target;

          if (sourceId === nowPlayingNode.id || targetId === nowPlayingNode.id) {
            return 2; // Reduced from 4 for a cleaner, heartbeat-like pulse
          }
          return 0;
        }}
        linkDirectionalParticleWidth={1.2} // Thinner, sleeker energy beads
        linkDirectionalParticleSpeed={(link) => {
          if (!nowPlayingNode) return 0;
          const sourceId = typeof link.source === "object" ? link.source.id : link.source;
          const targetId = typeof link.target === "object" ? link.target.id : link.target;

          if (sourceId === nowPlayingNode.id) {
            return 0.006; // Flow forward (outward from source)
          }
          if (targetId === nowPlayingNode.id) {
            return -0.006; // Flow backward (outward from target)
          }
          return 0;
        }}
        linkDirectionalParticleColor={() => '#10b981'} // Force them to match the Neon Emerald node
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

      {/* Rich HTML hover overlay for hovered nodes — non-touch devices only, clamped to viewport */}
      {!useTouchUI && hoveredNode && (
        <div
          className="entity-card hover-preview"
          style={{
            position: "absolute",
            top: tooltipPos.top,
            left: tooltipPos.left,
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