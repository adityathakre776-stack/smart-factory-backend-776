import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DigitalTwinSidebar from "@/components/dashboard/DigitalTwinSidebar";
import KPICards from "@/components/dashboard/KPICards";
import LiveCharts from "@/components/dashboard/LiveCharts";
import AIInsights from "@/components/dashboard/AIInsights";
import HistoricalAnalysis from "@/components/dashboard/HistoricalAnalysis";
import NetworkHealthPanel from "@/components/dashboard/NetworkHealthPanel";
import VapiAgentCall from "@/components/dashboard/VapiAgentCall";
import { Bell, User, Settings, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { normalizeNodeId } from "@/lib/nodeAccess";

type WorkerDashboardProps = {
  forcedNode?: string | null;
};

const WorkerDashboard = ({ forcedNode }: WorkerDashboardProps) => {
  const [isDark, setIsDark] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const { fullName, logout, assignedNode } = useAuth();
  const activeNode = normalizeNodeId(forcedNode || assignedNode || selectedNode || "NODE_01") || "NODE_01";

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") {
      setIsDark(false);
      document.documentElement.classList.remove("dark");
    } else {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (isDark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="h-full px-4 flex items-center justify-between max-w-[1920px] mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold">SF</span>
            </div>
            <span className="text-lg font-bold hidden sm:block">Worker Dashboard</span>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-status-critical text-[10px] font-bold flex items-center justify-center text-white">
                3
              </span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-semibold text-sm">
                    {fullName?.charAt(0)?.toUpperCase() || "W"}
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{fullName || "Worker"}</p>
                  <p className="text-xs text-muted-foreground">Worker</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="flex items-center">
                    <User className="mr-2 w-4 h-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center">
                    <Settings className="mr-2 w-4 h-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  Assigned Node: {activeNode}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={logout}>
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </header>

      <div className="pt-20 px-4 pb-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 max-w-[1920px] mx-auto">
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="hidden lg:block"
          >
            <DigitalTwinSidebar selectedNode={activeNode} onSelectNode={() => {}} />
          </motion.aside>

          <motion.main
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="space-y-6"
          >
            <NetworkHealthPanel forcedNode={activeNode} />
            <KPICards forcedNode={activeNode} />
            <LiveCharts forcedNode={activeNode} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AIInsights />
              <VapiAgentCall />
            </div>
            <HistoricalAnalysis forcedNode={activeNode} />
          </motion.main>
        </div>
      </div>
    </div>
  );
};

export default WorkerDashboard;