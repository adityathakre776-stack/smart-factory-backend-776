import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DigitalTwinSidebar from "@/components/dashboard/DigitalTwinSidebar";
import KPICards from "@/components/dashboard/KPICards";
import LiveCharts from "@/components/dashboard/LiveCharts";
import AIInsights from "@/components/dashboard/AIInsights";
import ControlsSidebar from "@/components/dashboard/ControlsSidebar";
import HistoricalAnalysis from "@/components/dashboard/HistoricalAnalysis";
import LoRaMetricsCharts from "@/components/dashboard/LoRaMetricsCharts";
// import CameraPanel from "@/components/dashboard/CameraPanel";

const Dashboard = () => {
  const [isDark, setIsDark] = useState(true);

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
      <DashboardHeader isDark={isDark} toggleTheme={toggleTheme} />

      <div className="pt-20 px-4 pb-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] gap-4 max-w-[1920px] mx-auto">
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="hidden lg:block"
          >
            <DigitalTwinSidebar selectedNode={null} onSelectNode={() => {}} />
          </motion.aside>

          <motion.main
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="space-y-6"
          >
            <KPICards />
            <LiveCharts />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
  
    <AIInsights />
  </div>
            <HistoricalAnalysis />
            <LoRaMetricsCharts />
          </motion.main>

          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="hidden lg:block"
          >
            <ControlsSidebar />
          </motion.aside>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;