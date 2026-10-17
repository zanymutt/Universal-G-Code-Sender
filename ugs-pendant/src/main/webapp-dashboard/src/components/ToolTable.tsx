import { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen, faPlus, faRotateLeft, faTrash } from "@fortawesome/free-solid-svg-icons";
import {
  addTool,
  cutterSummary,
  deleteTool,
  MAX_TOOL_NUMBER,
  resetTool,
  restoreTool,
  SavedTools,
  setToolColor,
  setToolCutter,
  ToolRow,
} from "../utils/toolTable";
import { CutterSpec } from "../utils/stockSimEngine";
import CutterFields from "./CutterFields";

type Props = {
  rows: ToolRow[];
  saved: SavedTools;
  // The cutter used for anything the table doesn't list.
  base: CutterSpec;
  onChange: (saved: SavedTools) => void;
};

// The Stock view's tool table: one row per tool number the file (or an earlier
// session) names. Edit changes the cutter, the swatch changes its color, Reset
// goes back to what the file says, Delete drops the tool so it is cut with the
// default cutter, and Add sets up a tool number the file doesn't mention.
const ToolTable = ({ rows, saved, base, onChange }: Props) => {
  const [editing, setEditing] = useState<number | null>(null);
  const [newTool, setNewTool] = useState("");
  const parsed = newTool.trim() === "" ? null : Number(newTool);
  const valid = parsed !== null && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_TOOL_NUMBER;
  const exists = valid && rows.some((row) => row.tool === parsed);
  const anySaved = Object.keys(saved).length > 0;

  const add = () => {
    if (!valid || exists || parsed === null) return;
    onChange(addTool(saved, parsed, base));
    setEditing(parsed);
    setNewTool("");
  };

  return (
    <div className="toolTable">
      {rows.length === 0 && (
        <div className="stockSettingsHint">
          This file has no tool changes, so everything is cut with the cutter above. Add a tool number to set one up
          ahead of time.
        </div>
      )}
      {rows.map((row) => {
        const open = editing === row.tool && !row.removed;
        return (
          <div key={row.tool} className={`toolTableRow${row.removed ? " toolTableRowRemoved" : ""}`}>
            <div className="toolTableLine">
              <input
                type="color"
                className="toolTableSwatch"
                aria-label={`T${row.tool} color`}
                title="Color for this tool"
                value={row.color}
                disabled={row.removed}
                onChange={(event) => onChange(setToolColor(saved, row.tool, event.target.value))}
              />
              <div className="toolTableName">
                <strong>T{row.tool}</strong>
                <span className="toolTableSummary">
                  {row.removed
                    ? "Removed: uses the default cutter"
                    : `${cutterSummary(row.cutter)}${row.inFile ? "" : " (not in this file)"}`}
                </span>
              </div>
              {row.removed ? (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  aria-label={`Restore T${row.tool}`}
                  title="Restore this tool"
                  onClick={() => onChange(restoreTool(saved, row.tool))}
                >
                  <FontAwesomeIcon icon={faRotateLeft} />
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant={open ? "primary" : "outline-secondary"}
                    aria-label={`Edit T${row.tool}`}
                    aria-expanded={open}
                    title="Edit the cutter"
                    onClick={() => setEditing(open ? null : row.tool)}
                  >
                    <FontAwesomeIcon icon={faPen} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    aria-label={`Reset T${row.tool}`}
                    title={row.inFile ? "Reset to what the file says" : "Reset to the default cutter"}
                    disabled={!row.edited}
                    onClick={() => onChange(resetTool(saved, row.tool))}
                  >
                    <FontAwesomeIcon icon={faRotateLeft} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    aria-label={`Delete T${row.tool}`}
                    title={row.inFile ? "Delete: cut this tool with the default cutter" : "Delete this saved tool"}
                    onClick={() => {
                      if (editing === row.tool) setEditing(null);
                      onChange(deleteTool(saved, row.tool, row.inFile));
                    }}
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </Button>
                </>
              )}
            </div>
            {open && (
              <div className="toolTableEditor">
                <CutterFields
                  label={`T${row.tool}`}
                  cutter={row.cutter}
                  onChange={(patch) => onChange(setToolCutter(saved, row.tool, { ...row.cutter, ...patch }))}
                />
              </div>
            )}
          </div>
        );
      })}
      <div className="toolTableAdd">
        <Form.Control
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_TOOL_NUMBER}
          step={1}
          size="sm"
          placeholder="Tool number"
          aria-label="New tool number"
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
          aria-label="Add tool"
          title={exists ? "That tool is already listed" : "Add a tool"}
          disabled={!valid || exists}
          onClick={add}
        >
          <FontAwesomeIcon icon={faPlus} />
        </Button>
        <Button
          size="sm"
          variant="outline-secondary"
          title="Forget every edit, color and deletion: tools go back to what the file says"
          disabled={!anySaved}
          onClick={() => {
            setEditing(null);
            onChange({});
          }}
        >
          Reset all
        </Button>
      </div>
    </div>
  );
};

export default ToolTable;
