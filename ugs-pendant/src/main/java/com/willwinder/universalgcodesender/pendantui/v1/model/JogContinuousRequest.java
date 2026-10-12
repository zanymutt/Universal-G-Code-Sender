package com.willwinder.universalgcodesender.pendantui.v1.model;

import java.io.Serializable;

/**
 * A continuous jog direction, each component -1..1. All zero stops the jog.
 */
public class JogContinuousRequest implements Serializable {
    private double x;
    private double y;
    private double z;

    public double getX() {
        return x;
    }

    public void setX(double x) {
        this.x = x;
    }

    public double getY() {
        return y;
    }

    public void setY(double y) {
        this.y = y;
    }

    public double getZ() {
        return z;
    }

    public void setZ(double z) {
        this.z = z;
    }
}
