import { usePluginManager } from "./PluginManager";
import { usePluginPins, usePluginTileMode } from "../hooks/useRailPrefs";
import { pinnedPlugins } from "../utils/pluginPins";
import PluginGrid from "./PluginGrid";
import PluginListPanel from "./PluginListPanel";
import RailHeading from "./RailHeading";

type Props = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

// The rail's Plugins section: a foldable heading with the all-plugins grid
// button beside it, and the pinned plugins as named buttons or icon tiles.
const PluginsSection = ({ collapsed, onToggleCollapsed }: Props) => {
  const { plugins, openPlugin, pluginStates } = usePluginManager();
  const { unpinned, toggle } = usePluginPins();
  const { mode, setMode } = usePluginTileMode();
  const pinned = pinnedPlugins(plugins, unpinned);

  return (
    <div className={`rightRailSection${collapsed ? " rightRailCollapsed" : ""}`}>
      <div className="rightRailSectionHeader">
        <RailHeading
          id="plugins"
          title={`Plugins${plugins.length > 0 ? ` (${pinned.length}/${plugins.length})` : ""}`}
          collapsed={collapsed}
          onToggle={onToggleCollapsed}
        />
        {plugins.length > 0 && (
          <PluginGrid
            plugins={plugins}
            unpinned={unpinned}
            states={pluginStates}
            mode={mode}
            onMode={setMode}
            onTogglePin={toggle}
            onOpen={openPlugin}
          />
        )}
      </div>
      <div id="rail-section-plugins" hidden={collapsed}>
        <PluginListPanel plugins={pinned} mode={mode} allUnpinned={plugins.length > 0 && pinned.length === 0} />
      </div>
    </div>
  );
};

export default PluginsSection;
