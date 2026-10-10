import { useState } from "react";
import { Button, Modal } from "react-bootstrap";
import MacroEditor from "./MacroEditor";
import ConfirmDialog from "./ConfirmDialog";
import "./MacroEditorModal.scss";

type Props = {
  show: boolean;
  onClose: () => void;
};

// The RightRail's macro edit button opens this instead of repurposing a
// center pane. MacroEditor is mounted only while the modal is open, so closing
// (after the unsaved-changes check below) discards any leftover draft.
const MacroEditorModal = ({ show, onClose }: Props) => {
  const [dirty, setDirty] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const requestClose = () => {
    if (dirty) {
      setConfirmingClose(true);
    } else {
      onClose();
    }
  };

  const handleExited = () => {
    setDirty(false);
    setConfirmingClose(false);
  };

  return (
    <>
      <Modal
        show={show}
        onHide={requestClose}
        onExited={handleExited}
        centered
        dialogClassName="macroEditorModalDialog"
      >
        <Modal.Header closeButton>
          <Modal.Title>Edit macros</Modal.Title>
        </Modal.Header>
        <Modal.Body className="macroEditorModalBody">
          <MacroEditor onDirtyChange={setDirty} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={requestClose}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
      {confirmingClose && (
        <ConfirmDialog
          show={true}
          title="Discard unsaved changes?"
          message="You have unsaved macro changes. Close the editor and discard them?"
          confirmLabel="Discard changes"
          confirmVariant="danger"
          onConfirm={() => {
            setConfirmingClose(false);
            onClose();
          }}
          onCancel={() => setConfirmingClose(false)}
        />
      )}
    </>
  );
};

export default MacroEditorModal;
