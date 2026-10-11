// Glue between the center pane layout and plugin windows. The layout is the
// source of truth for "which plugin is shown in which pane" (a pane's content
// is the string "plugin:<id>"); plugin windows are brought in line with it by
// planPluginDocking below, so there's one place that decides, not two that
// have to be kept in step.

const PLUGIN_PREFIX = "plugin:";

export const pluginContent = (pluginId: string): string => `${PLUGIN_PREFIX}${pluginId}`;

export const pluginIdFromContent = (content: string): string | null =>
  content.startsWith(PLUGIN_PREFIX) && content.length > PLUGIN_PREFIX.length
    ? content.slice(PLUGIN_PREFIX.length)
    : null;

const BUILT_IN_LABELS: Record<string, string> = {
  visualize: "Visualize",
  edit: "Edit",
  macros: "Macros",
  probe: "Probe",
  console: "Console",
};

// A short display name for a pane's content. `pluginName` is the installed
// plugin's name when the caller has it; without it a plugin falls back to its id.
export const paneContentLabel = (content: string, pluginName?: string): string => {
  const pluginId = pluginIdFromContent(content);
  return pluginId === null ? BUILT_IN_LABELS[content] ?? content : pluginName ?? pluginId;
};

// The id of the element (data-plugin-dock-slot) a pane's body carries when it
// shows a plugin - see useDockRect.
export const paneDockSlot = (paneId: number): string => `pane-${paneId}`;

// Something outside the layout (a floating window's Dock control) asking for
// a pane to show some content. detail: { paneId: number; content: string }.
export const PANE_SET_CONTENT_EVENT = "ugs-pane-set-content";

// A docked plugin's window was closed, so any pane showing it has to show
// something else instead. detail: { pluginId: string }.
export const PANE_PLUGIN_CLOSED_EVENT = "ugs-pane-plugin-closed";

type PanePlan = { id: number; content: string };
type WindowPlan = { key: number; plugin: { id: string }; dockSlot: string | null };

export type PluginDockingPlan<P> = {
  // Plugins that should be opened (or moved) into a slot.
  dock: { plugin: P; slot: string }[];
  // Docked windows whose pane no longer shows them: kept running, hidden.
  park: number[];
};

// What has to change for the windows to match the panes. Idempotent: applying
// the plan and planning again gives an empty plan, which is what lets it run
// as a plain effect on every layout/window change without looping.
//
// A plugin is shown in at most one pane (the first pane naming it wins);
// a pane naming a plugin that isn't installed is left alone - it renders a
// placeholder rather than anything being opened.
export function planPluginDocking<P extends { id: string }>(
  panes: PanePlan[],
  plugins: P[],
  windows: WindowPlan[],
): PluginDockingPlan<P> {
  const wanted = new Map<string, string>(); // slot -> plugin id
  const claimed = new Set<string>();
  for (const pane of panes) {
    const id = pluginIdFromContent(pane.content);
    if (id === null || claimed.has(id)) continue;
    claimed.add(id);
    wanted.set(paneDockSlot(pane.id), id);
  }

  const dock: PluginDockingPlan<P>["dock"] = [];
  wanted.forEach((pluginId, slot) => {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return;
    const alreadyThere = windows.some((w) => w.plugin.id === pluginId && w.dockSlot === slot);
    if (!alreadyThere) dock.push({ plugin, slot });
  });

  const park = windows
    .filter((w) => w.dockSlot !== null && wanted.get(w.dockSlot) !== w.plugin.id)
    // A window that's about to be moved into another slot by `dock` above is
    // being re-docked, not parked.
    .filter((w) => !dock.some((d) => d.plugin.id === w.plugin.id))
    .map((w) => w.key);

  return { dock, park };
}
