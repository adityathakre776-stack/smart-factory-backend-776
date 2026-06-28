import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Thermometer, X, Activity, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import API from "@/api/api";

interface Node {
  id: string;
  name: string;
  x: number;
  y: number;
  status: "normal" | "warning" | "critical" | "offline";
  zone: string;
  lastSeen: string;
  voltage: number;
  temperature: number;
  vibration: number;
}

const statusColors = {
  normal: "bg-status-normal",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  offline: "bg-status-offline",
};

const statusGlow = {
  normal: "shadow-[0_0_12px_hsl(var(--status-normal)/0.6)]",
  warning: "shadow-[0_0_12px_hsl(var(--status-warning)/0.6)] animate-pulse",
  critical: "shadow-[0_0_12px_hsl(var(--status-critical)/0.6)] animate-pulse",
  offline: "",
};

interface DigitalTwinSidebarProps {
  selectedNode: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

const DigitalTwinSidebar = ({ selectedNode, onSelectNode }: DigitalTwinSidebarProps) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);

  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const res = await API.get("/nodes");
        setNodes(res.data);
      } catch (err) {
        console.error("Failed to fetch nodes:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchNodes();

    const interval = setInterval(fetchNodes, 15000);
    return () => clearInterval(interval);
  }, []);

  const selected = nodes.find((n) => n.id === selectedNode);

  if (loading) {
    return (
      <div className="space-y-4 sticky top-20">
        <div className="glass-card p-6 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-muted-foreground">Loading digital twin...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sticky top-20">
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Digital Twin</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Heatmap</span>
            <Switch checked={showHeatmap} onCheckedChange={setShowHeatmap} />
          </div>
        </div>

        <div className="relative aspect-square bg-muted/30 rounded-lg overflow-hidden">
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
            <defs>
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="hsl(var(--border))" strokeWidth="0.3" />
              </pattern>
            </defs>
            <rect width="100" height="100" fill="url(#grid)" />

            <rect x="5" y="5" width="40" height="35" rx="2" fill="hsl(var(--neon-cyan) / 0.05)" stroke="hsl(var(--neon-cyan) / 0.2)" strokeWidth="0.5" />
            <rect x="50" y="5" width="45" height="35" rx="2" fill="hsl(var(--accent) / 0.05)" stroke="hsl(var(--accent) / 0.2)" strokeWidth="0.5" />
            <rect x="5" y="45" width="90" height="20" rx="2" fill="hsl(var(--primary) / 0.05)" stroke="hsl(var(--primary) / 0.2)" strokeWidth="0.5" />
            <rect x="5" y="70" width="90" height="25" rx="2" fill="hsl(var(--status-normal) / 0.05)" stroke="hsl(var(--status-normal) / 0.2)" strokeWidth="0.5" />

            {showHeatmap && (
              <>
                <defs>
                  <radialGradient id="heat-critical">
                    <stop offset="0%" stopColor="hsl(var(--status-critical))" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="hsl(var(--status-critical))" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="heat-warning">
                    <stop offset="0%" stopColor="hsl(var(--status-warning))" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="hsl(var(--status-warning))" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {nodes
                  .filter((n) => n.status === "critical" || n.status === "warning")
                  .map((node) => (
                    <circle
                      key={node.id}
                      cx={node.x}
                      cy={node.y}
                      r={node.status === "critical" ? 15 : 12}
                      fill={node.status === "critical" ? "url(#heat-critical)" : "url(#heat-warning)"}
                    />
                  ))}
              </>
            )}
          </svg>

          {nodes.map((node) => (
            <motion.button
              key={node.id}
              whileHover={{ scale: 1.3 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => onSelectNode(selectedNode === node.id ? null : node.id)}
              className={`absolute w-3 h-3 rounded-full ${statusColors[node.status]} ${statusGlow[node.status]} 
                ${selectedNode === node.id ? 'ring-2 ring-white ring-offset-2 ring-offset-background' : ''}
                cursor-pointer transition-all z-10`}
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: "translate(-50%, -50%)",
              }}
              title={`${node.name} - ${node.status}`}
            />
          ))}
        </div>

        <div className="flex items-center justify-center gap-4 mt-4 text-xs">
          {Object.entries(statusColors).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${color}`} />
              <span className="capitalize text-muted-foreground">{status}</span>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="glass-card p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${statusColors[selected.status]}`} />
                <h4 className="font-semibold">{selected.name}</h4>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onSelectNode(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="w-4 h-4" />
                <span>{selected.zone}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Last seen: {selected.lastSeen}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="text-center p-2 rounded bg-muted/50">
                  <Zap className="w-4 h-4 mx-auto text-neon-cyan mb-1" />
                  <div className="font-semibold">{selected.voltage}V</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/50">
                  <Thermometer className="w-4 h-4 mx-auto text-primary mb-1" />
                  <div className="font-semibold">{selected.temperature}°C</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/50">
                  <Activity className="w-4 h-4 mx-auto text-accent mb-1" />
                  <div className="font-semibold">{selected.vibration}g</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glass-card p-4">
        <h3 className="font-semibold mb-3">Node Summary</h3>
        <div className="space-y-2">
          {[
            { status: "normal", count: nodes.filter((n) => n.status === "normal").length },
            { status: "warning", count: nodes.filter((n) => n.status === "warning").length },
            { status: "critical", count: nodes.filter((n) => n.status === "critical").length },
            { status: "offline", count: nodes.filter((n) => n.status === "offline").length },
          ].map(({ status, count }) => (
            <div key={status} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${statusColors[status as keyof typeof statusColors]}`} />
                <span className="text-sm capitalize text-muted-foreground">{status}</span>
              </div>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DigitalTwinSidebar;