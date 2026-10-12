import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { useAppSelector } from "./hooks/useAppSelector";
import "./App.scss";
import WaitingPage from "./pages/WaitingPage";
import Dashboard from "./pages/Dashboard";
import ReconnectOverlay from "./components/ReconnectOverlay";
import { socketActions } from "./store/socketSlice";
import { ACCENT_PRESETS } from "./theme/accentPresets";
import { RECONNECT_INTERVAL_MS } from "./utils/reconnect";

function App() {
  const isConnected = useAppSelector((state) => state.socket.isConnected);
  const hasConnected = useAppSelector((state) => state.socket.hasConnected);
  const isEstablishingConnection = useAppSelector((state) => state.socket.isEstablishingConnection);
  const appRef = useRef<HTMLDivElement | null>(null);
  const theme = useAppSelector((state) => state.theme.theme);
  const accent = useAppSelector((state) => state.accent.accent);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(socketActions.connect());
  }, [dispatch]);

  // While there's no connection (before the first one, or after losing it),
  // keep trying. Re-armed whenever a connect attempt starts or ends, so each
  // failed attempt is followed by another one RECONNECT_INTERVAL_MS later.
  useEffect(() => {
    if (isConnected) return;
    const timer = setTimeout(() => dispatch(socketActions.connect()), RECONNECT_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [dispatch, isConnected, isEstablishingConnection]);

  // Once connected the dashboard stays mounted for good. A drop covers it with
  // the reconnect overlay and makes it inert (no clicks, no Tab into it), but
  // unmounting it would throw away the pane layout, every open plugin (their
  // iframes reload) and unsaved editor text - for a Wi-Fi blip as much as a UGS
  // restart. inert is set through the DOM because React 18 has no prop for it.
  const showReconnect = hasConnected && !isConnected;
  useEffect(() => {
    appRef.current?.toggleAttribute("inert", showReconnect);
  }, [showReconnect]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "light" ? "#eef1f4" : "#1c1e1f",
    );
  }, [theme]);

  // Applied as inline custom properties on <html> (rather than a CSS class
  // per preset) so they win over theme.scss's own --dashboard-accent*
  // defaults regardless of which theme is active, and so every place that
  // already reads --dashboard-accent/-soft/-border (buttons, focus rings,
  // the gcode editor's number tokens, etc.) picks up the chosen color with
  // no changes of its own needed.
  useEffect(() => {
    const preset = ACCENT_PRESETS[accent][theme];
    const root = document.documentElement.style;
    root.setProperty("--dashboard-accent", preset.accent);
    root.setProperty("--dashboard-accent-soft", preset.soft);
    root.setProperty("--dashboard-accent-border", preset.border);
    // Always the *dark* variant, regardless of the active theme - see
    // theme.scss's comment on --dashboard-hud-accent. The visualizer's own
    // readout chip stays a fixed dark overlay in both themes, so its number
    // needs the dark palette's brighter accent to stay legible, even while
    // the light theme is active everywhere else.
    root.setProperty("--dashboard-hud-accent", ACCENT_PRESETS[accent].dark.accent);
  }, [accent, theme]);

  // The dashboard itself shows machine connection state and a way to connect
  // right in the top bar, so there's no separate full-page "disconnected"
  // screen to get stuck on. The only full-page wait is the very first
  // connection; after that the dashboard stays put (see above).
  return (
    <>
      <div className="app" ref={appRef}>
        {hasConnected || isConnected ? <Dashboard /> : <WaitingPage />}
      </div>
      {showReconnect && <ReconnectOverlay onRetry={() => dispatch(socketActions.connect())} />}
    </>
  );
}

export default App;
