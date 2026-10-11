import { createContext, ReactNode, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { listPlugins, PluginInfo } from "../services/plugins";
import PluginWindow from "./PluginWindow";
import PluginTray from "./PluginTray";
import { initialPluginWindows, pluginWindowsReducer, PluginWindowsState } from "../store/pluginWindows";
import { PANE_PLUGIN_CLOSED_EVENT, PANE_SET_CONTENT_EVENT, paneContentLabel, pluginContent } from "../utils/pluginPanes";

// Staggers each newly opened window a bit further down/right than the last
// so opening several plugins in a row doesn't stack them in an identical
// spot - purely cosmetic, wraps back to the top-left offset once it'd
// otherwise walk a window off the visible area.
const STAGGER_STEP = 28;
const STAGGER_MAX_STEPS = 10;

// A center-layout pane a floating plugin window can be docked into, as
// published by CenterPaneLayoutDemo (empty whenever that layout isn't mounted).
export type DockTarget = { id: number; content: string };

type PluginManagerValue = {
  plugins: PluginInfo[];
  // False until the first plugin list fetch has settled, so a layout that
  // names a plugin doesn't call it "not installed" just because it's early.
  pluginsLoaded: boolean;
  windows: PluginWindowsState["windows"];
  // Layout-driven docking (see utils/pluginPanes planPluginDocking).
  dockInto: (plugin: PluginInfo, slot: string) => void;
  parkWindow: (key: number) => void;
  floatWindow: (key: number) => void;
  closeWindow: (key: number) => void;
  dockTargets: DockTarget[];
  setDockTargets: (targets: DockTarget[]) => void;
  // Ask the layout to show this plugin in that pane.
  requestDock: (pluginId: string, paneId: number) => void;
  refreshPlugins: () => void;
  openPlugin: (plugin: PluginInfo) => void;
  // Per plugin id: "open" if any of its windows is showing, "minimized" if it
  // has windows but all are minimized, absent if none. Lets the list panel
  // mark which plugins are already running.
  pluginStates: Record<string, "open" | "minimized">;
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
  const [pluginsLoaded, setPluginsLoaded] = useState(false);
  const [dockTargets, setDockTargets] = useState<DockTarget[]>([]);
  const [windowState, dispatchWindow] = useReducer(pluginWindowsReducer, initialPluginWindows);

  const refreshPlugins = () => {
    listPlugins()
      .then((list) => {
        setPlugins(list);
        setPluginsLoaded(true);
      })
      // A failed fetch (e.g. before the backend's finished starting) just
      // leaves the list empty rather than being surfaced as an error -
      // there's nothing actionable for the person to do about it beyond
      // pressing refresh again.
      .catch(() => {
        setPlugins([]);
        setPluginsLoaded(true);
      });
  };

  useEffect(refreshPlugins, []);

  const openPlugin = (plugin: PluginInfo) => {
    dispatchWindow({ type: "open", plugin });
  };

  const closeWindow = (key: number) => {
    const closing = windowState.windows.find((w) => w.key === key);
    // A docked plugin is what a pane is showing: tell the layout it's gone so
    // that pane picks something else, instead of reopening it on the spot.
    if (closing?.dockSlot) {
      window.dispatchEvent(new CustomEvent(PANE_PLUGIN_CLOSED_EVENT, { detail: { pluginId: closing.plugin.id } }));
    }
    dispatchWindow({ type: "close", key });
  };

  const dockInto = (plugin: PluginInfo, slot: string) => dispatchWindow({ type: "openDocked", plugin, slot });
  const parkWindow = (key: number) => dispatchWindow({ type: "park", key });
  const floatWindow = (key: number) => dispatchWindow({ type: "float", key });
  const requestDock = (pluginId: string, paneId: number) => {
    window.dispatchEvent(new CustomEvent(PANE_SET_CONTENT_EVENT, { detail: { paneId, content: pluginContent(pluginId) } }));
  };

  // What a floating window's Dock control offers: one entry per pane of the
  // center layout, named by position and what it's showing right now.
  const dockOptions = dockTargets.map((target, index) => ({
    id: target.id,
    label: `Pane ${index + 1}: ${paneContentLabel(target.content, plugins.find((p) => `plugin:${p.id}` === target.content)?.name)}`,
  }));

  const pluginStates = useMemo(() => {
    const states: Record<string, "open" | "minimized"> = {};
    for (const w of windowState.windows) {
      if (!w.minimized) states[w.plugin.id] = "open";
      else if (!states[w.plugin.id]) states[w.plugin.id] = "minimized";
    }
    return states;
  }, [windowState.windows]);

  return (
    <PluginManagerContext.Provider value={{
      plugins, pluginsLoaded, refreshPlugins, openPlugin, pluginStates,
      windows: windowState.windows, dockInto, parkWindow, floatWindow, closeWindow,
      dockTargets, setDockTargets, requestDock,
    }}>
      {children}

      {windowState.windows.map((openWindow, index) => (
        <PluginWindow
          key={openWindow.key}
          plugin={openWindow.plugin}
          isFront={windowState.frontKey === openWindow.key}
          focusRequest={openWindow.focusRequest}
          dockSlot={openWindow.dockSlot}
          dockOptions={dockOptions}
          onDock={(paneId) => requestDock(openWindow.plugin.id, paneId)}
          onActivate={() => dispatchWindow({ type: "activate", key: openWindow.key })}
          initialOffset={{
            x: 80 + STAGGER_STEP * (index % STAGGER_MAX_STEPS),
            y: 80 + STAGGER_STEP * (index % STAGGER_MAX_STEPS),
          }}
          onClose={() => closeWindow(openWindow.key)}
          minimized={openWindow.minimized}
          onMinimize={() => dispatchWindow({ type: "minimize", key: openWindow.key })}
        />
      ))}

      <PluginTray
        items={windowState.windows.filter(w => w.minimized)}
        onRestore={(key) => dispatchWindow({ type: "restore", key })}
        onClose={closeWindow}
      />
    </PluginManagerContext.Provider>
  );
};

export default PluginManagerProvider;
