import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { listPlugins, PluginInfo } from "../services/plugins";
import PluginWindow from "./PluginWindow";

// One open plugin window - a plugin can be opened more than once (two
// instances of the same rotate-gcode tool, say), so instances are keyed by
// a per-open counter, not by plugin id.
type OpenWindow = {
  key: number;
  plugin: PluginInfo;
};

// Staggers each newly opened window a bit further down/right than the last
// so opening several plugins in a row doesn't stack them in an identical
// spot - purely cosmetic, wraps back to the top-left offset once it'd
// otherwise walk a window off the visible area.
const STAGGER_STEP = 28;
const STAGGER_MAX_STEPS = 10;

type PluginManagerValue = {
  plugins: PluginInfo[];
  refreshPlugins: () => void;
  openPlugin: (plugin: PluginInfo) => void;
};

const PluginManagerContext = createContext<PluginManagerValue | null>(null);

// The list of installed plugins and a way to open one live here, shared via
// context, because the two things that need them - PluginListPanel (an
// inline list in RightRail) and the floating PluginWindows themselves -
// aren't in an ancestor/descendant relationship with each other. Both need
// the *same* plugin list and the *same* set of open windows, not their own
// independent copies, so a plain hook (which gives every caller its own
// state) doesn't work here - this needs one shared owner.
export const usePluginManager = (): PluginManagerValue => {
  const ctx = useContext(PluginManagerContext);
  if (!ctx) throw new Error("usePluginManager() must be used inside <PluginManagerProvider>");
  return ctx;
};

type Props = { children: ReactNode };

// Owns the plugin list and every currently-open floating PluginWindow.
// Renders {children} untouched (RightRail's PluginListPanel, wherever it
// ends up in the tree, reaches this via usePluginManager()) plus the
// floating windows themselves as siblings - those stay position: fixed at
// the same level regardless of which layout (wide/narrow) is currently
// showing RightRail.
const PluginManagerProvider = ({ children }: Props) => {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [openWindows, setOpenWindows] = useState<OpenWindow[]>([]);
  const [nextKey, setNextKey] = useState(0);

  const refreshPlugins = () => {
    listPlugins()
      .then(setPlugins)
      // A failed fetch (e.g. before the backend's finished starting) just
      // leaves the list empty rather than being surfaced as an error -
      // there's nothing actionable for the person to do about it beyond
      // pressing refresh again.
      .catch(() => setPlugins([]));
  };

  useEffect(refreshPlugins, []);

  const openPlugin = (plugin: PluginInfo) => {
    setOpenWindows((prev) => [...prev, { key: nextKey, plugin }]);
    setNextKey((k) => k + 1);
  };

  const closeWindow = (key: number) => {
    setOpenWindows((prev) => prev.filter((w) => w.key !== key));
  };

  return (
    <PluginManagerContext.Provider value={{ plugins, refreshPlugins, openPlugin }}>
      {children}

      {openWindows.map((openWindow, index) => (
        <PluginWindow
          key={openWindow.key}
          plugin={openWindow.plugin}
          initialOffset={{
            x: 80 + STAGGER_STEP * (index % STAGGER_MAX_STEPS),
            y: 80 + STAGGER_STEP * (index % STAGGER_MAX_STEPS),
          }}
          onClose={() => closeWindow(openWindow.key)}
        />
      ))}
    </PluginManagerContext.Provider>
  );
};

export default PluginManagerProvider;
