/*
    Copyright 2023 Will Winder

    This file is part of Universal Gcode Sender (UGS).

    UGS is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    UGS is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with UGS.  If not, see <http://www.gnu.org/licenses/>.
 */
package com.willwinder.universalgcodesender.pendantui.v1.resources;

import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.services.RunFromService;
import com.willwinder.universalgcodesender.services.SendProgressService;
import com.willwinder.universalgcodesender.pendantui.v1.model.FileStatus;
import com.willwinder.universalgcodesender.pendantui.v1.model.WorkspaceFileEntry;
import com.willwinder.universalgcodesender.pendantui.v1.model.WorkspaceFileList;
import com.willwinder.universalgcodesender.services.LookupService;
import com.willwinder.universalgcodesender.utils.GcodeFileExtensions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import org.glassfish.jersey.media.multipart.FormDataContentDisposition;
import org.glassfish.jersey.media.multipart.FormDataParam;

import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.io.File;
import java.io.IOException;
import java.nio.file.FileVisitOption;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Tag(name = "Files", description = "Endpoints for loading files and handling files")
@Path("/files")
public class FilesResource {

    @Inject
    private BackendAPI backendAPI;

    private final SendProgressService sendProgress = LookupService.lookup(SendProgressService.class);

    @POST
    @Path("uploadAndOpen")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Operation(summary = "Upload a file and open it")
    public void open(
            @FormDataParam("file") FormDataContentDisposition disposition, @FormDataParam("file") File file) throws Exception {
        String originalFileName = disposition.getFileName();
        // A fresh subdirectory per upload, not the same target path every time a
        // file with this name is uploaded (renaming/overwriting a same-named file
        // used to fail here, intermittently, after a few upload/close cycles) -
        // on Windows, overwriting (or even renaming over) a path some other
        // handle still has open can fail outright, unlike Unix. Re-uploading the
        // same filename a second time - re-editing the same job, or just
        // re-picking it after closing - is an entirely normal thing to do and
        // shouldn't depend on whatever handle the *previous* upload's own
        // processing (GcodeStreamReader, the editor's getFileContent, etc.) left
        // behind having been released in time. The original filename is kept
        // (not made unique itself) purely for display - fileStatus/the editor
        // only ever show the last path segment.
        File uploadDir = new File(file.getParentFile(), "upload_" + UUID.randomUUID());
        if (!uploadDir.mkdirs()) {
            throw new IOException("Couldn't create a directory for the uploaded file: " + uploadDir);
        }
        File renamedFile = new File(uploadDir, originalFileName);
        if (!file.renameTo(renamedFile)) {
            Files.copy(file.toPath(), renamedFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
            file.delete();
        }

        // backendAPI.setGcodeFile directly, not the LookupService.lookupOptional(FileLoader.class)
        // indirection this used to go through (see saveFileContent's own comment on why that's
        // risky) - every dashboard-driven file operation now stays off the interactive desktop
        // path uniformly, not just saves. That mirroring (opening pendant-selected files in the
        // desktop's own editor too) was the original intent of the FileLoader indirection, but it
        // left a desktop editor tab that the dashboard's own closeFile()/later reopens have no way
        // to keep in sync with - confirmed causing both the freeze (already fixed) and confusing
        // stale-tab behavior (an old file/name lingering in the desktop editor after the dashboard
        // moved on). ugs-cli already behaves this way (it registers no FileLoader of its own), so
        // this brings the platform edition's dashboard/pendant API in line with that.
        backendAPI.setGcodeFile(renamedFile);
    }

    @POST
    @Path("send")
    @Produces(MediaType.APPLICATION_JSON)
    public void send() throws Exception {
        if (backendAPI.isPaused()) {
            backendAPI.pauseResume();
        } else {
            backendAPI.send();
        }
    }

    @POST
    @Path("runFromLine")
    @Operation(summary = "Prepare the currently loaded file to start streaming from a given line, skipping " +
            "everything before it while replaying position/spindle/coolant/work offset state - " +
            "does not itself start anything, a separate call to send() does that")
    public void runFromLine(@QueryParam("line") int line) {
        LookupService.lookup(RunFromService.class).runFromLine(line);
    }

    @GET
    @Path("pause")
    @Produces(MediaType.APPLICATION_JSON)
    public void pause() throws Exception {
        if (!backendAPI.isPaused()) {
            backendAPI.pauseResume();
        }
    }

    @GET
    @Path("cancel")
    @Produces(MediaType.APPLICATION_JSON)
    public void cancel() throws Exception {
        backendAPI.cancel();
    }

    @GET
    @Path("getWorkspaceFileList")
    @Produces(MediaType.APPLICATION_JSON)
    public WorkspaceFileList getWorkspaceFileList() {
        WorkspaceFileList result = new WorkspaceFileList();
        // Kept flat/top-level-only, unchanged, for the classic pendant - it has no folder-
        // browsing UI, so a "/"-separated relative path would just show up as a literal part of
        // the filename there. Not changing BackendAPI#getWorkspaceFileList's own contract at all.
        result.setFileList(backendAPI.getWorkspaceFileList());
        WorkspaceScan scan = workspaceDirectory()
                .map(FilesResource::scanWorkspace)
                .orElseGet(() -> new WorkspaceScan(Collections.emptyList(), Collections.emptyList()));
        result.setFileDetails(scan.files());
        result.setFolderList(scan.folders());
        return result;
    }

    @POST
    @Path("createWorkspaceFolder")
    @Operation(summary = "Create a new folder in the workspace directory (and any missing parent folders " +
            "on the way to it), for the Save As dialog's \"New folder\" action")
    public void createWorkspaceFolder(@QueryParam("path") String path) throws IOException {
        File workspaceDirectory = workspaceDirectory()
                .orElseThrow(() -> new NotFoundException("No workspace directory is configured"));
        File target = resolveNewWorkspacePath(workspaceDirectory, path);
        if (target.isDirectory()) {
            return; // Already exists - creating a folder that's already there isn't an error.
        }
        if (!target.mkdirs()) {
            throw new IOException("Couldn't create folder '" + path + "'");
        }
    }

    @POST
    @Path("openWorkspaceFile")
    public void openWorkspaceFile(@QueryParam("file") String file) throws Exception {
        // Not backendAPI.openWorkspaceFile(file) - that method (ugs-core, shared by every edition)
        // still goes through the interactive FileLoader indirection itself. Replicating its
        // validation here and calling setGcodeFile directly, the same as uploadAndOpen above,
        // keeps this endpoint off the interactive path without changing what openWorkspaceFile
        // means for any other caller - there happens to be none today, but this way that method's
        // own behavior isn't being silently redefined out from under a future one.
        File workspaceDirectory = workspaceDirectory()
                .orElseThrow(() -> new NotFoundException("No workspace directory is configured"));
        backendAPI.setGcodeFile(resolveWorkspaceFile(workspaceDirectory, file));
    }

    /**
     * Resolves a client-supplied, workspace-relative path (e.g. "CustomerA/2026/lid.nc", from the
     * dashboard's recursive file browser) to a real file, rejecting anything that doesn't land
     * inside the workspace directory once ".." segments and symlinks are resolved. This dashboard
     * is reachable from other machines on the network, so a path-traversal attempt here isn't a
     * purely theoretical concern the way it might be for a local-only desktop file dialog.
     * Validating the resolved path directly (rather than checking membership in an enumerated
     * list) also means a workspace with more files than {@link #listWorkspaceFilesRecursively}'s
     * own cap still opens correctly - only its own display list gets truncated, not what can
     * actually be opened.
     */
    private static File resolveWorkspaceFile(File workspaceDirectory, String relativePath) throws IOException {
        if (relativePath == null || relativePath.isBlank()) {
            throw new BadRequestException("No file specified");
        }
        File canonicalWorkspace = workspaceDirectory.getCanonicalFile();
        File canonicalCandidate = new File(workspaceDirectory, relativePath).getCanonicalFile();
        if (!canonicalCandidate.getPath().startsWith(canonicalWorkspace.getPath() + File.separator)
                || !canonicalCandidate.isFile()
                || !GcodeFileExtensions.isGcodeFile(canonicalCandidate.getName())) {
            throw new NotFoundException("Couldn't find the file '" + relativePath + "' in workspace directory");
        }
        return canonicalCandidate;
    }

    /**
     * Same path-traversal containment check as {@link #resolveWorkspaceFile}, but for a target
     * that's expected *not* to exist yet (a new save-as destination, or a folder about to be
     * created) - so unlike that method, this can't check {@code isFile()}/{@code isDirectory()}
     * as part of validating it, only that the resolved, canonicalized path still lands inside
     * the workspace directory once ".." segments are resolved.
     */
    private static File resolveNewWorkspacePath(File workspaceDirectory, String relativePath) throws IOException {
        if (relativePath == null || relativePath.isBlank()) {
            throw new BadRequestException("No path specified");
        }
        File canonicalWorkspace = workspaceDirectory.getCanonicalFile();
        File candidate = new File(workspaceDirectory, relativePath);
        // getCanonicalFile() resolves ".." segments without requiring the path to exist yet -
        // only its existing ancestors need to be real, which the workspace directory itself
        // always is.
        File canonicalCandidate = candidate.getCanonicalFile();
        if (!canonicalCandidate.getPath().startsWith(canonicalWorkspace.getPath() + File.separator)) {
            throw new BadRequestException("Invalid path '" + relativePath + "'");
        }
        return canonicalCandidate;
    }

    // Depth/count caps so a very large or oddly-structured network share (a symlink loop, a
    // share root pointed at something enormous) can't turn a single request into an effectively
    // unbounded scan - the dashboard's search box is the intended way to find something in a
    // workspace deep or wide enough to hit either of these.
    private static final int MAX_WORKSPACE_DEPTH = 12;
    private static final int MAX_WORKSPACE_FILES = 5000;

    /** One filesystem walk feeds both the file grid and the folder tree - see {@link #scanWorkspace}. */
    private record WorkspaceScan(List<WorkspaceFileEntry> files, List<String> folders) {
    }

    private static WorkspaceScan scanWorkspace(File workspaceDirectory) {
        java.nio.file.Path root = workspaceDirectory.toPath();
        List<WorkspaceFileEntry> files = new ArrayList<>();
        List<String> folders = new ArrayList<>();
        try {
            Files.walkFileTree(root, EnumSet.noneOf(FileVisitOption.class), MAX_WORKSPACE_DEPTH, new SimpleFileVisitor<java.nio.file.Path>() {
                @Override
                public FileVisitResult preVisitDirectory(java.nio.file.Path dir, BasicFileAttributes attrs) throws IOException {
                    // Skips hidden directories (dotfiles, Windows attribute-hidden folders like a
                    // network share's "$RECYCLE.BIN") - never something a job folder would be.
                    if (!dir.equals(root) && Files.isHidden(dir)) {
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                    // The root itself isn't a folder a Save As dialog would ever need to list -
                    // it's already the implicit starting point of the tree.
                    if (!dir.equals(root)) {
                        folders.add(root.relativize(dir).toString().replace(File.separatorChar, '/'));
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(java.nio.file.Path file, BasicFileAttributes attrs) {
                    if (GcodeFileExtensions.isGcodeFile(file.getFileName().toString())) {
                        String relativePath = root.relativize(file).toString().replace(File.separatorChar, '/');
                        files.add(new WorkspaceFileEntry(relativePath, attrs.size(), attrs.lastModifiedTime().toMillis()));
                    }
                    return files.size() >= MAX_WORKSPACE_FILES ? FileVisitResult.TERMINATE : FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(java.nio.file.Path file, IOException exc) {
                    // A single unreadable file/folder (permissions, a stale network link)
                    // shouldn't abort listing everything else the share does have.
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            // Best-effort - return whatever was gathered before the failure rather than nothing.
        }
        return new WorkspaceScan(files, folders);
    }

    @GET
    @Path("getFileStatus")
    @Produces(MediaType.APPLICATION_JSON)
    public FileStatus getFileStatus() {
        return new FileStatus(Optional.ofNullable(backendAPI.getGcodeFile()).map(File::getAbsolutePath).orElse(""),
                sendProgress.getNumRows(),
                sendProgress.getNumCompletedRows(),
                sendProgress.getNumRemainingRows(),
                sendProgress.getDuration(),
                sendProgress.getRemainingDuration(),
                sendProgress.getLastCompletedCommandNumber(),
                sendProgress.getSendState().name());
    }

    @GET
    @Path("getFileContent")
    @Produces(MediaType.TEXT_PLAIN)
    @Operation(summary = "Get the raw gcode text of the currently loaded file")
    public String getFileContent() throws IOException {
        return Files.readString(currentGcodeFile().toPath());
    }

    @POST
    @Path("saveFileContent")
    @Consumes(MediaType.TEXT_PLAIN)
    @Operation(summary = "Save the raw gcode text of the currently loaded file and reload it")
    public void saveFileContent(String content) throws Exception {
        File gcodeFile = currentGcodeFile();
        Files.writeString(gcodeFile.toPath(), content);

        // backendAPI.setGcodeFile directly, not the LookupService.lookupOptional(FileLoader.class)
        // indirection saveFileContentAs/uploadAndOpen use - on the platform edition that resolves
        // to OpenFileActionLoader, which replays the full interactive "Open File" menu action
        // (EditorUtils.closeOpenEditors(), then the file's OpenCookie) on the Swing EDT. That's
        // fine for a genuinely new file the user just picked, but here the file is already the
        // one loaded - this call exists purely to make the backend re-parse the edit just written,
        // not to "open" anything new. Confirmed the interactive path can block the whole app: if
        // a desktop editor tab for this same file was left open from an earlier reload (which
        // c.open() itself creates) with even a trivial pending state, closeOpenEditors() can pop a
        // native "save changes?" dialog on the EDT - invisible and unanswerable from a remote
        // dashboard session, so every request after it (including the "Run" button, which waits on
        // this same save to finish first) hangs forever. setGcodeFile does everything send() itself
        // actually depends on (re-dispatches FileStateEvent.OPENING_FILE and reprocesses into
        // processedGcodeFile - see GUIBackend#setGcodeFile) without touching the desktop UI at all.
        backendAPI.setGcodeFile(gcodeFile);
    }

    @POST
    @Path("closeFile")
    @Operation(summary = "Close the currently loaded file")
    public void closeFile() throws Exception {
        backendAPI.unsetGcodeFile();
    }

    @POST
    @Path("saveFileContentAs")
    @Consumes(MediaType.TEXT_PLAIN)
    @Operation(summary = "Save the raw gcode text as a new file in the workspace directory, and open it")
    public void saveFileContentAs(@QueryParam("filename") String filename, String content) throws Exception {
        if (filename == null || filename.isBlank()) {
            throw new BadRequestException("Invalid filename");
        }

        File currentFile = currentGcodeFile();
        Optional<File> workspaceDirectory = workspaceDirectory();
        String filenameWithExtension = ensureExtension(filename, currentFile);
        File targetFile;
        if (workspaceDirectory.isPresent()) {
            // filename may now be a workspace-relative path with folder segments (e.g.
            // "CustomerA/2026/lid.gcode", from the Save As dialog's folder tree), not just a
            // bare name - resolved and validated the same way resolveWorkspaceFile keeps an
            // *existing* file's path inside the workspace directory.
            targetFile = resolveNewWorkspacePath(workspaceDirectory.get(), filenameWithExtension);
            File parent = targetFile.getParentFile();
            if (!parent.isDirectory()) {
                throw new NotFoundException("Folder for '" + filename + "' doesn't exist");
            }
        } else {
            // No workspace configured - nowhere to browse folders in, so this only ever
            // supports a bare filename saved next to whatever's currently loaded, same as before.
            if (!filenameWithExtension.equals(new File(filenameWithExtension).getName())) {
                throw new BadRequestException("Invalid filename");
            }
            targetFile = new File(currentFile.getParentFile(), filenameWithExtension);
        }
        Files.writeString(targetFile.toPath(), content);

        // Same reasoning as saveFileContent above - a new file on disk, but as far as the
        // backend/dashboard are concerned this is still just "reload with fresh content", not an
        // interactive file-open the desktop GUI needs to mirror.
        backendAPI.setGcodeFile(targetFile);
    }

    /**
     * "Save as" needs a folder that's actually meaningful to the user - "next to whatever
     * file happens to be currently open" fails silently for anything opened by uploading it
     * through the browser's file picker (see {@link #open}), since that lands in a JVM temp
     * directory the browser never reveals the real original path for. The configured
     * workspace directory (the same folder {@link #getWorkspaceFileList} already lists) is
     * always a real, known location the user picked, and the result shows up in that list
     * immediately - so prefer it whenever one is configured.
     */
    private Optional<File> workspaceDirectory() {
        String workspaceDirectory = backendAPI.getSettings().getWorkspaceDirectory();
        if (workspaceDirectory == null || workspaceDirectory.isBlank()) {
            return Optional.empty();
        }
        File folder = new File(workspaceDirectory);
        return folder.isDirectory() ? Optional.of(folder) : Optional.empty();
    }

    private static String ensureExtension(String filename, File referenceFile) {
        if (filename.contains(".")) {
            return filename;
        }
        String refName = referenceFile.getName();
        int dot = refName.lastIndexOf('.');
        return filename + (dot >= 0 ? refName.substring(dot) : ".gcode");
    }

    /**
     * These endpoints always operate on whichever file is already loaded (rather than taking a
     * client-supplied filename) - both because editing only makes sense for the currently open job,
     * and because it sidesteps needing to validate an arbitrary path: a file opened via upload (as
     * opposed to {@link #openWorkspaceFile}) doesn't live in the workspace directory, so restricting
     * these to workspace-only files (as an earlier version of this did) would have made them
     * unusable for anything but files picked from the workspace list.
     */
    private File currentGcodeFile() {
        File gcodeFile = backendAPI.getGcodeFile();
        if (gcodeFile == null) {
            throw new NotFoundException("No file is currently loaded");
        }
        return gcodeFile;
    }
}
