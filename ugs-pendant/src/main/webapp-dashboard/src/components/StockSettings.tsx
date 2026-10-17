import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear } from "@fortawesome/free-solid-svg-icons";
import { layoutRect, layoutScale } from "../utils/layoutRect";
import { placePopover } from "../utils/placePopover";
import { autoCellSize, StockProcess, StockSettings as StockSettingsValue } from "../utils/stockSimEngine";
import { StockProfiles } from "../utils/stockSettingsStore";
import { StockStatus } from "../utils/stockModel";
import { buildToolRows, SavedTools, ToolScan } from "../utils/toolTable";
import CutterFields from "./CutterFields";
import NumberField from "./StockNumberField";
import ToolTable from "./ToolTable";
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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const settings = profiles.settings[profiles.process];
  const router = profiles.process === "router";
  const toolRows = buildToolRows(scan, profiles.tools, profiles.settings.router);

  const update = (patch: Partial<StockSettingsValue>) =>
    onChange({
      ...profiles,
      settings: { ...profiles.settings, [profiles.process]: { ...settings, ...patch } },
    });

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
              </Form.Select>
            </Form.Group>

            {router ? (
              <CutterFields cutter={settings} onChange={update} />
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
              <>
                <div className="stockSettingsHeading">Tools</div>
                <div className="stockSettingsHint">
                  Tools are read from the file&apos;s T words and M6. The cutter above is used for anything not listed.
                </div>
                <ToolTable
                  rows={toolRows}
                  saved={profiles.tools}
                  base={settings}
                  onChange={(tools: SavedTools) => onChange({ ...profiles, tools })}
                />
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

            <div className="stockSettingsHeading">Quality</div>
            <NumberField
              label="Cell size (mm), 0 = auto"
              value={settings.cell}
              min={0}
              step={0.05}
              hint={
                settings.cell > 0
                  ? "Smaller is sharper and slower. Detail finer than about half a cell is lost."
                  : `Auto: ${router ? "cutter diameter \u00f7 10" : "kerf \u00f7 2"} = ${autoCellSize(settings).toFixed(2)} mm, so the cut is a few cells wide.`
              }
              onChange={(cell) => update({ cell })}
            />
            <Form.Group>
              <Form.Label>Detail limit (cells)</Form.Label>
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
