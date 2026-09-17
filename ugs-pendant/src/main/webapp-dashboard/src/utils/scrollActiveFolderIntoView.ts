// Shared by OpenFileModal and SaveAsModal - both restore a remembered folder
// (see lastWorkspaceFolder.ts) on open, but restoring currentPath/expandedPaths
// alone leaves the tree pane scrolled wherever it happened to start (usually
// the top) even when the actual active row is well below the fold, several
// levels deep. Scrolling the active row into view makes it obvious at a
// glance where the dialog actually opened to, instead of looking like it
// silently reset to the workspace root.
export const scrollActiveFolderIntoView = (container: HTMLElement | null): void => {
  const activeRow = container?.querySelector(".folderTreeRow.active");
  activeRow?.scrollIntoView({ block: "center" });
};
