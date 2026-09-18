package com.willwinder.universalgcodesender.pendantui.v1.model;

/**
 * One entry in the installed-plugins list. {@code entryUrl}/{@code iconUrl} are pre-resolved to
 * this plugin's {@code /files/...} route so the frontend never has to reconstruct plugin paths
 * itself - it just points an iframe's {@code src} straight at {@code entryUrl}.
 */
public record PluginInfo(String id, String name, String description, String version, String entryUrl,
                          String iconUrl, boolean allowMultipleInstances) {
}
