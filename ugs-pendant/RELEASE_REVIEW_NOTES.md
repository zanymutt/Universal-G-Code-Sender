# Editorial and API review notes

These notes accompany `RELEASE_ANNOUNCEMENT_REVISED.md` and `PLUGIN_API_REVISED.md`. The original drafts and application code were left untouched. Review is based on the supplied screenshots, the local implementation, the locally installed Rotate G-code example, and the linked upstream repositories. It is a source/documentation review, not a hardware or browser compatibility test.

## Announcement positioning

The original draft reads like an incremental changelog: plugins and a Save As improvement arrive before a new reader understands Dashboard. The revised version leads with what it is, where it runs, and why its layout helps at a machine. It gives desktop/mouse use and touchscreen use equal footing.

Avoid claiming UGS previously lacked a visualizer, editor, probing, macros, flexible panels, or plugins. [Upstream UGS](https://github.com/winder/Universal-G-Code-Sender) already has a substantial desktop interface and module ecosystem. Dashboard's distinction is how those workflows come together in this browser interface, plus the lightweight web-plugin mechanism. The announcement credits UGS without positioning Dashboard as an official upstream release.

The fork remote is `https://github.com/qviper/Universal-G-Code-Sender.git`. A particular Dashboard release asset was not verified. The announcement therefore retains one explicit release-link placeholder and does not promise unverified OS packages, filenames, or bundled Java. Before publication, point the developer-guide link at the final published filename and confirm whether Rotate G-code will be bundled or downloadable separately; its installed local folder is not currently a tracked example under `ugs-pendant`.

## Suggested screenshot order and captions

Use a few readable screenshots rather than placing all ten at the top of the announcement. The supplied clipboard image duplicates the Save As view. The proposed announcement works as plain text; these captions can accompany forum uploads or repository-hosted images.

| Order | File | Suggested caption |
| --- | --- | --- |
| 1 | `base.jpg` | **Your CNC workspace at a glance:** position, jogging, toolpath, macros, overrides, and job controls in one wide-screen layout. |
| 2 | `split.jpg` | **Keep the code beside the cut:** the toolpath viewer and G-code editor share an adjustable split view. |
| 3 | `macro.jpg` | **Make frequent actions your own:** edit macros, choose colors and icons, and keep them available as buttons. |
| 4 | `plugin.jpg` | **Small tools, right where you work:** Rotate G-code runs in a movable, resizable plugin window. |
| 5 | `launch.jpg` | **Start UGS, open Dashboard:** optional automatic browser launch, including Chrome/Edge app mode. |

Optional follow-ups: `resize.jpg` demonstrates reduced overall UI scale with independently enlarged editor/console text; `probe.jpg` shows probing alongside the visualizer; `filebrowser.jpg` specifically shows **Save As**, not the Open dialog; `runfrom.jpg` shows the confirmation step, not a running or proven restart operation.

Some supplied images include large white margins or cut off the right edge of the application. For publication, a clean recapture of those views would read better than added labels. Keep `base.jpg` or `split.jpg` as the main image; neither needs markup to convey the layout. No screenshots were modified.

## FigUI credit

Keep the main announcement focused on UGS Dashboard, as drafted. Include a short acknowledgment in the developer guide because the implementation deliberately uses FigUI-style manifest and message names. Suggested wording: “The manifest and messaging conventions are inspired by FigUI's plugin API; Dashboard implements a subset adapted to UGS.” The revised guide includes that acknowledgment with a link.

Do not describe it as FigUI-compatible without qualification. [FigUI's guide](https://github.com/figamore/FigUI/blob/main/plugins/PLUGIN_GUIDE.md) describes capabilities that this bridge does not provide, including additional layouts, automatic theming, and query methods. If any code/assets were copied, preserve their existing attribution and notices; this review does not establish provenance.

## Corrections made in the plugin guide

- Replaced the missing-SDK “complete example” with an actual two-file starter. The starter is read-only, includes message-source validation, displays errors, and times out unanswered requests.
- Corrected the claim that an opaque-origin sandbox can freely use its own `localStorage`. Documented the settings API, CORS constraints, and lack of injected theme variables.
- Clarified that plugins can affect the physical machine through the API and overwrite files. The original announcement's sandbox language could imply a stronger restriction than exists.
- Corrected manifest `description`: it is used as hover text in `PluginListPanel.tsx`.
- Documented that `getGcode()` reads the saved backend file, not unsaved editor text; `setGcode()` writes the current file on disk without an API-level confirmation.
- Removed the example describing `G91 G0 Z5` as a guaranteed 5 mm jog. It depends on units and changes modal state.
- Corrected the description of `line` events and documented the current forwarding limitations.
- Explained full-object settings replacement, shared settings across instances, Save As outcomes, and the lack of arbitrary file access.

## Implementation issues for Claude to consider separately

These findings were not fixed as part of the documentation work.

### 1. Plugin `line` events stall at the console cap

`src/main/webapp-dashboard/src/components/PluginWindow.tsx` slices messages starting at `lastForwardedCountRef.current`, then records the array length. `src/main/webapp-dashboard/src/store/consoleSlice.ts` caps that array at 500. Once the stored index and length are both 500, `slice(500)` returns nothing despite new messages replacing old ones. A subscriber opening after the console has filled can receive no lines at all.

The subscriber counter in `store/pluginLineSubscription.ts` also competes with the Console's independently controlled Verbose setting. Finally, the plugin forwards only `verbose` entries, not all console message types, and `EventsSocket.java` strips trailing whitespace. The original guide's “everything, unfiltered” and full-transcript claims were not supportable.

### 2. Local-device Save As succeeds but reports cancellation to the plugin

`components/SaveAsModal.tsx` saves device-mode content through `saveToDevice()` and then closes. That route does not call `PluginWindow.tsx`'s `onSaveToWorkspace` callback, which is the only place the pending plugin request resolves. Closing then rejects it with `Save cancelled`. A separate success result for device saves, or restricting this plugin dialog to UGS saves, would make the contract clearer.

### 3. Save As returns the submitted path rather than the normalized filename

The plugin resolves `{ path: relativePath }`. The Java `FilesResource.saveFileContentAs` method may append an extension before writing. A user typing `part` can therefore produce `part.gcode` while the API reports `part`. The guide does not promise the returned string is a canonical path. Save As also calls `currentGcodeFile()` before saving, so it currently needs an already loaded job even when a workspace exists.

### 4. `sendCommand` does not check HTTP error status

`services/machine.ts` uses `fetch(...).then()` for `sendGcode`; an HTTP error can resolve the plugin request successfully. It also has no controller-acknowledgment/completion contract. `services/files.ts` similarly does not check status for `getWorkspaceFileList()`. The guide makes those boundaries explicit rather than promising all failures reject.

### 5. The installed reference SDK has callback and source-check gaps

The locally installed Rotate G-code `sdk.js` does not check `event.source` on incoming messages. Its `off(event, callback)` always sends `unsubscribe`, even if other callbacks for that event remain. A reusable SDK should validate the parent source and only unsubscribe when the final callback is removed. The new starter includes a source check and uses direct host subscriptions rather than copying that wrapper.

### 6. File operations target a shared current job

The bridge does not attach file identity or revision information to `getGcode`/`setGcode`. A plugin can read one job and later overwrite a different currently loaded job if the user switches files in between. This is an API design consideration for transformation tools; the guide documents it and encourages explicit save actions.

## Source map

Paths below are relative to this `ugs-pendant` directory unless noted.

| Claim | Local evidence |
| --- | --- |
| Wide/narrow layouts | `src/main/webapp-dashboard/src/pages/Dashboard.tsx`, `components/PortraitDashboard.tsx`, `hooks/useNarrowLayout.ts` |
| UI scale, split, console resizing | `hooks/useZoomLevel.ts`, `components/CenterPanel.tsx` under the dashboard source directory |
| Macro workflow | `components/MacroEditor.tsx`, `components/MacroForm.tsx` |
| File browsing and saving | `components/OpenFileModal.tsx`, `components/SaveAsModal.tsx`, Java `FilesResource.java` |
| Probing and run-from-line UI | `components/ProbePanel.tsx`, `components/GcodeEditor.tsx` |
| Plugin host contract | `components/PluginWindow.tsx`, `components/PluginListPanel.tsx`, Java `PluginsResource.java` and `PluginManifest.java` |
| Startup browser/app mode | Repository `ugs-platform/ugs-platform-ugscore/src/main/java/com/willwinder/ugs/nbp/core/services/PendantService.java` |
| Install paths | Repository `ugs-core/src/com/willwinder/universalgcodesender/utils/SettingsFactory.java` |

The announcement deliberately avoids claiming universal controller/browser testing, guaranteed recovery of an interrupted cut, or preservation of arbitrary programs by the rotation example. Screenshots show available controls; they do not verify those broader claims.
