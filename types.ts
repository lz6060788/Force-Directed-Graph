export interface GraphNode {
  id: string;
  weight: number; // Determines radius
  x?: number;     // Current X position
  y?: number;     // Current Y position
  vx?: number;    // Velocity X
  vy?: number;    // Velocity Y
  color?: string; // Node color
}

export interface GraphLink {
  source: string; // ID of source node
  target: string; // ID of target node
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}