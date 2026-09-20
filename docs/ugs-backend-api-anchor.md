# UGS Dashboard Backend/Frontend API Anchor

Structural map of the bridge between `webapp-dashboard` (Vite/React) and the `ugs-pendant` Java backend, plus the plugin bridge. No prose, no code - paths and signatures only, for anchoring a fresh task.

## Backend bootstrap

- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/PendantUI.java` — server entry point; constants `API_CONTEXT_PATH="/api/v1"`, `WEBSOCKET_CONTEXT_PATH="/ws/v1"`, `DASHBOARD_CONTEXT_PATH="/dashboard"`; wires Jetty handlers.
- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/v1/AppV1Config.java` — Jersey `ResourceConfig`; registers every `*Resource` class below plus `StaticResource`, `ExceptionMapper`, `ObjectMapperProvider`.
- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/html/DashboardStaticResource.java` — serves built dashboard assets from `RESOURCES_PATH="/resources/ugs-dashboard/%s"` (i.e. `target/classes/resources/ugs-dashboard`, the Vite build output copied in by `frontend-maven-plugin`).
- `ugs-pendant/src/main/webapp-dashboard/vite.config.ts` — dev proxy: `/api` → `http://localhost:8080`, `/ws` → `http://localhost:8080`.

## Backend REST resources (`ugs-pendant/src/main/java/.../pendantui/v1/resources/`)

All `@Path`-relative to `/api/v1`.

- `StatusResource.java` `@Path("/status")` — `GET getStatus()` → `Status`.
- `MachineResource.java` `@Path("/machine")` — `GET connect()`, `GET disconnect()`, `GET getPortList()`→`List<String>`, `GET/POST getSelectedPort/setSelectedPort(port)`, `GET getBaudRateList()`, `GET/POST getSelectedBaudRate/setSelectedBaudRate(baudRate)`, `GET getFirmwareList()`, `GET/POST getSelectedFirmware/setSelectedFirmware(firmware)`, `GET killAlarm()`, `GET resetToZero()`, `GET returnToZero()`, `GET homeMachine()`, `GET softReset()`, `POST sendOverride(command: Overrides)`, `POST sendGcode(GcodeCommands)`, `GET jog(x,y,z: int)`.
- `FilesResource.java` `@Path("/files")` — `POST uploadAndOpen` (multipart), `POST send()`, `POST runFromLine(line: int)`, `GET pause()`, `GET cancel()`, `GET getWorkspaceFileList()`→`WorkspaceFileList`, `POST createWorkspaceFolder`, `POST openWorkspaceFile`, `GET getFileStatus()`→`FileStatus`, `GET getFileContent()`, `POST saveFileContent`, `POST closeFile()`, `POST saveFileContentAs`.
- `MacrosResource.java` `@Path("/macros")` — `GET getMacroList()`→`List<Macro>`, `POST runMacro(Macro)`, `POST saveMacroList(List<Macro>)`→`List<Macro>`.
- `ProbeResource.java` `@Path("/probe")` — `GET getSettings()`→`ProbeSettings`, `POST saveSettings(ProbeSettings)`, `POST run(ProbeRunRequest)`→`ProbeResult`.
- `VisualizerResource.java` `@Path("/visualizer")` — `GET getToolpath()`→`List<ToolpathSegment>`.
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
- `ToolpathSegment.java` `record(start: ToolpathPoint, end: ToolpathPoint, rapid, arc, lineNumber)`; `ToolpathPoint.java` `record(x,y,z)`.
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

- `ugs-pendant/src/main/webapp-dashboard/src/components/PluginWindow.tsx` — parent side; `callMethod(method, params)` switch (the whole plugin API surface): `getStatus`, `subscribe`/`unsubscribe`, `sendCommand`, `getGcode`/`setGcode`, `saveGcodeAs`, `listFiles`, `openFile`, `pickFile`, `getFileStatus`, `startSend`, `pauseSend`, `stopSend`, `readFile`/`writeFile`, `getSettings`/`saveSettings`, `getDeviceInfo`, `getMachineSettings`, `close`.
- postMessage protocol: plugin→parent `{type:"fluid-request", id, method, params}`; parent→plugin `{type:"fluid-response", id, result|error}`; parent→plugin push `{type:"fluid-event", event, data}` (events: `"status"`, `"line"`).
- `ugs-pendant/src/main/webapp-dashboard/src/components/PluginManager.tsx` — owns plugin window list via `useReducer(pluginWindowsReducer, ...)`, renders one `<PluginWindow>` per open window.
- `ugs-pendant/src/main/webapp-dashboard/src/store/pluginWindows.ts` — pure reducer, `PluginWindowsState={windows, frontKey, nextKey}`, actions: `open`(plugin), `activate`(key), `close`(key); enforces one-window-per-plugin unless `manifest.allowMultipleInstances`.
- Plugin-side SDK (lives in each plugin's own folder, not in git): `sdk.js` builds `window.Fluid = {...}` wrapping every `callMethod` case above as a `postMessage`-based promise call, plus `Fluid.on(event, handler)` for `fluid-event` pushes. Reference copies: `~/.ugs/dashboard-plugins/{batch-runner,rotate-gcode}/sdk.js`.
- Example plugins committed in-repo: `ugs-pendant/examples/{batch-runner,job-inspector}/`.
- Full prose API reference (already written, don't duplicate): `ugs-pendant/PLUGIN_API.md`.

## Center panel plugin-hosting note (not yet built)

Plugins today only ever open as floating popup windows (`PluginWindow.tsx`), never docked into a `CenterPanel.tsx` tab/slot. If that gets built, and a plugin can move between panel slots the way `GcodeEditor` moves between the top pane and bottom panel, it must NOT reuse a naive `createPortal(children, activeSlot)` swap — see `feedback_react_portal_container_swap_unmounts` memory / the fix in `CenterPanel.tsx` (`editorHostRef` + `useLayoutEffect` + `appendChild`) for why and the correct pattern, doubly important for an iframe since remounting one fully reloads it.
