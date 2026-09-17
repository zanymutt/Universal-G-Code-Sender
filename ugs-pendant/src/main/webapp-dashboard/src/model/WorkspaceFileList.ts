export type WorkspaceFileEntry = {
  // Workspace-relative, "/"-separated - e.g. "CustomerA/2026/lid.nc" for a
  // file in a subfolder, not just a bare filename.
  path: string;
  size: number;
  lastModified: number;
};

export type WorkspaceFileList = {
  fileList: string[];
  fileDetails: WorkspaceFileEntry[];
  // Every folder under the workspace, "/"-separated relative paths, regardless of whether it
  // holds any gcode - unlike fileDetails, which only ever implies folders that happen to
  // contain some. Used for Save As's folder tree, which needs to navigate into (and create)
  // folders fileDetails alone could never reveal.
  folderList: string[];
};
