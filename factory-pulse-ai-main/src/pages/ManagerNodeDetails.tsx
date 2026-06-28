import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Bell, User, Settings, Users, BarChart3, AlertTriangle, Sun, Moon, ArrowLeft } from "lucide-react";
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
import KPICards from "@/components/dashboard/KPICards";
import LiveCharts from "@/components/dashboard/LiveCharts";
import AIInsights from "@/components/dashboard/AIInsights";
import HistoricalAnalysis from "@/components/dashboard/HistoricalAnalysis";
import NetworkHealthPanel from "@/components/dashboard/NetworkHealthPanel";

const ManagerNodeDetails = () => {
  const [isDark, setIsDark] = useState(true);
  const { fullName, logout } = useAuth();
  const { nodeId } = useParams();

  const normalizedParam = String(nodeId || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  const activeNode = normalizeNodeId(normalizedParam);

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

  if (!activeNode) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="h-full px-4 flex items-center justify-between max-w-[1920px] mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold">SF</span>
            </div>
            <span className="text-lg font-bold hidden sm:block">Node Details - {activeNode}</span>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-status-critical text-[10px] font-bold flex items-center justify-center text-white">
                8
              </span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-semibold text-sm">
                    {fullName?.charAt(0)?.toUpperCase() || "M"}
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{fullName || "Manager"}</p>
                  <p className="text-xs text-muted-foreground">Manager</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/manager/team-members" className="flex items-center">
                    <Users className="mr-2 w-4 h-4" />
                    Team Members
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/manager/reports" className="flex items-center">
                    <BarChart3 className="mr-2 w-4 h-4" />
                    Reports
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/manager/alerts" className="flex items-center">
                    <AlertTriangle className="mr-2 w-4 h-4" />
                    Critical Alerts
                  </Link>
                </DropdownMenuItem>
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
        <div className="max-w-[1920px] mx-auto space-y-6">
          <Button asChild variant="outline" className="w-fit">
            <Link to="/dashboard" className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Manager Dashboard
            </Link>
          </Button>

          <NetworkHealthPanel forcedNode={activeNode} />
          <KPICards forcedNode={activeNode} />
          <LiveCharts forcedNode={activeNode} />
          <AIInsights />
          <HistoricalAnalysis forcedNode={activeNode} />
        </div>
      </div>
    </div>
  );
};

export default ManagerNodeDetails;
