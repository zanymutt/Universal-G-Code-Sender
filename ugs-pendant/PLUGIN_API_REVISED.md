# Build a plugin for UGS Dashboard

A Dashboard plugin is a small web page that adds a tool to your CNC workspace. It could be a job inspector, a calculator, a custom status display, or a tool that transforms the loaded G-code. You write the interface in HTML, CSS, and JavaScript; Dashboard supplies a floating window and an API for interacting with UGS.

You don't need to compile UGS or use a Java plugin framework. A simple plugin needs just two files: a manifest and an HTML page.

The ready-to-copy [Job Inspector example](examples/job-inspector/) includes [plugin.json](examples/job-inspector/plugin.json) and [index.html](examples/job-inspector/index.html). Copy the whole `job-inspector` folder into your plugin directory and reload Dashboard, or follow the walkthrough below to create it yourself.

This guide describes the current Dashboard implementation. These web plugins are separate from UGS Platform's desktop modules. The API is still developing; limitations that affect plugin authors are listed below.

## 1. Create your plugin folder

Plugins live on the **computer running UGS**, under the settings directory for the account running UGS. This is separate from the G-code workspace and from your controller's storage.

| Operating system | Default plugin directory |
| --- | --- |
| Windows | `%USERPROFILE%\.ugs\dashboard-plugins\` |
| Linux | `~/.ugs/dashboard-plugins/` |
| macOS | `~/Library/Preferences/ugs/dashboard-plugins/` |

Create a folder named `job-inspector` inside that directory:

```text
dashboard-plugins/
└── job-inspector/
    ├── plugin.json
    └── index.html
```

The folder name is the plugin ID. Use a simple name such as `job-inspector` with lowercase letters, numbers, and hyphens. Keep all plugin assets in this one folder: the current file-serving API does not support nested asset directories. Reserve `settings.json` for settings written by Dashboard.

## 2. Add a manifest

Save this as `plugin.json`:

```json
{
  "name": "Job Inspector",
  "description": "Show machine state and count lines in the loaded job.",
  "version": "1.0.0",
  "entry": "index.html"
}
```

| Field | Required | What Dashboard does with it |
| --- | --- | --- |
| `name` | Yes | Shows it on the plugin button and window title. Must not be blank. |
| `description` | No | Uses it as the plugin button's hover text. |
| `version` | No | Reads it as metadata; does not currently display it. |
| `entry` | No | Opens this HTML file. Defaults to `index.html` when omitted or blank. |
| `allowMultipleInstances` | No | Boolean; defaults to `false`. Set to `true` to allow multiple windows in one Dashboard page. |
| `icon` | No | Shows this local image on the plugin button and window title. |

For example, add `"icon": "icon.png"` if you include that file alongside your HTML. Unknown fields are ignored. Fields such as `layout`, `layoutTablet`, `layoutMobile`, and `files` do not enable extra behavior in Dashboard.

## 3. Add a complete working page

### Choosing whether to allow multiple windows

By default, clicking an already-open plugin brings its existing window to the front and focuses it, preserving its contents and size. Closing it allows a fresh instance on the next launch. Existing manifests need no changes.

For tools designed to support independent windows, add `"allowMultipleInstances": true` to the manifest and reload Dashboard. Each window has its own iframe, JavaScript state, request routing, and subscriptions. Closing one leaves its siblings open. Settings are still shared by plugin ID, with the last save winning; the loaded job and machine connection are shared too. Calculators and reference tools are good candidates. Batch runners and tools that modify the current job should generally keep the default.

The restriction applies to one Dashboard page, not across tabs, browsers, or devices. It does not provide exclusive control of the machine. The backend and Dashboard must both include this feature for the opt-in to work.

Save the following as `index.html`. It includes its own message bridge, so there is no SDK to download and no build step. It reads status and job text without issuing machine commands or changing files.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Job Inspector</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 16px;
      font: 16px/1.5 system-ui, sans-serif;
      background: #1c1e1f; color: #e5e7eb;
    }
    h1 { margin: 0 0 12px; font-size: 20px; }
    button {
      min-height: 44px; padding: 8px 14px; font: inherit;
      background: #454ce5; color: white;
      border: 0; border-radius: 4px; cursor: pointer;
    }
    button:disabled { opacity: .6; cursor: wait; }
    #result { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>Job Inspector</h1>
  <p id="state" role="status">Connecting to Dashboard…</p>
  <button id="inspect" type="button">Inspect loaded job</button>
  <p id="result" role="status"></p>
  <script>
    let nextId = 0;
    const pending = new Map();
    const stateEl = document.getElementById("state");
    const resultEl = document.getElementById("result");
    const inspectButton = document.getElementById("inspect");

    function call(method, params = {}, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        if (window.parent === window) {
          reject(new Error("Open this plugin from UGS Dashboard."));
          return;
        }
        const id = ++nextId;
        const timer = timeoutMs > 0 ? setTimeout(() => {
          pending.delete(id);
          reject(new Error(`No reply to ${method}; check Dashboard.`));
        }, timeoutMs) : null;
        pending.set(id, { resolve, reject, timer });
        try {
          window.parent.postMessage(
            { type: "fluid-request", id, method, params }, "*"
          );
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    }

    function showStatus(status) {
      stateEl.textContent = `Machine: ${status.state}`;
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "fluid-response") {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        clearTimeout(request.timer);
        if (data.error !== undefined) request.reject(new Error(data.error));
        else request.resolve(data.result);
      } else if (data.type === "fluid-event" && data.event === "status") {
        showStatus(data.data);
      }
    });

    async function start() {
      try {
        showStatus(await call("getStatus"));
        await call("subscribe", { event: "status" });
      } catch (error) {
        stateEl.textContent = error.message;
      }
    }

    inspectButton.addEventListener("click", async () => {
      inspectButton.disabled = true;
      try {
        const text = await call("getGcode");
        const lines = text === "" ? [] : text.split(/\r\n|\r|\n/);
        if (lines[lines.length - 1] === "") lines.pop();
        resultEl.textContent = `${lines.length} text lines in the saved job.`;
      } catch (error) {
        resultEl.textContent = `Couldn't read the job: ${error.message}`;
      } finally {
        inspectButton.disabled = false;
      }
    });

    start();
  </script>
</body>
</html>
```

Reload Dashboard, then click **Job Inspector** under **Plugins**. Open a G-code file and click **Inspect loaded job**. The count is a text-line count, not UGS's count of executable commands.

To update the plugin, edit its files and close/reopen its window. Reload Dashboard to rediscover a new folder or changed manifest. If the browser still serves an older asset, disable its cache in DevTools and reload. You do not need to restart UGS.

## How the API works

The parent Dashboard owns the UGS connection. Your plugin sends a request with a unique ID; Dashboard returns a response carrying that ID. Live events arrive separately.

```js
// Plugin → Dashboard
{ type: "fluid-request", id: 1, method: "getStatus", params: {} }

// Dashboard → plugin, success
{ type: "fluid-response", id: 1, result: /* method-specific value */ }

// Dashboard → plugin, failure
{ type: "fluid-response", id: 1, error: "An error description" }

// Dashboard → plugin, subscribed event
{ type: "fluid-event", event: "status", data: /* status snapshot */ }
```

The `call()` helper above implements requests and replies. The examples below use it inside an `async` function or an async click handler. Handle rejections in your UI, as the starter does.

The message names are part of the current protocol: keep the `fluid-` prefixes. Dashboard does **not** inject `window.Fluid` or a shared SDK. The Rotate G-code example bundles an `sdk.js` that provides `Fluid.getStatus()` and similar convenience methods; those wrappers use this same protocol.

The starter's timeout is a client-side convenience, not a host guarantee. A timeout does not cancel a request or prove that an action failed. Don't automatically retry a command or write operation. Pass `0` as the third argument for a dialog-based request that may wait for the user indefinitely.

## API reference

### Machine status: `getStatus`

```js
const status = await call("getStatus");
```

| Field | Meaning |
| --- | --- |
| `state` | UGS machine state, such as `DISCONNECTED`, `CONNECTING`, `IDLE`, `RUN`, `HOLD`, or `ALARM`. Handle other states too. |
| `wpos` | Work coordinates: `x`, `y`, `z`, `a`, `b`, `c`, and `units`. |
| `mpos` | Machine coordinates with the same shape. |
| `feed` | Feed-speed value supplied by UGS. |
| `spindle` | Spindle-speed value supplied by UGS, in RPM. |
| `feedOverride` | Feed override percentage. |
| `rapidOverride` | Rapid override percentage. |
| `spindleOverride` | Spindle override percentage. |

Read the coordinate `units` value (`MM` or `INCH` in normal operation); don't assume millimeters or infer the controller's G20/G21 mode from the display units. Treat absent or non-finite coordinate values as unavailable. The presence of an axis field does not establish that the physical machine has that axis.

This is Dashboard's latest state snapshot, not a fresh controller query. The plugin snapshot does not currently include Dashboard's full pin, accessory, or modal-state data.

### Live updates: `subscribe` / `unsubscribe`

Register your message handler before subscribing. The starter already handles `status` messages.

```js
await call("subscribe", { event: "status" });
// Later, when updates are no longer needed:
await call("unsubscribe", { event: "status" });
```

`status` events carry the same shape as `getStatus()`. The host sends its current snapshot when the subscription takes effect and subsequent updates as Dashboard receives them. Closing the plugin removes its subscriptions.

`line` events carry strings from UGS's **verbose console stream**. They are not a complete, lossless stream of all controller responses: other message categories are excluded and trailing whitespace is stripped upstream. There is no command/request correlation.

Line forwarding uses monotonically increasing message IDs so the bounded console buffer can keep rolling. The host manages verbose subscriptions for plugin listeners. These events still do not provide a lossless command-response protocol.

If you build a helper with multiple callbacks per event, subscribe once for the first callback and unsubscribe only after removing the last. The host tracks subscriptions per plugin window, not per callback.

### Commands: `sendCommand`

```js
await call("sendCommand", { command: "$I" });
// $I is a Grbl/FluidNC-style information request, not a universal command.
```

Sends command text through UGS. Firmware command syntax and capabilities still apply. Commands can move the machine or change controller settings; run them from an explicit user action and make their effect clear.

A resolved request is **not** a controller acknowledgment or a motion-completed signal. The current frontend helper also does not reject HTTP error statuses for this method, so resolution alone does not establish backend acceptance. There is no supported query/response or wait-until-motion-complete API yet.

### Read the loaded job: `getGcode`

```js
const originalText = await call("getGcode");
```

Returns the raw text of the backend's currently loaded file on disk. It does not include unsaved text in the Dashboard editor. Rejects if no file is loaded.

### Replace the loaded job: `setGcode`

```js
await call("setGcode", { content: modifiedText });
```

Writes to the currently loaded file and asks UGS to reload it. This is an actual disk write, not an editor preview, and this method does not present an overwrite confirmation. Completion of the request does not mean that every view has finished refreshing.

The target is whichever file is loaded **when the request runs**. There is no file ID or revision check tying it to an earlier `getGcode()` call. Make replacement an explicit action, and account for the user opening another file while your tool is working. For a file uploaded through the browser, the loaded copy may be a temporary server file rather than the original file on the user's device.

### Choose a save destination: `saveGcodeAs`

```js
const result = await call("saveGcodeAs", { content: modifiedText }, 0);
console.log("Submitted save path:", result.path);
```

Opens Dashboard's Save As dialog. The plugin supplies content; the user chooses the destination and filename. The dialog offers workspace folder browsing, folder creation, and an overwrite confirmation when a matching file appears in the workspace listing. It can save a new file or overwrite an existing one.

Saving to UGS writes the content and loads the saved file. The response is `{ path: string }`, containing the path submitted by the dialog, normally relative to the workspace. The backend may add an extension, so this is not guaranteed to be the final on-disk filename. If no workspace is configured, the backend saves beside the current file. A current file must already be loaded in this implementation, even for Save As.

Closing the dialog without a UGS save rejects with `Save cancelled`. A failed write can leave the dialog open to show an error and allow a retry. Open only one Save As request at a time per plugin window.

Plugin Save As offers saving to UGS only, so a successful result identifies the workspace file. Device downloads are not offered by this plugin dialog.

### Browse the workspace: `listFiles`

```js
const listing = await call("listFiles");
const entries = listing.fileDetails ?? [];
```

| Field | Shape |
| --- | --- |
| `fileList` | Array of workspace-relative G-code paths, retained for older clients. |
| `fileDetails` | Array of `{ path, size, lastModified }`. Size is bytes; modification time is epoch milliseconds. |
| `folderList` | Workspace-relative folder paths, including empty folders. |

Paths use `/` separators, for example `CustomerA/lid.gcode`. This is the UGS computer's configured workspace, not a general filesystem listing or the controller's SD card. Listing is best-effort; inaccessible files/folders may be omitted. The current frontend helper does not check HTTP error status before parsing this response, so validate its shape.

### Load a workspace file: `openFile`

```js
await call("openFile", { path: "CustomerA/lid.gcode" });
```

Loads an existing workspace file into UGS. It changes the shared current job; it does not start sending the job. Use a path returned by `listFiles()`.

### Choose a file without loading it: `pickFile`

```js
const { path } = await call("pickFile");
await call("openFile", { path }); // optional; selection alone does not load it
```

Opens Dashboard's workspace picker. Canceling rejects with `Pick cancelled`. A second request from this plugin window rejects while the first picker is open, even when calls arrive before the next render.

### Inspect and control the current job

```js
const file = await call("getFileStatus");
await call("startSend"); // starts the loaded job, or resumes a paused send
await call("pauseSend");
await call("stopSend");
```

These controls operate on the shared current job. `startSend` rejects while the Dashboard editor has unsaved changes. A resolved call means the request returned, not that motion finished.

`getFileStatus` returns `fileName`, `rowCount`, `completedRowCount`, `remainingRowCount`, `sendDuration`, `sendRemainingDuration`, `lastCompletedLineNumber`, and `sendState`. Durations are milliseconds; an unavailable estimate can be `-1`. The lifecycle states are `IDLE`, `RUNNING`, `PAUSED`, `COMPLETED`, and `CANCELED`. Loading/unloading a file resets the state to `IDLE`.

For a batch, poll after `startSend` resolves and require **both** `sendState === "COMPLETED"` and controller `state === "IDLE"`, with the expected file name, before advancing. A short job can complete without a RUN notification reaching the plugin. Retry while the backend state is RUNNING or PAUSED; cancellation and missing/unknown states must not advance. Neither all rows acknowledged nor zero remaining time proves success. Invalidate asynchronous callbacks after Stop and when switching files so a stale response cannot start another job.

The `sendState` field requires the updated UGS backend, not just a Dashboard reload. The reference SDK exposes these methods as `Fluid.pickFile()`, `Fluid.getFileStatus()`, `Fluid.startSend()`, `Fluid.pauseSend()`, and `Fluid.stopSend()`; the starter's generic `call()` helper works without additional wrappers.

### Remember preferences: `getSettings` / `saveSettings`

```js
const settings = await call("getSettings");
settings.lastAngle = 90;
await call("saveSettings", { data: settings });
```

`getSettings` returns `{}` when nothing has been saved. `saveSettings` accepts a JSON object and **replaces** the previous object; it does not merge individual keys.

Settings are stored as `settings.json` in the installed plugin folder on the UGS computer. They are shared by instances of that plugin ID, including windows opened from different devices. Concurrent saves use last-write-wins behavior. Renaming the folder changes the plugin ID; deleting it also removes its saved settings. Treat this as preferences storage, not secret storage.

### Close the window: `close`

```js
call("close").catch(() => {});
```

Asks Dashboard to close this plugin window. The iframe may be removed before a reply can be consumed, so don't put required follow-up work after awaiting this request.

### Unsupported methods

`readFile`, `writeFile`, `getDeviceInfo`, and `getMachineSettings` currently reject with an explicit not-implemented error. Other unrecognized methods, including `sendQuery`, reject as unknown methods. There is no generic arbitrary-file API, firmware-settings API in this plugin bridge.

## Design for the plugin window

Your page opens in a floating, draggable, resizable window. Use flexible widths, allow your page to scroll, and test a small window as well as your usual size. Give touch controls enough space and show progress or errors inside the page. Window resizing support itself depends on the browser's native CSS resize behavior.

Dashboard does not inject its styles or theme variables into the iframe. Supply your own CSS, as the starter does. Keep optional CSS, classic JavaScript files, and images alongside `index.html` and use relative references such as `<script src="tool.js"></script>` or `<link rel="stylesheet" href="style.css">`. ES modules and fetched resources are subject to cross-origin checks in this sandbox; don't assume a normal web-app bundle will work unchanged.

## Sandbox behavior

Dashboard uses `sandbox="allow-scripts"`, without `allow-same-origin`. Your plugin can run JavaScript and manipulate its own page, but cannot access Dashboard's DOM or its JavaScript state directly. Use the message API for UGS operations.

Browser `alert`, `confirm`, and `prompt` dialogs are blocked; create controls and confirmation messages inside the plugin instead. The opaque origin also prevents normal `localStorage`/`sessionStorage` access. Use `getSettings` and `saveSettings` for persistence. Fetches are subject to CORS, and the sandbox is not a network firewall. See the browser's [iframe sandbox documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).

The sandbox does not make a plugin read-only: the exposed API can send machine commands and overwrite a loaded file. There are no per-plugin permission prompts for those API methods. Install code you trust, and design write/motion actions so users understand what they are requesting.

The starter accepts replies only from `window.parent`; the host similarly checks that requests come from its own plugin iframe. The current protocol uses `postMessage(..., "*")` to accommodate the sandboxed frame. Keep those source checks when adapting the bridge.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Plugin does not appear | Correct account's UGS settings directory, one folder level, valid JSON, nonblank `name`, then reload Dashboard. Invalid manifests are skipped and logged by UGS. |
| Window is blank | `entry` points to an existing file; filenames and relative paths match; assets are flat, not nested. Inspect the iframe console/network requests. |
| `Fluid is not defined` | Dashboard does not inject an SDK. Bundle one or use the complete starter's `call()` helper. |
| Requests receive no reply | Launch through Dashboard, not by opening `index.html` directly. Verify message names and install the response listener before sending requests. |
| Preferences fail | Use the settings API instead of browser storage. Check that UGS can write to the installed plugin directory. |
| Job text looks old | `getGcode()` reads disk; save editor changes first. |
| A line listener stops | Check the subscription; only verbose console messages are forwarded. |
| Save reports cancellation | The plugin dialog was canceled; it only offers UGS workspace destinations. |

## Porting a plugin

The manifest and messaging conventions are inspired by [FigUI's plugin API](https://github.com/figamore/FigUI/blob/main/plugins/PLUGIN_GUIDE.md). This is a partial implementation adapted to UGS, not a promise of drop-in compatibility. Check method availability, status and file-list shapes, storage location, theming, and layout assumptions before porting. Firmware-specific commands still need a compatible controller.
