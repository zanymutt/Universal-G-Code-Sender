import { usePluginManager } from "./PluginManager";
import "./PluginListPanel.scss";

// Inline list for RightRail - same "grid of small buttons" look as
// MacrosPanel, since this sits in the same sidebar and should read as one
// more section of it, not a visually distinct widget.
const PluginListPanel = () => {
  const { plugins, openPlugin, pluginStates } = usePluginManager();

  if (plugins.length === 0) {
    return (
      <p className="pluginListEmpty">
        No plugins installed. Drop a plugin folder into the dashboard-plugins directory and reload.
      </p>
    );
  }

  return (
    <div className="pluginListPanel">
      {plugins.map((plugin) => (
        <button
          type="button"
          key={plugin.id}
          className="pluginListButton"
          data-state={pluginStates[plugin.id]}
          title={pluginStates[plugin.id] === "minimized"
            ? `Restore ${plugin.name}`
            : plugin.description || plugin.name}
          onClick={() => openPlugin(plugin)}
        >
          {plugin.iconUrl && <img src={plugin.iconUrl} alt="" className="pluginListIcon" />}
          <span className="pluginListLabel">{plugin.name}</span>
        </button>
      ))}
    </div>
  );
};

export default PluginListPanel;
