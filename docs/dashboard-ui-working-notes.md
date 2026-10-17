# Dashboard UI working notes

Practical notes for anyone (human or agent) starting a UI change on the touchscreen dashboard
(`ugs-pendant/src/main/webapp-dashboard`). The architectural map is
[`ugs-backend-api-anchor.md`](ugs-backend-api-anchor.md); this file is the "how to work here" companion.
Both describe the code as of 2026-10-12 - verify against the source before relying on a detail.

## The loop that has worked

1. **Inspect first.** Read the component and its SCSS; grep for who else uses it.
2. **Keep logic that can be tested out of the component.** Pure helpers live in `src/utils/*.ts` and are
   unit-tested with the transpile-and-`vm` pattern in `tests/*.test.cjs` (no jsdom, no bundler). Examples:
   `pluginWindowGeometry`, `pluginPanes`, `searchMatchCount`, `gcodeReviewIgnore`, `reconnect`.
3. **Typecheck and test:** from `ugs-pendant/src/main/webapp-dashboard`
   - `npx tsc --noEmit -p .`
   - `node --test tests/*.test.cjs` (list the files - passing the directory fails)
   - `npx sass --no-source-map src/components/<File>.scss > /dev/null` to catch SCSS errors quickly
4. **Look at it in a browser** against an isolated mock backend (see below), not the live app.
5. **Full package rebuild before calling it done** - the module/dev-server builds are not the app that
   gets launched:
   ```
   export JAVA_HOME="F:\git\projects\usg\.tools\jdk-25.0.4.1+1"
   export PATH="$JAVA_HOME/bin:$PATH"
   ./mvnw -pl ugs-platform/application -am install -DskipTests
   sed -i 's|#jdkhome="/path/to/jdk"|jdkhome="F:/git/projects/usg/.tools/jdk-25.0.4.1+1"|' \
     ugs-platform/application/target/ugsplatform/etc/ugsplatform.conf
   ```
   Then grep the packaged `ugs-pendant.jar` (under `ugs-platform/application/target/ugsplatform/ugsplatform/modules/ext/.../`)
   for something unique to the change: extract `resources/ugs-dashboard/index.html` to get the current
   `assets/index-*.js`/`.css` names - stale chunks pile up in the same folder, so grep the *current* one.
   - UGS must be closed or the final `cluster-app` step fails on `ugsplatform64.exe`; a plain retry
     after closing it works.
   - `mvn package` can succeed while `tsc` failed inside it - always grep the bundle.
   - The user launches `ugs-platform/application/target/ugsplatform/bin/ugsplatform64.exe`.
6. **Plugins are static files.** Changing `ugs-pendant/examples/<id>` is not enough: copy the changed
   files into `~/.ugs/dashboard-plugins/<id>/` (leave that folder's `settings.json` alone) and verify the
   files match. No build or restart; close and reopen the plugin window, hard-reload the dashboard.
7. **Report what changed, files, checks run, and manual test steps.** Commit locally; do not push unless
   asked. A push to the fork's `master` also starts the *Nightly build* and *Dashboard online demo*
   workflows (`.github/workflows/nightly.yaml`, only on `zanymutt`), which publish a public prerelease.

## Isolated preview

Ports **8080, 5173 and 5175 belong to the user's own running UGS / dev servers** - never touch them.

```
cd ugs-pendant/mock-backend && MOCK_PORT=18080 node server.mjs
cd ugs-pendant/src/main/webapp-dashboard && node node_modules/vite/bin/vite.js --config sizing-preview.config.mjs --port 5180 --strictPort
```

Open `http://localhost:5180/dashboard/`. The mock serves the in-repo `ugs-pendant/examples/*` plugins and
holds one file in memory; `POST /api/v1/files/saveFileContent` loads different text into it (e.g. a
large file from `test_files/`). The mock has **no** `/api/v1/review` endpoint - stub that one fetch in
the page to exercise the review panel. A plugin's own page can also be opened top-level
(`/api/v1/plugins/<id>/files/index.html`) for layout work; it then runs in "offline preview" mode.

Stop only 5180 / 18080 afterwards.

### Testing real input (scrollbars, drags)

JavaScript can't operate a native scrollbar and the in-app browser pane doesn't drive one reliably, but
**real mouse events over the DevTools protocol do**. Chrome is at
`C:\Program Files\Google\Chrome\Application\chrome.exe`; launch it `--headless=new
--remote-debugging-port=9333 --user-data-dir=<tmp>` and use Node 24's built-in `WebSocket` to send
`Input.dispatchMouseEvent` (`mousePressed` / `mouseMoved` / `mouseReleased`) and `Runtime.evaluate`
(`Page.captureScreenshot` for pictures). Always run a **control** (a plain `overflow:auto` div of the same
height) so you know whether a discrepancy is the page or the harness. This is how the editor's
scrollbar-thumb lag was reproduced and fixed. Kill only Chrome processes whose command line contains your
temp profile directory - the user's own Chrome may be open.

## Gotchas that have each cost real time

- **Dashboard zoom is a CSS transform on `.app`** (`html.dashboard-zoomed .app`). Pointer deltas and
  `getBoundingClientRect` are in screen pixels, `position: fixed` coordinates inside `.app` are in layout
  pixels. Use `utils/layoutRect.ts` (`layoutScale`, `layoutRect`) - see `PluginWindow` and `useDockRect`.
  Everything that drags or measures must be tested at a zoom that isn't 100%.
- **Never re-parent a plugin iframe** (moving it in the DOM reloads it and the plugin loses its state).
  Docked plugins are positioned over a pane slot, not moved into it. Also: do not unmount things that
  hold state - the dashboard stays mounted across a lost connection for the same reason.
- **Test the case that matches reality, not the mock's convenient one.** The mock backend comes back with its
  default file loaded after a restart, so an "edits survive a restart" test passed while real UGS (which
  starts with nothing loaded) discards the editor buffer. When a test depends on backend state, make the
  mock's state match what the real backend would be.
- **A sandboxed (`allow-scripts`, no `allow-same-origin`) iframe swallows pointer events** and is blocked
  entirely in the in-app browser pane. Handles/shields must live in the parent DOM next to the iframe,
  never over a part of it that needs to be clickable; the harness can't click inside one.
- **CodeMirror needs integer line heights.** A fractional line height makes its height estimate drift,
  it then writes `scrollTop` itself, and Chrome re-baselines a scrollbar drag on a script scroll. See
  `editorSizeTheme` in `GcodeEditor.tsx`.
- **Native `<select>` is deliberate** for in-header menus (pane "Plugins", window "Dock"): the popup is
  drawn by the browser above plugin iframes and is touch friendly. Size one to its *displayed* text -
  a select otherwise sizes to its longest option.
- **Container queries, not viewport media queries**, for anything that lives in a resizable pane (editor
  toolbar, pane headers). Measure the real needed width before choosing a threshold.
- **Touch sizing** is `@media (any-pointer: coarse)`: 44px targets. The in-app pane's "mobile" preset
  emulates touch; its "tablet" preset is size-only.
- **React 18 has no `inert` prop** - set it with `toggleAttribute` (see `App.tsx`).
- **Pane layout is not restored on page load**; only saved presets are (via `ugs-pane-layout-apply`).
- **CodeMirror's panels** (search) are not templated by us; extend them by DOM (`searchCountPlugin`) and
  override their CSS with equal-or-higher specificity (`.cm-search.cm-panel ...`).
- **Line endings:** the working tree mixes LF and CRLF files; edit scripts should detect and preserve it.
  Git warns "LF will be replaced by CRLF" - harmless.
- **Shell quoting:** apostrophes inside `node -e '...'` and heredocs with backticks break; write a
  script file instead for anything non-trivial.
- **Chrome reads gamepads while the window is unfocused** (visible is enough), and a Bluetooth Xbox pad has no `standard` mapping: D-pad on axis 9 with a ~1.2e9 neutral, triggers resting at -1. Judge axes by movement from rest, never from zero, and gate controller input on `document.hasFocus()`.
- **Testing controller input in the preview pane**: there is no real pad, so replace `navigator.getGamepads` with a fake object and mutate its `axes`/`buttons`; the pane often reports `visibilityState: "hidden"` and `hasFocus() === false`, which are exactly the gates, so stub them with `Object.defineProperty(document, "visibilityState", ...)` and `document.hasFocus = () => ...` to exercise both sides. The poll is a timer for this reason (rAF doesn't run in a hidden pane).
- **Don't add a third `.topBarSection`.** `PluginTray` finds the free stretch of the top bar for minimized-plugin chips by looking for exactly two `:scope > .topBarSection` children; a third silently drops the chips back above the job bar. Put new top-bar controls inside the right-hand section.
- **Labels-to-icons switches are container queries keyed to a measured width.** The 3D toolbar needs ~762px (808px with Stock on) and switches below 850px; measure the real row (children widths + gaps + padding) with the widest state before choosing a number, and re-measure when a button is added. A stale number shows up as a button wrapping onto a second row at in-between widths.
- **The packaged-app build refuses to finish while UGS is running** (and a script that skips it is easy to mistake for success): check `tasklist | grep ugsplatform` first, and after a build grep the *current* `assets/index-*.js` and `.css` named by `resources/ugs-dashboard/index.html` for something unique to the change. The CSS minifier rewrites `max-width:850px` as `width<=850px`.
- **Previewing the online demo** needs `vite.demo.config.ts`, not `sizing-preview.config.mjs`: `VITE_DEMO` is a compile-time literal in the normal config, so setting the environment variable does nothing there.
- **Opening a minimized plugin chip, folding a section, a hold on a quick-layout box** are all pointer-driven: the preview pane's synthetic clicks work for them, but check touch sizing (`any-pointer: coarse`) by emulating the mobile preset.
- **Plugin pages: don't call `element.scrollIntoView()`.** It scrolls every ancestor, so inside the
  sandboxed iframe it moved the whole dashboard. Scroll the plugin's own page with `window.scrollTo`.
- **Fuzzy text inside a plugin at a fractional dashboard zoom** came from a rounded `overflow:hidden`
  clip around content that gets its own compositor layer (a scrolling list, sticky headers, anything
  painted after one), plus `opacity` on disabled buttons. Square the clip, drop sticky/opacity and fade
  with colour mixes instead. The in-app preview pane cannot show this - ask the user to look.
- **Native `<select>` pop-ups misplace under dashboard zoom** inside a plugin (the browser draws them
  outside the transformed page). Use segmented buttons or an inline `<select size=N>` list.
- **Plugin examples can be generated.** `ugs-pendant/examples/thc` comes from
  `tools/thc-workspaces.html` in the separate THC firmware repo via `tools/make-thc-plugin.py` - change
  the source there and regenerate, don't hand-edit the example.
- **The online demo's `Samples/` files are fetched on demand** (`src/demo/library`, `ensureLoaded` in
  `demoMachine.ts`) - a new endpoint that reads file text must `await ensureLoaded(path)` first.
- **Another tool also edits this repo** (the THC plugin under `ugs-pendant/examples/thc` has had edits not
  made in these sessions). Check `git status` for unfamiliar changes and don't commit them by accident.

## Verifying a behaviour change

- State a hypothesis, then make a control that would disprove it (the editor scroll bug was *not* the
  follow-run logic first assumed; a plain-div control showed it was the editor itself).
- Prefer asserting on measured numbers (rects, scrollTop, computed styles, event counts) over eyeballing a
  screenshot; take the screenshot as well for anything visual.
- Test the unhappy paths of anything new: empty input, narrow width, 90%/105% zoom, touch sizing, a
  100k-line file, the backend going away (`ugs-pendant/mock-backend/server.mjs` can be killed and
  restarted from a script).
