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
package com.willwinder.universalgcodesender.pendantui.v1.model;

import com.willwinder.universalgcodesender.services.interceptor.CommandInterceptorService;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorPrompt;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorState;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorStateEvent;
import com.willwinder.universalgcodesender.services.interceptor.UserResponse;
import com.willwinder.universalgcodesender.types.GcodeCommand;

import java.io.Serializable;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What a running command interceptor (a tool change, for now) is doing, as the dashboard sees it: its
 * virtual state, the step it is waiting for the operator to answer, and which tool was asked for. Sent over
 * the events socket as {@code InterceptorStateEvent} whenever it changes and returned by
 * {@code GET /interceptor} for a client that connects while one is waiting.
 */
public class InterceptorStatus implements Serializable {
    // Comments are not part of the command, and a T word is not preceded by a letter (so the T in a word like
    // "ST1" is not a tool selection). A digit before it is fine: "M6T1" and "M06T1" are common.
    private static final Pattern COMMENTS = Pattern.compile("\\([^)]*\\)?|;.*");
    private static final Pattern TOOL_WORD = Pattern.compile("(?i)(?<![A-Z.])T0*(\\d+)(?![0-9.])");

    /** One question the interceptor is waiting for the operator to answer. */
    public static class Prompt implements Serializable {
        private String stepId;
        private List<String> options;

        public Prompt() {
        }

        public Prompt(String stepId, List<String> options) {
            this.stepId = stepId;
            this.options = options;
        }

        public String getStepId() {
            return stepId;
        }

        public void setStepId(String stepId) {
            this.stepId = stepId;
        }

        public List<String> getOptions() {
            return options;
        }

        public void setOptions(List<String> options) {
            this.options = options;
        }
    }

    private String state = InterceptorState.INACTIVE.name();
    private String previousState;
    private Prompt prompt;
    private String triggerCommand;
    private Integer toolNumber;

    public InterceptorStatus() {
    }

    /** From the event the interceptor service dispatches on every state change. */
    public static InterceptorStatus of(InterceptorStateEvent event) {
        return of(event.getState(), event.getPreviousState(),
                event.getPrompt().orElse(null), event.getTriggerCommand().orElse(null));
    }

    /** The service's state right now. */
    public static InterceptorStatus current(CommandInterceptorService service) {
        return of(service.getState(), null, service.getCurrentPrompt().orElse(null), service.getTriggerCommand().orElse(null));
    }

    static InterceptorStatus of(InterceptorState state, InterceptorState previous, InterceptorPrompt prompt, GcodeCommand trigger) {
        InterceptorStatus status = new InterceptorStatus();
        status.state = state.name();
        status.previousState = previous == null ? null : previous.name();
        if (prompt != null) {
            status.prompt = new Prompt(prompt.stepId(), prompt.options().stream().map(UserResponse::name).toList());
        }
        if (trigger != null) {
            String original = trigger.getOriginalCommandString();
            status.triggerCommand = original == null || original.isBlank() ? trigger.getCommandString() : original;
            status.toolNumber = toolNumberOf(status.triggerCommand);
        }
        return status;
    }

    /**
     * The tool a command asks for ("T2 M6" and "M6 T2" are tool 2), or null when it names none. Read from the
     * command itself rather than from UGS's parser state, which only changes when a T word was sent and so
     * still holds the last tool UGS saw when the trigger command names none.
     */
    public static Integer toolNumberOf(String command) {
        if (command == null) {
            return null;
        }
        Matcher matcher = TOOL_WORD.matcher(COMMENTS.matcher(command).replaceAll(" "));
        if (!matcher.find()) {
            return null;
        }
        try {
            return Integer.valueOf(matcher.group(1));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public String getState() {
        return state;
    }

    public void setState(String state) {
        this.state = state;
    }

    public String getPreviousState() {
        return previousState;
    }

    public void setPreviousState(String previousState) {
        this.previousState = previousState;
    }

    public Prompt getPrompt() {
        return prompt;
    }

    public void setPrompt(Prompt prompt) {
        this.prompt = prompt;
    }

    public String getTriggerCommand() {
        return triggerCommand;
    }

    public void setTriggerCommand(String triggerCommand) {
        this.triggerCommand = triggerCommand;
    }

    public Integer getToolNumber() {
        return toolNumber;
    }

    public void setToolNumber(Integer toolNumber) {
        this.toolNumber = toolNumber;
    }
}
