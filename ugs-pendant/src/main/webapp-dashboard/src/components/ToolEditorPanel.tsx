import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faRotateLeft, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { clampPanelPosition, placeFloatingPanel } from "../utils/floatingPanel";
import { layoutRect, layoutScale } from "../utils/layoutRect";
import { CutterSpec, StockShape } from "../utils/stockSimEngine";
import {
  addTool,
  deleteTool,
  MAX_TOOL_NUMBER,
  resetTool,
  restoreTool,
  SavedTools,
  setToolColor,
  setToolCutter,
  ToolRow,
} from "../utils/toolTable";
import ColorPicker from "./ColorPicker";
import ConfirmDialog from "./ConfirmDialog";
import "./ToolEditorPanel.scss";

const PANEL_WIDTH = 780;

// A number cell: keeps its own text while typing (so clearing the box to retype
// doesn't fight the committed value) and commits only valid values in range.
const Cell = ({
  label,
  value,
  min,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onCommit: (value: number) => void;
}) => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Form.Control
      size="sm"
      type="number"
      inputMode="decimal"
      aria-label={label}
      min={min}
      step={step}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const next = Number(event.target.value);
        if (event.target.value !== "" && Number.isFinite(next) && next >= min) onCommit(next);
      }}
    />
  );
};

const NotApplicable = () => (
  <span className="toolEditorNotApplicable" aria-hidden="true">
    &ndash;
  </span>
);

type Props = {
  rows: ToolRow[];
  saved: SavedTools;
  // The cutter used for anything the table doesn't list.
  base: CutterSpec;
  // The settings popover, so the panel can open beside it.
  anchorRef: RefObject<HTMLElement | null>;
  // Owned by the caller so the popover's outside-click check can treat the panel as inside it.
  panelRef: RefObject<HTMLDivElement | null>;
  onChange: (saved: SavedTools) => void;
  onClose: () => void;
  // The plotter's pen table: the same panel with a name and a line width in place of the cutter shape.
  pens?: boolean;
};

// The Stock view's tool table as a floating grid. It never blocks the page: no
// backdrop, and the carve behind it keeps redrawing as a cutter is edited. Drag
// it by its header. Edit a cell to change that tool's cutter, the swatch for its
// color; Reset goes back to what the file says, Delete drops the tool so it is
// cut with the default cutter (Restore undoes that), Add sets up a tool number
// the file doesn't mention.
const ToolEditorPanel = ({ rows, saved, base, anchorRef, panelRef, onChange, onClose, pens = false }: Props) => {
  const label = (tool: number) => (pens ? `Pen ${tool}` : `T${tool}`);
  const noun = pens ? "pen" : "tool";
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState({ width: PANEL_WIDTH, maxHeight: 600 });
  const [newTool, setNewTool] = useState("");
  // Tools saved from an earlier file but not named in this one do nothing to the
  // carve, so they stay out of the way unless asked for (or just added).
  const [showSaved, setShowSaved] = useState(false);
  // "Reset all" forgets every saved tool - not only those in this file - so it asks first.
  const [confirmingResetAll, setConfirmingResetAll] = useState(false);
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number; scale: number } | null>(null);

  const parsed = newTool.trim() === "" ? null : Number(newTool);
  const valid = parsed !== null && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_TOOL_NUMBER;
  const exists = valid && rows.some((row) => row.tool === parsed);
  const anySaved = Object.keys(saved).length > 0;
  const savedOnlyCount = rows.filter((row) => !row.inFile).length;
  const savedCount = Object.keys(saved).length;
  const visibleRows = showSaved ? rows : rows.filter((row) => row.inFile);

  const viewportOf = (element: HTMLElement) => {
    const scale = layoutScale(element);
    return { scale, width: window.innerWidth / scale, height: window.innerHeight / scale };
  };

  // First placement: beside the settings popover when there is room.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || position) return;
    const viewport = viewportOf(panel);
    const anchorElement = anchorRef.current;
    const anchor = anchorElement ? layoutRect(anchorElement) : null;
    const placed = placeFloatingPanel(
      anchor ? { left: anchor.left, top: anchor.top, right: anchor.left + anchor.width, bottom: anchor.top + anchor.height } : null,
      { width: PANEL_WIDTH, height: panel.scrollHeight },
      viewport
    );
    setSize({ width: placed.width, maxHeight: placed.maxHeight });
    setPosition({ left: placed.left, top: placed.top });
  }, [position, panelRef, anchorRef]);

  // A smaller window must not strand the panel off screen.
  useEffect(() => {
    const onResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const viewport = viewportOf(panel);
      setPosition((current) => (current ? clampPanelPosition(current.left, current.top, size.width, viewport) : current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width]);

  const add = () => {
    if (!valid || exists || parsed === null) return;
    onChange(addTool(saved, parsed, base));
    setShowSaved(true);
    setNewTool("");
  };

  const edit = (row: ToolRow, patch: Partial<CutterSpec>) => onChange(setToolCutter(saved, row.tool, { ...row.cutter, ...patch }));

  return (
    <>
      {createPortal(
    <div
      ref={panelRef}
      className={`toolEditorPanel${pens ? " toolEditorPens" : ""}`}
      role="dialog"
      aria-label={pens ? "Pen editor" : "Tool editor"}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        width: size.width,
        maxHeight: size.maxHeight,
        visibility: position ? "visible" : "hidden",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="toolEditorHeader"
        onPointerDown={(event) => {
          const panel = panelRef.current;
          if (!panel || !position || (event.target as HTMLElement).closest("button")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: position.left,
            top: position.top,
            scale: layoutScale(panel),
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          const panel = panelRef.current;
          if (!current || current.pointer !== event.pointerId || !panel) return;
          setPosition(
            clampPanelPosition(
              current.left + (event.clientX - current.x) / current.scale,
              current.top + (event.clientY - current.y) / current.scale,
              size.width,
              viewportOf(panel)
            )
          );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <strong>{pens ? "Pens" : "Tools"}</strong>
        <span className="toolEditorHeaderHint">
          Drag to move. The {pens ? "drawing" : "carve"} updates as you edit.
        </span>
        <Button
          size="sm"
          variant="outline-secondary"
          aria-label={pens ? "Close pen editor" : "Close tool editor"}
          title="Close"
          onClick={onClose}
        >
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </div>

      <div className="toolEditorBody">
        {visibleRows.length === 0 ? (
          <div className="toolEditorEmpty">
            {pens
              ? "This file has no pen changes, so everything is drawn with the default pen in the settings. Add a pen number to set one up ahead of time; it takes effect when a file uses it."
              : "This file has no tool changes, so everything is cut with the cutter in the settings. Add a tool number to set one up ahead of time; it takes effect when a file uses it."}
          </div>
        ) : (
          <div className="toolEditorGrid" role="table" aria-label={pens ? "Pens" : "Tools"}>
            <div className="toolEditorRow toolEditorColumns" role="row">
              <span role="columnheader">{pens ? "Pen" : "Tool"}</span>
              {pens ? (
                <>
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Line width (mm)</span>
                </>
              ) : (
                <>
                  <span role="columnheader" className="toolEditorShapeColumn">
                    Shape
                  </span>
                  <span role="columnheader">Diameter (mm)</span>
                  <span role="columnheader">Angle (&deg;)</span>
                  <span role="columnheader">Corner radius (mm)</span>
                  <span role="columnheader" title="V-bit: width of the flat tip. Taper ball: diameter of the tip ball.">
                    Tip (mm)
                  </span>
                </>
              )}
              <span role="columnheader">
                <span className="visually-hidden">Actions</span>
              </span>
            </div>
            {visibleRows.map((row) => {
              const { cutter } = row;
              const angled = cutter.shape === "v" || cutter.shape === "taperball";
              return (
                <div
                  key={row.tool}
                  role="row"
                  className={`toolEditorRow${row.removed ? " toolEditorRowRemoved" : ""}`}
                >
                  <div className="toolEditorIdentity">
                    <ColorPicker
                      className="toolEditorSwatch"
                      aria-label={`${label(row.tool)} color`}
                      title={pens ? "Ink color for this pen" : "Color for this tool"}
                      value={row.color}
                      disabled={row.removed}
                      onCommit={(color) => onChange(setToolColor(saved, row.tool, color))}
                    />
                    <strong>{label(row.tool)}</strong>
                    {!row.inFile && !row.removed && <span className="toolEditorBadge">not in file</span>}
                  </div>
                  {row.removed ? (
                    <div className="toolEditorRemovedNote">
                      Removed: uses the default {pens ? "pen" : "cutter"}
                    </div>
                  ) : pens ? (
                    <div className="toolEditorFields">
                      <label>
                        <span className="toolEditorCellLabel">Name</span>
                        <span className="toolEditorPenName" title={row.name}>
                          {row.name ?? <NotApplicable />}
                        </span>
                      </label>
                      <label>
                        <span className="toolEditorCellLabel">Line width (mm)</span>
                        <Cell
                          label={`${label(row.tool)} line width`}
                          value={cutter.diameter}
                          min={0.01}
                          step={0.05}
                          onCommit={(diameter) => edit(row, { diameter })}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="toolEditorFields">
                      <label className="toolEditorShapeColumn">
                        <span className="toolEditorCellLabel">Shape</span>
                        <Form.Select
                          size="sm"
                          aria-label={`T${row.tool} shape`}
                          value={cutter.shape}
                          onChange={(event) => {
                            const shape = event.target.value as StockShape;
                            // A taper ball needs a tip ball; a zero tip would just be a sharp cone.
                            edit(row, shape === "taperball" && cutter.tipDiameter === 0 ? { shape, tipDiameter: 1 } : { shape });
                          }}
                        >
                          <option value="flat">Flat end mill</option>
                          <option value="ball">Ball nose</option>
                          <option value="bullnose">Bull nose</option>
                          <option value="v">V-bit / chamfer</option>
                          <option value="taperball">Taper ball nose</option>
                        </Form.Select>
                      </label>
                      <label>
                        <span className="toolEditorCellLabel">Diameter (mm)</span>
                        <Cell
                          label={`T${row.tool} diameter`}
                          value={cutter.diameter}
                          min={0.01}
                          step={0.5}
                          onCommit={(diameter) => edit(row, { diameter })}
                        />
                      </label>
                      <label>
                        <span className="toolEditorCellLabel">Angle (&deg;)</span>
                        {angled ? (
                          <Cell
                            label={`T${row.tool} included angle`}
                            value={cutter.vAngle}
                            min={10}
                            step={5}
                            onCommit={(vAngle) => edit(row, { vAngle })}
                          />
                        ) : (
                          <NotApplicable />
                        )}
                      </label>
                      <label>
                        <span className="toolEditorCellLabel">Corner radius (mm)</span>
                        {cutter.shape === "bullnose" ? (
                          <Cell
                            label={`T${row.tool} corner radius`}
                            value={cutter.cornerRadius}
                            min={0}
                            step={0.25}
                            onCommit={(cornerRadius) => edit(row, { cornerRadius })}
                          />
                        ) : (
                          <NotApplicable />
                        )}
                      </label>
                      <label>
                        <span className="toolEditorCellLabel">Tip (mm)</span>
                        {angled ? (
                          <Cell
                            label={`T${row.tool} tip diameter`}
                            value={cutter.tipDiameter}
                            min={0}
                            step={0.1}
                            onCommit={(tipDiameter) => edit(row, { tipDiameter })}
                          />
                        ) : (
                          <NotApplicable />
                        )}
                      </label>
                    </div>
                  )}
                  <div className="toolEditorActions">
                    {row.removed ? (
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        aria-label={`Restore ${label(row.tool)}`}
                        title={`Restore this ${noun}`}
                        onClick={() => onChange(restoreTool(saved, row.tool))}
                      >
                        <FontAwesomeIcon icon={faRotateLeft} />
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          aria-label={`Reset ${label(row.tool)}`}
                          title={
                            row.inFile
                              ? "Reset to what the file says"
                              : `Reset to the default ${pens ? "pen" : "cutter"}`
                          }
                          disabled={!row.edited}
                          onClick={() => onChange(resetTool(saved, row.tool))}
                        >
                          <FontAwesomeIcon icon={faRotateLeft} />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-danger"
                          aria-label={`Delete ${label(row.tool)}`}
                          title={
                            row.inFile
                              ? `Delete: ${pens ? "draw with the default pen" : "cut this tool with the default cutter"}`
                              : `Delete this saved ${noun}`
                          }
                          onClick={() => onChange(deleteTool(saved, row.tool, row.inFile))}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {savedOnlyCount > 0 && (
        <Form.Check
          type="switch"
          id="tool-editor-show-saved"
          className="toolEditorShowSaved"
          label={`Show ${savedOnlyCount} saved ${noun}${savedOnlyCount === 1 ? "" : "s"} not in this file`}
          checked={showSaved}
          onChange={(event) => setShowSaved(event.target.checked)}
        />
      )}
      <div className="toolEditorFooter">
        <Form.Control
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_TOOL_NUMBER}
          step={1}
          size="sm"
          placeholder={pens ? "Pen number" : "Tool number"}
          aria-label={pens ? "New pen number" : "New tool number"}
          value={newTool}
          isInvalid={newTool.trim() !== "" && (!valid || exists)}
          onChange={(event) => setNewTool(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
        <Button
          size="sm"
          variant="outline-secondary"
          aria-label={pens ? "Add pen" : "Add tool"}
          title={exists ? `That ${noun} is already listed` : `Add a ${noun}`}
          disabled={!valid || exists}
          onClick={add}
        >
          <FontAwesomeIcon icon={faPlus} /> Add
        </Button>
        <span className="toolEditorFooterSpacer" />
        <Button
          size="sm"
          variant="outline-secondary"
          title={`Forget every edit, color and deletion, for every file: ${noun}s go back to what their file says`}
          disabled={!anySaved}
          onClick={() => setConfirmingResetAll(true)}
        >
          Reset all
        </Button>
      </div>
    </div>,
    document.querySelector(".app") ?? document.body
      )}
      {/* Beside the panel, not inside it: a key press in the dialog must not reach the panel's Escape handler. */}
      <ConfirmDialog
        show={confirmingResetAll}
        title={`Reset all ${noun}s?`}
        message={
          `This erases every ${noun} you have edited, recolored or deleted - for all files, not just the one that is ` +
          `open.\n\n${savedCount} saved ${noun}${savedCount === 1 ? "" : "s"}` +
          (savedOnlyCount > 0 ? `, ${savedOnlyCount} of them not in this file` : "") +
          `. Each ${noun} goes back to what its file says, or to the default ${pens ? "pen" : "cutter"}.`
        }
        confirmLabel={`Reset all ${noun}s`}
        confirmVariant="danger"
        onCancel={() => setConfirmingResetAll(false)}
        onConfirm={() => {
          setConfirmingResetAll(false);
          onChange({});
        }}
      />
    </>
  );
};

export default ToolEditorPanel;
