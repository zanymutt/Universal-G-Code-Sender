import { useEffect, useState } from "react";
import { useAppSelector } from "../hooks/useAppSelector";
import "./ConnectionHealth.scss";

// A WebSocket can stay technically "open" for a while after the underlying
// connection has actually gone stale (network drop, pendant server hung,
// etc.) - these thresholds are about the age of the last message actually
// received, not the socket's own readyState.
//
// The client pings every 4s (socketMiddleware.ts) and the server replies
// with a pong (EventsSocket.java), so that alone is enough to keep this
// live during a genuinely idle machine - status pushes are NOT a reliable
// heartbeat on their own, since several controllers (e.g. FluidNCController)
// deliberately skip dispatching a status event when nothing has changed.
// These thresholds need enough margin over the 4s ping interval to absorb
// normal jitter without flickering.
const STALE_AFTER_MS = 7000;
const LOST_AFTER_MS = 15000;

const ConnectionHealth = () => {
  const isConnected = useAppSelector((state) => state.socket.isConnected);
  const lastMessageAt = useAppSelector((state) => state.socket.lastMessageAt);

  // Without this, nothing would re-render the dot as time passes with no new
  // message arriving - it'd stay "live" forever even after the connection
  // actually stalled.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMs = lastMessageAt ? now - lastMessageAt : Infinity;
  const health = !isConnected
    ? "lost"
    : elapsedMs > LOST_AFTER_MS
      ? "lost"
      : elapsedMs > STALE_AFTER_MS
        ? "stale"
        : "live";

  // This is the link between the dashboard (the browser) and the UGS program
  // - NOT the machine. Next to the Connect button a bare green dot reads as
  // "machine connected", so it carries a "UGS" caption and a tooltip that says
  // what it measures; the machine's own state is the pill at the far left.
  const label = !isConnected
    ? "Dashboard ↔ UGS link: not connected (this is the link to the UGS program, not the machine)"
    : health === "lost"
      ? "Dashboard ↔ UGS link: stalled - no updates received recently"
      : health === "stale"
        ? `Dashboard ↔ UGS link: no update in ${Math.round(elapsedMs / 1000)}s`
        : "Dashboard ↔ UGS link: healthy (the machine's own state is the pill on the left)";

  return (
    <div className={`connectionHealth ${health}`} title={label} role="status" aria-label={label}>
      <span className="connectionHealthDot" />
      <span className="connectionHealthLabel">UGS</span>
    </div>
  );
};

export default ConnectionHealth;
