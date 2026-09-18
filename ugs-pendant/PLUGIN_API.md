# Dashboard Plugin API

Plugins are self-contained folders of HTML/CSS/JS, installed by dropping them into a folder on the machine running UGS and reloading the dashboard - no build step, no compilation, no restart of UGS itself.

## Installing a plugin

Drop the plugin's folder into:

- **Windows/Linux:** `~/.ugs/dashboard-plugins/<plugin-id>/`
- **macOS:** `~/Library/Preferences/ugs/dashboard-plugins/<plugin-id>/`

Then reload the dashboard page. It'll show up under the **Plugins** section of the right rail. `<plugin-id>` is just the folder's name - it's how the backend and the URL refer to this plugin, so keep it filesystem-safe (no spaces or special characters).

## Plugin structure

A plugin folder is flat (no subdirectories) and needs:

```
my-plugin/
├── plugin.json   ← manifest (required)
└── index.html    ← entry point (required)
```

Any additional files (CSS, JS, an icon) go in the same folder alongside `index.html` and are referenced with plain relative paths.

### `plugin.json`

```json
{
  "name": "My Plugin",
  "description": "What it does, in one sentence.",
  "version": "1.0.0",
  "entry": "index.html",
  "icon": "icon.png",
  "allowMultipleInstances": false
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | ✅ | Shown in the Plugins list |
| `description` | No | Not currently shown anywhere in the UI, but good practice |
| `version` | No | Not currently shown anywhere in the UI |
| `entry` | No | Defaults to `index.html` |
| `allowMultipleInstances` | No | Boolean; defaults to `false`. Set to `true` to permit multiple windows of this plugin in one Dashboard page. |
| `icon` | No | Shown next to the name in the Plugins list and the plugin window's title bar |

Unrecognized fields are silently ignored rather than causing an error, so a manifest written for another plugin ecosystem with a similar `plugin.json` shape (extra fields like `layout`, `layoutTablet`, `layoutMobile`, `files`) will still load here - it just won't do anything with the fields this dashboard doesn't act on yet.

## How it runs

Plugins open once per Dashboard page by default. Clicking an already-open plugin brings its existing window to the front and focuses it without reloading its content. Closing it lets the next click open a fresh instance.

Set `"allowMultipleInstances": true` in `plugin.json` only when your plugin supports independent windows. Reload Dashboard after changing the manifest. Each window has its own iframe, request routing, subscriptions, and local JavaScript state; closing one does not close its siblings. Settings remain shared by plugin ID (last save wins), and all windows use the same loaded job and machine connection. Keep batch runners and tools that modify the current job single-instance unless you implement appropriate coordination.

This is a window policy for one Dashboard page, not a machine lock: another browser tab or device can still open the plugin. Existing manifests need no changes. The backend and Dashboard must include this feature for the opt-in to take effect.

Your plugin opens as a **floating, draggable, resizable window** on top of the dashboard - not embedded into the normal layout. It renders inside a **sandboxed iframe** (`sandbox="allow-scripts"`, deliberately *without* `allow-same-origin`), which means:

- Your plugin gets a unique, opaque origin - it cannot read or touch anything on the parent page (no access to the dashboard's DOM, `localStorage`, cookies, or anything else) except through the message-based API below.
- **`alert()`, `confirm()`, and `prompt()` are all silently blocked.** They won't throw an error - they'll just do nothing. Build your own UI for anything you'd normally use one of these for (a status `<div>` you update, a real `<input>` instead of `prompt()`).
- Your plugin can still use its own `localStorage`/`fetch`/etc. freely - it's isolated from the *dashboard's* page, not from the network or its own browser storage.

## Talking to the dashboard

Everything goes through `postMessage`. Send a `fluid-request`, get back a `fluid-response` with the same `id`:

```js
let msgId = 0;
const pending = {};

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending[id] = { resolve, reject };
    window.parent.postMessage({ type: "fluid-request", id, method, params: params || {} }, "*");
  });
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "fluid-response") {
    const p = pending[data.id];
    if (!p) return;
    delete pending[data.id];
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
  }
});
```

Copy this into your plugin (or copy `sdk.js` from the rotate-gcode reference plugin, which wraps it into a nicer `window.Fluid.*` object - every example below assumes you've done that). There's no dashboard-hosted shared script to load; each plugin bundles its own copy.

## Methods

### `getStatus()`

Returns a snapshot of the machine's current state.

```js
const status = await Fluid.getStatus();
// status.state          -> "IDLE" | "RUN" | "HOLD" | "JOG" | "HOME" | "CHECK" | "ALARM"
//                           | "DOOR" | "SLEEP" | "TOOL" | "CONNECTING" | "DISCONNECTED" | "UNKNOWN"
// status.wpos            -> { x, y, z, a, b, c, units } - work coordinates. x/y/z/a/b/c are always
//                           present (0 for axes the machine doesn't have); units is "MM" | "INCH" | "UNKNOWN"
// status.mpos            -> same shape as wpos, but machine coordinates
// status.feed            -> number - current feed rate, in whatever unit system is currently active
// status.spindle         -> number - current spindle speed, rpm
// status.feedOverride    -> number - feed override, percent (100 = no override)
// status.rapidOverride   -> number - rapid override, percent
// status.spindleOverride -> number - spindle override, percent
console.log(`Machine is ${status.state} at X${status.wpos.x} Y${status.wpos.y}`);
```

### `on(event, callback)` / `off(event, callback)`

Subscribe to live events. Two event names exist: `"status"` (a status snapshot, same shape as `getStatus()`, pushed whenever it changes) and `"line"` (raw text the controller sends back over serial - `ok`, `error:9`, alarm text, everything, unfiltered).

```js
function onStatus(status) {
  // status -> same shape as getStatus()'s return value above
  console.log("machine state:", status.state);
}
Fluid.on("status", onStatus);

// later, e.g. when your plugin's window closes or you no longer need it:
Fluid.off("status", onStatus);
```

```js
Fluid.on("line", (text) => {
  // text -> string, one raw line exactly as the controller sent it
  if (text.startsWith("ALARM")) {
    console.warn("Machine alarmed:", text);
  }
});
```

`"line"` is a real console firehose - useful for catching firmware-specific messages `getStatus()` doesn't parse out, or logging a full session transcript. It's overkill if all you want is position/state; use `"status"` for that.

### `sendCommand(command)`

Sends a raw line of G-code (or a firmware command like `$H`) to the controller. Fire-and-forget - it doesn't wait for the controller's response or report back what it said (subscribe to `"line"` for that).

```js
await Fluid.sendCommand("G91 G0 Z5"); // relative jog up 5mm
await Fluid.sendCommand("$H"); // home
```

### `getGcode()`

Returns the raw text of whichever file is currently loaded in the dashboard.

```js
const text = await Fluid.getGcode();
// text -> string, the raw file content exactly as it is on disk
const lineCount = text.split(/\r?\n/).length;
```

### `setGcode(content)`

Overwrites the currently loaded file with new content and reloads it - the dashboard's viewer/editor/status all pick up the change automatically. Use this for "modify the file in place" tools (the rotate-gcode plugin's "Save (overwrite)" button uses exactly this).

```js
const rotated = rotateGcode(originalText, 90);
await Fluid.setGcode(rotated); // resolves with no value once the reload has happened
```

### `saveGcodeAs(content)`

Saves new content as a **different** file. Unlike the other methods, this one takes **no filename or path at all** - it opens the dashboard's own Save As dialog (folder browsing, folder creation, the remembered last-used folder, an overwrite warning if you pick an existing name) and resolves once the person picks a location and confirms, or rejects if they cancel.

```js
try {
  const result = await Fluid.saveGcodeAs(modifiedText);
  // result.path -> string, the workspace-relative path it was saved to (e.g. "CustomerA/lid-rotated.gcode")
  console.log(`Saved as "${result.path}" and opened it`);
} catch (err) {
  // err.message -> "Save cancelled" if the person closed the dialog without saving
  console.log("Save cancelled:", err.message);
}
```

This is deliberate: a plugin never gets to choose *where* something lands on disk. That choice always goes through the same UI a person uses everywhere else in the dashboard.

### `listFiles()`

Returns the whole workspace listing - the same shape the dashboard's own Open/Save As dialogs use.

```js
const { fileDetails, folderList } = await Fluid.listFiles();
// fileDetails       -> array, one entry per gcode file in the workspace
// fileDetails[].path         -> string, workspace-relative, "/"-separated (e.g. "CustomerA/lid.gcode")
// fileDetails[].size         -> number, bytes
// fileDetails[].lastModified -> number, epoch milliseconds
// folderList        -> string[], every folder in the workspace, "/"-separated relative paths -
//                      includes empty folders, unlike fileDetails which only implies folders with a file in them
```

### `openFile(path)`

Opens a file already in the workspace by its path (as returned by `listFiles()`).

```js
await Fluid.openFile("CustomerA/lid.gcode"); // resolves with no value once it's loaded
```

### `pickFile()`

Opens the dashboard's own Open dialog (folder tree, search, everything a person gets from the Open button) and resolves with the path they pick - **without** loading it as the active file, unlike `openFile()`. Use this when you want a path to act on later (queue it, read it, whatever), not one to switch to right now. Rejects if the person cancels. Only one can be open at a time - a second call while one's already pending rejects immediately rather than replacing it, so `await` each call before making another.

```js
try {
  const result = await Fluid.pickFile();
  // result.path -> string, workspace-relative, same shape listFiles()/openFile() use
  console.log(`Picked "${result.path}"`);
} catch (err) {
  console.log("Pick cancelled:", err.message);
}
```

### `getFileStatus()`

Returns the currently loaded file's name and send progress. Separate from `getStatus()` because this isn't controller state - it's the backend's own tracking of the file it's sending.

```js
const fileStatus = await Fluid.getFileStatus();
// fileStatus.fileName             -> string, the ABSOLUTE path on disk (not workspace-relative
//                                    like listFiles()/openFile() use) - "" if nothing is loaded
// fileStatus.sendState            -> "IDLE" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELED" - see note below
// fileStatus.rowCount             -> number, total lines in the loaded file
// fileStatus.completedRowCount    -> number, lines sent and acknowledged so far
// fileStatus.remainingRowCount    -> number, rowCount - completedRowCount
// fileStatus.sendDuration         -> number, milliseconds since the send started
// fileStatus.sendRemainingDuration -> number, estimated milliseconds left - see note below
// fileStatus.lastCompletedLineNumber -> number, the 0-indexed line number of the last ack'd command
const percent = Math.round((fileStatus.completedRowCount / fileStatus.rowCount) * 100);
```

`completedRowCount` and `sendRemainingDuration` are progress indicators, not success indicators: canceled jobs can have every row acknowledged and zero remaining time. Use `sendState`, which is one of `IDLE`, `RUNNING`, `PAUSED`, `COMPLETED`, or `CANCELED`. Loading/unloading a file resets it to `IDLE`; starting a stream sets `RUNNING`. Only the backend stream-complete event sets `COMPLETED`.

### `startSend()` / `pauseSend()` / `stopSend()`

Control sending the currently loaded file - the same three actions as the dashboard's own Start/Pause/Stop buttons, and interchangeable with them (a person can still click Stop on a job your plugin started).

```js
await Fluid.startSend(); // starts sending the loaded file - also how you resume after pauseSend()
await Fluid.pauseSend(); // pauses (GRBL feed hold) - startSend() resumes from here
await Fluid.stopSend();  // cancels the current send entirely
```

`startSend()` rejects (rather than silently running stale gcode) if the dashboard's own gcode editor currently has unsaved changes - same rule as the dashboard's own Start button, since the backend always runs what's on disk.

For batch sequencing, poll `getFileStatus()` after `startSend()` resolves. Require `sendState === "COMPLETED"`, the expected file name, and controller `state === "IDLE"` before advancing. Short jobs may finish between status notifications, so do not require observing RUN first. Keep polling while the stream is RUNNING or PAUSED. CANCELED and missing/unknown states must not advance the queue. Invalidate pending requests when stopping or starting another file so stale responses cannot advance a later run.

### `getSettings()` / `saveSettings(data)`

A small JSON blob, private to your plugin, persisted on disk between sessions. Good for remembering the last angle someone typed, a chosen unit preference, anything you don't want to ask for every time the plugin opens.

```js
const settings = await Fluid.getSettings(); // {} if nothing's been saved yet
angleInput.value = settings.lastAngle ?? 90;

angleInput.addEventListener("change", () => {
  Fluid.saveSettings({ ...settings, lastAngle: Number(angleInput.value) });
});
```

### `close()`

Closes your plugin's own window - the same as the person clicking the × themselves.

```js
Fluid.close();
```

## Not implemented yet

These will reject with a clear error message rather than silently doing nothing or faking a result:

- **`readFile(path)` / `writeFile(path, content)`** - arbitrary file access beyond the currently-loaded file. `getGcode`/`setGcode`/`saveGcodeAs` cover the loaded-file case; there's no generic file API yet.
- **`getDeviceInfo()` / `getMachineSettings()`** - some firmwares expose a full settings dump (e.g. FluidNC's `$$`/`$I`), but UGS is firmware-agnostic (GRBL, TinyG, grblHAL, Smoothieware, g2core...), so there's no generic settings dump to return yet.

## A minimal complete example

```html
<!doctype html>
<html>
<body style="font-family: system-ui; background: #1c1e1f; color: #e5e7eb; margin: 0; padding: 12px;">
  <div id="status">Loading...</div>
  <button id="home">Home</button>

  <script src="sdk.js"></script>
  <script>
    const statusEl = document.getElementById("status");

    Fluid.getStatus().then((s) => {
      statusEl.textContent = `State: ${s.state}`;
    });

    Fluid.on("status", (s) => {
      statusEl.textContent = `State: ${s.state}`;
    });

    document.getElementById("home").addEventListener("click", () => {
      Fluid.sendCommand("$H");
    });
  </script>
</body>
</html>
```

Paired with a `plugin.json`:

```json
{ "name": "Minimal Example", "entry": "index.html" }
```

That's a complete, working plugin - live status display and a home button, in about 20 lines.
