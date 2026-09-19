import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { DEFAULT_SIZING, useDashboardSizing } from "../hooks/useDashboardSizing";
import "./DashboardSizing.scss";
import { useLayoutPresets } from "../hooks/useLayoutPresets";

type Props = { zoom: number; resetZoom: () => void; applyZoom: (value: number) => void };
export default function DashboardSizing({ zoom, resetZoom, applyZoom }: Props) {
  const [show, setShow] = useState(false);
  const { sizing, setSizing } = useDashboardSizing();
  const { presets, save, error } = useLayoutPresets();
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const preset = presets.find(p => p.name === selected);
  const matches = preset && preset.zoom === zoom && preset.compact === sizing.compact &&
    preset.leftWidth === sizing.leftWidth && preset.rightWidth === sizing.rightWidth &&
    (preset.layoutMode ?? "auto") === (sizing.layoutMode ?? "auto");
  const duplicate = presets.some(p => p.name.toLowerCase() === name.trim().toLowerCase());
  return <>
    <Button variant="secondary" onClick={() => setShow(true)} title="Column widths and control spacing">Layout</Button>
    <Modal show={show} onHide={() => setShow(false)} centered scrollable>
      <Modal.Header closeButton><Modal.Title>Dashboard layout</Modal.Title></Modal.Header>
      <Modal.Body className="dashboardSizing">
        <p>Make more room for your job while keeping text at its natural size.</p>
        <Form.Label htmlFor="layout-mode">Screen layout</Form.Label>
        <Form.Select id="layout-mode" value={sizing.layoutMode ?? "auto"}
          onChange={e => setSizing(s => ({ ...s, layoutMode: e.target.value as typeof s.layoutMode }))}>
          <option value="auto">Auto — adapt to available width</option>
          <option value="desktop">Desktop — three columns</option>
          <option value="tablet">Tablet — controls + workspace</option>
          <option value="tabbed">Tabbed — one panel at a time</option>
        </Form.Select>
        <p className="small">Tablet moves macros and overrides to the Machine tab. On narrow screens it switches to tabs. Rotate without losing the editor or preview state.</p>
        <div className="dashboardSizingPresets">
          <Button variant="outline-secondary" onClick={() => {
            setSizing(s => ({ ...s, compact: true, leftWidth: 280, rightWidth: 290 })); resetZoom();
          }}>Apply compact preset</Button>
          <Button variant="outline-secondary" onClick={() => {
            setSizing(s => ({ ...DEFAULT_SIZING, layoutMode: s.layoutMode })); resetZoom();
          }}>Apply comfortable preset</Button>
        </div>
        <section aria-label="Saved layouts">
          <Form.Label htmlFor="saved-layout">Saved layouts</Form.Label>
          <Form.Select id="saved-layout" value={selected} onChange={e => {
            setSelected(e.target.value); setNotice("");
          }}>
            <option value="">Choose a saved layout</option>
            {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </Form.Select>
          {preset && <p className="small mt-2">{preset.zoom}% zoom · {preset.compact ? "Compact" : "Comfortable"} · {preset.leftWidth}px left / {preset.rightWidth}px right
            <br />{matches ? "Current settings match this layout." : "Current settings differ from this layout."}</p>}
          <div className="dashboardSizingPresets mt-2">
            <Button size="sm" disabled={!preset} onClick={() => {
              if (!preset) return;
              setSizing({ compact: preset.compact, leftWidth: preset.leftWidth, rightWidth: preset.rightWidth, layoutMode: preset.layoutMode ?? "auto" });
              applyZoom(preset.zoom); setNotice(`Applied “${preset.name}”.`);
            }}>Apply saved layout</Button>
            <Button size="sm" variant="outline-secondary" disabled={!preset || !!matches} onClick={() => {
              if (preset && save(presets.map(p => p.name === selected ? { ...sizing, zoom, name: selected } : p)))
                setNotice(`Updated “${selected}” with current settings.`);
            }}>Update with current</Button>
            <Button size="sm" variant="outline-danger" disabled={!preset} onClick={() => {
              if (save(presets.filter(p => p.name !== selected))) {
                setNotice(`Deleted “${selected}”. Current settings are unchanged.`); setSelected("");
              }
            }}>Delete preset</Button>
          </div>
          <Form.Label htmlFor="layout-name" className="mt-3">New layout name</Form.Label>
          <Form.Control id="layout-name" value={name} maxLength={60} placeholder="e.g. Desktop or iPad landscape"
            onChange={e => setName(e.target.value)} />
          {duplicate && <p className="small mt-1">That name is already saved. Select it above to update it.</p>}
          <Button className="mt-2" size="sm" disabled={!name.trim() || duplicate} onClick={() => {
            const trimmed = name.trim();
            if (save([...presets, { ...sizing, zoom, name: trimmed }])) {
              setSelected(trimmed); setName(""); setNotice(`Saved “${trimmed}”.`);
            }
          }}>Save current layout</Button>
          <p className="small mt-2 mb-0">Saved in this browser only. Includes screen layout, page zoom, compact mode, and both column widths.</p>
          <div role="status" className="small mt-2">{error || notice}</div>
        </section>
        <Form.Check id="compact-controls" type="switch" label="Compact controls and spacing"
          checked={sizing.compact} onChange={e => setSizing(s => ({ ...s, compact: e.target.checked }))} />
        <p className="small">Compact also reduces the header and bottom job controls. Comfortable keeps the larger controls for touch use. Editor and console font sizes stay independent.</p>
        {(["leftWidth", "rightWidth"] as const).map((side, index) => (
          <div key={side}>
            <Form.Label htmlFor={side}>{index === 0 ? "Left" : "Right"} column: {sizing[side]} px</Form.Label>
            <Form.Range id={side} min={260} max={420} step={10} value={sizing[side]}
              onChange={e => setSizing(s => ({ ...s, [side]: Number(e.target.value) }))} />
          </div>
        ))}
        <p className="small">Column widths apply to the wide layout and may shrink to fit smaller screens.</p>
        <div>Page zoom: {zoom}% <Button size="sm" variant="outline-secondary" disabled={zoom === 100}
          onClick={resetZoom}>Reset to 100%</Button></div>
        <p className="small mt-2 mb-0">Use 100% to compare sharpness. The header zoom buttons remain available.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setSizing(DEFAULT_SIZING)}>Reset layout</Button>
        <Button onClick={() => setShow(false)}>Done</Button>
      </Modal.Footer>
    </Modal>
  </>;
}
