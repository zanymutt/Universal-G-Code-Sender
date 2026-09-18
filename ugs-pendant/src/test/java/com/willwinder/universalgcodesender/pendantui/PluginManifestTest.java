package com.willwinder.universalgcodesender.pendantui;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.willwinder.universalgcodesender.pendantui.v1.model.PluginInfo;
import com.willwinder.universalgcodesender.pendantui.v1.model.PluginManifest;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PluginManifestTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    public void existingManifestDefaultsToSingleInstance() throws Exception {
        assertFalse(mapper.readValue("{\"name\":\"Tool\",\"layout\":\"workspace\"}",
                PluginManifest.class).allowMultipleInstances());
        assertFalse(mapper.readValue("{\"name\":\"Tool\",\"allowMultipleInstances\":false}",
                PluginManifest.class).allowMultipleInstances());
    }

    @Test
    public void explicitOptInSurvivesListSerialization() throws Exception {
        PluginManifest manifest = mapper.readValue(
                "{\"name\":\"Tool\",\"allowMultipleInstances\":true}", PluginManifest.class);
        assertTrue(manifest.allowMultipleInstances());
        PluginInfo info = new PluginInfo("tool", manifest.name(), null, null,
                "/api/v1/plugins/tool/files/index.html", null, manifest.allowMultipleInstances());
        assertTrue(mapper.readTree(mapper.writeValueAsString(info)).get("allowMultipleInstances").asBoolean());
    }
}
