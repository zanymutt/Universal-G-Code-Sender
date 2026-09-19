package com.willwinder.universalgcodesender.pendantui;

import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.pendantui.v1.resources.FilesResource;
import com.willwinder.universalgcodesender.utils.Settings;
import jakarta.ws.rs.BadRequestException;
import org.easymock.EasyMock;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class FilesResourceSaveAsTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();

    private FilesResource resource(BackendAPI backend) throws Exception {
        FilesResource resource = new FilesResource();
        var field = FilesResource.class.getDeclaredField("backendAPI");
        field.setAccessible(true);
        field.set(resource, backend);
        return resource;
    }

    @Test public void savesNewJobWithoutLoadedFileInWorkspace() throws Exception {
        File workspace = folder.newFolder("workspace");
        File child = new File(workspace, "version.1");
        assertTrue(child.mkdir());
        File target = new File(child, "new-job.gcode");
        BackendAPI backend = EasyMock.createMock(BackendAPI.class);
        Settings settings = new Settings();
        settings.setWorkspaceDirectory(workspace.getAbsolutePath());
        EasyMock.expect(backend.getGcodeFile()).andReturn(null);
        EasyMock.expect(backend.getSettings()).andReturn(settings);
        backend.setGcodeFile(target);
        EasyMock.replay(backend);
        resource(backend).saveFileContentAs("version.1/new-job", "G21\nG0 Z5\n");
        assertEquals("G21\nG0 Z5\n", Files.readString(target.toPath()));
        EasyMock.verify(backend);
    }

    @Test public void missingWorkspaceAndFileReportsRequiredSetup() throws Exception {
        BackendAPI backend = EasyMock.createMock(BackendAPI.class);
        Settings settings = new Settings();
        settings.setWorkspaceDirectory("");
        EasyMock.expect(backend.getGcodeFile()).andReturn(null);
        EasyMock.expect(backend.getSettings()).andReturn(settings);
        EasyMock.replay(backend);
        try {
            resource(backend).saveFileContentAs("new-job", "G21\n");
            fail("Expected missing workspace error");
        } catch (BadRequestException e) {
            assertTrue(e.getMessage().contains("Configure a workspace"));
        }
        EasyMock.verify(backend);
    }
}
