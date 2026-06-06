import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Search, Loader2, ExternalLink, Link2, X, Play, AlertTriangle } from "lucide-react";
import { parseM3U, getProxyUrl, type Channel } from "@/lib/playlist";
import Hls from "hls.js";
import mpegts from "mpegts.js";

/* ─── helpers ──────────────────────────────────────────────── */

const EXAMPLE_URL =
  "https://raw.githubusercontent.com/nikkexe0-del/alexplaylist/refs/heads/main/sportspremimum.m3u";

const HighlightText = ({
  text,
  highlight,
}: {
  text: string;
  highlight: string;
}) => {
  if (!highlight.trim()) return <>{text}</>;
  const parts = text.split(
    new RegExp(
      `(${highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi"
    )
  );
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-red-600 text-white rounded-[2px] px-0.5 font-bold">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
};

/* ─── inline player (same logic as WatchPage InlinePlayer) ─── */

type StreamKind = "hls" | "mpegts" | "native";

function detectKind(url: string): StreamKind {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".m3u8")) return "hls";
  if (u.endsWith(".ts") || u.endsWith(".mpegts") || u.endsWith(".m2ts") || u.endsWith(".flv"))
    return "mpegts";
  return "native";
}

function InlinePlayer({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}) {
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
      video.addEventListener(
        "error",
        () => setError("This stream can't play in the browser. Try Retry or open in VLC."),
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

  const retry = () => { setError(null); setLoadingStream(true); setAttempt((a) => a + 1); };

  const copyUrl = () => {
    navigator.clipboard.writeText(channel.url).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div className="w-full flex flex-col gap-3 mb-8">
      {/* Player */}
      <div className="relative w-full bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl" style={{ aspectRatio: "16/9" }}>
        <video ref={videoRef} controls playsInline autoPlay className="absolute inset-0 w-full h-full" />
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
              className="bg-red-600 text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {/* watermark */}
        <div className="absolute top-3 right-3 pointer-events-none opacity-20 text-white font-black tracking-widest text-sm select-none">
          zestyytv
        </div>
      </div>

      {/* Title bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="badge-live">
              <span className="live-dot" /> LIVE
            </span>
            <span className="text-[10px] font-bold text-neutral-300 uppercase tracking-[0.2em]">
              {channel.group} · CUSTOM
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl lg:text-6xl font-black uppercase leading-[0.85] tracking-tighter">
            {channel.name}
          </h1>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-400 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-lg transition-all self-start lg:self-end"
        >
          <X className="w-3 h-3" /> Close
        </button>
      </div>

      {/* URL bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-900/40 border border-white/5 p-3 rounded-lg">
        <div className="text-[10px] sm:text-xs text-neutral-500 font-mono truncate max-w-full">
          {channel.url}
        </div>
        <div className="flex items-center gap-5 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest shrink-0">
          <button
            onClick={copyUrl}
            className={`transition-colors ${isCopied ? "text-green-500" : "text-neutral-400 hover:text-white"}`}
          >
            {isCopied ? "COPIED!" : "COPY URL"}
          </button>
          <a
            href={channel.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-white transition-colors"
          >
            OPEN IN BROWSER
          </a>
        </div>
      </div>
    </div>
  );
}

/* ─── channel card ──────────────────────────────────────────── */

function ChannelMiniCard({
  channel,
  searchTerm = "",
  onPlay,
}: {
  channel: Channel;
  searchTerm?: string;
  onPlay: (c: Channel) => void;
}) {
  return (
    <button
      onClick={() => onPlay(channel)}
      className="flex flex-col w-full text-left group bg-neutral-900/40 rounded-lg border border-white/5 hover:border-red-500/30 transition-all overflow-hidden p-3"
    >
      <div className="w-full aspect-video bg-neutral-950 rounded-md overflow-hidden relative mb-3">
        <div className="absolute inset-0 flex items-center justify-center p-3 bg-black/40 backdrop-blur-sm">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt={channel.name}
              loading="lazy"
              decoding="async"
              className="max-w-full max-h-[70%] object-contain drop-shadow-2xl group-hover:scale-110 transition-transform duration-500"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="font-black text-neutral-600 text-[10px] uppercase text-center leading-tight px-2">
              {channel.name}
            </div>
          )}
        </div>
        <span className="badge-live absolute top-1.5 right-1.5 z-10 text-[7px]">
          <span className="live-dot" />
          LIVE
        </span>
      </div>
      <h5 className="text-[11px] font-bold truncate text-white leading-tight">
        <HighlightText text={channel.name} highlight={searchTerm} />
      </h5>
      <p className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest mt-0.5">
        <HighlightText text={channel.group || ""} highlight={searchTerm} />
      </p>
    </button>
  );
}

/* ─── load bento ────────────────────────────────────────────── */

function LoadBento({
  onLoad,
}: {
  onLoad: (url: string) => void;
}) {
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");

  const handleLoad = () => {
    const trimmed = input.trim();
    if (!trimmed) { setErr("Paste an M3U URL first."); return; }
    if (!trimmed.startsWith("http")) { setErr("Must be a http/https URL."); return; }
    setErr("");
    onLoad(trimmed);
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-10">
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-6 sm:p-8 flex flex-col gap-5 shadow-2xl">
        {/* icon + heading */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center shrink-0">
            <Link2 className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h2 className="text-base font-black uppercase tracking-tight text-white">
              Load Your M3U Playlist
            </h2>
            <p className="text-[10px] text-neutral-500 font-medium mt-0.5">
              Paste any public .m3u URL and browse your channels
            </p>
          </div>
        </div>

        {/* input */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleLoad()}
              placeholder={`e.g. ${EXAMPLE_URL}`}
              className="flex-1 bg-neutral-950 border border-white/10 rounded-xl py-3 px-4 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 transition-all font-mono"
            />
            <button
              onClick={handleLoad}
              className="shrink-0 flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-colors shadow-lg shadow-red-600/20"
            >
              <Play className="w-3.5 h-3.5" />
              Load
            </button>
          </div>
          {err && <p className="text-[10px] text-red-400 font-bold px-1">{err}</p>}
        </div>

        {/* example pill */}
        <button
          onClick={() => { setInput(EXAMPLE_URL); setErr(""); }}
          className="self-start flex items-center gap-1.5 text-[10px] font-bold text-neutral-500 hover:text-red-400 transition-colors uppercase tracking-wider"
        >
          <ExternalLink className="w-3 h-3" />
          Use example playlist
        </button>
      </div>
    </div>
  );
}

/* ─── main page ─────────────────────────────────────────────── */

const PAGE_SIZE = 24;

const CustomPlaylist = () => {
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("");
  const [playing, setPlaying] = useState<Channel | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const playerRef = useRef<HTMLDivElement>(null);

  /* load playlist when URL is set */
  useEffect(() => {
    if (!playlistUrl) return;
    setLoading(true);
    setLoadError(null);
    setChannels([]);
    setPlaying(null);
    setQuery("");
    setActiveGroup("");
    setVisibleCount(PAGE_SIZE);

    (async () => {
      try {
        const res = await fetch(playlistUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseM3U(text);
        if (parsed.length === 0) throw new Error("No channels found in playlist.");
        setChannels(parsed);
      } catch (e) {
        setLoadError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [playlistUrl]);

  /* scroll to player */
  useEffect(() => {
    if (playing && playerRef.current) {
      playerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [playing]);

  const groups = useMemo(
    () => ["All", ...Array.from(new Set(channels.map((c) => c.group).filter(Boolean)))],
    [channels]
  );

  const filtered = useMemo(() => {
    let ch = channels;
    if (activeGroup && activeGroup !== "All") ch = ch.filter((c) => c.group === activeGroup);
    if (query.trim()) {
      const q = query.toLowerCase();
      ch = ch.filter((c) => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
    }
    return ch;
  }, [channels, activeGroup, query]);

  const visibleChannels = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const loadMore = useCallback(() => setVisibleCount((n) => n + PAGE_SIZE), []);

  const handlePlay = (ch: Channel) => {
    setPlaying(ch);
  };

  const handleReset = () => {
    setPlaylistUrl(null);
    setChannels([]);
    setPlaying(null);
    setLoadError(null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans flex flex-col selection:bg-red-600 selection:text-white">

      {/* ── Nav ── */}
      <nav className="flex items-center justify-between px-4 sm:px-6 lg:px-12 py-4 sm:py-5 bg-gradient-to-b from-black/80 to-transparent absolute top-0 w-full z-30">
        <div className="flex items-center gap-4 sm:gap-6">
          <a
            href="/"
            className="flex items-center gap-2 text-red-600 cursor-pointer"
          >
            <span className="text-2xl sm:text-3xl font-black tracking-tighter uppercase italic">
              ZESTYY<span className="text-white">TV</span>
            </span>
          </a>
          <span className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-800/80 border border-white/10 text-[9px] font-black uppercase tracking-widest text-neutral-400">
            <Link2 className="w-3 h-3" />
            Custom M3U
          </span>
        </div>

        <div className="flex items-center gap-3">
          {channels.length > 0 && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-400 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-lg transition-all"
            >
              <X className="w-3 h-3" /> New Playlist
            </button>
          )}
          <a
            href="https://www.instagram.com/nikkk.exe"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-black px-3 py-1.5 rounded shadow-lg shadow-red-600/20 uppercase tracking-tighter hover:bg-red-700 transition-colors"
          >
            <span>DEVELOPER</span>
            <ExternalLink className="w-3 h-3 opacity-70" />
          </a>
        </div>
      </nav>

      {/* ── Main ── */}
      <main className="pt-24 px-4 sm:px-6 lg:px-12 pb-16 flex-1 flex flex-col max-w-[1800px] w-full mx-auto">

        {/* ── Player ── */}
        {playing && (
          <div ref={playerRef}>
            <InlinePlayer channel={playing} onClose={() => setPlaying(null)} />
          </div>
        )}

        {/* ── Load bento (shown when no playlist loaded) ── */}
        {!playlistUrl && !loading && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh]">
            {/* Hero text */}
            <div className="text-center mb-8">
              <div className="flex items-center justify-center gap-2 mb-4">
                <span className="badge-live">
                  <span className="live-dot" /> CUSTOM
                </span>
              </div>
              <h1 className="text-4xl sm:text-6xl font-black uppercase tracking-tighter leading-none mb-3">
                YOUR PLAYLIST.{" "}
                <span className="text-red-500">YOUR CHANNELS.</span>
              </h1>
              <p className="text-neutral-400 text-sm max-w-md mx-auto">
                Load any public M3U URL and stream your channels instantly in the browser.
              </p>
            </div>
            <LoadBento onLoad={setPlaylistUrl} />
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-28 gap-4 text-neutral-500">
            <Loader2 className="h-8 w-8 animate-spin text-red-600" />
            <p className="text-xs font-bold uppercase tracking-widest">Loading playlist…</p>
          </div>
        )}

        {/* ── Error ── */}
        {loadError && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <AlertTriangle className="h-10 w-10 text-red-500" />
            <p className="text-red-400 font-bold text-sm max-w-md">{loadError}</p>
            <button
              onClick={handleReset}
              className="text-[10px] font-black uppercase tracking-widest text-neutral-400 hover:text-white border border-white/10 hover:border-white/30 px-4 py-2 rounded-lg transition-all"
            >
              Try Another URL
            </button>
          </div>
        )}

        {/* ── Channels view ── */}
        {channels.length > 0 && !loading && (
          <div className="flex flex-col gap-8">
            {/* Playlist info bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-900/40 border border-white/5 p-3 sm:p-4 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-600/10 border border-red-600/20 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4 text-red-500" />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest mb-0.5">Loaded Playlist</p>
                  <p className="text-xs font-mono text-neutral-300 truncate max-w-[280px] sm:max-w-md">{playlistUrl}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-widest shrink-0">
                <span className="text-neutral-500">{channels.length} channels</span>
                <button
                  onClick={handleReset}
                  className="text-red-400 hover:text-red-300 transition-colors"
                >
                  Change
                </button>
              </div>
            </div>

            {/* Search + groups */}
            <section>
              <div className="relative max-w-2xl mx-auto mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search channels…"
                  className="w-full bg-neutral-900 border border-white/10 rounded-xl py-3 sm:py-4 pl-12 pr-5 text-xs sm:text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-red-500 transition-all focus:ring-2 focus:ring-red-500/10"
                />
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1">
                {groups.map((g) => (
                  <button
                    key={g}
                    onClick={() => setActiveGroup(activeGroup === g ? "" : g)}
                    className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider border transition-all ${
                      activeGroup === g
                        ? "bg-red-600 text-white border-transparent shadow-lg shadow-red-600/25"
                        : "bg-neutral-900/60 border-white/10 text-neutral-400 hover:text-white hover:border-white/20"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </section>

            {/* Grid */}
            <section>
              {query.trim() && (
                <div className="flex items-center gap-4 mb-5">
                  <h4 className="text-base sm:text-xl font-extrabold tracking-tighter text-red-500 uppercase italic">
                    Search Results
                  </h4>
                  <div className="h-px flex-1 bg-red-500/10" />
                  <span className="text-[9px] font-bold text-neutral-600 tracking-widest">
                    {filtered.length} FOUND
                  </span>
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="py-16 text-center border-4 border-dashed border-white/5 rounded-[32px]">
                  <p className="text-neutral-600 font-black uppercase tracking-widest text-xs">
                    No channels match.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                    {visibleChannels.map((c) => (
                      <ChannelMiniCard
                        key={c.id}
                        channel={c}
                        searchTerm={query}
                        onPlay={handlePlay}
                      />
                    ))}
                  </div>

                  {visibleCount < filtered.length && (
                    <div className="flex flex-col items-center gap-2 mt-10">
                      <p className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">
                        Showing {visibleChannels.length} of {filtered.length} channels
                      </p>
                      <button
                        onClick={loadMore}
                        className="px-8 py-3 bg-neutral-900 hover:bg-neutral-800 border border-white/10 hover:border-red-500/40 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all hover:shadow-lg hover:shadow-red-600/10"
                      >
                        Load More
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="w-full border-t border-white/10 py-8 px-6 flex flex-col items-center justify-center gap-4 text-center text-neutral-400 bg-neutral-900/50">
        <span className="font-bold text-lg">
          <span className="text-red-500">Zestyy</span><span className="text-white">TV</span>
        </span>
        <p className="text-sm">Custom M3U Loader · Streams from your playlist · Personal use only</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="/"
            className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-[11px] font-black px-4 py-2 rounded-full uppercase tracking-wider transition-colors border border-white/10"
          >
            ← Main Playlist
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
        <p className="text-xs">
          Built by{" "}
          <a
            href="https://instagram.com/nikkk.exe"
            target="_blank"
            rel="noreferrer"
            className="text-red-500 font-medium hover:text-red-400 transition-colors"
          >
            @nikkk.exe
          </a>
        </p>
      </footer>
    </div>
  );
};

export default CustomPlaylist;
