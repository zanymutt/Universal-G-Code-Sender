import { useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTableCells, faThumbtack } from "@fortawesome/free-solid-svg-icons";
import type { PluginInfo } from "../services/plugins";
import { filterPlugins, isPinned, TileMode } from "../utils/pluginPins";
import PluginBadge from "./PluginBadge";
import "./PluginGrid.scss";

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

// A button beside the Plugins heading that opens every installed plugin in a
// dialog, with a pin on each - the same kind of overlay as the macro editor.
// Pinned plugins are the ones the rail shows; the rest are only here. The cards
// flow into two columns when the dialog is wide enough.
const PluginGrid = ({ plugins, unpinned, states, mode, onMode, onTogglePin, onOpen }: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const shown = filterPlugins(plugins, query);
  const pinnedCount = plugins.filter((plugin) => isPinned(unpinned, plugin.id)).length;

  return (
    <>
      <Button
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
      <Modal
        show={open}
        onHide={() => setOpen(false)}
        centered
        scrollable
        dialogClassName="pluginGridDialog"
        aria-label="All plugins"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            All plugins <span className="pluginGridCount">{pinnedCount} of {plugins.length} pinned</span>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pluginGrid">
          <div className="pluginGridToolbar">
            {plugins.length >= SEARCH_FROM ? (
              <input
                type="search"
                className="form-control form-control-sm pluginGridSearch"
                placeholder="Find a plugin"
                aria-label="Find a plugin"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : (
              <span className="pluginGridSearch" />
            )}
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
        </Modal.Body>
      </Modal>
    </>
  );
};

export default PluginGrid;
