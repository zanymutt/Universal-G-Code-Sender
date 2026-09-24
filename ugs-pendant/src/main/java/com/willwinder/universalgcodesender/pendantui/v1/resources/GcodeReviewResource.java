/*
    Copyright 2026 Will Winder

    This file is part of Universal Gcode Sender (UGS).

    UGS is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
 */
package com.willwinder.universalgcodesender.pendantui.v1.resources;

import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.pendantui.v1.model.GcodeReviewResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

@Tag(name = "G-code Review", description = "Advisory parser diagnostics for G-code")
@Path("/review")
public class GcodeReviewResource {

    @Inject
    private BackendAPI backendAPI;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Review the currently loaded G-code file")
    public GcodeReviewResult reviewLoadedFile() throws IOException {
        File file = currentFile();
        return GcodeReviewService.review(file.getName(), Files.readString(file.toPath()));
    }

    @POST
    @Consumes(MediaType.TEXT_PLAIN)
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Review G-code text, including unsaved dashboard editor content")
    public GcodeReviewResult reviewContent(String content) {
        File file = currentFile();
        return GcodeReviewService.review(file.getName(), content);
    }

    private File currentFile() {
        File file = backendAPI.getGcodeFile();
        if (file == null) {
            throw new NotFoundException("No file is currently loaded");
        }
        return file;
    }
}
