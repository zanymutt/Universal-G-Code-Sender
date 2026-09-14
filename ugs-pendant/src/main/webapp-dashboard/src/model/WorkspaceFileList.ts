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
};
