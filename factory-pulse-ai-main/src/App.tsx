import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Landing from "./pages/Landing";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import WorkerDashboard from "./pages/WorkerDashboard";
import ManagerDashboard from "./pages/ManagerDashboard";
import ManagerNodeDetails from "./pages/ManagerNodeDetails";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import TeamMembers from "./pages/TeamMembers";
import Reports from "./pages/Reports";
import CriticalAlerts from "./pages/CriticalAlerts";
import { inferAssignedNode, normalizeNodeId } from "./lib/nodeAccess";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/signin" replace />;
}

function RoleBasedDashboard() {
  const { role, assignedNode, email, fullName } = useAuth();

  if (role === "manager" || role === "admin") {
    return <ManagerDashboard />;
  }
  if (role === "worker") {
    const mappedNode =
      normalizeNodeId(assignedNode) ||
      inferAssignedNode(email, fullName) ||
      "NODE_01";
    const routeNode = mappedNode.toLowerCase().replace("_", "-");
    return <Navigate to={`/worker/${routeNode}`} replace />;
  }

  return <Navigate to="/signin" replace />;
}

const App = () => (
  <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <RoleBasedDashboard />
                </ProtectedRoute>
              }
            />

                <Route
                  path="/worker/node-01"
                  element={
                    <ProtectedRoute>
                      <WorkerDashboard forcedNode="NODE_01" />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/worker/node-02"
                  element={
                    <ProtectedRoute>
                      <WorkerDashboard forcedNode="NODE_02" />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/worker/node-03"
                  element={
                    <ProtectedRoute>
                      <WorkerDashboard forcedNode="NODE_03" />
                    </ProtectedRoute>
                  }
                />

            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />

            <Route
              path="/manager/team-members"
              element={
                <ProtectedRoute>
                  <TeamMembers />
                </ProtectedRoute>
              }
            />

            <Route
              path="/manager/nodes/:nodeId"
              element={
                <ProtectedRoute>
                  <ManagerNodeDetails />
                </ProtectedRoute>
              }
            />

            <Route
              path="/manager/reports"
              element={
                <ProtectedRoute>
                  <Reports />
                </ProtectedRoute>
              }
            />

            <Route
              path="/manager/alerts"
              element={
                <ProtectedRoute>
                  <CriticalAlerts />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AuthProvider>
);

export default App;