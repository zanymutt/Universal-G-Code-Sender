# UGS Dashboard Backend/Frontend API Anchor

Structural map (as of 2026-10-12; see also `dashboard-ui-working-notes.md` for how to work here) of the bridge between `webapp-dashboard` (Vite/React) and the `ugs-pendant` Java backend, plus the plugin bridge. No prose, no code - paths and signatures only, for anchoring a fresh task.

## Backend bootstrap

- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/PendantUI.java` — server entry point; constants `API_CONTEXT_PATH="/api/v1"`, `WEBSOCKET_CONTEXT_PATH="/ws/v1"`, `DASHBOARD_CONTEXT_PATH="/dashboard"`; wires Jetty handlers.
- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/v1/AppV1Config.java` — Jersey `ResourceConfig`; registers every `*Resource` class below plus `StaticResource`, `ExceptionMapper`, `ObjectMapperProvider`.
- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/html/DashboardStaticResource.java` — serves built dashboard assets from `RESOURCES_PATH="/resources/ugs-dashboard/%s"` (i.e. `target/classes/resources/ugs-dashboard`, the Vite build output copied in by `frontend-maven-plugin`).
- `ugs-pendant/src/main/webapp-dashboard/vite.config.ts` — dev proxy: `/api` → `http://localhost:8080`, `/ws` → `http://localhost:8080`.

## Backend REST resources (`ugs-pendant/src/main/java/.../pendantui/v1/resources/`)

All `@Path`-relative to `/api/v1`.

- `StatusResource.java` `@Path("/status")` — `GET getStatus()` → `Status`.
- `MachineResource.java` `@Path("/machine")` — `GET connect()`, `GET disconnect()`, `GET getPortList()`→`List<String>`, `GET/POST getSelectedPort/setSelectedPort(port)`, `GET getBaudRateList()`, `GET/POST getSelectedBaudRate/setSelectedBaudRate(baudRate)`, `GET getFirmwareList()`, `GET/POST getSelectedFirmware/setSelectedFirmware(firmware)`, `GET killAlarm()`, `GET resetToZero()`, `GET returnToZero()`, `GET homeMachine()`, `GET softReset()`, `POST sendOverride(command: Overrides)`, `POST sendGcode(GcodeCommands)`, `GET jog(x,y,z: int)` (one step of the current step size), `POST jogContinuous(JogContinuousRequest{x,y,z: -1..1})`→`JogContinuousResponse{active, reason}` (see "Continuous jog").
- `FilesResource.java` `@Path("/files")` — `POST uploadAndOpen` (multipart), `POST send()`, `POST runFromLine(line: int)`, `GET pause()`, `GET cancel()`, `GET getWorkspaceFileList()`→`WorkspaceFileList`, `POST createWorkspaceFolder`, `POST openWorkspaceFile`, `GET getFileStatus()`→`FileStatus`, `GET getFileContent()`, `POST saveFileContent`, `POST closeFile()`, `POST saveFileContentAs`.
- `MacrosResource.java` `@Path("/macros")` — `GET getMacroList()`→`List<Macro>`, `POST runMacro(Macro)`, `POST saveMacroList(List<Macro>)`→`List<Macro>`.
- `ProbeResource.java` `@Path("/probe")` — `GET getSettings()`→`ProbeSettings`, `POST saveSettings(ProbeSettings)`, `POST run(ProbeRunRequest)`→`ProbeResult`.
- `VisualizerResource.java` `@Path("/visualizer")` — `GET getToolpath()`→`List<ToolpathSegment>`.
- `GcodeReviewResource.java` `@Path("/review")` — `GET` reviews the loaded file; `POST` reviews dashboard editor text→`GcodeReviewResult`.
- `SettingsResource.java` `@Path("/settings")` — `GET getSettings()`→`Settings`, `POST setSettings(Settings)`.
- `PluginsResource.java` `@Path("/plugins")` — `GET list()`→`List<PluginInfo>`; `GET {id}/files/{filename}`→`Response` (static file); `GET/POST {id}/settings` (JSON blob passthrough).
- `TextResource.java` `@Path("/text")` — `GET getTexts()`→`Map<String,String>` (i18n strings).
- `CustomOpenApiResource.java` — OpenAPI/Swagger doc generator, servers URL `/api/v1`.

## Backend WebSocket

- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/v1/ws/EventsSocket.java` — `@ServerEndpoint("/events")` (full path `/ws/v1/events`).
  - Client→server text frames: `"ping"` (→ replies `{"eventType":"Pong"}"`), `"verbose:on"` / `"verbose:off"` (per-session opt-in to `MessageType.VERBOSE` console traffic).
  - Server→client: JSON `Event` wrapper, `eventType` values seen in frontend: `ControllerStatusEvent`, `Pong`, `ConsoleMessageEvent`, `AlarmEvent`, `FileStateEvent` (`fileState: "FILE_LOADED"` etc.), `SettingChangedEvent`, `CommandEvent` (`commandEventType: "COMMAND_COMPLETE"|"COMMAND_SENT"`).
  - Backend listens via `UGSEventListener`/`MessageListener` on `BackendProvider.getBackendAPI()`.

## Backend models (`ugs-pendant/src/main/java/.../pendantui/v1/model/`)

- `Status.java` — controller/machine status class (mirrors `ControllerStatus`).
- `FileStatus.java` `record(fileName, rowCount, completedRowCount, remainingRowCount, sendDuration, sendRemainingDuration, lastCompletedLineNumber, sendState)`.
- `Macro.java` — id/name/description/gcode/color/icon/keypress etc. (class, not record).
- `ProbeSettings.java`, `ProbeRunRequest.java`, `ProbeResult.java`, `ProbeOperation.java` (enum).
- `ToolpathSegment.java` `record(start: ToolpathPoint, end: ToolpathPoint, rapid, arc, lineNumber, feedRate, inches, spindleSpeed)` (`spindleSpeed` = the modal S word; feeds laser engraving depth in the Stock view); `ToolpathPoint.java` `record(x,y,z)`.
- `WorkspaceFileEntry.java`, `WorkspaceFileList.java` — file browser tree nodes.
- `Settings.java` — app settings blob (units, etc.).
- `PluginManifest.java` `record(name, description, version, entry, icon, allowMultipleInstances)` — maps to `plugin.json`, `@JsonIgnoreProperties(ignoreUnknown=true)`, `entryOrDefault()` defaults to `"index.html"`.
- `PluginInfo.java` `record(id, name, description, version, entryUrl, iconUrl, allowMultipleInstances)` — `entryUrl`/`iconUrl` pre-resolved to `/api/v1/plugins/{id}/files/...`.
- `Event.java` — WS envelope wrapper; `PendantError.java` — error body shape.

## Plugin filesystem (backend-owned, not in git)

- Root: `SettingsFactory.getSettingsDirectory()/dashboard-plugins/<pluginId>/` (i.e. `~/.ugs/dashboard-plugins/<id>/` on this machine).
- Per-plugin files: `plugin.json` (manifest), `settings.json` (per-plugin JSON blob), `index.html` + any JS/CSS/icon the manifest's `entry`/`icon` point to.
- Install method today: drop a folder in manually, then hit the dashboard's plugin-list refresh (`GET /plugins/list`) — no upload endpoint yet (see `PluginsResource` class javadoc for the deferred multipart-install plan).

## Frontend services (`ugs-pendant/src/main/webapp-dashboard/src/services/*.ts`)

Thin REST wrappers, one file per backend resource, all `fetch("/api/v1/...")`.

- `status.ts` — (status fetch, consumed by `statusSlice.ts`).
- `machine.ts` — `getPortList`, `getSelectedPort`, `getSelectedFirmware`, `getSelectedBaudRate`, `getFirmwareList`, `getBaudRateList`, `connect`, `disconnect`, `softReset`, `killAlarm`, `homeMachine`, `returnToZero(axis?)`, `jog(x,y,z)`, `cancelSend`, `pause`, `send`, `sendOverride(command)`, `sendGcode(commands)`.
- `files.ts` — `getFileStatus`, `send`, `runFromLine(line)`, `stop`, `pause`, `getWorkspaceFileList`, `openWorkspaceFile(relativePath)`, `createWorkspaceFolder(relativePath)`, `closeFile`, `uploadAndOpen(file: File)`.
- `fileContent.ts` — `getFileContent()`, `saveFileContent(content)`, `saveFileContentAs(filename, content)`.
- `macros.ts` — `getMacroList`, `runMacro(macro)`, `saveMacroList(macros)`.
- `probe.ts` — `getProbeSettings`, `saveProbeSettings(settings)`, `runProbe(operation, maxTravel?)`.
- `visualizer.ts` — `getToolpath()` → `ToolpathSegment[]`.
- `settings.ts` — `fetchSettings`, `putSettings(settings)`.
- `plugins.ts` — `listPlugins()` → `PluginInfo[]`, `getPluginSettings(id)`, `savePluginSettings(id, data)`.
- `download.ts` — local-only helpers: `supportsSaveFilePicker`, `saveToDevice`, `downloadSingleMacro`, `downloadMacroList`, `parseMacroListFile(file)`.
- `editorSaveBridge.ts` — `registerEditorSaveHandler(handler)`, `saveEditorContent()` (lets JobBar trigger GcodeEditor's save from elsewhere).

## Frontend WebSocket handling

- `ugs-pendant/src/main/webapp-dashboard/src/utils/Socket.ts` — raw WS wrapper class (`connect(url)`, `send`, `onMessage`, `isConnected`).
- `ugs-pendant/src/main/webapp-dashboard/src/store/socketMiddleware.ts` — opens `ws://<host>/ws/v1/events`, dispatches redux actions per `eventType` (see WebSocket section above), sends `ping` every 4s, mirrors `consoleActions.setVerboseEnabled` to `"verbose:on"/"off"` frames.
- `ugs-pendant/src/main/webapp-dashboard/src/store/socketSlice.ts` — connection-state slice (`connect`, `connectionEstablished`, `connectionClosed`, `messageReceived`).
- Event payload TS types: `ugs-pendant/src/main/webapp-dashboard/src/model/{UGSEvent,ControllerStatusEvent,CommandEvent,AlarmEvent,ConsoleMessageEvent,FileStateEvent}.ts`.

## Plugin bridge (dashboard ⇄ sandboxed plugin iframe)

- `ugs-pendant/src/main/webapp-dashboard/src/components/PluginWindow.tsx` — parent side; `callMethod(method, params)` switch (the whole plugin API surface): `getStatus`, `getTheme`, `subscribe`/`unsubscribe`, `sendCommand`, `getGcode`/`setGcode`, `saveGcodeAs`, `downloadFile`, `listFiles`, `openFile`, `pickFile`, `getFileStatus`, `startSend`, `pauseSend`, `stopSend`, `readFile`/`writeFile`, `getSettings`/`saveSettings`, `getDeviceInfo`, `getMachineSettings`, `close`.
- postMessage protocol: plugin→parent `{type:"fluid-request", id, method, params}`; parent→plugin `{type:"fluid-response", id, result|error}`; parent→plugin push `{type:"fluid-event", event, data}` (events: `"status"`, `"line"`, `"theme"`).
- `getTheme`/the `"theme"` event hand a plugin `{mode:"dark"|"light", colors:{background,surface,surfaceRaised,border,borderStrong,text,textMuted,accent}}` — computed by `src/theme/palette.ts`'s `getPluginThemeSnapshot(theme, accent)` from the dashboard's own `theme`/`accent` redux state (`store/themeSlice.ts`, `store/accentSlice.ts`; accent presets in `src/theme/accentPresets.ts`), kept in sync with `theme.scss`'s `:root`/`:root[data-theme="light"]` tokens by hand rather than read live via `getComputedStyle` (the latter would race `App.tsx`'s own effect that writes `--dashboard-accent*` on the same theme/accent change). Sent once on `getTheme()`, and again via the `"theme"` event whenever a subscribed plugin's window is open and the person changes theme/accent - see the `rotate-gcode` example's `sdk.js`/`app.js` (`applyTheme`) for a plugin that consumes it. `border` vs `borderStrong` mirrors `theme.scss`'s own two-tier convention (soft dividers against `surface`, a stronger one for anything against the lighter `surfaceRaised`, e.g. buttons/inputs) - see `--dashboard-hud-*` below for the one family of tokens plugins _don't_ get a snapshot equivalent of.
- `theme.scss` also declares a separate `--dashboard-hud-*` token family (`hud-bg`, `hud-border`, `hud-text`, `hud-text-subtle`, `hud-text-disabled`, `hud-info`, `hud-accent`), used only by the 3D visualizer's own overlays (`VisualizerReadout.scss`, `Visualizer3D.scss`'s order legend/empty state, `VisualizerZoomControl.scss`, `SimulationBar.scss`). These sit on the visualizer's WebGL canvas, which paints a fixed dark `scene.background` in both themes (`Visualizer3D.tsx`) rather than trying to maintain a second light-mode toolpath palette - so unlike everything else in `theme.scss`, these are declared once under `:root` and deliberately NOT repeated under `:root[data-theme="light"]`, and must never be swapped back to the plain `--dashboard-*` tokens (which DO flip and would go illegible against that permanently-dark backdrop). `--dashboard-hud-accent` is the one exception still driven by JS - `App.tsx`'s accent effect always writes the *dark* preset variant into it regardless of the active theme, so the readout's numbers still track the person's accent choice.
- `ugs-pendant/src/main/webapp-dashboard/src/components/PluginManager.tsx` — owns plugin window list via `useReducer(pluginWindowsReducer, ...)`, renders one `<PluginWindow>` per open window.
- `ugs-pendant/src/main/webapp-dashboard/src/store/pluginWindows.ts` — pure reducer, `PluginWindowsState={windows, frontKey, nextKey}`, actions: `open`(plugin), `activate`(key), `close`(key); enforces one-window-per-plugin unless `manifest.allowMultipleInstances`.
- Plugin-side SDK (lives in each plugin's own folder, not in git): `sdk.js` builds `window.Fluid = {...}` wrapping every `callMethod` case above as a `postMessage`-based promise call, plus `Fluid.on(event, handler)` for `fluid-event` pushes. Reference copies: `~/.ugs/dashboard-plugins/{batch-runner,rotate-gcode}/sdk.js`.
- Example plugins committed in-repo: `ugs-pendant/examples/{batch-runner,job-inspector}/`.
- Full prose API reference (already written, don't duplicate): `ugs-pendant/PLUGIN_API.md`.

## Plugin docking into center panes

Plugins open floating by default (right-rail click), and can be docked into a center-layout pane or floated again. The layout is the source of truth; plugin windows are reconciled to it.

- A pane's `content` is a built-in (`visualize|edit|macros|probe|console`) or `"plugin:<id>"` — `PaneContent` in `components/CenterPaneLayoutDemo.tsx`. Helpers, events and the reconcile planner (`planPluginDocking`) live in `src/utils/pluginPanes.ts`.
- `CenterPaneLayoutDemo` runs an idempotent effect: panes naming a plugin get it opened and docked (`openDocked`), docked windows whose pane shows something else are parked (`park` = minimized, still running, restorable from the tray). Pane bodies showing a plugin carry `data-plugin-dock-slot="pane-<id>"`.
- `store/pluginWindows.ts` entries have `dockSlot: string|null`; actions `dock`/`openDocked`/`float`/`park`. One window per plugin unless `allowMultipleInstances`.
- **Never re-parent the iframe** (moving it reloads the plugin). `PluginWindow.tsx` stays mounted at one place and, when docked, is laid over the slot's box measured by `hooks/useDockRect.ts` (zoom-corrected via `utils/layoutRect.ts`; z-index 10, under the pane dividers at 20 and floating windows at 40/41). A non-front floating window gets `.pluginWindowActivateShield` because clicks inside the iframe never reach the parent.
- UI: a native `<select>` "Plugins" in each pane header (an optgroup in the narrow single select), Float/Close buttons on docked panes, and a Dock `<select>` in a floating window's title bar. Events: `ugs-pane-set-content` (dock request), `ugs-pane-plugin-closed` (a docked plugin closed -> pane reverts).
- The current pane layout is not restored on page load (existing behaviour); saved presets are, via `ugs-pane-layout-apply`.
- Do NOT reuse a naive `createPortal(children, activeSlot)` swap for anything that holds state — see the removed legacy `CenterPanel.tsx` in git history (`editorHostRef` + `appendChild`) for the stable-host-node pattern; the pane layout (`CenterPaneLayoutDemo.tsx`) is the only center layout now.

## Frontend app shell and connection lifecycle

- `src/App.tsx` — owns the connect/retry loop. Before the **first** connection it shows `pages/WaitingPage.tsx` ("Establishing connection", presentational only). After that `<Dashboard />` **stays mounted forever**; a lost connection renders `components/ReconnectOverlay.tsx` on top and sets `inert` on `.app`. Retries every `RECONNECT_INTERVAL_MS` (`utils/reconnect.ts`, 4s) whenever `!isConnected`.
- `store/socketSlice.ts` — `isConnected`, `isEstablishingConnection`, `hasConnected` (true once a connection was ever made this page load), `lastMessageAt`.
- `store/socketMiddleware.ts` — one live socket at a time: a new `connect` disconnects the previous socket, and `open`/`close`/`message` handlers ignore any socket that isn't `activeSocket`. On open it refetches settings, status and file status.
- `components/ConnectionHealth.tsx` — the "● UGS" chip in the top bar: health of the **dashboard ↔ UGS link only** (age of the last WS message: live < 7s, stale < 15s, else lost). The machine's own state is the pill/`ConnectionWidget` beside it.
- Why the dashboard stays mounted: the pane layout and plugin windows (iframes reload) live in component state. Unsaved editor text survives a drop only while UGS still has the same file loaded; if `fileStatus.fileName` goes empty (a UGS restart) `GcodeEditor` discards its buffer. Rescuing that text (keep the buffer, offer Save as / Discard) is a known, deliberately deferred improvement.

## Layout shells (desktop, tablet, tabbed)

- `pages/Dashboard.tsx` renders one tree for every width; CSS in `pages/Dashboard.scss` and `pages/TabletDashboard.scss` decides what shows (`html[data-dashboard-layout]` = auto|desktop|tablet|tabbed, set from the sizing hook). Desktop is three columns (position, panes, rail); the rail's Machine/Macros and Overrides tabs stack at desktop widths.
- The panel switcher (`nav.tabletNavigation`: Position / Jog, Program, Machine / Macros) is the first child of `.dashboardBody`. In the tablet shell it is grid cell column 1 / row 1, above the position readout, and `.dashboardCenter` / `.dashboardRight` span both rows so the workspace runs to the top bar; in the tabbed shell `.dashboardBody` is a flex column and it is the first row. It is hidden on desktop. There is no console shortcut: the console is a pane content like any other.
- The legacy single-panel center layout (`?legacyLayout=1`, `CenterPanel.tsx`) and its `ui` state (`centerView`, `splitLeft`, `splitRight`, `bottomView`) were removed 2026-10-13; `store/uiSlice.ts` now holds only the page, run-from line, cursor/sim lines, toolpath version and dirty flag.

## Gcode editor (`components/GcodeEditor.tsx`, `GcodeEditor.scss`)

- CodeMirror 6 view created once per `fileName`; `editableCompartment` (editable + `readOnly`), `fontSizeCompartment` (`editorSizeTheme`: font size **and an integer pixel line height** - required for stable scrollbar dragging).
- Line decorations (StateFields): `dimThroughField` (already-sent/skipped lines), `currentRunLineField`, `reviewMarksField`.
- **Follow the run line**: `currentRunLine` = live job line, else the visualizer simulation's `ui.simLine`; `scrollLineIntoView` keeps it visible. Pauses on user wheel/touch/scrollbar/PageUp-Down input (`followRunLine` state + ref); the "Follow run" pill resumes; resets when the line returns to 0.
- **Find / replace**: `search({top:true})` + `searchKeymap`; toolbar Find button → `openSearchPanel`. `searchCountPlugin` (ViewPlugin) injects a `current/total` counter into the panel DOM using `utils/searchMatchCount.ts` (cap 99,999). Panel CSS lives under `.gcodeEditorCodeMirror` in the SCSS.
- **G-code review**: a docked panel under the code (not a modal). `POST /api/v1/review` with the editor text; marks flagged lines; per-finding **Ignore** persisted by severity+message (`utils/gcodeReviewIgnore.ts`, localStorage `ugs-dashboard-gcode-review-ignored`); panel height drag/keys/dbl-click reset persisted via `utils/gcodeReviewHeight.ts`.
- Toolbar: `.gcodeEditorToolbar` is a container (`container-type: inline-size`); labels drop to icons at ≤ 920px, text-size buttons become a slider at ≤ 640px, filename ellipsises, row wraps as a last resort.
- Unsaved text is published to `ui.editorIsDirty`; the job bar's Start warns on it. `services/editorSaveBridge.ts` lets other components trigger the editor's save.

## Plugin windows: geometry and touch

- `utils/pluginWindowGeometry.ts` — pure `resizeBox` / `moveBox` (min 220×160, max 96%/90% of the viewport, header always ≥ 80px on screen). Resize directions: `e`, `w`, `s`, `se`, `sw` (no top edge - that's the move header).
- `PluginWindow.tsx` — handles are `.pluginWindowResize-*` strips in a frame band (`--plugin-frame-edge`/`-corner`/`-header-height`, larger under `any-pointer: coarse`) around the iframe; pointer deltas ÷ `layoutScale`; `.pluginWindowInteracting` disables the iframe's pointer events during a drag; `.pluginWindowActivateShield` raises a rear window on a body click.
- Size is remembered per plugin (`utils/pluginWindowSize.ts`); a docked window's size is never saved as the floating size.
- Header controls are native `<select>`/buttons (Dock menu, minimize, maximize, close).

## Keyboard shortcuts (input -> action layer)

- `utils/dashboardActions.ts` - pure: the `ACTIONS` registry (id, label, group, `command`, `defaults`), `commandFor(id)` (also resolves `macro:<uuid>`), and `isCommandAvailable(command, {connected, state, hasFile})`, whose rules mirror the on-screen buttons (jog/macros IDLE|JOG; start IDLE|HOLD with a file; pause RUN|CHECK; stop RUN|HOLD|CHECK|JOG; zero/home/return IDLE; overrides not DISCONNECTED/CONNECTING/ALARM). An input source (keyboard now, gamepad later) only has to map its events to an action id.
- `utils/keyBindings.ts` - pure: combos (`"Shift+Numpad4"` = modifiers + `KeyboardEvent.code`, so the keypad stays distinct from the digit row), `comboFromEvent`, `formatCombo`, `assignCombo` (a combo belongs to one action; the previous owner loses it), `sanitizeKeyBindingSettings`, `isTypingTarget`, `isActivationOnControl`. Tab/Escape are never bindable.
- `store/keyBindingsSlice.ts` - `{enabled, bindings}` persisted in localStorage `ugs-dashboard-key-bindings` (per device on purpose). `enabled` defaults to **false**.
- `hooks/useKeyboardShortcuts.ts` (mounted in `Dashboard.tsx`) - one window `keydown` listener that reads the store at press time. Ignores: disabled, not the dashboard page, typing targets (text inputs, textarea, select, `.cm-editor`, contenteditable), Enter/Space on a focused control, any open `.modal.show`, and `event.repeat` (bound keys still `preventDefault` so arrows don't scroll/move a focused radio group). Start dispatches `window` event `ugs-job-start`, which `JobBar` handles through its normal unsaved-text confirm. `runActionCommand` is exported so a gamepad source can reuse it.
- `pages/SettingsPage.tsx` is a tab list (`TABS`, last tab in localStorage `ugs-dashboard-settings-tab`, arrow/Home/End navigation via `utils/tabNav.ts`); add a tab by adding an entry and a panel branch. Content is `--settings-max-width` (1280px) and flows into columns (`.settingsFieldGrid` grid, `.keyBindingGroups` CSS multi-column) rather than using viewport media queries.
- `components/KeyboardSettings.tsx` (the Keyboard tab) - enable switch, per-action chips, press-to-bind capture (window capture-phase listener that `stopImmediatePropagation`s so the bound key never also fires), reset to defaults, one row per macro.
- `utils/jogPresets.ts` - the step-size/feed-rate preset ladders shared with `StepSize`/`FeedRate`, and `stepPreset`.
- Keys never reach the dashboard while a plugin iframe has focus. With `holdToJog` on, a jog key held >= `HOLD_TO_JOG_MS` (250 ms) feeds the shared continuous-jog stream (below); released sooner it is a normal `GET /machine/jog` step.

## Right rail: sections, pinned plugins, icon tiles

- `components/RightRail.tsx` - every section heading is a `RailHeading` (an h6 holding a fold button, `aria-controls="rail-section-<id>"`); folded ids are kept by `hooks/useRailPrefs.ts` `useRailCollapsed` in localStorage `ugs-dashboard-rail-collapsed`. A folded Macros section drops its flex-grow via `.rightRailCollapsed`.
- `components/PluginsSection.tsx` = heading + `PluginGrid` button + `PluginListPanel` (pinned only). Pins are stored as the **unpinned** ids (`ugs-dashboard-plugins-unpinned`) so a plugin installed later is pinned by default; rail style is `ugs-dashboard-plugin-tiles` (`"names"` default | `"icons"`). Pure helpers and tests: `utils/pluginPins.ts` / `tests/pluginPins.test.cjs`.
- `PluginGrid.tsx` is a portal into `.app` placed with `placePopover` (same pattern as `SimulationSettings`), because the rail is `overflow-y: auto` and would clip an inline popover. `PluginBadge.tsx` draws the plugin's icon or, with none, its initials on `hsl(hash(id), 55%, 38%)`.

## Quick layouts (top bar)

- `utils/quickLayouts.ts` - pure: four slots `{color, sizing, zoom, panes|null}` (snapshots, not references to named presets), `parseQuickSlots` (always 4 entries; a bad slot is dropped alone), `quickSlotMatches` (marks the active slot), 8 colours. `hooks/useQuickLayouts.ts` persists them (localStorage `ugs-dashboard-quick-layouts`). `components/QuickLayouts.tsx`: tap recalls, empty tap / hold 600 ms / right click opens the editor (colour, Save, Clear).
- The boxes sit inside the top bar's second `.topBarSection`, beside Layout: `PluginTray`'s `usePlacement` needs exactly two `:scope > .topBarSection` children to find the free stretch for minimized-plugin chips, so do not add a third section.
- Recall = `setSizing` + `applyZoom` + `applyPaneLayout(slot.panes)` (the existing `ugs-pane-layout-apply` event). `useDashboardSizing()` is now owned by `TopBar` and passed to `DashboardSizing` (it used to be called inside it), so the slots and the Layout dialog share one sizing state.
- `utils/paneLayoutShape.ts` holds `isPaneLayout` (re-exported from `hooks/usePaneLayoutPresets.ts`) so it can be used and tested without React.
- The visualizer toolbar's icons-only switch is a container query keyed to its measured natural width (762px; 808px with Stock on); re-measure when adding a button.

## Game controller input

- `utils/gamepadInput.ts` - pure: `PadSnapshot` -> held inputs named `Pad.B<n>`, `Pad.A<n>+/-`, `Pad.HatN/E/S/W`. `GamepadInputState` judges an axis by its movement from its resting value (first reading per controller; `recalibrate()`), with press 0.5 / release 0.3 hysteresis, ignores non-finite/out-of-range axis values, and decodes a hat on axis 9 of a 10+ axis pad with no `standard` mapping (8 positions at `i*2/7-1`; neutral is a ~1.2e9 sentinel). `describeInput` is the label.
- Tuning: `keyBindings.padTuning = {activation, deadband}` (clamped 0.2-0.9 / 0.05-0.6; release = min(deadband, activation-0.05)) is pushed into the poller by `useGamepadShortcuts` (`setGamepadTuning`); `GamepadFrame.deltas` is each axis's movement from rest, for the settings page's live view.
- Backup: `utils/inputBackup.ts` (pure; app `ugs-dashboard-input-bindings` v1: `bindings` + `padTuning`, never the enable/focus/hold-to-jog flags) and `components/InputBackupControls.tsx` (on both tabs). Import goes through `mergeImportedBindings` (replaces only the chosen kind) and the slice's `importInputSettings`.
- Buttons are judged like axes: pressed at `activation`, held until the value falls under the release point; `pressed` with a 0 value counts as 1. The standard mapping's triggers are analog buttons 6/7. `components/AxisMonitor.tsx` (behind a toggle in the Game controller tab) lists every axis (delta from rest, dead band/activation marks, hat decoded) and every button (0-100%) continuously; Xbox-style names come from `buttonName`/`axisName` and only apply when `mapping === "standard"`. A reconnect can switch a pad between raw HID (mapping "", 15 buttons/10 axes, hat on axis 9) and standard (17 buttons/4 axes), which changes every `Pad.*` number - bindings are NOT yet tied to a layout signature.
- `services/gamepadPoller.ts` - one shared 16 ms timer over `navigator.getGamepads()` (a timer, not rAF); runs only while subscribed. `services/inputCapture.ts` pauses controller shortcuts during press-to-bind.
- `hooks/useGamepadShortcuts.ts` (mounted in `Dashboard.tsx`) - gated by `keyBindings.gamepadEnabled`, dashboard page, no open modal, page visible, and (unless `gamepadWhenUnfocused`) `document.hasFocus()`. Inputs already down when the gate opens are ignored until released. Presses/releases go to the same `getActionRunner(store)` (in `hooks/useKeyboardShortcuts.ts`) as the keyboard, so tap/hold, availability and cleanup are identical.
- Controller inputs live in the same `keyBindings.bindings` map as key combos (`Pad.` prefix); `BindingEditor.tsx` shows one kind per tab and `resetBindingsForKind` resets one without the other. No controller defaults ship.
- Chrome 154 exposes `navigator.getGamepads` on a plain-HTTP LAN origin (verified with `tools/gamepad-test` on a Bluetooth Xbox pad, 045e:0b13) and keeps updating it while the window is unfocused but visible.

## Continuous jog

- Backend: `pendantui/v1/ContinuousJogController.java` (one per server, bound in `AppV1Config`) drives `ugs-core`'s `ContinuousJogWorker` (short acknowledged segments at `JogService.getFeedRate()`). `update(x,y,z)` clamps, scales to unit length, refuses when not connected or `!JogService.canJog()` (IDLE/JOG + jogging capability), and doubles as a heartbeat. A watchdog (100 ms tick) stops and cancels the jog after `DEFAULT_TIMEOUT_MS` (500) without an update or when the controller stops being jog-able. `cancelJog()` is sent only while `getControllerState()==JOG` (for firmware without a real-time cancel it would cancel a job). Stopping when nothing of its own is jogging touches nothing. Tests: `ContinuousJogControllerTest`.
- Client: `utils/continuousJog.ts` (pure; `createContinuousJog`, `combineDirections`, `HEARTBEAT_MS` 150) sources -> one combined direction, one request in flight (a late "go" can't overtake "stop"), explicit zero on release (retried 3x), a refusal clears all holds. `services/continuousJogSession.ts` is the page-wide instance (`getContinuousJog()`); a gamepad source should `set("gamepad", vec)` on it. `services/machine.ts` `jogContinuous` aborts after 1.5 s.
- Demo: `demoMachine.ts` simulates it (500 ms timeout included); `mock-backend/server.mjs` just records updates at `GET /__jog-log`.

## Stock view (material removal)

A "Stock" toggle in the 3D visualizer toolbar shows the block of material with the cut taken out of it, for a router (flat/ball/V cutter), laser (depth from S power) or plasma (through-cut, kerf width). Heightfield (2.5D) model: no undercuts or 4th/5th axis.

- `utils/stockSimEngine.ts` — pure, DOM-free: `StockSettings`, `packToolpath`, `planStockGrid`, `StockSimulator` (stamps the cutter footprint per segment; seeks forward incrementally, backward via snapshots). Tested by `tests/stockSimEngine.test.cjs`.
- `utils/stockSim.worker.ts` — runs the simulator off the UI thread; only ever works toward the newest `seek`. Messages: `load`/`seek` in; `ready`/`heights`/`progress`/`empty` out.
- `utils/stockModel.ts` — `StockModel` owns the worker and the three.js objects: one static grid mesh displaced by a height `DataTexture` in a vertex shader (normals and burn shading in the fragment shader), so a new result is one texture upload. Through-cuts `discard` and show the background.
- `components/StockSettings.tsx` (+ `utils/stockSettingsStore.ts`, localStorage `ugs.dashboard.stockSimulation`) — popover with per-process cutter/stock settings. All lengths are mm in settings and converted to the file's units in the engine.
- `Visualizer3D.tsx` drives it: loads on toggle/settings/new toolpath; position follows the simulation playhead (`ToolpathSimulation.getCompletedSegments()`), the last completed line during a real job, else the finished part. Toolpath lines are hidden over the stock unless "Show toolpath over the stock" is on.
- **Tool table (router only).** `utils/toolTable.ts` (pure; `tests/toolTable.test.cjs`) `scanTools(text)` reads the loaded file (`getFileContent`) for tool changes (M6 with the T word, or a bare T when the file never uses M6) and guesses each tool from comments (`( T0 : 3.175 )` header, or free-form text within 3 lines before the change: shape words, `1/8"`, `6 mm`, `60 deg`). `segmentToolNumbers` maps a segment to its tool by `lineNumber`, which is the file's **1-based line, comments and blanks included** (`GcodeParserUtils.processAndExportText`); the mock backend numbers differently, so tool changes land wrong there - use the demo or real UGS. `StockSettings.tools` (tool number -> `CutterSpec`) and `PackedToolpath.tool` go to the worker; each segment is stamped with its own cutter, and with two or more tools the simulator also keeps an `owner` map (slot per cell, snapshotted with the heights) that `StockModel` uploads as a second texture to tint the cut in each tool's color (`uTint`, 31-slot palette). Colors are painted only, so changing one never restarts the worker.
- The user's edits are `StockProfiles.tools` (`SavedTools`: `cutter` / `color` / `removed`) in the same localStorage entry, plus `colorByTool`. The settings popover only shows a summary and an **Edit tools...** button; the table itself is `components/ToolEditorPanel.tsx`, a floating, non-blocking panel (no backdrop; portal into `.app`, z-index 61, dragged by its header with `layoutScale`-corrected deltas, placement/clamping in `utils/floatingPanel.ts`; a container query switches the grid to cards below 640px; it outlives the popover, which treats clicks in it as inside). Row semantics: Edit/color write `cutter`/`color`; Reset drops the entry (back to what the file says); Delete on a tool in the file marks it `removed` (cut with the default cutter, Restore undoes it), on a saved-only tool forgets it; Add creates a saved tool; Reset all clears the table. Lines in the toolpath are also colored per tool when the Stock view shows the path (`Visualizer3D` `toolLineColors`; "Order" wins).
- **Rapid-into-stock warning (router only).** `StockSimulator.stampSegment` checks each fully-applied rapid (G0): if any cell under the cutter, at the cutter's profile level along the move, still stands more than `RAPID_TOLERANCE_CELLS` (1 cell; the heightfield stamps sloped cuts a little shallow, so a smaller tolerance flags the retract after a 3D relief pass) above it, the segment index goes in `rapidHits`. `getRapidHits()` filters by the current position, so it survives rewinds; the worker's `heights` message carries `{count, first}`, `StockStatus.rapidCount/rapidFirst` hold it, and `utils/rapidWarning.ts` turns indices into file lines for the chip in `Visualizer3D` (`.visualizer3DStockWarning`, switch `StockProfiles.warnRapids`). Rapids outside the stock's footprint are not judged. Samples `bowl-ballnose.nc` and `mountains.nc` do rapid sideways at cutting depth, so they trigger it (correctly).
- Cell size `0` = auto (`autoCellSize`: laser/plasma kerf / 2, router diameter / 10). The grid is capped at `StockSettings.maxCells` (default 2M, user-selectable 1M-8M in the popover); finer requested cell sizes are coarsened automatically and reported via `StockStatus.coarsened`.
