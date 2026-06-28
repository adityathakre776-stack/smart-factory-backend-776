import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthState {
  authReady: boolean;
  isAuthenticated: boolean;
  role: string | null;
  fullName: string | null;
  email: string | null;
  assignedNode: string | null;
  refreshAuth: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    authReady: false,
    isAuthenticated: false,
    role: null,
    fullName: null,
    email: null,
    assignedNode: null,
    refreshAuth: () => loadAuth(),
    logout: () => {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("fullName");
      localStorage.removeItem("email");
      localStorage.removeItem("assignedNode");
      setState(prev => ({
        ...prev,
        authReady: true,
        isAuthenticated: false,
        role: null,
        fullName: null,
        email: null,
        assignedNode: null,
      }));
      window.location.href = "/signin";
    },
  });

  const loadAuth = () => {
    const token     = localStorage.getItem("token");
    const role      = localStorage.getItem("role");
    const fullName  = localStorage.getItem("fullName");
    const email  = localStorage.getItem("email");
    const assignedNode  = localStorage.getItem("assignedNode");

    if (token && role) {
      setState(prev => ({
        ...prev,
        authReady: true,
        isAuthenticated: true,
        role,
        fullName: fullName || "User",
        email,
        assignedNode,
      }));
    } else {
      setState(prev => ({
        ...prev,
        authReady: true,
        isAuthenticated: false,
        role: null,
        fullName: null,
        email: null,
        assignedNode: null,
      }));
    }
  };

  useEffect(() => {
    loadAuth();

    // Listen for storage changes (useful in same-tab scenarios)
    window.addEventListener('storage', loadAuth);
    return () => window.removeEventListener('storage', loadAuth);
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};