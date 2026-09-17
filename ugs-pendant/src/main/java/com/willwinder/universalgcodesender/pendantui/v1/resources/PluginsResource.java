/*
    Copyright 2026 Will Winder

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

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.willwinder.universalgcodesender.pendantui.v1.model.PluginInfo;
import com.willwinder.universalgcodesender.pendantui.v1.model.PluginManifest;
import com.willwinder.universalgcodesender.utils.SettingsFactory;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Serves installed Dashboard plugins - manifest listing, their static files (index.html, any
 * accompanying CSS/JS/icon), and a small per-plugin JSON settings blob. Deliberately does not
 * expose an install/upload endpoint yet: for now a plugin is installed by dropping its folder
 * into the plugins directory directly (same as the FigUI guide's "copy to SD card, then refresh"
 * path) and hitting the refresh button this resource's "list" endpoint backs. A real "install
 * from a picked folder" flow can reuse {@link FilesResource#uploadAndOpen}'s multipart pattern
 * later without changing anything here.
 */
@Tag(name = "Plugins", description = "Endpoints for listing and serving installed Dashboard plugins")
@Path("/plugins")
public class PluginsResource {

    private static final Logger LOGGER = Logger.getLogger(PluginsResource.class.getSimpleName());
    private static final String PLUGINS_DIRECTORY_NAME = "dashboard-plugins";
    private static final String MANIFEST_FILENAME = "plugin.json";
    private static final String SETTINGS_FILENAME = "settings.json";

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Lives under UGS's own settings directory (~/.ugs or platform equivalent), not the gcode
     * workspace directory - a plugin is code, not a job file, and keeping the two separate means
     * a plugin's HTML/JS never shows up in the Open File browser's tree/grid alongside actual
     * gcode.
     */
    private static File pluginsDirectory() {
        File dir = new File(SettingsFactory.getSettingsDirectory(), PLUGINS_DIRECTORY_NAME);
        dir.mkdirs();
        return dir;
    }

    @GET
    @Path("list")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "List installed plugins")
    public List<PluginInfo> list() {
        List<PluginInfo> result = new ArrayList<>();
        File[] pluginDirs = pluginsDirectory().listFiles(File::isDirectory);
        if (pluginDirs == null) {
            return result;
        }

        for (File pluginDir : pluginDirs) {
            String id = pluginDir.getName();
            readManifest(pluginDir).ifPresent(manifest -> {
                String iconUrl = manifest.icon() == null || manifest.icon().isBlank()
                        ? null
                        : String.format("/api/v1/plugins/%s/files/%s", id, manifest.icon());
                result.add(new PluginInfo(
                        id,
                        manifest.name(),
                        manifest.description(),
                        manifest.version(),
                        String.format("/api/v1/plugins/%s/files/%s", id, manifest.entryOrDefault()),
                        iconUrl));
            });
        }
        return result;
    }

    // A folder without a readable plugin.json (mid-copy, malformed JSON, or just not a plugin
    // folder at all) is skipped rather than failing the whole listing - one bad folder in the
    // plugins directory shouldn't take every other installed plugin down with it.
    private Optional<PluginManifest> readManifest(File pluginDir) {
        File manifestFile = new File(pluginDir, MANIFEST_FILENAME);
        if (!manifestFile.isFile()) {
            return Optional.empty();
        }
        try {
            PluginManifest manifest = objectMapper.readValue(manifestFile, PluginManifest.class);
            if (manifest.name() == null || manifest.name().isBlank()) {
                LOGGER.warning(() -> "Skipping plugin '" + pluginDir.getName() + "': missing required 'name'");
                return Optional.empty();
            }
            return Optional.of(manifest);
        } catch (IOException e) {
            LOGGER.log(Level.WARNING, e, () -> "Skipping plugin '" + pluginDir.getName() + "': couldn't parse plugin.json");
            return Optional.empty();
        }
    }

    @GET
    @Path("{id}/files/{filename}")
    @Operation(summary = "Get a static file (HTML/CSS/JS/icon) belonging to an installed plugin")
    public Response getFile(@PathParam("id") String id, @PathParam("filename") String filename) {
        File file = resolvePluginFile(id, filename);
        String mimeType = getMimeType(filename);
        return Response.ok(file).header(HttpHeaders.CONTENT_TYPE, mimeType).build();
    }

    @GET
    @Path("{id}/settings")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Get a plugin's saved settings (empty object if none saved yet)")
    public JsonNode getSettings(@PathParam("id") String id) throws IOException {
        File settingsFile = new File(resolvePluginDirectory(id), SETTINGS_FILENAME);
        if (!settingsFile.isFile()) {
            return objectMapper.createObjectNode();
        }
        return objectMapper.readTree(settingsFile);
    }

    @POST
    @Path("{id}/settings")
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(summary = "Save a plugin's settings, replacing whatever was saved before")
    public void saveSettings(@PathParam("id") String id, ObjectNode settings) throws IOException {
        File pluginDirectory = resolvePluginDirectory(id);
        File settingsFile = new File(pluginDirectory, SETTINGS_FILENAME);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(settingsFile, settings);
    }

    // Plugin folders are deliberately flat (per the plugin guide - no subdirectories), so unlike
    // FilesResource's workspace path resolution this doesn't need to walk arbitrary-depth
    // segments - just reject anything that isn't a bare name, which also rejects ".." outright
    // rather than needing a canonical-path containment check to catch it.
    private static String requireSimpleName(String value, String what) {
        if (value == null || value.isBlank() || value.contains("/") || value.contains("\\") || value.equals("..")) {
            throw new BadRequestException("Invalid " + what);
        }
        return value;
    }

    private static File resolvePluginDirectory(String id) {
        File dir = new File(pluginsDirectory(), requireSimpleName(id, "plugin id"));
        if (!dir.isDirectory()) {
            throw new NotFoundException("No plugin installed with id '" + id + "'");
        }
        return dir;
    }

    private static File resolvePluginFile(String id, String filename) {
        File file = new File(resolvePluginDirectory(id), requireSimpleName(filename, "filename"));
        if (!file.isFile()) {
            throw new NotFoundException("No file '" + filename + "' in plugin '" + id + "'");
        }
        return file;
    }

    private static String getMimeType(String filename) {
        if (filename.endsWith(".html")) return "text/html";
        if (filename.endsWith(".js")) return "text/javascript";
        if (filename.endsWith(".css")) return "text/css";
        if (filename.endsWith(".png")) return "image/png";
        if (filename.endsWith(".svg")) return "image/svg+xml";
        if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }
}
