import axios from "axios";

const envBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const browserHost = typeof window !== "undefined" ? window.location.hostname : "localhost";
const savedBaseUrl = typeof window !== "undefined" ? localStorage.getItem("apiBaseUrl") : null;

const apiBaseCandidates = Array.from(
  new Set(
    [
      envBaseUrl,
      savedBaseUrl || undefined,
      `http://${browserHost}:5000/api`,
      "http://172.20.10.2:5000/api",
      "http://127.0.0.1:5000/api",
      "http://localhost:5000/api",
    ].filter(Boolean) as string[]
  )
);

let activeBaseIndex = 0;

const API = axios.create({
  baseURL: apiBaseCandidates[activeBaseIndex],
  timeout: 10000,
});

function getValidToken(): string | null {
  const raw = localStorage.getItem("token");
  if (!raw) return null;
  const token = raw.trim();
  if (!token || token === "undefined" || token === "null") return null;
  return token;
}

API.interceptors.request.use((req) => {
  const token = getValidToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

/** Avoid stale dashboard rows when a browser or proxy caches GET responses. */
export const freshQueryParams = () => ({ _t: Date.now() });

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url || "");

    // 401: not authenticated / bad token. (422 can occur from JWT edge cases; fix server-side;
    // do not redirect on 422 or login loops happen while debugging.)
    if (
      status === 401 &&
      url &&
      !url.includes("/login") &&
      !url.includes("/signup")
    ) {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("fullName");
      localStorage.removeItem("email");
      localStorage.removeItem("assignedNode");
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/signin")) {
        window.location.href = "/signin";
      }
    }

    const config = error?.config as any;
    const hasNoResponse = !error?.response;
    const canFailover =
      hasNoResponse &&
      config &&
      !config.__apiFailoverRetried &&
      activeBaseIndex < apiBaseCandidates.length - 1;

    if (canFailover) {
      config.__apiFailoverRetried = true;
      activeBaseIndex += 1;
      const nextBaseUrl = apiBaseCandidates[activeBaseIndex];
      API.defaults.baseURL = nextBaseUrl;
      localStorage.setItem("apiBaseUrl", nextBaseUrl);
      return API.request(config);
    }

    return Promise.reject(error);
  }
);

export default API;
