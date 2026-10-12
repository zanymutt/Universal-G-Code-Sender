import { useEffect, useRef, useState } from "react";
import { Button } from "react-bootstrap";
import { useQuickLayouts } from "../hooks/useQuickLayouts";
import { readCurrentPaneLayout } from "../hooks/usePaneLayoutPresets";
import type { DashboardSizing } from "../hooks/useDashboardSizing";
import { paneContentLabel } from "../utils/pluginPanes";
import {
  colorHex,
  DEFAULT_QUICK_COLOR,
  makeQuickSlot,
  QUICK_COLORS,
  QuickColorId,
  QuickSlot,
  quickSlotMatches,
} from "../utils/quickLayouts";
import "./QuickLayouts.scss";

const HOLD_MS = 600;

type Props = {
  sizing: DashboardSizing;
  zoom: number;
  // Recalls a slot: the caller applies column widths, zoom and the pane layout.
  onRecall: (slot: QuickSlot) => void;
};

const describe = (slot: QuickSlot) => {
  const panes = slot.panes
    ? `${slot.panes.panes.length} pane${slot.panes.panes.length === 1 ? "" : "s"}: ${slot.panes.panes
        .map((pane) => paneContentLabel(pane.content))
        .join(" · ")}`
    : "panes unchanged";
  return `${panes}; zoom ${slot.zoom}%`;
};

// Four numbered one-tap layouts. Tap recalls the saved layout and panes; an
// empty slot, or a press and hold / right click on any slot, opens a small
// editor to save the current layout there and choose its colour.
const QuickLayouts = ({ sizing, zoom, onRecall }: Props) => {
  const { slots, setSlot } = useQuickLayouts();
  const [editing, setEditing] = useState<number | null>(null);
  const [color, setColor] = useState<QuickColorId>(DEFAULT_QUICK_COLOR);
  // Whether the pane layout in storage has changed since a slot was marked.
  const [, bump] = useState(0);
  const holdTimer = useRef<number | null>(null);
  const heldOpen = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  // Slots mark themselves active when the panes match, so re-check when the
  // pane layout changes.
  useEffect(() => {
    const refresh = () => bump((n) => n + 1);
    window.addEventListener("ugs-pane-layouts-changed", refresh);
    return () => window.removeEventListener("ugs-pane-layouts-changed", refresh);
  }, []);

  useEffect(() => {
    if (editing === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setEditing(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditing(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [editing]);

  const openEditor = (index: number) => {
    setColor(slots[index]?.color ?? DEFAULT_QUICK_COLOR);
    setEditing(index);
  };

  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const currentPanes = readCurrentPaneLayout();

  return (
    <div className="quickLayouts" ref={root} role="group" aria-label="Quick layouts">
      {slots.map((slot, index) => {
        const active = quickSlotMatches(slot, sizing, zoom, currentPanes);
        const hex = slot ? colorHex(slot.color) : undefined;
        return (
          <div className="quickLayoutSlot" key={index}>
            <button
              type="button"
              className={`quickLayoutButton${slot ? " quickLayoutFilled" : ""}${active ? " quickLayoutActive" : ""}`}
              style={hex ? ({ "--quick-color": hex } as React.CSSProperties) : undefined}
              aria-pressed={active}
              aria-label={slot ? `Layout ${index + 1}: ${describe(slot)}` : `Layout ${index + 1} (empty)`}
              title={
                slot
                  ? `Layout ${index + 1} - ${describe(slot)}. Press and hold to change.`
                  : `Layout ${index + 1} is empty. Tap to save the current layout here.`
              }
              onPointerDown={() => {
                heldOpen.current = false;
                clearHold();
                holdTimer.current = window.setTimeout(() => {
                  holdTimer.current = null;
                  heldOpen.current = true;
                  openEditor(index);
                }, HOLD_MS);
              }}
              onPointerUp={clearHold}
              onPointerLeave={clearHold}
              onPointerCancel={clearHold}
              // Right click (or a touch long press reported as a context menu).
              // No click follows a right click, so there is nothing to suppress.
              onContextMenu={(event) => {
                event.preventDefault();
                clearHold();
                openEditor(index);
              }}
              onClick={() => {
                // The click that ends a press-and-hold must not also recall.
                if (heldOpen.current) {
                  heldOpen.current = false;
                  return;
                }
                if (slot) onRecall(slot);
                else openEditor(index);
              }}
            >
              {index + 1}
            </button>

            {editing === index && (
              <div className="quickLayoutEditor" role="dialog" aria-label={`Layout ${index + 1}`}>
                <div className="quickLayoutEditorTitle">Layout {index + 1}</div>
                <div className="quickLayoutSwatches" role="radiogroup" aria-label="Colour">
                  {QUICK_COLORS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={color === option.id}
                      aria-label={option.label}
                      title={option.label}
                      className={`quickLayoutSwatch${color === option.id ? " quickLayoutSwatchOn" : ""}`}
                      style={{ background: option.hex }}
                      onClick={() => setColor(option.id)}
                    />
                  ))}
                </div>
                <p className="quickLayoutEditorHint">
                  Saves the column widths, zoom and panes as they are now.
                </p>
                <div className="quickLayoutEditorButtons">
                  <Button
                    size="sm"
                    onClick={() => {
                      setSlot(index, makeQuickSlot(color, sizing, zoom, readCurrentPaneLayout()));
                      setEditing(null);
                    }}
                  >
                    Save current here
                  </Button>
                  {slot && (
                    <Button
                      size="sm"
                      variant="outline-danger"
                      onClick={() => {
                        setSlot(index, null);
                        setEditing(null);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default QuickLayouts;
