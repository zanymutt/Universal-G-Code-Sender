import { useEffect, useMemo, useState } from "react";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Modal from "react-bootstrap/Modal";
import ToggleButton from "react-bootstrap/ToggleButton";
import {
  getWorkspaceFileList,
  openWorkspaceFile,
  uploadAndOpen,
} from "../services/files";
import { Container, ListGroup, ListGroupItem, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock, faFile, faSearch, faUpload } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { refreshFileState } from "../store/refreshFileState";
import { isLocalAccess } from "../utils/isLocalAccess";
import { WorkspaceFileEntry } from "../model/WorkspaceFileList";
import "./OpenFileModal.scss";

type Props = {
  handleClose: () => void;
};

type SortMode = "recent" | "name";

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatRelativeTime = (epochMs: number): string => {
  if (!epochMs) return "";
  const diffSeconds = Math.round((Date.now() - epochMs) / 1000);
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(epochMs).toLocaleDateString();
};

const OpenFileModal = ({ handleClose }: Props) => {
  const dispatch = useAppDispatch();
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>();
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  // Uploading only makes sense from the same machine running UGS - it lands
  // in a disposable server-side temp copy (see FilesResource#open's own
  // comment), which on a remote session there's no way to get back to after
  // closing/reopening at all, unlike a workspace file. Not offering it there
  // avoids that dead end rather than explaining it after the fact.
  const canUpload = isLocalAccess();

  useEffect(() => {
    getWorkspaceFileList()
      .then((result) => setEntries(result?.fileDetails ?? []))
      .finally(() => setIsLoadingList(false));
  }, []);

  // Recomputed rather than sorted/filtered once on load - a fresh file just
  // saved elsewhere and reopened here should show up sorted correctly the
  // next time this modal opens, and the filter box needs to react live anyway.
  const visibleEntries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = (entries ?? []).filter((entry) =>
      entry.name.toLowerCase().includes(needle)
    );
    return filtered.sort((a, b) =>
      sortMode === "recent"
        ? b.lastModified - a.lastModified
        : a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase())
    );
  }, [entries, filter, sortMode]);

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

  const hasAnyFiles = !!entries?.length;

  return (
    <Modal show={true} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Open file</Modal.Title>
      </Modal.Header>

      {error && (
        <div style={{ color: "#ff6b6b", padding: "8px 16px 0" }}>{error}</div>
      )}

      {hasAnyFiles && (
        <div className="openFileModalToolbar">
          <div className="openFileModalSearch">
            <FontAwesomeIcon icon={faSearch} />
            <input
              type="text"
              placeholder="Filter files..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <ButtonGroup size="sm" className="openFileModalSort">
            <ToggleButton
              id="open-file-sort-recent"
              type="radio"
              variant="outline-secondary"
              name="open-file-sort"
              value="recent"
              checked={sortMode === "recent"}
              onChange={() => setSortMode("recent")}
            >
              <FontAwesomeIcon icon={faClock} /> Recent
            </ToggleButton>
            <ToggleButton
              id="open-file-sort-name"
              type="radio"
              variant="outline-secondary"
              name="open-file-sort"
              value="name"
              checked={sortMode === "name"}
              onChange={() => setSortMode("name")}
            >
              Name
            </ToggleButton>
          </ButtonGroup>
        </div>
      )}

      {/* Sized to fit its content (up to a cap, scrollable beyond that) rather
          than reserving a fixed fraction of the screen regardless of how many
          files there actually are - a handful of files shouldn't fill most of
          a small touchscreen. */}
      <Modal.Body className="openFileModalBody">
        {isLoadingList && (
          <Container className="text-center" style={{ paddingTop: "24px", paddingBottom: "24px" }}>
            <Spinner size="sm" />
          </Container>
        )}
        {!isLoadingList && !hasAnyFiles && (
          <Container style={{ paddingTop: "24px" }}>
            <p>
              There are no files in the workspace directory. Please check the
              UGS configuration to get started with your workspace.
            </p>
            {canUpload && <p>Press open to load a gcode file from this device.</p>}
          </Container>
        )}
        {!isLoadingList && hasAnyFiles && !visibleEntries.length && (
          <Container style={{ paddingTop: "24px" }}>
            <p>No files match &quot;{filter}&quot;.</p>
          </Container>
        )}
        <ListGroup variant="flush">
          {visibleEntries.map((entry) => (
            <ListGroupItem
              key={entry.name}
              action
              onClick={() => alertClicked(entry.name)}
              className="openFileModalItem"
              disabled={isLoading}
            >
              <FontAwesomeIcon icon={faFile} className="openFileModalItemIcon" />
              <div className="openFileModalItemText">
                <div className="openFileModalItemName">{entry.name}</div>
                <div className="openFileModalItemMeta">
                  {formatSize(entry.size)} &bull; {formatRelativeTime(entry.lastModified)}
                </div>
              </div>
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
