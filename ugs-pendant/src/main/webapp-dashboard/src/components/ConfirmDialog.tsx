import { Button, Modal } from "react-bootstrap";

type Props = {
  show: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: string;
  onConfirm: () => void;
  onCancel: () => void;
  // An optional middle option, between Cancel and Confirm, for the rare
  // three-way choice (e.g. GcodeEditor's unsaved-changes-before-run prompt:
  // Cancel / Save / Save and run) - both need to be given together, or
  // neither.
  secondaryLabel?: string;
  secondaryVariant?: string;
  onSecondary?: () => void;
  // Disables every button - e.g. while a save triggered from this dialog is
  // still in flight, so a second tap can't fire it again mid-request.
  actionsDisabled?: boolean;
};

const ConfirmDialog = ({
  show,
  title,
  message,
  confirmLabel,
  confirmVariant,
  onConfirm,
  onCancel,
  secondaryLabel,
  secondaryVariant,
  onSecondary,
  actionsDisabled,
}: Props) => {
  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      {/* pre-line: some callers pass multi-line messages (e.g. quoting a line
          of gcode) - plain text collapses \n, this preserves it without
          affecting the single-line messages every other caller passes */}
      <Modal.Body style={{ whiteSpace: "pre-line" }}>{message}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel} disabled={actionsDisabled}>
          Cancel
        </Button>
        {secondaryLabel && onSecondary && (
          <Button variant={secondaryVariant ?? "secondary"} onClick={onSecondary} disabled={actionsDisabled}>
            {secondaryLabel}
          </Button>
        )}
        <Button variant={confirmVariant ?? "primary"} onClick={onConfirm} disabled={actionsDisabled}>
          {confirmLabel ?? "Confirm"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ConfirmDialog;
