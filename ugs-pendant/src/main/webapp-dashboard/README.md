# UGS Dashboard

## Online demo

The dashboard can run with no UGS and no machine: `npm run build:demo` builds a
static copy whose backend is simulated in the browser (`src/demo`), with a sample
workspace to open, edit and run. Nothing is sent to hardware or saved - edits live
in memory and a reload starts over.

- Live: https://zanymutt.github.io/Universal-G-Code-Sender/ (published by
  `.github/workflows/dashboard-demo.yml` to the `gh-pages` branch; enable it once
  under Settings > Pages > Deploy from a branch > `gh-pages` / root).
- Locally: `npm run build:demo && npm run preview:demo`.
- What's simulated: connection, jogging, console/macros, work-zero and homing,
  spindle/coolant/overrides, and running the loaded file (start/pause/stop, run
  from line) with the tool moving along the toolpath at the programmed feeds.
- Plugins: Nesting and Rotate G-code are offered, copied from
  `ugs-pendant/examples/<id>` at build time (`DEMO_PLUGINS` in
  `vite.demo.config.ts`) - so they always match the repo. svg-to-gcode is left out.
- The demo code is compiled out of the normal build (`VITE_DEMO` is `"false"` in
  `vite.config.ts`).

# Development

A React 18 + TypeScript + Vite app (Redux Toolkit, react-bootstrap, CodeMirror 6, three.js). It is built
into the `ugs-pendant` jar by `frontend-maven-plugin` and served by UGS at `/dashboard`.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server; proxies `/api` and `/ws` to a UGS on `localhost:8080` |
| `npm run build` | `tsc && vite build` (a type error here silently skips the bundle in a Maven build - always check the output) |
| `npm run build:demo` | the static online demo build (see above) |
| `npm run lint` | eslint |
| `npx tsc --noEmit -p .` | typecheck only |
| `node --test tests/*.test.cjs` | unit tests for the pure logic in `src/utils` and the reducers (list the files, not the directory) |
| `npx sass --no-source-map src/components/<File>.scss > /dev/null` | catch a SCSS error quickly |

Where things are, how the backend and plugin bridge fit together, and the gotchas learned so far:

- [`docs/ugs-backend-api-anchor.md`](../../../../docs/ugs-backend-api-anchor.md) - architectural map
- [`docs/dashboard-ui-working-notes.md`](../../../../docs/dashboard-ui-working-notes.md) - build/verify routine,
  isolated preview, testing real input, gotchas
- [`ugs-pendant/PLUGIN_API.md`](../../../PLUGIN_API.md) - the plugin API

`src/` at a glance:

| Folder | What is in it |
|---|---|
| `pages/` | `Dashboard` (the shell; the panel switcher sits in the left column on a tablet and in a row when tabbed), `SettingsPage` (Appearance, Keyboard, Game controller tabs), the tablet/tabbed layout styles, the connect page |
| `components/` | one file per UI piece. The center panes are `CenterPaneLayoutDemo.tsx`; the right rail is `RightRail.tsx` (foldable sections, `PluginsSection` + `PluginGrid` for pinned plugins); `TopBar` holds `QuickLayouts` (four one-tap layouts), `DashboardSizing` and `PaneLayoutPresets` |
| `store/` | Redux slices (status, settings, files, console, macros, ui, theme/accent, `keyBindings`), socket middleware, the plugin window reducer |
| `services/` | thin REST wrappers (`machine.ts` includes `jogContinuous`), plus the page-wide `continuousJogSession`, `gamepadPoller` and `inputCapture` |
| `hooks/` | `useKeyboardShortcuts` (also exports the shared press/release `ActionRunner`), `useGamepadShortcuts`, `useQuickLayouts`, `useRailPrefs`, sizing/zoom/layout-preset hooks |
| `utils/` | pure, tested logic: `dashboardActions` (the action registry), `keyBindings`, `gamepadInput`, `continuousJog`, `inputBackup`, `quickLayouts`, `pluginPins`, `pluginPanes`, `layoutRect`, `placePopover`, the stock simulator, and more |
| `theme/` | palette and accent presets |
| `demo/` | the in-browser simulated backend for the online demo |

## Input: keyboard, game controller, continuous jog

Everything an input device can do is a named action in `utils/dashboardActions.ts` with the same state rules as the
on-screen buttons. Keys (`useKeyboardShortcuts`) and controller inputs (`useGamepadShortcuts`) both feed one
`ActionRunner`, which owns "tap is a step, hold keeps jogging" and cleans up on blur or disconnect. Held-key
jogging goes to `POST /api/v1/machine/jogContinuous`; UGS runs the jog and cancels it by itself if the dashboard
stops sending heartbeats. Details and the reasoning are in the anchor doc ("Keyboard shortcuts", "Game controller
input", "Continuous jog"). A standalone page for checking what a browser sees from a controller is in
[`ugs-pendant/tools/gamepad-test`](../../../tools/gamepad-test/README.md).

## What is stored in the browser

All of these are per browser and per address (localhost and a LAN IP are separate stores). The layout and
bindings ones can be exported from the dashboard (Layout / Panes dialogs, and the Keyboard and Game controller
tabs).

| Key | Holds |
|---|---|
| `ugs-dashboard-theme`, `ugs-dashboard-accent` | colour theme and accent |
| `ugs-dashboard-zoom`, `ugs-dashboard-sizing` | page zoom; column widths, density, screen layout |
| `ugs-dashboard-layout-presets`, `ugs-dashboard-pane-layout-presets`, `ugs-dashboard-current-pane-layout` | saved layouts, saved pane layouts, the pane layout showing now |
| `ugs-dashboard-quick-layouts` | the four top-bar layout slots (colour, widths, zoom, panes) |
| `ugs-dashboard-key-bindings` | keyboard and controller bindings, the on/off switches, stick tuning, hold-to-jog |
| `ugs-dashboard-plugins-unpinned`, `ugs-dashboard-plugin-tiles`, `ugs-dashboard-rail-collapsed` | plugins hidden from the rail, rail plugin style, folded rail sections |
| `ugs-dashboard-settings-tab` | last Settings tab |
| `ugs-dashboard-console-font-size`, `ugs-dashboard-editor-font-size` | text sizes |
| `ugs-dashboard-gcode-review-height`, `ugs-dashboard-gcode-review-ignored` | review panel height, ignored findings |
| `ugs.dashboard.stockSimulation`, `ugs.dashboard.simulation.rapidRate`, `ugs.dashboard.pluginWindowSize.<id>` | stock view, simulation and plugin window sizes |
