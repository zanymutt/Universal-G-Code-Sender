package com.willwinder.universalgcodesender.pendantui.v1.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.io.Serializable;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class WorkspaceFileList implements Serializable {
    private List<String> fileList;
    // Additive alongside fileList (kept as-is for the classic pendant, which
    // only ever wanted names) - size/lastModified let the dashboard's file
    // browser sort by recency and show a size, without either client needing
    // to change what the other already relies on.
    private List<WorkspaceFileEntry> fileDetails;
    // Every folder under the workspace, recursive, regardless of whether it contains any
    // gcode files - unlike fileDetails, which only ever reflects folders that happen to have
    // gcode in them. The Save As dialog needs to navigate into (and create) folders that are
    // currently empty or hold only non-gcode files, which fileDetails alone could never reveal.
    private List<String> folderList;

    public List<String> getFileList() {
        return fileList;
    }

    public void setFileList(List<String> fileList) {
        this.fileList = fileList;
    }

    public List<WorkspaceFileEntry> getFileDetails() {
        return fileDetails;
    }

    public void setFileDetails(List<WorkspaceFileEntry> fileDetails) {
        this.fileDetails = fileDetails;
    }

    public List<String> getFolderList() {
        return folderList;
    }

    public void setFolderList(List<String> folderList) {
        this.folderList = folderList;
    }
}
