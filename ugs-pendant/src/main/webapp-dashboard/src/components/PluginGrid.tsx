import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTableCells, faThumbtack } from "@fortawesome/free-solid-svg-icons";
import type { PluginInfo } from "../services/plugins";
import { layoutRect, layoutScale } from "../utils/layoutRect";
import { placePopover } from "../utils/placePopover";
import { filterPlugins, isPinned, TileMode } from "../utils/pluginPins";
import PluginBadge from "./PluginBadge";
import "./PluginGrid.scss";

const POPOVER_WIDTH = 380;
// Past this many plugins a search box is worth its row.
const SEARCH_FROM = 6;

type Props = {
  plugins: PluginInfo[];
  unpinned: string[];
  states: Record<string, "open" | "minimized">;
  mode: TileMode;
  onMode: (mode: TileMode) => void;
  onTogglePin: (id: string) => void;
  onOpen: (plugin: PluginInfo) => void;
};

// A button beside the Plugins heading that pops out every installed plugin in a
// grid, with a pin on each. Pinned plugins are the ones the rail shows; the
// rest are only here. Measured and placed with placePopover, rendered into .app
// (inside the zoom transform) exactly like SimulationSettings, so it fits on a
// short screen and is never clipped by the rail's own scrolling.
const PluginGrid = ({ plugins, unpinned, states, mode, onMode, onTogglePin, onOpen }: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const toggle = toggleRef.current;
    const popover = popoverRef.current;
    if (!toggle || !popover) return;
    const scale = layoutScale(toggle);
    const anchor = layoutRect(toggle);
    popover.style.maxHeight = "none";
    popover.style.overflowY = "visible";
    popover.style.width = `${POPOVER_WIDTH}px`;
    const placement = placePopover(
      { left: anchor.left, top: anchor.top, right: anchor.left + anchor.width, bottom: anchor.top + anchor.height },
      { width: POPOVER_WIDTH, height: popover.scrollHeight },
      { width: window.innerWidth / scale, height: window.innerHeight / scale }
    );
    popover.style.left = `${placement.left}px`;
    popover.style.top = `${placement.top}px`;
    popover.style.width = `${placement.width}px`;
    if (placement.maxHeight !== null) {
      popover.style.maxHeight = `${placement.maxHeight}px`;
      popover.style.overflowY = "auto";
    }
    popover.style.visibility = "visible";
  };

  useLayoutEffect(() => {
    if (open) place();
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !toggleRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (toggleRef.current) observer?.observe(toggleRef.current);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = filterPlugins(plugins, query);
  const pinnedCount = plugins.filter((plugin) => isPinned(unpinned, plugin.id)).length;

  return (
    <>
      <Button
        ref={toggleRef}
        size="sm"
        variant="outline-secondary"
        className="pluginGridToggle"
        title="All plugins - pin the ones you want on the rail"
        aria-label="All plugins"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
      >
        <FontAwesomeIcon icon={faTableCells} />
      </Button>
      {open &&
        createPortal(
          <div ref={popoverRef} className="pluginGrid" role="dialog" aria-label="All plugins" style={{ visibility: "hidden" }}>
            <div className="pluginGridHeader">
              <span className="pluginGridTitle">
                All plugins <span className="pluginGridCount">{pinnedCount} of {plugins.length} pinned</span>
              </span>
              <span className="pluginGridModes" role="group" aria-label="Rail style">
                <Button
                  size="sm"
                  variant={mode === "names" ? "secondary" : "outline-secondary"}
                  aria-pressed={mode === "names"}
                  onClick={() => onMode("names")}
                >
                  Names
                </Button>
                <Button
                  size="sm"
                  variant={mode === "icons" ? "secondary" : "outline-secondary"}
                  aria-pressed={mode === "icons"}
                  onClick={() => onMode("icons")}
                >
                  Icons
                </Button>
              </span>
            </div>

            {plugins.length >= SEARCH_FROM && (
              <input
                type="search"
                className="form-control form-control-sm pluginGridSearch"
                placeholder="Find a plugin"
                aria-label="Find a plugin"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}

            <div className="pluginGridCards">
              {shown.length === 0 && <p className="pluginGridNone">No plugin matches.</p>}
              {shown.map((plugin) => {
                const pinned = isPinned(unpinned, plugin.id);
                const state = states[plugin.id];
                return (
                  <div className={`pluginGridCard${pinned ? " pluginGridCardPinned" : ""}`} key={plugin.id}>
                    <button
                      type="button"
                      className="pluginGridOpen"
                      data-state={state}
                      onClick={() => {
                        onOpen(plugin);
                        setOpen(false);
                      }}
                      title={state === "minimized" ? `Restore ${plugin.name}` : `Open ${plugin.name}`}
                    >
                      <PluginBadge id={plugin.id} name={plugin.name} iconUrl={plugin.iconUrl} size={32} />
                      <span className="pluginGridText">
                        <span className="pluginGridName">{plugin.name}</span>
                        {plugin.description && <span className="pluginGridDescription">{plugin.description}</span>}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="pluginGridPin"
                      aria-pressed={pinned}
                      aria-label={pinned ? `Unpin ${plugin.name} from the rail` : `Pin ${plugin.name} to the rail`}
                      title={pinned ? "Pinned to the rail - click to unpin" : "Not on the rail - click to pin"}
                      onClick={() => onTogglePin(plugin.id)}
                    >
                      <FontAwesomeIcon icon={faThumbtack} />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="pluginGridHint">Pinned plugins show on the rail. Others open from here.</p>
          </div>,
          document.querySelector(".app") ?? document.body
        )}
    </>
  );
};

export default PluginGrid;
