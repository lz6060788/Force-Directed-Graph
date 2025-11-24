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
  
  // Interaction State
  private draggedNode: EngineNode | null = null;
  private hoveredNode: EngineNode | null = null;
  private isDragging = false;
  private lastMousePos = { x: 0, y: 0 };
  private clickStartPos = { x: 0, y: 0 };
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
    this.ctx.scale(this.dpr, this.dpr);
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

  private setupInputHandlers() {
    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const pos = getPos(e);
      this.clickStartPos = { ...pos };
      
      const node = this.getNodeAt(pos.x, pos.y);
      if (node) {
        this.draggedNode = node;
        this.isDragging = true;
        this.lastMousePos = pos;
        this.canvas.style.cursor = 'grabbing';
      }
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const pos = getPos(e);

      if (this.isDragging && this.draggedNode) {
        // Manual position update during drag
        this.draggedNode.x = pos.x;
        this.draggedNode.y = pos.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
      } else {
        // Hover effect
        const node = this.getNodeAt(pos.x, pos.y);
        if (node !== this.hoveredNode) {
          this.hoveredNode = node || null;
          this.canvas.style.cursor = node ? 'grab' : 'default';
        }
      }
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      // Logic handled via window listener below
    };

    // Binding proper listeners
    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', (e) => {
      const pos = getPos(e);
      const dist = Math.sqrt(Math.pow(pos.x - this.clickStartPos.x, 2) + Math.pow(pos.y - this.clickStartPos.y, 2));
      
      if (this.draggedNode && dist < 5) {
         this.options.onNodeClick?.(this.draggedNode);
      }

      this.isDragging = false;
      this.draggedNode = null;
      this.canvas.style.cursor = 'default';
    });

    this.canvas.addEventListener('touchstart', onDown, { passive: false });
    this.canvas.addEventListener('touchmove', onMove, { passive: false });
    this.canvas.addEventListener('touchend', () => {
       this.isDragging = false;
       this.draggedNode = null;
    });
  }

  private getNodeAt(x: number, y: number): EngineNode | undefined {
    // Iterate in reverse to catch top-most nodes first
    for (const node of Array.from(this.nodes.values()).reverse()) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy <= node.radius * node.radius) {
        return node;
      }
    }
    return undefined;
  }

  private calculateForces() {
    const nodeList = Array.from(this.nodes.values());
    const width = this.options.width;
    const height = this.options.height;
    const centerX = width / 2;
    const centerY = height / 2;

    for (let i = 0; i < nodeList.length; i++) {
      const node = nodeList[i];
      if (node === this.draggedNode) continue;

      let fx = 0;
      let fy = 0;

      // 1. Center Gravity (Weak pull to center)
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

      // Wall boundaries (soft bounce)
      const padding = node.radius;
      if (node.x < padding) { node.x = padding; node.vx *= -0.5; }
      if (node.x > this.options.width - padding) { node.x = this.options.width - padding; node.vx *= -0.5; }
      if (node.y < padding) { node.y = padding; node.vy *= -0.5; }
      if (node.y > this.options.height - padding) { node.y = this.options.height - padding; node.vy *= -0.5; }
    });

    this.resolveCollisions();
  }

  private draw() {
    const { width, height } = this.options;
    
    // Background
    this.ctx.fillStyle = '#0f172a'; // Match Tailwind slate-900
    this.ctx.fillRect(0, 0, width, height);

    // Links
    this.ctx.lineWidth = 1.5;
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
      // Glow/Shadow
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = node.color || '#fff';
      
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = node.color || '#3b82f6';
      this.ctx.fill();

      // Border for contrast
      this.ctx.shadowBlur = 0;
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = '#1e293b'; // slate-800
      this.ctx.stroke();

      // Label (Weight)
      this.ctx.fillStyle = 'white';
      this.ctx.font = '10px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      if (node.radius > 15) {
         this.ctx.fillText(node.weight.toString(), node.x, node.y);
      }
      
      // Highlight hovered
      if (node === this.hoveredNode) {
         this.ctx.strokeStyle = 'white';
         this.ctx.lineWidth = 2;
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