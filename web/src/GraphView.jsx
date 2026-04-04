import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";

// Simple force-directed layout for initial positioning
function computeForceLayout(nodes, links, iterations = 300) {
  const nodeMap = new Map();
  const width = 800;
  const height = 600;

  // Initialize positions randomly in a circle
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const radius = 200 + Math.random() * 100;
    nodeMap.set(node.id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      ...node
    });
  });

  const k = Math.sqrt((width * height) / nodes.length) * 0.8;

  for (let iter = 0; iter < iterations; iter++) {
    const temperature = 2 * (1 - iter / iterations);

    // Repulsive forces between all pairs
    for (const [idA, nodeA] of nodeMap) {
      nodeA.vx = 0;
      nodeA.vy = 0;
      for (const [idB, nodeB] of nodeMap) {
        if (idA === idB) continue;
        let dx = nodeA.x - nodeB.x;
        let dy = nodeA.y - nodeB.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = (k * k) / dist;
        nodeA.vx += (dx / dist) * force;
        nodeA.vy += (dy / dist) * force;
      }
    }

    // Attractive forces along edges
    for (const link of links) {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target) continue;
      let dx = target.x - source.x;
      let dy = target.y - source.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let force = (dist * dist) / k * (link.weight || 0.5);
      source.vx += (dx / dist) * force;
      source.vy += (dy / dist) * force;
      target.vx -= (dx / dist) * force;
      target.vy -= (dy / dist) * force;
    }

    // Apply forces with temperature limit
    for (const [, node] of nodeMap) {
      let len = Math.sqrt(node.vx * node.vx + node.vy * node.vy) || 1;
      let move = Math.min(len, temperature) / len;
      node.x += node.vx * move;
      node.y += node.vy * move;
    }
  }

  return nodeMap;
}

function entityColor(kind, alpha = 1.0) {
  const colors = {
    track: { r: 0.659, g: 0.333, b: 0.969 },  // #a855f7 (brighter purple)
    artist: { r: 0.055, g: 0.647, b: 0.914 }, // #0ea5e9
    album: { r: 0.961, g: 0.620, b: 0.043 },  // #f59e0b
    genre: { r: 0.133, g: 0.773, b: 0.369 }   // #22c55e
  };
  const c = colors[kind] || { r: 0.58, g: 0.639, b: 0.722 };
  return { r: c.r, g: c.g, b: c.b, a: alpha };
}

function createTextTexture(text, color = "#ffffff", fontSize = 24, maxWidth = 200) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = maxWidth;
  canvas.height = fontSize * 2;

  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Truncate text if too long
  let displayText = text || "";
  if (ctx.measureText(displayText).width > maxWidth - 20) {
    while (ctx.measureText(displayText + "...").width > maxWidth - 20 && displayText.length > 0) {
      displayText = displayText.slice(0, -1);
    }
    displayText += "...";
  }

  ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);
  return canvas;
}

function createNodeSprite(node, position, scale = 1.0) {
  const group = new THREE.Group();
  const color = entityColor(node.kind || "track");

  // Main sphere
  const radius = 8 * scale;
  const geometry = new THREE.SphereGeometry(radius, 16, 16);
  const material = new THREE.MeshPhongMaterial({
    color: new THREE.Color(color.r, color.g, color.b),
    emissive: new THREE.Color(color.r * 0.3, color.g * 0.3, color.b * 0.3),
    transparent: true,
    opacity: 0.9,
  });
  const sphere = new THREE.Mesh(geometry, material);
  group.add(sphere);

  // Glow effect
  const glowGeometry = new THREE.SphereGeometry(radius * 1.4, 16, 16);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color.r, color.g, color.b),
    transparent: true,
    opacity: 0.15,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  group.add(glow);

  // Label
  const labelCanvas = createTextTexture(node.title || node.id, "#e2e8f0", 20, 180);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, transparent: true });
  const labelSprite = new THREE.Sprite(labelMaterial);
  labelSprite.scale.set(60 * scale, 20 * scale, 1);
  labelSprite.position.set(0, -radius - 15, 0);
  group.add(labelSprite);

  // Artist subtitle
  if (node.artist) {
    const artistCanvas = createTextTexture(node.artist, "#94a3b8", 16, 180);
    const artistTexture = new THREE.CanvasTexture(artistCanvas);
    const artistMaterial = new THREE.SpriteMaterial({ map: artistTexture, transparent: true, opacity: 0.7 });
    const artistSprite = new THREE.Sprite(artistMaterial);
    artistSprite.scale.set(50 * scale, 16 * scale, 1);
    artistSprite.position.set(0, -radius - 30, 0);
    group.add(artistSprite);
  }

  group.position.set(position.x, position.y, 0);
  group.userData = { nodeId: node.id, node };

  return group;
}

function createLinkLine(sourcePos, targetPos, weight = 0.5) {
  const points = [
    new THREE.Vector3(sourcePos.x, sourcePos.y, 0),
    new THREE.Vector3(targetPos.x, targetPos.y, 0)
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(0.4, 0.4, 0.5),
    transparent: true,
    opacity: Math.max(0.1, weight * 0.6),
  });
  return new THREE.Line(geometry, material);
}

function WebGLGraphView({ graphData, onNodeClick, selectedNodeId }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const composerRef = useRef(null);
  const nodeSpritesRef = useRef(new Map());
  const linkLinesRef = useRef([]);
  const lastInteractionRef = useRef(Date.now());
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const animationFrameRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const initScene = useCallback(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      1,
      5000
    );
    camera.position.set(0, 0, 800);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Post-processing: EffectComposer with Bloom
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(containerRef.current.clientWidth, containerRef.current.clientHeight),
      1.5,   // strength
      0.4,   // radius
      0.85   // threshold
    );
    composer.addPass(bloomPass);
    composerRef.current = composer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 1.2;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(200, 200, 400);
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xa855f7, 0.5, 1000);
    pointLight.position.set(-200, -200, 200);
    scene.add(pointLight);

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      bloomPass.resolution.set(width, height);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  const renderGraph = useCallback(() => {
    if (!sceneRef.current || !graphData) return;

    const scene = sceneRef.current;
    const { nodes, links } = graphData;

    // Clear existing objects
    nodeSpritesRef.current.forEach((group) => scene.remove(group));
    nodeSpritesRef.current.clear();
    linkLinesRef.current.forEach((line) => scene.remove(line));
    linkLinesRef.current = [];

    if (nodes.length === 0) {
      setIsLoading(false);
      return;
    }

    // Compute layout
    const layout = computeForceLayout(nodes, links, 400);

    // Create link lines (initially hidden, shown on hover)
    links.forEach((link) => {
      const sourcePos = layout.get(link.source);
      const targetPos = layout.get(link.target);
      if (sourcePos && targetPos) {
        const line = createLinkLine(sourcePos, targetPos, link.weight);
        line.visible = false; // Hidden by default
        line.userData = { source: link.source, target: link.target };
        scene.add(line);
        linkLinesRef.current.push(line);
      }
    });

    // Create node sprites
    nodes.forEach((node) => {
      const pos = layout.get(node.id);
      if (!pos) return;

      const isHighlighted = selectedNodeId === node.id;
      const scale = isHighlighted ? 1.5 : 1.0;
      const sprite = createNodeSprite(node, pos, scale);
      scene.add(sprite);
      nodeSpritesRef.current.set(node.id, sprite);
    });

    setIsLoading(false);
  }, [graphData, selectedNodeId]);

  const animate = useCallback(() => {
    animationFrameRef.current = requestAnimationFrame(animate);
    const now = Date.now();
    const isIdle = now - lastInteractionRef.current > 3000;

    if (controlsRef.current) {
      controlsRef.current.update();
    }

    // Slow auto-rotation when idle
    if (isIdle && sceneRef.current && cameraRef.current) {
      const orbitSpeed = 0.0003; // radians per millisecond
      const orbitRadius = 800;
      const time = now * orbitSpeed;
      cameraRef.current.position.x = Math.sin(time) * orbitRadius;
      cameraRef.current.position.z = Math.cos(time) * orbitRadius;
      cameraRef.current.position.y = Math.sin(time * 0.5) * 200;
      cameraRef.current.lookAt(sceneRef.current.position);
    }

    if (rendererRef.current && sceneRef.current && cameraRef.current && composerRef.current) {
      composerRef.current.render();
    } else if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, []);

  const handleClick = useCallback((event) => {
    lastInteractionRef.current = Date.now();
    if (!containerRef.current || !cameraRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    // Collect all meshes from node sprites
    const meshes = [];
    nodeSpritesRef.current.forEach((group) => {
      group.traverse((child) => {
        if (child.isMesh) {
          meshes.push(child);
        }
      });
    });

    const intersects = raycasterRef.current.intersectObjects(meshes);
    if (intersects.length > 0) {
      let parent = intersects[0].object.parent;
      while (parent && !parent.userData.nodeId) {
        parent = parent.parent;
      }
      if (parent && parent.userData.node) {
        onNodeClick?.(parent.userData.node);
      }
    }
  }, [onNodeClick]);

  const handleMouseMove = useCallback((event) => {
    lastInteractionRef.current = Date.now();
    if (!containerRef.current || !cameraRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    const meshes = [];
    nodeSpritesRef.current.forEach((group) => {
      group.traverse((child) => {
        if (child.isMesh) {
          meshes.push(child);
        }
      });
    });

    const intersects = raycasterRef.current.intersectObjects(meshes);
    if (intersects.length > 0) {
      let parent = intersects[0].object.parent;
      while (parent && !parent.userData.nodeId) {
        parent = parent.parent;
      }
      if (parent && parent.userData.node) {
        setHoveredNode(parent.userData.node);
        containerRef.current.style.cursor = "pointer";
        return;
      }
    }
    setHoveredNode(null);
    containerRef.current.style.cursor = "grab";
  }, []);

  useEffect(() => {
    const cleanup = initScene();
    return cleanup;
  }, [initScene]);

  useEffect(() => {
    renderGraph();
  }, [renderGraph]);

  useEffect(() => {
    animate();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animate]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.addEventListener("click", handleClick);
      containerRef.current.addEventListener("mousemove", handleMouseMove);
    }
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener("click", handleClick);
        containerRef.current.removeEventListener("mousemove", handleMouseMove);
      }
    };
  }, [handleClick, handleMouseMove]);

  // Update selected node highlight
  useEffect(() => {
    nodeSpritesRef.current.forEach((group, nodeId) => {
      const isSelected = nodeId === selectedNodeId;
      const scale = isSelected ? 1.5 : 1.0;
      group.scale.setScalar(scale);
    });
  }, [selectedNodeId]);

  // Update link visibility based on hovered node
  useEffect(() => {
    linkLinesRef.current.forEach((line) => {
      if (!hoveredNode) {
        line.visible = false;
      } else {
        const isConnected =
          line.userData.source === hoveredNode.id ||
          line.userData.target === hoveredNode.id;
        line.visible = isConnected;
        if (isConnected) {
          line.material.opacity = 0.8;
          line.material.color.set(0xa855f7);
        }
      }
    });
  }, [hoveredNode]);

  return (
    <div className="graph-view-container">
      {isLoading && (
        <div className="graph-loading-overlay">
          <div className="graph-loading-spinner">
            <div className="spinner-ring" />
            <div className="spinner-ring" />
            <div className="spinner-ring" />
          </div>
          <p>Computing graph layout...</p>
        </div>
      )}
      {hoveredNode && (
        <div className="graph-tooltip">
          <strong>{hoveredNode.title}</strong>
          {hoveredNode.artist && <span>{hoveredNode.artist}</span>}
          {hoveredNode.bpm && <span>BPM: {hoveredNode.bpm}</span>}
          {hoveredNode.genre && <span>Genre: {hoveredNode.genre}</span>}
        </div>
      )}
      <div ref={containerRef} className="graph-canvas-container" />
    </div>
  );
}

export default WebGLGraphView;