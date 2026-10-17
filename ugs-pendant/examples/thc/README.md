# THC Control Panel (Dashboard plugin)

Live control, settings presets and datalog capture for the ESP32 plasma torch
height controller (THC). The plugin talks **directly to the THC** over
`ws://<THC-IP>/ws`; it sends no UGS machine commands and does not touch the
loaded job.

## Install

Copy the flat contents of this folder to `~/.ugs/dashboard-plugins/thc/`
(Windows: `C:\Users\<you>\.ugs\dashboard-plugins\thc`), reload the Dashboard,
then open **THC Control Panel** from Plugins.

## Using it

- **Link** - enter the THC address, **Connect**. The window jumps to Operate
  once frames arrive. Diagnostics and the raw last frame live here too.
- **Operate** - voltages, mode / test run, datalog recording, status pills, jog
  and calibrate, interlock state. While recording, a red **REC** bar with the
  row count stays pinned under the tabs on every page; tap it to stop.
- **Calibrate** - the *Current voltage* tile is a second Calibrate button (same
  command; the firmware refuses it during an arc, cut or test run).
- **Setpoint** - tap the *Setpoint voltage* tile to edit it in place: type a
  value or nudge with -1 / -0.1 / +0.1 / +1, then **Set**. Nothing is sent until
  **Set**; the tile shows the THC's own value, with a "waiting" note until the
  THC echoes the new one. Allowed during a cut (the firmware only interlocks
  jog and calibrate).
- **Test run window averages** - under the *Test run avg voltage* tile, every
  finished averaging window of a test run is listed (grouped by run, with the
  sample count), so the values no longer overwrite each other. **Use** on a row,
  or **Use mean as setpoint**, sends that voltage as the THC setpoint;
  **Save CSV** exports the list; **Clear** empties it. Derived from the live
  telemetry only; kept in memory until cleared or the window is closed.
- **Settings** - presets (read and write the same `settings.csv` the Sunton's
  SD card uses), an **Active** tab that lists everything the THC is running
  right now on one page (tap a section or value to jump to the tab that edits
  it), and every live setting, with the speed-curve preview and the
  3 s rolling voltage graph.
- A banner on Operate / Settings says when readings are not live (not
  connected, or no telemetry for more than 3 s).

The layout works down to the Dashboard's smallest plugin window (about 220 px
wide); on a wide window the Movement and Voltage charts sit beside the entries.
The theme and accent follow the Dashboard; the THC address is remembered in the
plugin's saved settings.

## Saving CSV files

Plugin windows are sandboxed and cannot trigger browser downloads. **Save CSV**
(datalog and test-run averages) and **Save settings.csv** ask the Dashboard to
save the file (`Fluid.downloadFile`): in Chrome or Edge on `localhost` that is a
normal Save As dialog, elsewhere an ordinary download. A Dashboard without that
method shows the text in-page with a **Copy to clipboard** button instead.

## Files

`plugin.json`, `index.html`, `style.css`, `app.js`, `sdk.js` (the Dashboard
bridge shim, plus the optional `downloadFile` wrapper) and
`thc-panel-icon.svg`.

The files are **generated** from the standalone `tools/thc-workspaces.html` in
the THC firmware repo (`python tools/make-thc-plugin.py <thc-workspaces.html>
<this folder> <sdk.js>`), which keeps working on its own as the bench fallback.
Edit that page, regenerate, then copy this folder to
`~/.ugs/dashboard-plugins/thc/` - don't hand-edit these files.
