package com.willwinder.universalgcodesender.pendantui.v1.model;

import java.io.Serializable;

/**
 * The outcome of a continuous jog update: whether the machine is now being jogged and,
 * when it isn't although a direction was asked for, why ({@code NOT_CONNECTED} or
 * {@code CANNOT_JOG}).
 */
public class JogContinuousResponse implements Serializable {
    private boolean active;
    private String reason;

    public JogContinuousResponse() {
    }

    public JogContinuousResponse(boolean active, String reason) {
        this.active = active;
        this.reason = reason;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }
}
