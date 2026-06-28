import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, AlertCircle, CheckCircle, XCircle, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const alerts = [
  { id: 1, type: "critical", message: "Panel-7 temperature critical", node: "Panel-7", time: "5m ago" },
  { id: 2, type: "warning", message: "Motor-3 vibration elevated", node: "Motor-3", time: "8m ago" },
  { id: 3, type: "info", message: "CNC-1 went offline", node: "CNC-1", time: "12m ago" },
  { id: 4, type: "success", message: "HVAC-1 maintenance completed", node: "HVAC-1", time: "25m ago" },
  { id: 5, type: "warning", message: "Gas sensor calibration needed", node: "Gas-S1", time: "1h ago" },
  { id: 6, type: "info", message: "Scheduled backup completed", node: "System", time: "2h ago" },
  { id: 7, type: "success", message: "Motor-2 health check passed", node: "Motor-2", time: "3h ago" },
  { id: 8, type: "warning", message: "Power fluctuation detected", node: "Main Panel", time: "4h ago" },
];

const alertIcons = {
  critical: { icon: XCircle, color: "text-status-critical" },
  warning: { icon: AlertCircle, color: "text-status-warning" },
  info: { icon: Bell, color: "text-neon-cyan" },
  success: { icon: CheckCircle, color: "text-status-normal" },
};

const ControlsSidebar = () => {
  return (
    <div className="space-y-4 sticky top-20">
      {/* Alert History - only remaining section */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-neon-cyan" />
            <h3 className="font-semibold">Alert History</h3>
          </div>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-status-critical/10 text-status-critical">
            1 critical
          </span>
        </div>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {alerts.map((alert) => {
              const AlertIcon = alertIcons[alert.type as keyof typeof alertIcons].icon;
              const iconColor = alertIcons[alert.type as keyof typeof alertIcons].color;

              return (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer border border-border/50"
                >
                  <AlertIcon className={`w-5 h-5 mt-0.5 ${iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{alert.message}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <span className="font-medium">{alert.node}</span>
                      <span>•</span>
                      <span>{alert.time}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

export default ControlsSidebar;