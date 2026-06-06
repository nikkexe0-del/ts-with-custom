Architecture Breakdown
Stack: React + Vite + TypeScript + Tailwind + shadcn/ui, deployed on Vercel
The magic is 3 layers:
1. Smart Stream Type Detection
tsfunction detectKind(url: string): "hls" | "mpegts" | "native" {
  if (url.endsWith(".m3u8")) return "hls"
  if (url.endsWith(".ts") || ".mpegts" || ".m2ts" || ".flv") return "mpegts"
  return "native"
}
One function. Routes the URL to the right player engine before anything loads.
2. Dual Player Engine

.m3u8 / HLS → hls.js — handles chunked HTTP live streams, adaptive bitrate, Safari native fallback
.ts / MPEG-TS raw streams → mpegts.js — uses Media Source Extensions (MSE) to feed raw transport stream bytes directly into a <video> tag. This is why raw .ts works in browser — browsers can't natively play .ts, but MSE lets JS push decoded segments in real time
Everything else → native <video src=""> with error fallback

3. Supabase Edge Function Proxy
The .ts streams (and any http:// sources) are force-routed through a Supabase Deno edge function that:

Strips CORS restrictions (adds Access-Control-Allow-Origin: *)
Forwards range requests (for seeking)
Spoofs a mobile User-Agent
Proxies the raw stream bytes through to the browser

This is why it works on iOS/Android — Safari can't do cross-origin requests to random IPTV servers, but the proxy neutralizes that.

Vibe Code Prompt
Drop this into Cursor/Lovable/v0:
Build a React + Vite + TypeScript live stream player app. Stack: Tailwind CSS, shadcn/ui, react-router-dom, hls.js, mpegts.js, Supabase edge function as CORS proxy.

Core logic:
- Parse M3U/M3U8 playlist files: extract channel name, group-title, tvg-logo, and stream URL
- Auto-detect stream type from URL extension: .m3u8 → use hls.js, .ts/.mpegts/.m2ts/.flv → use mpegts.js with MSE, anything else → native HTML5 video
- Raw .ts streams and http:// URLs must always be routed through a Supabase Edge Function proxy at /functions/v1/stream-proxy?url=<encoded> to fix CORS and mixed content
- The Supabase proxy (Deno) must: forward GET/HEAD, pass Range headers, add CORS headers, spoof User-Agent as mobile Chrome, passthrough content-type/content-length/content-range
- hls.js config: enableWorker true, lowLatencyMode true
- mpegts.js config: isLive true, enableWorker true, enableStashBuffer false, liveBufferLatencyChasing true, maxLatency 6s

UI:
- Home page: channel grid grouped by M3U group-title, each card shows logo + name + group badge
- Clicking a channel opens a full-screen player overlay or dedicated /watch/:id page
- Player shows: 16:9 video, loading spinner, error state with Retry button, stream type badge (HLS/MPEG-TS/Direct), Copy URL button, VLC deep link button
- Proxy toggle (optional): force all streams through proxy

Supabase: use VITE_SUPABASE_URL env var to construct proxy URL. Deploy edge function to supabase/functions/stream-proxy/index.ts.

Dark theme, Inter font, red accent color (#dc2626).
That's literally the exact architecture this project uses. The hls.js + mpegts.js dual-engine combo with a Supabase edge proxy is the whole trick.
