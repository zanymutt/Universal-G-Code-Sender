import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import type { PluginInfo } from "../services/plugins";
import "./PluginTray.scss";

type TrayItem = { key: number; plugin: PluginInfo };

type Props = {
  items: TrayItem[];
  onRestore: (key: number) => void;
  onClose: (key: number) => void;
};

const DEFAULT_BOTTOM = 64;
const GAP = 8;

// Sits just above the JobBar (whose height changes as it wraps on narrow
// screens) so a chip never covers the Start/Pause buttons. offsetHeight is
// in the same unscaled layout units as this fixed element's own coordinates,
// unlike getBoundingClientRect, which would be off whenever the dashboard
// zoom's transform is active.
const useJobBarClearance = (): number => {
  const [bottom, setBottom] = useState(DEFAULT_BOTTOM);
  useEffect(() => {
    const jobBar = document.querySelector<HTMLElement>(".jobBar");
    if (!jobBar) return;
    const update = () => setBottom(jobBar.offsetHeight + GAP);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(jobBar);
    return () => observer.disconnect();
  }, []);
  return bottom;
};

// One chip per minimized plugin window. The windows themselves stay mounted
// (hidden) in PluginManager - this is only the handle for getting them back.
const PluginTray = ({ items, onRestore, onClose }: Props) => {
  const bottom = useJobBarClearance();
  if (items.length === 0) return null;
  return (
    <div className="pluginTray" style={{ bottom }} role="toolbar" aria-label="Minimized plugins">
      {items.map(({ key, plugin }) => (
        <div className="pluginTrayChip" key={key}>
          <button type="button" className="pluginTrayRestore" onClick={() => onRestore(key)}
            title={`Restore ${plugin.name}`}>
            {plugin.iconUrl && <img src={plugin.iconUrl} alt="" className="pluginTrayIcon" />}
            <span className="pluginTrayLabel">{plugin.name}</span>
          </button>
          <button type="button" className="pluginTrayClose" onClick={() => onClose(key)}
            aria-label={`Close ${plugin.name}`} title="Close">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default PluginTray;
