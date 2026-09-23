import { useEffect, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark, faCheck, faTrash } from "@fortawesome/free-solid-svg-icons";
import { applyPaneLayout, usePaneLayoutPresets } from "../hooks/usePaneLayoutPresets";
import type { LayoutState, PaneContent } from "./CenterPaneLayoutDemo";

const LABELS: Record<PaneContent, string> = {
  visualize: "Visualize",
  edit: "Edit",
  macros: "Macros",
  probe: "Probe",
  console: "Console",
};

const summary = (layout: LayoutState) => {
  const contents = layout.panes.map(pane => LABELS[pane.content]).join(" · ");
  const shape = layout.panes.length === 1 ? "Single pane" : `${layout.panes.length} panes · ${layout.spine === "vertical" ? "vertical" : "horizontal"} spine`;
  return `${shape} — ${contents}`;
};

const PaneLayoutPresets = () => {
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const { presets, current, save, error } = usePaneLayoutPresets();
  const preset = presets.find(item => item.name === selected);
  const duplicate = presets.some(item => item.name.toLowerCase() === name.trim().toLowerCase());

  useEffect(() => {
    if (selected && !presets.some(item => item.name === selected)) setSelected("");
  }, [presets, selected]);

  const applySelected = () => {
    if (!preset) return;
    applyPaneLayout(preset.layout);
    setNotice(`Applied “${preset.name}”.`);
  };

  return <>
    <Button variant="secondary" onClick={() => setShow(true)} title="Saved pane layouts">
      <FontAwesomeIcon icon={faBookmark} /> <span className="topBarPaneLayoutsLabel">Panes</span>
    </Button>
    <Modal show={show} onHide={() => setShow(false)} centered>
      <Modal.Header closeButton><Modal.Title>Saved pane layouts</Modal.Title></Modal.Header>
      <Modal.Body>
        <p>Save and restore pane contents, split topology, and divider positions.</p>
        <Form.Label htmlFor="pane-layout-select">Saved layouts</Form.Label>
        <Form.Select id="pane-layout-select" value={selected} onChange={event => { setSelected(event.target.value); setNotice(""); }}>
          <option value="">Choose a saved pane layout</option>
          {presets.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
        </Form.Select>
        {preset && <p className="small mt-2 mb-0">{summary(preset.layout)}</p>}
        <div className="d-flex gap-2 mt-3">
          <Button size="sm" disabled={!preset} onClick={applySelected}><FontAwesomeIcon icon={faCheck} /> Apply</Button>
          <Button size="sm" variant="outline-primary" disabled={!preset || !current} onClick={() => {
            if (preset && current && save(presets.map(item => item.name === selected ? { ...item, layout: current } : item)))
              setNotice(`Updated “${selected}”.`);
          }}>Update current</Button>
          <Button size="sm" variant="outline-danger" disabled={!preset} onClick={() => {
            if (save(presets.filter(item => item.name !== selected))) {
              setNotice(`Deleted “${selected}”.`);
              setSelected("");
            }
          }}><FontAwesomeIcon icon={faTrash} /> Delete</Button>
        </div>
        <Form.Label htmlFor="pane-layout-name" className="mt-4">Save current layout as</Form.Label>
        <Form.Control id="pane-layout-name" value={name} maxLength={60} placeholder="e.g. Visualizer + Console"
          onChange={event => setName(event.target.value)} />
        {duplicate && <p className="small mt-1 mb-0">That name already exists. Select it above to update it.</p>}
        <Button className="mt-2" size="sm" disabled={!current || !name.trim() || duplicate} onClick={() => {
          const trimmed = name.trim();
          if (current && save([...presets, { name: trimmed, layout: current }])) {
            setSelected(trimmed);
            setName("");
            setNotice(`Saved “${trimmed}”.`);
          }
        }}>Save current pane layout</Button>
        <div role="status" className="small mt-3">{error || notice}</div>
      </Modal.Body>
      <Modal.Footer><Button variant="secondary" onClick={() => setShow(false)}>Done</Button></Modal.Footer>
    </Modal>
  </>;
};

export default PaneLayoutPresets;
