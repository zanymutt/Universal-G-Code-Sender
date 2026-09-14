import { useEffect, useState } from "react";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import {
  getWorkspaceFileList,
  openWorkspaceFile,
  uploadAndOpen,
} from "../services/files";
import { Container, ListGroup, ListGroupItem, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile, faUpload } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { refreshFileState } from "../store/refreshFileState";
import { isLocalAccess } from "../utils/isLocalAccess";

type Props = {
  handleClose: () => void;
};

const OpenFileModal = ({ handleClose }: Props) => {
  const dispatch = useAppDispatch();
  const [workspaceFileList, setWorkspaceFileList] = useState<string[]>();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Uploading only makes sense from the same machine running UGS - it lands
  // in a disposable server-side temp copy (see FilesResource#open's own
  // comment), which on a remote session there's no way to get back to after
  // closing/reopening at all, unlike a workspace file. Not offering it there
  // avoids that dead end rather than explaining it after the fact.
  const canUpload = isLocalAccess();

  useEffect(() => {
    getWorkspaceFileList().then((result) =>
      setWorkspaceFileList(
        result?.fileList.sort((a, b) =>
          a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase())
        )
      )
    );
  }, [setWorkspaceFileList]);

  const alertClicked = (file: string) => {
    setIsLoading(true);
    setError(null);
    openWorkspaceFile(file)
      .then(() => {
        refreshFileState(dispatch);
        handleClose();
      })
      // Previously nothing here at all - a failed open (the backend threw)
      // used to look identical to a successful one that just didn't do
      // anything, with no way to tell what actually happened. Left open
      // (not handleClose()) so the error is still visible, not dismissed
      // along with the modal.
      .catch(() => setError(`Couldn't open "${file}".`))
      .finally(() => setIsLoading(false));
  };

  const onUploadFile = () => {
    setError(null);
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.accept = ".cnc,.nc,.ngc,.tap,.txt,.gcode";
      input.type = "file";
      input.multiple = false;

      // eslint-disable-next-line
      input.onchange = async (e: any) => {
        setIsLoading(true);
        const files = e?.target?.files ?? [];
        if (files.length === 0) {
          resolve(1);
          return;
        }

        try {
          for (const file of files) {
            await uploadAndOpen(file);
          }
          resolve(1);
        } catch (err) {
          reject(err);
        }
      };
      input.click();
    })
      .then(() => {
        refreshFileState(dispatch);
        handleClose();
      })
      .catch(() => setError("Couldn't open that file."))
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <Modal show={true} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Open file</Modal.Title>
      </Modal.Header>

      {error && (
        <div style={{ color: "#ff6b6b", padding: "8px 16px 0" }}>{error}</div>
      )}

      {/* Was fullscreen - a popup sized to fit its content (below, capped
          and scrollable so a long workspace file list can't grow the modal
          past a reasonable height) instead. */}
      <Modal.Body style={{ padding: 0, maxHeight: "60vh", overflowY: "auto" }}>
        {!workspaceFileList?.length && (
          <Container style={{ paddingTop: "24px" }}>
            <p>
              There are no files in the workspace directory. Please check the
              UGS configuration to get started with your workspace.
            </p>
            {canUpload && <p>Press open to load a gcode file from this device.</p>}
          </Container>
        )}
        <ListGroup variant="flush">
          {workspaceFileList?.map((file) => (
            <ListGroupItem
              key={file}
              action
              onClick={() => alertClicked(file)}
              style={{ minHeight: "60px" }}
              disabled={isLoading}
            >
              <FontAwesomeIcon
                icon={faFile}
                size="xl"
                style={{ marginRight: "10px" }}
              />{" "}
              {file}
            </ListGroupItem>
          ))}
        </ListGroup>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
          Close
        </Button>
        {canUpload && (
          <Button
            variant="primary"
            disabled={isLoading}
            onClick={() => onUploadFile()}
          >
            <FontAwesomeIcon icon={faUpload} />
            Open... {isLoading && <Spinner size="sm" />}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default OpenFileModal;
