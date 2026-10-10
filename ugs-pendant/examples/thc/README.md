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
- **Operate** - voltages, mode / test run, status pills, jog and calibrate,
  interlock state, datalog recording.
- **Settings** - presets (read and write the same `settings.csv` the Sunton's
  SD card uses) and every live setting, with the speed-curve preview and the
  3 s rolling voltage graph.
- A banner on Operate / Settings says when readings are not live (not
  connected, or no telemetry for more than 3 s).

The layout works down to the Dashboard's smallest plugin window (about 220 px
wide). The theme and accent follow the Dashboard; the THC address is remembered
in the plugin's saved settings.

## Saving CSV files

Plugin windows are sandboxed and cannot trigger browser downloads. **Save CSV**
(datalog) and **Save settings.csv** first ask the Dashboard to save the file
(`Fluid.downloadFile`); a Dashboard without that method instead shows the text
in-page with a **Copy to clipboard** button to paste into a file.

## Files

`plugin.json`, `index.html`, `style.css`, `app.js`, `sdk.js` (the Dashboard
bridge shim, plus the optional `downloadFile` wrapper) and
`thc-panel-icon.svg`.

The shared logic is generated from the standalone `tools/thc-workspaces.html`
in the THC firmware repo, which keeps working on its own as the bench fallback.
