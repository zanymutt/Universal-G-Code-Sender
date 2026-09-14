package com.willwinder.universalgcodesender.pendantui.v1.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.io.Serializable;

@JsonIgnoreProperties(ignoreUnknown = true)
public class WorkspaceFileEntry implements Serializable {
    // Workspace-relative, "/"-separated - e.g. "CustomerA/2026/lid.nc" for a file in a
    // subfolder, not just a bare filename, since the workspace directory is now listed
    // recursively.
    private String path;
    private long size;
    private long lastModified;

    public WorkspaceFileEntry() {
    }

    public WorkspaceFileEntry(String path, long size, long lastModified) {
        this.path = path;
        this.size = size;
        this.lastModified = lastModified;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public long getSize() {
        return size;
    }

    public void setSize(long size) {
        this.size = size;
    }

    public long getLastModified() {
        return lastModified;
    }

    public void setLastModified(long lastModified) {
        this.lastModified = lastModified;
    }
}
