import { usePluginManager } from "./PluginManager";
import PluginBadge from "./PluginBadge";
import type { PluginInfo } from "../services/plugins";
import type { TileMode } from "../utils/pluginPins";
import "./PluginListPanel.scss";

type Props = {
  // The plugins to show: the pinned ones.
  plugins: PluginInfo[];
  mode: TileMode;
  // True when plugins are installed but none are pinned, so the empty message
  // can point at the grid instead of at the install folder.
  allUnpinned: boolean;
};

// Inline list for RightRail - the same "grid of small buttons" look as
// MacrosPanel, since this sits in the same sidebar and should read as one more
// section of it. Icon tiles are one row of squares instead of a column of
// named buttons, which is what keeps the rail short as plugins pile up.
const PluginListPanel = ({ plugins, mode, allUnpinned }: Props) => {
  const { plugins: installed, openPlugin, pluginStates } = usePluginManager();

  if (installed.length === 0) {
    return (
      <p className="pluginListEmpty">
        No plugins installed. Drop a plugin folder into the dashboard-plugins directory and reload.
      </p>
    );
  }

  if (plugins.length === 0) {
    return (
      <p className="pluginListEmpty">
        {allUnpinned ? "No plugins are pinned here. Open the grid to pin the ones you use." : "No plugins to show."}
      </p>
    );
  }

  const iconsOnly = mode === "icons";

  return (
    <div className={`pluginListPanel${iconsOnly ? " pluginListIconsOnly" : ""}`}>
      {plugins.map((plugin) => {
        const state = pluginStates[plugin.id];
        const restoring = state === "minimized";
        const title = restoring
          ? `Restore ${plugin.name}`
          : iconsOnly
            ? plugin.description ? `${plugin.name} - ${plugin.description}` : plugin.name
            : plugin.description || plugin.name;
        return (
          <button
            type="button"
            key={plugin.id}
            className="pluginListButton"
            data-state={state}
            title={title}
            aria-label={plugin.name}
            onClick={() => openPlugin(plugin)}
          >
            <PluginBadge id={plugin.id} name={plugin.name} iconUrl={plugin.iconUrl} size={iconsOnly ? 26 : 18} />
            {!iconsOnly && <span className="pluginListLabel">{plugin.name}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default PluginListPanel;
