package com.willwinder.universalgcodesender.pendantui.v1.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Maps directly to a plugin's {@code plugin.json}. Layout modes (workspace/controls/full/jog)
 * are deliberately not modeled yet - v1 plugins only ever open as a floating window, so there's
 * nothing yet to parse a "layout" field into.
 * <p>
 * {@code @JsonIgnoreProperties(ignoreUnknown = true)} matters here specifically: this schema is
 * intentionally kept identical to FigUI's own plugin.json shape, which already documents fields
 * (layout, layoutTablet, layoutMobile, files) this record doesn't model yet. Without this, a
 * plugin.json using any of those - or written by someone following FigUI's own guide - would fail
 * to parse and get silently skipped from the plugin list, not because anything is wrong with it.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PluginManifest(String name, String description, String version, String entry, String icon) {

    public String entryOrDefault() {
        return entry == null || entry.isBlank() ? "index.html" : entry;
    }
}
