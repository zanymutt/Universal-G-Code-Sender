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
}
