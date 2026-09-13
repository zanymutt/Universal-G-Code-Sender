import { useState } from "react";
import { Button, ButtonGroup, Form, Modal, Spinner, ToggleButton } from "react-bootstrap";
import { useAppSelector } from "../hooks/useAppSelector";
import { isLocalAccess, saveToDevice, supportsSaveFilePicker } from "../services/download";

type SaveMode = "workspace" | "device";

type Props = {
  defaultFileName: string;
  // A getter rather than a plain string so it always reads whatever's in the
  // editor right at save time, not a snapshot from whenever this modal opened.
  getContent: () => string;
  onSaveToWorkspace: (filename: string) => Promise<void>;
  handleClose: () => void;
};

const SaveAsModal = ({ defaultFileName, getContent, onSaveToWorkspace, handleClose }: Props) => {
  const [filename, setFilename] = useState(defaultFileName);
  const [mode, setMode] = useState<SaveMode>("workspace");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceDirectory = useAppSelector((state) => state.settings.workspaceDirectory);
  const hasFilePicker = supportsSaveFilePicker();
  // Only the literal localhost/loopback address counts - see isLocalAccess's
  // own comment. "device" is never reachable as a mode at all in that case
  // (the toggle offering it isn't rendered below), not just hidden once picked.
  const canSaveToDevice = isLocalAccess();

  const handleSave = () => {
    if (!filename.trim() || isSaving) return;
    setIsSaving(true);
    setError(null);

    const result =
      mode === "device" && canSaveToDevice
        ? saveToDevice(filename.trim(), getContent())
        : onSaveToWorkspace(filename.trim()).then(() => true);

    result
      .then((saved) => {
        if (saved) handleClose();
      })
      .catch(() => setError("Couldn't save the file."))
      .finally(() => setIsSaving(false));
  };

  return (
    <Modal show={true} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Save as</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Viewed from a different device than the one running UGS (the
            normal case for this dashboard), "save to this device" can't be
            offered cleanly - see isLocalAccess's own comment - so the choice
            itself is skipped rather than showing an option that's liable to
            confuse or fail once picked. */}
        {canSaveToDevice && (
          <ButtonGroup className="mb-2 w-100">
            <ToggleButton
              id="save-as-mode-workspace"
              type="radio"
              variant="outline-secondary"
              name="save-as-mode"
              value="workspace"
              checked={mode === "workspace"}
              onChange={() => setMode("workspace")}
            >
              Save to UGS
            </ToggleButton>
            <ToggleButton
              id="save-as-mode-device"
              type="radio"
              variant="outline-secondary"
              name="save-as-mode"
              value="device"
              checked={mode === "device"}
              onChange={() => setMode("device")}
            >
              Save to this device
            </ToggleButton>
          </ButtonGroup>
        )}

        <Form.Control
          type="text"
          value={filename}
          autoFocus
          onChange={(e) => setFilename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <Form.Text muted>
          {mode === "workspace" ? (
            workspaceDirectory ? (
              <>Will be saved to <code>{workspaceDirectory}</code> and opened in UGS.</>
            ) : (
              "No workspace directory is configured in UGS - this will be saved next to the currently open file instead."
            )
          ) : hasFilePicker ? (
            "Choose exactly where to save on this device - the file open in UGS won't change."
          ) : (
            "This browser can't prompt for a save location, so it'll go straight to your Downloads folder. The file open in UGS won't change."
          )}
        </Form.Text>
        {error && <div style={{ color: "#ff6b6b", marginTop: "8px" }}>{error}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={isSaving || !filename.trim()}>
          Save {isSaving && <Spinner size="sm" />}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SaveAsModal;
