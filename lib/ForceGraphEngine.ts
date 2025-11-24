import { GraphNode, GraphLink } from '../types';

interface EngineNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface EngineOptions {
  onNodeClick?: (node: GraphNode) => void;
  width: number;
  height: number;
}

export class ForceGraphEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: Map<string, EngineNode> = new Map();
  private links: { source: string; target: string }[] = [];
  private animationFrameId: number | null = null;
  private options: EngineOptions;
  
  // Physics Constants
  private readonly REPULSION = 800;
  private readonly SPRING_LENGTH = 120;
  private readonly SPRING_STRENGTH = 0.05;
  private readonly DAMPING = 0.85; // Friction
  private readonly CENTER_PULL = 0.0005;
  private readonly MAX_VELOCITY = 15;
  
  // Viewport / Camera State
  private transform = { x: 0, y: 0, k: 1 };
  
  // Interaction State
  private draggedNode: EngineNode | null = null;
  private hoveredNode: EngineNode | null = null;
  private isDraggingNode = false;
  private isPanning = false;
  
  private lastMousePos = { x: 0, y: 0 }; // Screen coords
  private clickStartPos = { x: 0, y: 0 }; // Screen coords for click detection
  private dpr: number = 1;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    this.canvas = canvas;
    this.options = options;
    const context = canvas.getContext('2d', { alpha: false }); // Optimization
    if (!context) throw new Error('Could not get 2D context');
    this.ctx = context;

    this.dpr = window.devicePixelRatio || 1;
    this.setupCanvas();
    this.setupInputHandlers();
    
    // Start loop
    this.animate = this.animate.bind(this);
    this.start();
  }

  private setupCanvas() {
    const { width, height } = this.options;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // We handle scaling in draw() now to combine it with zoom/pan
  }

  public resize(width: number, height: number) {
    this.options.width = width;
    this.options.height = height;
    this.setupCanvas();
  }

  public updateData(nodes: GraphNode[], links: GraphLink[]) {
    // Merge new nodes while preserving physics state of existing ones
    const newNodesMap = new Map<string, EngineNode>();

    nodes.forEach(rawNode => {
      const existing = this.nodes.get(rawNode.id);
      const radius = 15 + (rawNode.weight * 3); // Weight to Size mapping

      if (existing) {
        newNodesMap.set(rawNode.id, { 
          ...existing, 
          weight: rawNode.weight,
          radius 
        });
      } else {
        // Initialize new node
        newNodesMap.set(rawNode.id, {
          ...rawNode,
          x: rawNode.x ?? this.options.width / 2 + (Math.random() - 0.5) * 50,
          y: rawNode.y ?? this.options.height / 2 + (Math.random() - 0.5) * 50,
          vx: 0,
          vy: 0,
          radius,
          color: this.generateColor(rawNode.weight)
        });
      }
    });

    this.nodes = newNodesMap;
    this.links = links;
  }

  private generateColor(weight: number): string {
    // Generate a pleasing color based on weight
    const hue = 200 + (weight * 10) % 60; // Blues and Purples
    const sat = 70 + (weight * 2) % 30;
    const light = 50 + (weight * 2) % 20;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  // --- Coordinate Systems ---
  // Screen: Pixels on the DOM element
  // World: The virtual physics coordinate space

  private screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.transform.x) / this.transform.k,
      y: (sy - this.transform.y) / this.transform.k
    };
  }

  private setupInputHandlers() {
    const getScreenPos = (e: MouseEvent | TouchEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pos = getScreenPos(e);
      const worldBefore = this.screenToWorld(pos.x, pos.y);
      
      const zoomIntensity = 0.1;
      const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
      const newK = Math.max(0.1, Math.min(5, this.transform.k * (1 + delta))); // Clamp zoom 0.1x to 5x

      // Adjust translation so the point under mouse remains stationary
      // screen = world * k + t  =>  t = screen - world * k
      this.transform.x = pos.x - worldBefore.x * newK;
      this.transform.y = pos.y - worldBefore.y * newK;
      this.transform.k = newK;
    };

    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const screenPos = getScreenPos(e);
      const worldPos = this.screenToWorld(screenPos.x, screenPos.y);
      
      this.clickStartPos = { ...screenPos };
      this.lastMousePos = { ...screenPos };
      
      const node = this.getNodeAt(worldPos.x, worldPos.y);
      
      if (node) {
        this.draggedNode = node;
        this.isDraggingNode = true;
        this.canvas.style.cursor = 'grabbing';
      } else {
        this.isPanning = true;
        this.canvas.style.cursor = 'move';
      }
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const screenPos = getScreenPos(e);
      
      if (this.isDraggingNode && this.draggedNode) {
        // Dragging a node (Move it in world space)
        const worldPos = this.screenToWorld(screenPos.x, screenPos.y);
        this.draggedNode.x = worldPos.x;
        this.draggedNode.y = worldPos.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
      } 
      else if (this.isPanning) {
        // Panning the canvas
        const dx = screenPos.x - this.lastMousePos.x;
        const dy = screenPos.y - this.lastMousePos.y;
        this.transform.x += dx;
        this.transform.y += dy;
      } 
      else {
        // Just Hovering
        const worldPos = this.screenToWorld(screenPos.x, screenPos.y);
        const node = this.getNodeAt(worldPos.x, worldPos.y);
        if (node !== this.hoveredNode) {
          this.hoveredNode = node || null;
          this.canvas.style.cursor = node ? 'grab' : 'default';
        }
      }

      this.lastMousePos = { ...screenPos };
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      // Check for click
      if (this.isDraggingNode && this.draggedNode) {
         // It was a node interaction
         // We check distance from initial click to see if it was a "click" or a "drag"
         // Logic handled via window listener below is safer for drag release
      }
      // State reset handled by window listener
    };

    // Binding proper listeners
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    
    // Global release to catch drags that go outside canvas
    window.addEventListener('mouseup', (e) => {
      const screenPos = getScreenPos(e);
      // Calculate distance moved in Screen Pixels
      const dist = Math.sqrt(Math.pow(screenPos.x - this.clickStartPos.x, 2) + Math.pow(screenPos.y - this.clickStartPos.y, 2));
      
      if (this.isDraggingNode && this.draggedNode && dist < 5) {
         this.options.onNodeClick?.(this.draggedNode);
      }

      this.isDraggingNode = false;
      this.draggedNode = null;
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
    });

    // Touch support
    this.canvas.addEventListener('touchstart', onDown, { passive: false });
    this.canvas.addEventListener('touchmove', onMove, { passive: false });
    this.canvas.addEventListener('touchend', () => {
       this.isDraggingNode = false;
       this.draggedNode = null;
       this.isPanning = false;
    });
  }

  private getNodeAt(worldX: number, worldY: number): EngineNode | undefined {
    // Iterate in reverse to catch top-most nodes first
    for (const node of Array.from(this.nodes.values()).reverse()) {
      const dx = worldX - node.x;
      const dy = worldY - node.y;
      if (dx * dx + dy * dy <= node.radius * node.radius) {
        return node;
      }
    }
    return undefined;
  }

  private calculateForces() {
    const nodeList = Array.from(this.nodes.values());
    // Gravity center pulls towards the logical center of the screen space (untransformed)
    // allowing the graph to center itself naturally, even if we pan away.
    const centerX = this.options.width / 2;
    const centerY = this.options.height / 2;

    for (let i = 0; i < nodeList.length; i++) {
      const node = nodeList[i];
      if (node === this.draggedNode) continue;

      let fx = 0;
      let fy = 0;

      // 1. Center Gravity (Weak pull to center of the UNIVERSE)
      fx += (centerX - node.x) * this.CENTER_PULL;
      fy += (centerY - node.y) * this.CENTER_PULL;

      // 2. Repulsion (between all nodes)
      for (let j = 0; j < nodeList.length; j++) {
        if (i === j) continue;
        const other = nodeList[j];
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        let distSq = dx * dx + dy * dy;
        
        // Prevent division by zero / extreme forces
        if (distSq === 0) {
            distSq = 0.1; 
            fx += Math.random(); 
            fy += Math.random();
        }

        const dist = Math.sqrt(distSq);
        const force = this.REPULSION * (node.weight + other.weight) * 0.5 / distSq;
        
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      node.vx += fx;
      node.vy += fy;
    }

    // 3. Attraction (Springs along links)
    this.links.forEach(link => {
      const source = this.nodes.get(link.source);
      const target = this.nodes.get(link.target);
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // Safety check: Prevent division by zero if nodes are perfectly overlapping
      if (dist === 0) return;

      // Hooke's Law
      // Force = k * (currentLength - restingLength)
      const force = (dist - this.SPRING_LENGTH) * this.SPRING_STRENGTH;
      
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (source !== this.draggedNode) {
        source.vx += fx;
        source.vy += fy;
      }
      if (target !== this.draggedNode) {
        target.vx -= fx;
        target.vy -= fy;
      }
    });
  }

  private resolveCollisions() {
    // Hard collision resolution: Nodes must not overlap
    const nodes = Array.from(this.nodes.values());
    const iterations = 2; // Run a few times for stability

    for (let k = 0; k < iterations; k++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx*dx + dy*dy;
          const minDist = n1.radius + n2.radius + 2; // +2 padding

          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            // If perfectly overlapping, normalize random vector
            const tx = dist === 0 ? Math.random() : dx / dist;
            const ty = dist === 0 ? Math.random() : dy / dist;
            
            const overlap = minDist - dist;
            const separationFactor = 0.5; // Split the move between both

            // Move apart
            if (n1 !== this.draggedNode) {
              n1.x -= tx * overlap * separationFactor;
              n1.y -= ty * overlap * separationFactor;
            }
            if (n2 !== this.draggedNode) {
              n2.x += tx * overlap * separationFactor;
              n2.y += ty * overlap * separationFactor;
            }
          }
        }
      }
    }
  }

  private integrate() {
    this.calculateForces();
    
    // Update positions
    this.nodes.forEach(node => {
      if (node === this.draggedNode) return;

      // Limit Velocity
      const vMag = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (vMag > this.MAX_VELOCITY) {
        node.vx = (node.vx / vMag) * this.MAX_VELOCITY;
        node.vy = (node.vy / vMag) * this.MAX_VELOCITY;
      }

      node.x += node.vx;
      node.y += node.vy;

      // Damping
      node.vx *= this.DAMPING;
      node.vy *= this.DAMPING;

      // REMOVED Wall boundaries to allow infinite canvas
    });

    this.resolveCollisions();
  }

  private draw() {
    const { width, height } = this.options;
    
    // 1. Clear Screen (Screen Space)
    this.ctx.resetTransform();
    this.ctx.scale(this.dpr, this.dpr); // Restore default DPR scaling for clear
    this.ctx.fillStyle = '#0f172a'; 
    this.ctx.fillRect(0, 0, width, height);

    // 2. Apply Camera Transform (Pan/Zoom)
    // Note: We already scaled by DPR. Now we accumulate the camera transform.
    // The sequence is: Translate (Pan) -> Scale (Zoom)
    this.ctx.translate(this.transform.x, this.transform.y);
    this.ctx.scale(this.transform.k, this.transform.k);

    // --- Draw World Content ---

    // Links
    this.ctx.lineWidth = 1.5; 
    // Optimization: Don't let lines get too thin or too thick when zooming?
    // For now, let them scale naturally.
    
    this.links.forEach(link => {
      const source = this.nodes.get(link.source);
      const target = this.nodes.get(link.target);
      if (source && target) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'; // slate-400, low opacity
        this.ctx.moveTo(source.x, source.y);
        this.ctx.lineTo(target.x, target.y);
        this.ctx.stroke();
      }
    });

    // Nodes
    this.nodes.forEach(node => {
      // Glow/Shadow (Scale independent approx)
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = node.color || '#fff';
      
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = node.color || '#3b82f6';
      this.ctx.fill();

      // Border
      this.ctx.shadowBlur = 0;
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = '#1e293b'; 
      this.ctx.stroke();

      // Label (Weight) - Only draw if large enough on screen
      // Screen Radius = World Radius * Scale
      const screenRadius = node.radius * this.transform.k;
      
      if (screenRadius > 10) {
        this.ctx.fillStyle = 'white';
        // Keep font size consistent-ish in world space, or consistent in screen space?
        // Let's keep it readable: Scale the font inverse to zoom?
        // Or just let it scale. Let's let it scale but clamp minimums.
        this.ctx.font = '10px sans-serif'; 
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(node.weight.toString(), node.x, node.y);
      }
      
      // Highlight hovered
      if (node === this.hoveredNode) {
         this.ctx.strokeStyle = 'white';
         this.ctx.lineWidth = 2; // This will scale with zoom
         this.ctx.stroke();
      }
    });
  }

  private animate() {
    this.integrate();
    this.draw();
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  public start() {
    if (!this.animationFrameId) {
      this.animate();
    }
  }

  public stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
