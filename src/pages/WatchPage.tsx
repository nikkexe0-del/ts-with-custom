import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { parseM3U, getProxyUrl, type Channel } from "@/lib/playlist";
import { Loader2, ArrowLeft, ExternalLink, RotateCcw, Copy, AlertTriangle } from "lucide-react";

const PLAYLIST_URL = "https://raw.githubusercontent.com/nikkexe0-del/alexplaylist/refs/heads/main/premium.m3u";

// Module-level cache so navigating back and forth doesn't re-fetch
let cachedChannels: Channel[] | null = null;

type StreamKind = "hls" | "mpegts" | "native";
function detectKind(url: string): StreamKind {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".m3u8")) return "hls";
  if (u.endsWith(".ts") || u.endsWith(".mpegts") || u.endsWith(".m2ts") || u.endsWith(".flv"))
    return "mpegts";
  return "native";
}

/* ─── Inline player (no overlay, fills its container) ─── */
function InlinePlayer({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStream, setLoadingStream] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [isCopied, setIsCopied] = useState(false);

  const kind = detectKind(channel.url);
  const forceProxy = kind === "mpegts" || channel.url.startsWith("http://");
  const playUrl = forceProxy ? getProxyUrl(channel.url) : channel.url;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoadingStream(true);

    const cleanup = () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (mpegtsRef.current) {
        try {
          mpegtsRef.current.pause();
          mpegtsRef.current.unload();
          mpegtsRef.current.detachMediaElement();
          mpegtsRef.current.destroy();
        } catch { /* noop */ }
        mpegtsRef.current = null;
      }
    };

    const onPlaying = () => setLoadingStream(false);
    video.addEventListener("playing", onPlaying);

    const setupHls = () => {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(playUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError("HLS stream failed. Try Retry or open in VLC.");
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playUrl;
      } else {
        setError("HLS not supported in this browser.");
      }
    };

    const setupMpegts = () => {
      if (!mpegts.getFeatureList().mseLivePlayback) {
        setError("Browser doesn't support MSE for live TS playback.");
        return;
      }
      const player = mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: playUrl },
        {
          enableWorker: true,
          enableStashBuffer: false,
          stashInitialSize: 128,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 6,
          liveBufferLatencyMinRemain: 1,
        }
      );
      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      Promise.resolve(player.play()).catch(() => {});
      player.on(mpegts.Events.ERROR, () =>
        setError("Stream failed to load. Source may be offline or geo-blocked.")
      );
    };

    const setupNative = () => {
      video.src = playUrl;
      video.addEventListener("error", () =>
        setError("This stream can't play in the browser. Try Retry or open in VLC."),
        { once: true }
      );
      video.play().catch(() => {});
    };

    if (kind === "hls") setupHls();
    else if (kind === "mpegts") setupMpegts();
    else setupNative();

    return () => {
      video.removeEventListener("playing", onPlaying);
      cleanup();
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playUrl, kind, attempt]);

  const retry = () => { setError(null); setLoadingStream(true); setAttempt(a => a + 1); };

  const copyUrl = () => {
    navigator.clipboard.writeText("https://zestyytv.vercel.app").then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col w-full">
      {/* Video */}
      <div className="relative w-full bg-black" style={{ aspectRatio: "16/9" }}>
        <video
          ref={videoRef}
          controls
          playsInline
          autoPlay
          className="absolute inset-0 w-full h-full"
        />
        {loadingStream && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-12 w-12 rounded-full border-4 border-red-600/30 border-t-red-600 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/90">
            <AlertTriangle className="h-10 w-10 text-red-500" />
            <p className="text-sm text-white/90 max-w-md">{error}</p>
            <button
              onClick={retry}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-colors"
            >
              <RotateCcw className="h-4 w-4" /> Retry
            </button>
          </div>
        )}
        {/* watermark */}
        <div className="absolute top-3 right-3 pointer-events-none opacity-20 text-white font-black tracking-widest text-sm select-none">
          zestyytv
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-4 px-4 py-3 bg-neutral-900 border-t border-white/5 text-xs">
        <button
          onClick={retry}
          className="flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors font-bold uppercase tracking-wider"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reload
        </button>
        <button
          onClick={copyUrl}
          className={`flex items-center gap-1.5 font-bold uppercase tracking-wider transition-colors ${isCopied ? "text-green-400" : "text-neutral-400 hover:text-white"}`}
        >
          <Copy className="h-3.5 w-3.5" /> {isCopied ? "Copied!" : "Share"}
        </button>
      </div>
    </div>
  );
}

/* ─── Main page ─── */
const WatchPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [channels, setChannels] = useState<Channel[]>(cachedChannels ?? []);
  const [loading, setLoading] = useState(!cachedChannels);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedChannels) return;
    (async () => {
      try {
        const res = await fetch(PLAYLIST_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseM3U(text);
        cachedChannels = parsed;
        setChannels(parsed);
      } catch (e) {
        setLoadError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const channel = useMemo(() => channels.find(c => c.id === id) ?? null, [channels, id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center gap-4 text-neutral-500">
        <Loader2 className="h-8 w-8 animate-spin text-red-600" />
        <p className="text-xs font-bold uppercase tracking-widest">Loading stream…</p>
      </div>
    );
  }

  if (loadError || !channel) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-red-500 font-bold text-lg">
          {loadError ? `Failed to load playlist: ${loadError}` : "Channel not found."}
        </p>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 bg-red-600 text-white text-xs font-black px-4 py-2 rounded uppercase tracking-widest hover:bg-red-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to channels
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans flex flex-col selection:bg-red-600 selection:text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-4 sm:px-6 lg:px-12 py-4 bg-black/80 border-b border-white/5 z-30">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-red-600 ml-1 text-xl font-black tracking-tighter uppercase italic">
            ZESTYY<span className="text-white">TV</span>
          </span>
        </button>

        <div className="flex items-center gap-2">
          <span className="badge-live text-[9px]">
            <span className="live-dot" /> LIVE
          </span>
          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest truncate max-w-[180px] sm:max-w-none">
            {channel.group}
          </span>
        </div>

        <a
          href="https://www.instagram.com/nikkk.exe"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-black px-3 py-1.5 rounded shadow-lg shadow-red-600/20 uppercase tracking-tighter hover:bg-red-700 transition-colors"
        >
          <span className="hidden sm:inline">DEVELOPER</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </a>
      </nav>

      {/* Player */}
      <main className="flex-1 flex flex-col max-w-[1400px] w-full mx-auto px-0 sm:px-6 lg:px-12 py-0 sm:py-8 gap-6">
        <div className="w-full rounded-none sm:rounded-xl overflow-hidden border-0 sm:border border-white/10 shadow-2xl">
          <InlinePlayer channel={channel} />
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="w-full border-t border-white/10 py-6 px-6 flex flex-col items-center justify-center gap-4 text-center text-neutral-400 bg-neutral-900/50">
        <p className="text-sm font-bold">
          Stream by <span className="text-red-500">Zestyy</span><span className="text-white">TV</span>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://instagram.com/nikkk.exe"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-[11px] font-black px-4 py-2 rounded-full uppercase tracking-wider transition-colors border border-white/10"
          >
            💬 Suggestions
          </a>
          <a
            href="https://zestyyflix.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-black px-4 py-2 rounded-full uppercase tracking-wider transition-colors shadow-lg shadow-red-600/20"
          >
            🎬 More from ZestyyFlix
          </a>
        </div>
      </footer>
    </div>
  );
};

export default WatchPage;
