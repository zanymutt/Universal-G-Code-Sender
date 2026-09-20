import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import type { PluginInfo } from "../services/plugins";
import { layoutRect } from "../utils/layoutRect";
import "./PluginTray.scss";

type TrayItem = { key: number; plugin: PluginInfo };

type Props = {
  items: TrayItem[];
  onRestore: (key: number) => void;
  onClose: (key: number) => void;
};

const DEFAULT_BOTTOM = 64;
const GAP = 8;
const CHIP_HEIGHT = 36;
// Less free room than this in the top bar and the chips would be squeezed into
// nothing, so they fall back to sitting above the job bar instead.
const MIN_TOP_WIDTH = 160;

type Placement =
  | { mode: "top"; left: number; top: number; width: number }
  | { mode: "bottom"; bottom: number };

const samePlacement = (a: Placement, b: Placement) =>
  a.mode === "top" && b.mode === "top"
    ? Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5
    : a.mode === "bottom" && b.mode === "bottom" && a.bottom === b.bottom;

// Chips float over the top bar, in the empty stretch between its two sections
// (connection on the left, view/zoom/reset buttons on the right) so they never
// cover a control. When the top bar wraps onto several rows (tablet/narrow
// layouts) there's no such stretch, and they sit just above the job bar
// (whose height changes as it wraps) so a chip never covers Start/Pause.
// Everything is measured in the unscaled layout units this fixed element's own
// coordinates use (see layoutRect) rather than getBoundingClientRect's scaled ones.
const usePlacement = (): Placement => {
  const [placement, setPlacement] = useState<Placement>({ mode: "bottom", bottom: DEFAULT_BOTTOM });
  useEffect(() => {
    const topBar = document.querySelector<HTMLElement>(".topBar");
    const jobBar = document.querySelector<HTMLElement>(".jobBar");
    const sections = topBar ? Array.from(topBar.querySelectorAll<HTMLElement>(":scope > .topBarSection")) : [];

    const measure = (): Placement => {
      if (topBar && sections.length === 2) {
        const bar = layoutRect(topBar);
        const first = layoutRect(sections[0]);
        const second = layoutRect(sections[1]);
        const sameRow = first.top < second.top + second.height && second.top < first.top + first.height;
        const left = first.left + first.width + GAP * 2;
        const width = second.left - GAP * 2 - left;
        if (sameRow && width >= MIN_TOP_WIDTH) {
          return { mode: "top", left, width, top: bar.top + (bar.height - CHIP_HEIGHT) / 2 };
        }
      }
      return { mode: "bottom", bottom: (jobBar?.offsetHeight ?? DEFAULT_BOTTOM - GAP) + GAP };
    };
    const update = () => {
      const next = measure();
      setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
    };

    update();
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    [topBar, jobBar, ...sections].forEach((element) => element && observer?.observe(element));
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, []);
  return placement;
};

// One chip per minimized plugin window. The windows themselves stay mounted
// (hidden) in PluginManager - this is only the handle for getting them back.
const PluginTray = ({ items, onRestore, onClose }: Props) => {
  const placement = usePlacement();
  if (items.length === 0) return null;
  return (
    <div
      className={"pluginTray" + (placement.mode === "top" ? " pluginTrayTop" : "")}
      style={
        placement.mode === "top"
          ? { left: placement.left, top: placement.top, width: placement.width }
          : { bottom: placement.bottom }
      }
      role="toolbar"
      aria-label="Minimized plugins"
    >
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
