import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonGroup, Form, Modal, Spinner, ToggleButton } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile, faFolder, faFolderOpen, faFolderPlus } from "@fortawesome/free-solid-svg-icons";
import { useAppSelector } from "../hooks/useAppSelector";
import { saveToDevice, supportsSaveFilePicker } from "../services/download";
import { isLocalAccess } from "../utils/isLocalAccess";
import { createWorkspaceFolder, getWorkspaceFileList } from "../services/files";
import { readLastWorkspaceFolder, writeLastWorkspaceFolder } from "../utils/lastWorkspaceFolder";
import { scrollActiveFolderIntoView } from "../utils/scrollActiveFolderIntoView";
import { WorkspaceFileEntry } from "../model/WorkspaceFileList";
import FolderTree, { FolderTreeNode } from "./FolderTree";
import ConfirmDialog from "./ConfirmDialog";
import "./SaveAsModal.scss";

type SaveMode = "workspace" | "device";

type Props = {
  defaultFileName: string;
  // A getter rather than a plain string so it always reads whatever's in the
  // editor right at save time, not a snapshot from whenever this modal opened.
  getContent: () => string;
  onSaveToWorkspace: (relativePath: string) => Promise<void>;
  handleClose: () => void;
  // Default true. The plugin bridge's saveGcodeAs() (see PluginWindow.tsx)
  // passes false: its contract is "resolves with a workspace-relative
  // path," which a device save has no equivalent of - saveToDevice()'s
  // success path never calls onSaveToWorkspace, so handleClose's blanket
  // "Save cancelled" rejection was firing even though the file *had* been
  // saved, just to the person's downloads folder instead of the workspace.
  // Simplest fix is not offering that choice here at all, rather than
  // inventing a second, path-less "success" shape for the plugin API.
  allowDeviceSave?: boolean;
};

// Folder-only tree, built from getWorkspaceFileList's folderList - unlike
// OpenFileModal's own TreeNode, a folder here exists purely because it's a
// real folder, never gated by whether it happens to contain any gcode. A
// Save As dialog needs to navigate into (and create) folders that are
// currently empty just as well as ones full of other jobs.
type FolderNode = FolderTreeNode;

const buildFolderTree = (folderPaths: string[]): FolderNode => {
  const root: FolderNode = { folders: new Map() };
  for (const path of folderPaths) {
    let node = root;
    for (const segment of path.split("/")) {
      if (!segment) continue;
      let child = node.folders.get(segment);
      if (!child) {
        child = { folders: new Map() };
        node.folders.set(segment, child);
      }
      node = child;
    }
  }
  return root;
};

const getNode = (root: FolderNode, path: string[]): FolderNode | undefined => {
  let node: FolderNode | undefined = root;
  for (const segment of path) {
    node = node?.folders.get(segment);
    if (!node) return undefined;
  }
  return node;
};

const keyOf = (path: string[]) => path.join("/");

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
};

// Same fallback ensureExtension on the backend applies when saving - kept in
// sync deliberately (see that method's own comment) so the hint text here
// never promises a different extension than what actually lands on disk.
const impliedExtension = (referenceFileName: string): string => {
  const dot = referenceFileName.lastIndexOf(".");
  return dot >= 0 ? referenceFileName.slice(dot) : ".gcode";
};

// How many gcode files already live directly under each folder (not
// recursive) - keyed by "/"-joined path, "" for the workspace root. Purely
// informational (Save As doesn't list files, just folders), the same kind of
// "is this folder worth opening" signal OpenFileModal's own counts give.
const countFilesByFolder = (files: WorkspaceFileEntry[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf("/");
    const folder = lastSlash === -1 ? "" : file.path.slice(0, lastSlash);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return counts;
};

const SaveAsModal = ({ defaultFileName, getContent, onSaveToWorkspace, handleClose, allowDeviceSave = true }: Props) => {
  const [filename, setFilename] = useState(defaultFileName);
  const [mode, setMode] = useState<SaveMode>("workspace");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  // Set once Save is clicked and the chosen name already exists in the
  // current folder - holds the relative path so onConfirm can just save it,
  // rather than needing handleSave to recompute anything a second time.
  const [pendingOverwritePath, setPendingOverwritePath] = useState<string | null>(null);

  const workspaceDirectory = useAppSelector((state) => state.settings.workspaceDirectory);
  const hasFilePicker = supportsSaveFilePicker();
  // Only the literal localhost/loopback address counts - see isLocalAccess's
  // own comment. "device" is never reachable as a mode at all in that case
  // (the toggle offering it isn't rendered below), not just hidden once picked.
  // allowDeviceSave narrows this further for the plugin bridge - see Props.
  const canSaveToDevice = isLocalAccess() && allowDeviceSave;

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const fileCounts = useMemo(() => countFilesByFolder(files), [files]);
  const filesInCurrentFolder = useMemo(
    () =>
      files
        .filter((file) => dirname(file.path) === keyOf(currentPath))
        .sort((a, b) => basename(a.path).toLocaleLowerCase().localeCompare(basename(b.path).toLocaleLowerCase())),
    [files, currentPath]
  );

  useEffect(() => {
    if (!workspaceDirectory) return;
    getWorkspaceFileList()
      .then((result) => {
        const folderList = result?.folderList ?? [];
        setFolders(folderList);
        setFiles(result?.fileDetails ?? []);

        // Same "jump back to last folder, once we know it's actually still
        // there" behavior as OpenFileModal - see that component's own
        // comment on why a stale/renamed folder just falls back to root
        // instead of erroring.
        const stored = readLastWorkspaceFolder();
        if (!stored.length || !getNode(buildFolderTree(folderList), stored)) return;
        setCurrentPath(stored);
        setExpandedPaths(new Set(stored.map((_, i) => keyOf(stored.slice(0, i + 1)))));
        // Scrolling happens in a separate effect, once this restored path has
        // actually made it into the DOM - see pendingScrollRef below.
        pendingScrollRef.current = true;
      })
      .catch(() => {
        setFolders([]);
        setFiles([]);
      });
    // Only on mount - workspaceDirectory doesn't change while this modal is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs after the restore above commits currentPath/expandedPaths - only
  // then does the active row actually exist in the DOM for scrollIntoView to
  // find. Guarded by pendingScrollRef so this only fires right after a
  // restore, not on every ordinary click-to-navigate (which already
  // scrolled there by definition, since you just clicked it).
  const treePaneRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    scrollActiveFolderIntoView(treePaneRef.current);
  }, [currentPath]);

  const selectFolder = (path: string[]) => {
    setCurrentPath(path);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= path.length; i++) next.add(keyOf(path.slice(0, i)));
      return next;
    });
    setNewFolderOpen(false);
    setFolderError(null);
  };

  const toggleExpand = (path: string[]) =>
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      const key = keyOf(path);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name || isCreatingFolder) return;
    setIsCreatingFolder(true);
    setFolderError(null);
    const newPath = [...currentPath, name];
    createWorkspaceFolder(keyOf(newPath))
      .then(() => {
        setFolders((prev) => [...prev, keyOf(newPath)]);
        setNewFolderName("");
        setNewFolderOpen(false);
        selectFolder(newPath);
      })
      .catch(() => setFolderError("Couldn't create that folder."))
      .finally(() => setIsCreatingFolder(false));
  };

  const trimmedFilename = filename.trim();
  const displayExtension = trimmedFilename.includes(".") ? "" : impliedExtension(defaultFileName);
  // What actually lands on disk once the backend's own ensureExtension runs
  // (see that method's comment) - needed here too, not just for the hint
  // text, so the overwrite check below compares against the real target
  // name rather than whatever's still missing its extension in the input.
  const effectiveFilename = trimmedFilename + displayExtension;

  const isBrowsingWorkspace = mode === "workspace" && !!workspaceDirectory;

  const performSave = (relativePath: string) => {
    setIsSaving(true);
    setError(null);

    const result =
      mode === "device" && canSaveToDevice
        ? saveToDevice(trimmedFilename, getContent())
        : onSaveToWorkspace(relativePath).then(() => true);

    result
      .then((saved) => {
        if (!saved) return;
        if (isBrowsingWorkspace) writeLastWorkspaceFolder(currentPath);
        handleClose();
      })
      .catch(() => setError("Couldn't save the file."))
      .finally(() => setIsSaving(false));
  };

  const handleSave = () => {
    if (!trimmedFilename || isSaving) return;

    const relativePath = isBrowsingWorkspace ? [...currentPath, trimmedFilename].join("/") : trimmedFilename;

    if (isBrowsingWorkspace) {
      const targetPath = [...currentPath, effectiveFilename].join("/");
      if (files.some((file) => file.path === targetPath)) {
        setPendingOverwritePath(relativePath);
        return;
      }
    }

    performSave(relativePath);
  };

  return (
    <>
    <Modal
      show={true}
      onHide={handleClose}
      centered
      dialogClassName={`saveAsModalDialog${isBrowsingWorkspace ? " saveAsModalDialogWide" : ""}`}
    >
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

        {isBrowsingWorkspace ? (
          <div className="saveAsModalPanes">
            <div ref={treePaneRef} className="saveAsModalTreePane">
              <div
                className={`folderTreeRow folderTreeRoot${currentPath.length === 0 ? " active" : ""}`}
                onClick={() => selectFolder([])}
              >
                <FontAwesomeIcon
                  icon={currentPath.length === 0 ? faFolderOpen : faFolder}
                  className="folderTreeIcon"
                />
                <span className="folderTreeName">Workspace</span>
                <span className="folderTreeCount">{fileCounts.get("") ?? 0}</span>
              </div>
              <FolderTree
                root={tree}
                currentPath={currentPath}
                expandedPaths={expandedPaths}
                fileCounts={fileCounts}
                onSelect={selectFolder}
                onToggle={toggleExpand}
              />
            </div>

            <div className="saveAsModalRight">
              <div className="saveAsModalCurrentPath">
                Saving to <code>{currentPath.length ? currentPath.join(" / ") : "Workspace root"}</code>
              </div>

              {/* Existing files in this folder - click one to reuse its name
                  (e.g. to overwrite a previous version of the same job).
                  Selecting a file doesn't save anything by itself; the
                  overwrite warning only fires once Save is actually pressed. */}
              <div className="saveAsModalFileList">
                {filesInCurrentFolder.length === 0 ? (
                  <p className="saveAsModalFileListEmpty">No files in this folder yet.</p>
                ) : (
                  filesInCurrentFolder.map((file) => (
                    <button
                      type="button"
                      key={file.path}
                      className={`saveAsModalFileItem${basename(file.path) === trimmedFilename ? " active" : ""}`}
                      title={`Click to reuse "${basename(file.path)}" (will overwrite it if you save)`}
                      onClick={() => setFilename(basename(file.path))}
                    >
                      <FontAwesomeIcon icon={faFile} className="saveAsModalFileIcon" />
                      <span className="saveAsModalFileName">{basename(file.path)}</span>
                    </button>
                  ))
                )}
              </div>

              {newFolderOpen ? (
                <div className="saveAsModalNewFolderRow">
                  <Form.Control
                    size="sm"
                    autoFocus
                    placeholder="New folder name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") setNewFolderOpen(false);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || isCreatingFolder}
                  >
                    Create {isCreatingFolder && <Spinner size="sm" />}
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => setNewFolderOpen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  className="saveAsModalNewFolderButton"
                  onClick={() => setNewFolderOpen(true)}
                >
                  <FontAwesomeIcon icon={faFolderPlus} /> New folder
                </Button>
              )}
              {folderError && <div className="saveAsModalFolderError">{folderError}</div>}

              <Form.Control
                type="text"
                className="saveAsModalFilename"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              <Form.Text muted>
                Will save as <code>{trimmedFilename || "…"}{displayExtension}</code>
              </Form.Text>
            </div>
          </div>
        ) : (
          <>
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
                "No workspace directory is configured in UGS - this will be saved next to the currently open file instead."
              ) : hasFilePicker ? (
                "Choose exactly where to save on this device - the file open in UGS won't change."
              ) : (
                "This browser can't prompt for a save location, so it'll go straight to your Downloads folder. The file open in UGS won't change."
              )}
              {" "}Will save as <code>{trimmedFilename || "…"}{displayExtension}</code>
            </Form.Text>
          </>
        )}
        {error && <div style={{ color: "#ff6b6b", marginTop: "8px" }}>{error}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={isSaving || !trimmedFilename}>
          Save {isSaving && <Spinner size="sm" />}
        </Button>
      </Modal.Footer>
    </Modal>

    <ConfirmDialog
      show={pendingOverwritePath !== null}
      title="Overwrite file?"
      message={`"${effectiveFilename}" already exists in ${
        currentPath.length ? currentPath.join("/") : "the workspace root"
      }.\nOverwriting it can't be undone.`}
      confirmLabel="Overwrite"
      confirmVariant="danger"
      actionsDisabled={isSaving}
      onConfirm={() => {
        const path = pendingOverwritePath;
        setPendingOverwritePath(null);
        if (path) performSave(path);
      }}
      onCancel={() => setPendingOverwritePath(null)}
    />
    </>
  );
};

export default SaveAsModal;
