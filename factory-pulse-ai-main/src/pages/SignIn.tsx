import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { Factory, Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import API from "@/api/api";
import { useAuth } from "@/context/AuthContext";
import { inferAssignedNode, normalizeNodeId } from "@/lib/nodeAccess";

const SignIn = () => {
  const [email, setEmail] = useState("manager@smartfactory.ai");
  const [password, setPassword] = useState("Manager@123");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const navigate = useNavigate();
  const { toast } = useToast();
  const { refreshAuth } = useAuth();   // ← yeh line important hai

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setIsLoading(true);

    try {
      const response = await API.post("/login", {
        email,
        password,
      });

      const { access_token, role, fullName, assigned_node } = response.data;
      const normalizedEmail = email.trim().toLowerCase();
      const assignedNode =
        normalizeNodeId(assigned_node) ||
        inferAssignedNode(normalizedEmail, fullName) ||
        "NODE_01";

      // Token aur user info save karo (trim — stray whitespace breaks JWT parsing → 422)
      localStorage.setItem("token", String(access_token).trim());
      localStorage.setItem("role", role);
      localStorage.setItem("fullName", fullName || email.split("@")[0]);
      localStorage.setItem("email", normalizedEmail);
      if (role === "worker") {
        localStorage.setItem("assignedNode", assignedNode);
      } else {
        localStorage.removeItem("assignedNode");
      }

      // Context ko turant update karo (sabse important fix)
      refreshAuth();

      toast({
        title: "Login successful",
        description: `Welcome back${fullName ? `, ${fullName}` : ""}!`,
      });

      // Dashboard pe redirect
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const isNetworkIssue =
        !err.response &&
        (err.code === "ERR_NETWORK" ||
          err.code === "ECONNABORTED" ||
          String(err.message || "").toLowerCase().includes("network"));

      const msg = isNetworkIssue
        ? "Server se connection nahi ho pa raha. API IP/Network check karo aur backend run hai ya nahi verify karo."
        : err.response?.data?.message ||
          "Invalid credentials or server error. Please try again.";
      setErrorMsg(msg);
      toast({
        variant: "destructive",
        title: "Login failed",
        description: msg,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Factory className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">SmartFactory AI</span>
          </Link>

          {/* Header */}
          <h1 className="text-3xl font-bold mb-2">Welcome back</h1>
          <p className="text-muted-foreground mb-8">
            Sign in to access your factory monitoring dashboard
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Password</label>
                <Link
                  to="/forgot-password"
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-12"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {errorMsg && (
              <p className="text-sm text-destructive text-center">{errorMsg}</p>
            )}

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(!!checked)}
              />
              <label
                htmlFor="remember"
                className="text-sm text-muted-foreground cursor-pointer select-none"
              >
                Remember me for 30 days
              </label>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-12 bg-primary hover:bg-primary/90"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Signing in...
                </div>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="ml-2 w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Sign up link */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            Don't have an account?{" "}
            <Link to="/signup" className="text-primary hover:underline font-medium">
              Sign up for free
            </Link>
          </p>
        </motion.div>
      </div>

      {/* Right side - Visual */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-muted/30 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="absolute inset-0 grid-pattern opacity-30" />

        <motion.div
          className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-primary/20 blur-3xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-neon-cyan/20 blur-3xl"
          animate={{ scale: [1.2, 1, 1.2], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 10, repeat: Infinity }}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative z-10 text-center max-w-md px-8"
        >
          <div className="glass-card p-8 mb-6">
            <div className="text-5xl font-bold text-primary mb-2">87%</div>
            <div className="text-lg font-semibold mb-1">Downtime Reduction</div>
            <div className="text-sm text-muted-foreground">
              Average improvement across all monitored facilities
            </div>
          </div>
          <p className="text-muted-foreground">
            Join 500+ factories using AI-powered monitoring to optimize operations
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default SignIn;