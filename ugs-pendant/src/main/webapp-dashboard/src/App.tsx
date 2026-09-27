import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { useAppSelector } from "./hooks/useAppSelector";
import "./App.scss";
import WaitingPage from "./pages/WaitingPage";
import Dashboard from "./pages/Dashboard";
import { socketActions } from "./store/socketSlice";
import { ACCENT_PRESETS } from "./theme/accentPresets";

function App() {
  const isConnected = useAppSelector((state) => state.socket.isConnected);
  const theme = useAppSelector((state) => state.theme.theme);
  const accent = useAppSelector((state) => state.accent.accent);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(socketActions.connect());
  }, [dispatch]);

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

  // The dashboard itself now shows connection state and a way to connect right in
  // the top bar, so there's no separate full-page "disconnected" screen to get
  // stuck on - once the websocket is up, the dashboard is always what you see.
  return <div className="app">{isConnected ? <Dashboard /> : <WaitingPage />}</div>;
}

export default App;
