import { useEffect, useState } from "react";
import API from "@/api/api";
import { formatServerDateTime } from "@/lib/dateTime";



const CameraPanel = () => {
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const browserHost = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const streamUrl =
    (typeof window !== "undefined" && localStorage.getItem("cameraStreamUrl")) ||
    `http://${browserHost}:81/stream`;
  const uploadsBase =
    (typeof window !== "undefined" && localStorage.getItem("uploadsBaseUrl")) ||
    `http://${browserHost}:5000/uploads`;

  const fetchImages = async () => {
    try {
      const res = await API.get("/camera/list");
      setImages(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (err) {
      console.error("Camera list fetch failed", err);
      setError("Failed to load images");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
    const interval = setInterval(fetchImages, 15000); // every 15 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass-card p-4">
      <h3 className="font-semibold mb-2">Live Camera Feed</h3>
      <img
        src={streamUrl}
        alt="Live stream"
        className="rounded mb-6 w-full aspect-video object-cover border border-border"
        onError={(e) => {
          e.currentTarget.src = "/placeholder-camera-off.jpg"; // fallback image
        }}
      />

      <h3 className="font-semibold mb-3">Recent Captures</h3>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading images...</div>
      ) : error ? (
        <div className="text-center py-8 text-destructive">{error}</div>
      ) : images.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No images captured yet</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((img) => (
            <div key={img.id} className="group relative overflow-hidden rounded-lg border border-border">
              <img
                src={`${uploadsBase}/${img.filename}`}
                alt={`Capture ${img.created_at}`}
                className="w-full aspect-square object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-2 left-2 right-2 text-white text-xs">
                  {formatServerDateTime(img.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CameraPanel;