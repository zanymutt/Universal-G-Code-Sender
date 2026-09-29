# Straight Cut — Dashboard plugin

Generates one absolute-coordinate straight cut from the active work origin in
the `-X`, `+X`, `-Y`, or `+Y` direction. It supports millimeters or inches,
custom probe code, safe/pierce/cut heights, pierce delay, cut speed, and
optional THC control using `M8`/`M9`.

The generated sequence is:

```gcode
G90
G21                 ; or G20
G0 X0 Y0 Z[safe height]
[custom probe code, if provided]
G0 X0 Y0           ; after custom probe code, if provided
G0 Z[pierce height]
M3
G4 P[pierce delay]
G0 Z[cut height]
M8                  ; if THC enabled
G1 X/Y[distance] F[cut speed]
M5
G4 P0.5
M9                  ; if THC enabled
G0 Z[safe height]
```

The plugin never starts the machine. **Save As into Dashboard** uses the
Dashboard Save As dialog, loads the generated file as the current job, and
leaves the final Start action to the main Dashboard controls.

The opening `X0 Y0` states outright what every other line already assumes -
that the cut starts at the active work origin - since the file otherwise
never mentions whichever axis isn't being cut. The same `G0 X0 Y0` is emitted
after custom probe code so the controller has the intended XY position stated
again before the pierce and cut moves.

**Custom probe code is checked before Generate accepts it.** UGS's parser
treats any word starting with `F`, `S`, or `T` as a feed rate, spindle
speed, or tool number and tries to read the rest of it as a plain number -
a second one of the same letter on a line, or a value that isn't a clean
number, makes it reject the *entire file* the next time it's opened, not
just that line. Ordinary text pasted into this field by mistake can trigger
this by accident (an English sentence can easily produce a stray word
starting with `t` or `s`), so Generate now rejects that up front with the
offending line, rather than producing a file that looks fine here and then
fails the moment Dashboard reopens it.

## Install

Copy this whole folder to the Dashboard plugin directory on the computer
running UGS:

```text
%USERPROFILE%\.ugs\dashboard-plugins\straight-cut\
```

Reload Dashboard and open **Straight Cut** under **Plugins**. Plugin settings
are stored through Dashboard's `getSettings`/`saveSettings` API, and the page
tracks Dashboard's current palette through `getTheme()` and the `theme` event.
