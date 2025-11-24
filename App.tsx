import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ForceGraphEngine } from './lib/ForceGraphEngine';
import { GraphData, GraphNode, GraphLink } from './types';
import { Circle, Info, MousePointer2 } from 'lucide-react';

const INITIAL_DATA: GraphData = {
  nodes: [
    { id: '1', weight: 5 },
    { id: '2', weight: 8 },
    { id: '3', weight: 3 },
  ],
  links: [
    { source: '1', target: '2' },
    { source: '2', target: '3' },
  ]
};

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ForceGraphEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GraphData>(INITIAL_DATA);
  const [nodeCount, setNodeCount] = useState(INITIAL_DATA.nodes.length);

  // Callback when a node is clicked in the engine
  const handleNodeClick = useCallback((clickedNode: GraphNode) => {
    setData(prevData => {
      const newNodeId = (prevData.nodes.length + 1).toString() + '-' + Date.now();
      const newWeight = Math.floor(Math.random() * 8) + 2; // Random weight 2-10

      const newNode: GraphNode = {
        id: newNodeId,
        weight: newWeight,
        // Spawn near parent but with a small random offset to prevent physics NaN errors
        // (dividing by zero distance) and to visually pop out.
        x: (clickedNode.x ?? 0) + (Math.random() - 0.5) * 20, 
        y: (clickedNode.y ?? 0) + (Math.random() - 0.5) * 20
      };

      const newLink: GraphLink = {
        source: clickedNode.id,
        target: newNodeId
      };

      return {
        nodes: [...prevData.nodes, newNode],
        links: [...prevData.links, newLink]
      };
    });
  }, []);

  // Initialize Engine
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const { clientWidth, clientHeight } = containerRef.current;

    const engine = new ForceGraphEngine(canvasRef.current, {
      width: clientWidth,
      height: clientHeight,
      onNodeClick: handleNodeClick
    });

    engineRef.current = engine;

    const handleResize = () => {
      if (containerRef.current && engineRef.current) {
         engineRef.current.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.stop();
    };
  }, [handleNodeClick]);

  // Sync Data with Engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateData(data.nodes, data.links);
      setNodeCount(data.nodes.length);
    }
  }, [data]);

  const handleReset = () => {
    setData(INITIAL_DATA);
  };

  return (
    <div className="relative w-full h-screen bg-slate-900 overflow-hidden font-sans">
      
      {/* Header / UI Overlay */}
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <h1 className="text-3xl font-bold text-slate-100 tracking-tight drop-shadow-md">
          Force<span className="text-blue-500">Graph</span>
        </h1>
        <p className="text-slate-400 text-sm mt-1 max-w-xs">
          Interactive Canvas Engine • No Framework Dependencies
        </p>
      </div>

      <div className="absolute top-6 right-6 z-10 flex flex-col gap-4">
        <div className="bg-slate-800/80 backdrop-blur-md p-4 rounded-xl border border-slate-700 shadow-xl max-w-xs transition-all hover:bg-slate-800/90">
          <div className="flex items-center gap-2 mb-3 text-slate-200">
             <Info size={18} className="text-blue-400" />
             <span className="font-semibold text-sm">Instructions</span>
          </div>
          <ul className="space-y-2 text-xs text-slate-400">
            <li className="flex items-start gap-2">
              <MousePointer2 size={14} className="mt-0.5 shrink-0" />
              <span><strong>Drag</strong> nodes to reposition them physics-free.</span>
            </li>
            <li className="flex items-start gap-2">
              <Circle size={14} className="mt-0.5 shrink-0" />
              <span><strong>Click</strong> a node to spawn a connected neighbor.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="block w-3.5 h-3.5 mt-0.5 rounded-full bg-blue-500/50 border border-blue-400 shrink-0"></span>
              <span><strong>Size</strong> represents node weight.</span>
            </li>
          </ul>
        </div>

        <div className="bg-slate-800/80 backdrop-blur-md p-4 rounded-xl border border-slate-700 shadow-xl text-center">
           <div className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Total Nodes</div>
           <div className="text-3xl font-mono text-white">{nodeCount}</div>
        </div>
        
        <button 
          onClick={handleReset}
          className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/50 px-4 py-2 rounded-lg text-sm font-medium transition-colors backdrop-blur-sm"
        >
          Reset Graph
        </button>
      </div>

      {/* Canvas Container */}
      <div ref={containerRef} className="w-full h-full cursor-default">
        <canvas ref={canvasRef} className="block outline-none" />
      </div>

    </div>
  );
};

export default App;