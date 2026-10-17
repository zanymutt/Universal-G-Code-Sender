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

import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.pendantui.v1.model.InterceptorRespondRequest;
import com.willwinder.universalgcodesender.pendantui.v1.model.InterceptorStatus;
import com.willwinder.universalgcodesender.services.interceptor.CommandInterceptorService;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorPrompt;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorState;
import com.willwinder.universalgcodesender.services.interceptor.UserResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/**
 * Lets the dashboard answer the questions a command interceptor asks the operator while a job runs - today
 * the tool change that UGS performs for an {@code M6} in the file (move up, stop the spindle, wait for the
 * tool to be changed, wait for the go-ahead). The desktop shows the same questions in a dialog; both can
 * answer and the first answer wins. State changes are pushed over the events socket as
 * {@code InterceptorStateEvent}; {@code GET} is for a client that connects while one is waiting.
 */
@Tag(name = "Interceptor", description = "Endpoints for answering tool changes and other interrupted-job prompts")
@Path("/interceptor")
public class InterceptorResource {

    @Inject
    private BackendAPI backendAPI;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "What the command interceptor is doing right now (INACTIVE when nothing)")
    public InterceptorStatus getStatus() {
        return InterceptorStatus.current(backendAPI.getInterceptorService());
    }

    @POST
    @Path("respond")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Answer the waiting prompt with CONTINUE or SKIP, or ABORT the routine and the job",
            description = "CONTINUE and SKIP are only accepted while the interceptor is waiting for the operator and " +
                    "offers that answer (409 or 400 otherwise). ABORT also ends a routine that failed and left the job paused.")
    public InterceptorStatus respond(InterceptorRespondRequest request) {
        if (request == null || request.getResponse() == null) {
            throw new BadRequestException("Missing response");
        }

        CommandInterceptorService service = backendAPI.getInterceptorService();
        UserResponse response = request.getResponse();

        if (response == UserResponse.ABORT) {
            if (!service.isActive()) {
                throw new ClientErrorException("There is nothing to abort", Response.Status.CONFLICT);
            }
            service.abort();
        } else {
            if (service.getState() != InterceptorState.WAITING_FOR_USER) {
                throw new ClientErrorException("Nothing is waiting for an answer", Response.Status.CONFLICT);
            }
            InterceptorPrompt prompt = service.getCurrentPrompt().orElse(null);
            if (prompt == null || !prompt.hasOption(response)) {
                throw new BadRequestException("The current step does not accept " + response);
            }
            service.provideUserResponse(response);
        }

        return InterceptorStatus.current(service);
    }
}
