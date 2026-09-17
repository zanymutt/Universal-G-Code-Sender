import { useEffect, useMemo, useRef, useState } from "react";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import {
  getWorkspaceFileList,
  openWorkspaceFile,
  uploadAndOpen,
} from "../services/files";
import { Container, ListGroup, ListGroupItem, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCaretDown,
  faCaretUp,
  faFile,
  faFolder,
  faFolderOpen,
  faList,
  faSearch,
  faThLarge,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { refreshFileState } from "../store/refreshFileState";
import { isLocalAccess } from "../utils/isLocalAccess";
import { readLastWorkspaceFolder, writeLastWorkspaceFolder } from "../utils/lastWorkspaceFolder";
import { scrollActiveFolderIntoView } from "../utils/scrollActiveFolderIntoView";
import { WorkspaceFileEntry } from "../model/WorkspaceFileList";
import FolderTree from "./FolderTree";
import "./OpenFileModal.scss";

type Props = {
  handleClose: () => void;
};

type SortMode = "recent" | "name";
type ViewMode = "grid" | "list";

// A folder node only exists if it (or something under it) has at least one
// gcode file - built fresh from the flat entry list every time it changes,
// so there's never a dead-end folder with nothing in it to navigate into.
type TreeNode = {
  folders: Map<string, TreeNode>;
  files: WorkspaceFileEntry[];
};

const buildTree = (entries: WorkspaceFileEntry[]): TreeNode => {
  const root: TreeNode = { folders: new Map(), files: [] };
  for (const entry of entries) {
    const segments = entry.path.split("/");
    const fileName = segments.pop();
    if (!fileName) continue;
    let node = root;
    for (const segment of segments) {
      let child = node.folders.get(segment);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(segment, child);
      }
      node = child;
    }
    node.files.push(entry);
  }
  return root;
};

const getNode = (root: TreeNode, path: string[]): TreeNode | undefined => {
  let node: TreeNode | undefined = root;
  for (const segment of path) {
    node = node?.folders.get(segment);
    if (!node) return undefined;
  }
  return node;
};

// Total file count for a node and everything nested under it, keyed by
// "/"-joined path so the tree pane can show "(12)" next to a folder without
// walking it itself on every render.
const countFiles = (root: TreeNode): Map<string, number> => {
  const counts = new Map<string, number>();
  const walk = (node: TreeNode, path: string[]): number => {
    let total = node.files.length;
    for (const [name, child] of node.folders) {
      total += walk(child, [...path, name]);
    }
    counts.set(path.join("/"), total);
    return total;
  };
  walk(root, []);
  return counts;
};

const keyOf = (path: string[]) => path.join("/");

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
};

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

// Persisted in localStorage (not the workspace) - it's purely a per-browser
// UI convenience, so a stale or foreign value here should just be ignored
// rather than treated as something the backend needs to validate.
const VIEW_MODE_KEY = "ugsDashboard.openFileModal.viewMode";

const readStoredViewMode = (): ViewMode => {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

const OpenFileModal = ({ handleClose }: Props) => {
  const dispatch = useAppDispatch();
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>();
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  // Folder names, root to the currently browsed folder - e.g. ["CustomerA", "2026"].
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  // Which folders are expanded in the left-hand tree, as "/"-joined path
  // keys - independent of currentPath so a parent can stay open while you
  // browse a sibling, the way every desktop file manager's tree behaves.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // The tree pane collapses into a dropdown on narrow screens (see the
  // breakpoint in the stylesheet) so the file grid still gets real room;
  // this tracks whether that dropdown is currently open.
  const [showTreeMobile, setShowTreeMobile] = useState<boolean>(false);
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

  const tree = useMemo(() => buildTree(entries ?? []), [entries]);
  const fileCounts = useMemo(() => countFiles(tree), [tree]);

  // Jump back to the last folder you had open, once we know it's actually
  // still there - a folder that's since been emptied or renamed just leaves
  // you at the workspace root instead of on a path that no longer resolves
  // to anything. Only ever runs once, when the file list first arrives.
  useEffect(() => {
    if (!entries) return;
    const storedPath = readLastWorkspaceFolder();
    if (!storedPath.length || !getNode(tree, storedPath)) return;
    setCurrentPath(storedPath);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= storedPath.length; i++) next.add(keyOf(storedPath.slice(0, i)));
      return next;
    });
    // Scrolling the tree pane happens in a separate effect, once this
    // restored path has actually made it into the DOM - see pendingScrollRef.
    pendingScrollRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Runs after the restore effect above commits currentPath/expandedPaths -
  // only then does the active row actually exist in the DOM for
  // scrollIntoView to find. Guarded by pendingScrollRef so this only fires
  // right after a restore, not on every ordinary click-to-navigate (which
  // already scrolled there by definition, since you just clicked it).
  const treePaneRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    scrollActiveFolderIntoView(treePaneRef.current);
  }, [currentPath]);

  // The tree pane is display:none (not just off-screen) below the mobile
  // breakpoint until this dropdown opens - scrollIntoView on a display:none
  // element has no layout to scroll within, so the restore effect's own
  // scroll attempt above would silently no-op on a narrow screen opened
  // straight to a remembered subfolder. Re-running it once the pane actually
  // has layout (right after the dropdown opens) covers that case too.
  useEffect(() => {
    if (!showTreeMobile) return;
    scrollActiveFolderIntoView(treePaneRef.current);
  }, [showTreeMobile]);

  const currentNode = useMemo(
    () => getNode(tree, currentPath) ?? { folders: new Map(), files: [] },
    [tree, currentPath]
  );
  // A non-empty filter searches every file in the whole workspace, not just
  // the currently browsed folder - with many subfolders, that's normally a
  // much faster way to find something than clicking down into folders.
  const isSearching = filter.trim().length > 0;
  // The detail (rows-and-columns) layout is always used while searching, so
  // a match's folder (the Location column) is visible - browsing mode uses
  // it too when the person has picked List over the default icon Grid.
  const showDetailList = isSearching || viewMode === "list";

  const sortFiles = (files: WorkspaceFileEntry[]) =>
    [...files].sort((a, b) =>
      sortMode === "recent"
        ? b.lastModified - a.lastModified
        : basename(a.path).toLocaleLowerCase().localeCompare(basename(b.path).toLocaleLowerCase())
    );

  const visibleFiles = useMemo(() => {
    if (isSearching) {
      const needle = filter.trim().toLowerCase();
      return sortFiles((entries ?? []).filter((entry) => entry.path.toLowerCase().includes(needle)));
    }
    return sortFiles(currentNode.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, currentNode, isSearching, filter, sortMode]);

  const hasAnyFiles = !!entries?.length;
  // isSearching drives the detail rows' 3-vs-4-column grid (see the .searching
  // modifier in the stylesheet) regardless of *why* the detail layout is
  // showing, so a plain browsing-mode List view reuses the same 3-column
  // template as before rather than needing a variant of its own.
  const rowClass = `openFileModalItem${isSearching ? " searching" : ""}`;

  // Selecting a folder - from the tree, the breadcrumbs, or the root link -
  // always does the same things: browse there, make sure the tree shows it
  // as expanded down to that depth, drop out of a search (a stale filter
  // left active after jumping to a folder would just hide that folder's own
  // files behind an unrelated search term), and remember it for next time.
  const selectFolder = (path: string[]) => {
    setCurrentPath(path);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= path.length; i++) next.add(keyOf(path.slice(0, i)));
      return next;
    });
    setFilter("");
    setShowTreeMobile(false);
    writeLastWorkspaceFolder(path);
  };

  const selectViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Best-effort, as above.
    }
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

  const alertClicked = (path: string) => {
    setIsLoading(true);
    setError(null);
    openWorkspaceFile(path)
      .then(() => {
        refreshFileState(dispatch);
        handleClose();
      })
      // Previously nothing here at all - a failed open (the backend threw)
      // used to look identical to a successful one that just didn't do
      // anything, with no way to tell what actually happened. Left open
      // (not handleClose()) so the error is still visible, not dismissed
      // along with the modal.
      .catch(() => setError(`Couldn't open "${basename(path)}".`))
      .finally(() => setIsLoading(false));
  };

  const onUploadFile = () => {
    setError(null);
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.accept = ".cnc,.gc,.nc,.ngc,.tap,.txt,.gcode";
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
    <Modal show={true} onHide={handleClose} centered dialogClassName="openFileModalDialog">
      <Modal.Header closeButton>
        <Modal.Title>Open file</Modal.Title>
      </Modal.Header>

      {error && (
        <div style={{ color: "#ff6b6b", padding: "8px 16px 0" }}>{error}</div>
      )}

      {hasAnyFiles && (
        <div className="openFileModalToolbar">
          <button
            type="button"
            className="openFileModalMobileTreeToggle"
            onClick={() => setShowTreeMobile((open) => !open)}
          >
            <FontAwesomeIcon icon={faFolder} />
            <span>{currentPath[currentPath.length - 1] ?? "Workspace"}</span>
            <FontAwesomeIcon icon={showTreeMobile ? faCaretUp : faCaretDown} />
          </button>
          <div className="openFileModalSearch">
            <FontAwesomeIcon icon={faSearch} />
            <input
              type="text"
              placeholder="Search all files..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      )}

      {hasAnyFiles && !isSearching && (
        <div className="openFileModalBreadcrumbs">
          <button type="button" onClick={() => selectFolder([])} disabled={currentPath.length === 0}>
            Workspace
          </button>
          {currentPath.map((segment, index) => (
            <span key={index}>
              <span className="openFileModalCrumbSep">/</span>
              <button
                type="button"
                onClick={() => selectFolder(currentPath.slice(0, index + 1))}
                disabled={index === currentPath.length - 1}
              >
                {segment}
              </button>
            </span>
          ))}
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

        {!isLoadingList && hasAnyFiles && (
          <div className="openFileModalPanes">
            <div ref={treePaneRef} className={`openFileModalTreePane${showTreeMobile ? " open" : ""}`}>
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

            <div className="openFileModalFilePane">
              {!isSearching && (
                <div className="openFileModalFileToolbar">
                  <div className="openFileModalSortToggle">
                    <button
                      type="button"
                      className={sortMode === "name" ? "active" : ""}
                      onClick={() => setSortMode("name")}
                    >
                      Name
                    </button>
                    <button
                      type="button"
                      className={sortMode === "recent" ? "active" : ""}
                      onClick={() => setSortMode("recent")}
                    >
                      Recent
                    </button>
                  </div>
                  <div className="openFileModalViewToggle">
                    <button
                      type="button"
                      className={viewMode === "grid" ? "active" : ""}
                      onClick={() => selectViewMode("grid")}
                      aria-label="Grid view"
                    >
                      <FontAwesomeIcon icon={faThLarge} />
                    </button>
                    <button
                      type="button"
                      className={viewMode === "list" ? "active" : ""}
                      onClick={() => selectViewMode("list")}
                      aria-label="List view"
                    >
                      <FontAwesomeIcon icon={faList} />
                    </button>
                  </div>
                </div>
              )}

              {showDetailList && (
                <div className={rowClass + " openFileModalColumnHeader"}>
                  {/* Sort is already reachable via the toolbar above while
                      browsing, so only the search view's header (which has
                      no toolbar of its own) needs these to be clickable. */}
                  {isSearching ? (
                    <>
                      <button type="button" className="openFileModalSortBtn" onClick={() => setSortMode("name")}>
                        Name {sortMode === "name" && <FontAwesomeIcon icon={faCaretUp} />}
                      </button>
                      <span className="openFileModalColSize">Size</span>
                      <button
                        type="button"
                        className="openFileModalSortBtn openFileModalColModified"
                        onClick={() => setSortMode("recent")}
                      >
                        Modified {sortMode === "recent" && <FontAwesomeIcon icon={faCaretDown} />}
                      </button>
                      <span className="openFileModalColLocation">Location</span>
                    </>
                  ) : (
                    <>
                      <span>Name</span>
                      <span className="openFileModalColSize">Size</span>
                      <span className="openFileModalColModified">Modified</span>
                    </>
                  )}
                </div>
              )}

              {isSearching && !visibleFiles.length && (
                <p className="openFileModalEmptyMessage">No files match &quot;{filter}&quot;.</p>
              )}
              {!isSearching && !visibleFiles.length && (
                <p className="openFileModalEmptyMessage">
                  No files directly in this folder - check the folders on the left.
                </p>
              )}

              {showDetailList ? (
                <ListGroup variant="flush">
                  {visibleFiles.map((entry) => (
                    <ListGroupItem
                      key={entry.path}
                      action
                      onClick={() => alertClicked(entry.path)}
                      className={rowClass}
                      disabled={isLoading}
                    >
                      <div className="openFileModalItemName">
                        <FontAwesomeIcon icon={faFile} className="openFileModalItemIcon" />
                        {basename(entry.path)}
                      </div>
                      <div className="openFileModalColSize">{formatSize(entry.size)}</div>
                      <div className="openFileModalColModified">{formatRelativeTime(entry.lastModified)}</div>
                      {isSearching && (
                        <div className="openFileModalColLocation">{dirname(entry.path) || "—"}</div>
                      )}
                    </ListGroupItem>
                  ))}
                </ListGroup>
              ) : (
                <div className="fileGrid">
                  {visibleFiles.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className="fileGridTile"
                      disabled={isLoading}
                      onClick={() => alertClicked(entry.path)}
                    >
                      <FontAwesomeIcon icon={faFile} className="fileGridIcon" />
                      <span className="fileGridName" title={basename(entry.path)}>
                        {basename(entry.path)}
                      </span>
                      <span className="fileGridMeta">
                        {formatSize(entry.size)} &middot; {formatRelativeTime(entry.lastModified)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
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
