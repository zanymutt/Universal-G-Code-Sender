import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear } from "@fortawesome/free-solid-svg-icons";
import { layoutRect, layoutScale } from "../utils/layoutRect";
import { placePopover } from "../utils/placePopover";
import { PaperSheet, PlotterOptions, SHEET_LABELS } from "../utils/plotterEngine";
import { autoCellSize, StockProcess, StockSettings as StockSettingsValue } from "../utils/stockSimEngine";
import { StockProfiles } from "../utils/stockSettingsStore";
import { StockStatus } from "../utils/stockModel";
import { buildToolRows, SavedTools, ToolScan } from "../utils/toolTable";
import ColorPicker from "./ColorPicker";
import CutterFields from "./CutterFields";
import NumberField from "./StockNumberField";
import ToolEditorPanel from "./ToolEditorPanel";
import "./StockSettings.scss";

const POPOVER_WIDTH = 280;

type Props = {
  profiles: StockProfiles;
  status: StockStatus;
  // The tool changes found in the loaded file, and how many distinct tools
  // actually cut (the tool colors only matter with two or more).
  scan: ToolScan;
  toolsUsed: number;
  onChange: (profiles: StockProfiles) => void;
};

// The Stock view's cutter and stock settings. Same placement approach as
// SimulationSettings: rendered into .app (inside the dashboard's zoom
// transform) and measured by placePopover so it always fits on screen.
const StockSettings = ({ profiles, status, scan, toolsUsed, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  // The tool editor is a separate floating panel: it outlives the popover so
  // tools can be edited while the carve is in view.
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolPanelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const settings = profiles.settings[profiles.process];
  const router = profiles.process === "router";
  // Plotter: the tools are pens (a color and a line width), kept in their own table.
  const plotter = profiles.process === "plotter";
  const toolRows = buildToolRows(
    scan,
    plotter ? profiles.pens : profiles.tools,
    plotter ? settings : profiles.settings.router
  );
  const noun = plotter ? "pen" : "tool";
  // The summary counts what this file uses; saved tools it doesn't mention stay out of it.
  const fileRows = toolRows.filter((row) => row.inFile);
  const toolNames = fileRows.filter((row) => !row.removed).map((row) => (plotter ? `${row.tool}` : `T${row.tool}`));
  const removedCount = fileRows.filter((row) => row.removed).length;
  const toolSummary =
    fileRows.length === 0
      ? `No ${noun} changes in this file.`
      : `${toolNames.length} ${noun}${toolNames.length === 1 ? "" : "s"}${toolNames.length > 0 ? `: ${toolNames.join(", ")}` : ""}${removedCount > 0 ? ` (${removedCount} removed)` : ""}`;

  const update = (patch: Partial<StockSettingsValue>) =>
    onChange({
      ...profiles,
      settings: { ...profiles.settings, [profiles.process]: { ...settings, ...patch } },
    });
  const updatePaper = (patch: Partial<PlotterOptions>) =>
    onChange({ ...profiles, plotter: { ...profiles.plotter, ...patch } });
  const realSheet = profiles.plotter.sheet !== "fit";

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
      if (
        !popoverRef.current?.contains(target) &&
        !toggleRef.current?.contains(target) &&
        !toolPanelRef.current?.contains(target) &&
        // A color picker opened from here is its own pop-up, rendered elsewhere in the page.
        !(target as Element).closest?.("[data-color-picker]")
      ) {
        setOpen(false);
      }
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

  return (
    <>
      <Button
        ref={toggleRef}
        variant="outline-secondary"
        aria-label="Stock and cutter settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Stock and cutter settings"
        onClick={() => setOpen((value) => !value)}
      >
        <FontAwesomeIcon icon={faGear} />
      </Button>
      {toolsOpen && (router || plotter) && (
        <ToolEditorPanel
          rows={toolRows}
          saved={plotter ? profiles.pens : profiles.tools}
          base={settings}
          pens={plotter}
          anchorRef={popoverRef}
          panelRef={toolPanelRef}
          onChange={(saved: SavedTools) => onChange(plotter ? { ...profiles, pens: saved } : { ...profiles, tools: saved })}
          onClose={() => setToolsOpen(false)}
        />
      )}
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="stockSettings"
            role="dialog"
            aria-label="Stock and cutter settings"
            style={{ visibility: "hidden" }}
          >
            <Form.Group>
              <Form.Label>Process</Form.Label>
              <Form.Select
                value={profiles.process}
                onChange={(event) => onChange({ ...profiles, process: event.target.value as StockProcess })}
              >
                <option value="router">Router / mill (depth from Z)</option>
                <option value="laser">Laser (depth from power)</option>
                <option value="plasma">Plasma (cuts through)</option>
                <option value="plotter">Plotter (ink on paper)</option>
              </Form.Select>
            </Form.Group>

            {router ? (
              <CutterFields cutter={settings} onChange={update} />
            ) : plotter ? (
              <NumberField
                label="Default pen width (mm)"
                value={settings.diameter}
                min={0.01}
                step={0.05}
                hint="Used for a pen the file doesn't describe. Each pen's own width is in the pen table."
                onChange={(diameter) => update({ diameter })}
              />
            ) : (
              <NumberField
                label="Kerf width (mm)"
                value={settings.diameter}
                min={0.01}
                step={0.05}
                onChange={(diameter) => update({ diameter })}
              />
            )}
            {profiles.process === "laser" && (
              <NumberField
                label="Full-burn power (S)"
                value={settings.fullPower}
                min={0}
                step={50}
                hint="Power that cuts all the way through; less engraves proportionally shallower. 0 = the highest S in the file."
                onChange={(fullPower) => update({ fullPower })}
              />
            )}

            <Form.Check
              type="switch"
              id="stock-show-path"
              label="Show toolpath over the stock"
              checked={profiles.showPath}
              onChange={(event) => onChange({ ...profiles, showPath: event.target.checked })}
            />

            {router && (
              <Form.Check
                type="switch"
                id="stock-warn-rapids"
                label="Warn when a rapid cuts into the stock"
                checked={profiles.warnRapids}
                onChange={(event) => onChange({ ...profiles, warnRapids: event.target.checked })}
              />
            )}

            {(router || plotter) && (
              <>
                <div className="stockSettingsHeading">{plotter ? "Pens" : "Tools"}</div>
                <div className="stockSettingsHint">
                  {plotter
                    ? "Read from the file's T words and M6; a comment like (Pen 3: orange #f99e0e) names the pen and sets its ink color. The default pen is used for anything not listed."
                    : "Read from the file's T words and M6. The cutter above is used for anything not listed."}
                </div>
                <div className="stockSettingsToolsLine">
                  <span>{toolSummary}</span>
                  <Button
                    size="sm"
                    variant={toolsOpen ? "primary" : "outline-secondary"}
                    aria-expanded={toolsOpen}
                    aria-haspopup="dialog"
                    onClick={() => setToolsOpen((value) => !value)}
                  >
                    {plotter ? "Edit pens\u2026" : "Edit tools\u2026"}
                  </Button>
                </div>
                {router && (
                  <>
                    <Form.Check
                      type="switch"
                      id="stock-color-by-tool"
                      label="Color the cut by tool"
                      checked={profiles.colorByTool}
                      onChange={(event) => onChange({ ...profiles, colorByTool: event.target.checked })}
                    />
                    {toolsUsed < 2 && (
                      <div className="stockSettingsHint">Colors show once the file cuts with two or more tools.</div>
                    )}
                  </>
                )}
              </>
            )}

            {plotter ? (
              <>
                <div className="stockSettingsHeading">Paper</div>
                <Form.Group>
                  <Form.Label>Paper color</Form.Label>
                  <ColorPicker
                    className="stockSettingsColor"
                    aria-label="Paper color"
                    value={profiles.plotter.paperColor}
                    onCommit={(paperColor) => updatePaper({ paperColor })}
                  />
                </Form.Group>
                <Form.Group>
                  <Form.Label>Paper size</Form.Label>
                  <Form.Select
                    value={profiles.plotter.sheet}
                    onChange={(event) => updatePaper({ sheet: event.target.value as PaperSheet })}
                  >
                    {(Object.keys(SHEET_LABELS) as PaperSheet[]).map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {SHEET_LABELS[sheet]}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
                {profiles.plotter.sheet === "custom" && (
                  <>
                    <NumberField
                      label="Sheet width (mm)"
                      value={profiles.plotter.width}
                      min={1}
                      step={1}
                      onChange={(width) => updatePaper({ width })}
                    />
                    <NumberField
                      label="Sheet height (mm)"
                      value={profiles.plotter.height}
                      min={1}
                      step={1}
                      onChange={(height) => updatePaper({ height })}
                    />
                  </>
                )}
                {realSheet ? (
                  <>
                    <Form.Check
                      type="switch"
                      id="stock-paper-landscape"
                      label="Sheet on its side (landscape)"
                      checked={profiles.plotter.landscape}
                      onChange={(event) => updatePaper({ landscape: event.target.checked })}
                    />
                    <NumberField
                      label="Sheet left edge, X (mm)"
                      value={profiles.plotter.x}
                      min={-10000}
                      step={1}
                      hint="Where the sheet's lower-left corner sits in work coordinates. Drawing past the sheet is cut off."
                      onChange={(x) => updatePaper({ x })}
                    />
                    <NumberField
                      label="Sheet bottom edge, Y (mm)"
                      value={profiles.plotter.y}
                      min={-10000}
                      step={1}
                      onChange={(y) => updatePaper({ y })}
                    />
                  </>
                ) : (
                  <NumberField
                    label="Border around the drawing (mm)"
                    value={settings.margin}
                    min={0}
                    step={1}
                    onChange={(margin) => update({ margin })}
                  />
                )}
                <NumberField
                  label="Paper surface, Z (mm)"
                  value={settings.topZ}
                  min={-1000}
                  step={0.5}
                  hint="The pen draws at or below this Z. How far below only adds pressure, so it makes no difference to the drawing."
                  onChange={(topZ) => update({ topZ })}
                />
              </>
            ) : (
              <>
                <div className="stockSettingsHeading">Stock</div>
                <NumberField
                  label="Margin around the part (mm)"
                  value={settings.margin}
                  min={0}
                  step={1}
                  onChange={(margin) => update({ margin })}
                />
                <NumberField
                  label="Thickness (mm)"
                  value={settings.thickness}
                  min={0}
                  step={0.5}
                  hint={router ? "0 = deepest cut plus 3 mm." : "0 = 3 mm."}
                  onChange={(thickness) => update({ thickness })}
                />
                <NumberField
                  label="Top of stock, Z (mm)"
                  value={settings.topZ}
                  min={-1000}
                  step={1}
                  hint="Where the surface sits in work coordinates. Usually 0."
                  onChange={(topZ) => update({ topZ })}
                />
              </>
            )}

            <div className="stockSettingsHeading">Quality</div>
            <NumberField
              label={plotter ? "Pixel size (mm), 0 = auto" : "Cell size (mm), 0 = auto"}
              value={settings.cell}
              min={0}
              step={0.05}
              hint={
                plotter
                  ? settings.cell > 0
                    ? "Smaller is sharper and heavier. Lines thinner than a pixel are drawn one pixel wide."
                    : "Auto: half the width of the thinnest pen, so every line is a couple of pixels wide."
                  : settings.cell > 0
                    ? "Smaller is sharper and slower. Detail finer than about half a cell is lost."
                    : `Auto: ${router ? "cutter diameter \u00f7 10" : "kerf \u00f7 2"} = ${autoCellSize(settings).toFixed(2)} mm, so the cut is a few cells wide.`
              }
              onChange={(cell) => update({ cell })}
            />
            <Form.Group>
              <Form.Label>{plotter ? "Detail limit (pixels)" : "Detail limit (cells)"}</Form.Label>
              <Form.Select
                value={settings.maxCells}
                onChange={(event) => update({ maxCells: Number(event.target.value) })}
              >
                <option value={1_000_000}>1 million - light</option>
                <option value={2_000_000}>2 million - default</option>
                <option value={4_000_000}>4 million - more detail</option>
                <option value={8_000_000}>8 million - most detail, heavy</option>
              </Form.Select>
              <div className="stockSettingsHint">
                {status.coarsened
                  ? `Hit the limit: using ${(status.inches ? status.cell * 25.4 : status.cell).toFixed(2)} mm cells. Raise this for finer detail on a big part.`
                  : "Caps the grid on big parts. More cells use more memory and calculate slower."}
              </div>
            </Form.Group>
          </div>,
          document.querySelector(".app") ?? document.body
        )}
    </>
  );
};

export default StockSettings;
