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

import com.willwinder.universalgcodesender.services.interceptor.UserResponse;

import java.io.Serializable;

/** The operator's answer to what a command interceptor is waiting for: CONTINUE, SKIP or ABORT. */
public class InterceptorRespondRequest implements Serializable {
    private UserResponse response;

    public InterceptorRespondRequest() {
    }

    public InterceptorRespondRequest(UserResponse response) {
        this.response = response;
    }

    public UserResponse getResponse() {
        return response;
    }

    public void setResponse(UserResponse response) {
        this.response = response;
    }
}
