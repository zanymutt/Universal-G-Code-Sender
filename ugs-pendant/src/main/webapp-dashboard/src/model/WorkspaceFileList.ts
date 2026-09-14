export type WorkspaceFileEntry = {
  name: string;
  size: number;
  lastModified: number;
};

export type WorkspaceFileList = {
  fileList: string[];
  fileDetails: WorkspaceFileEntry[];
};
