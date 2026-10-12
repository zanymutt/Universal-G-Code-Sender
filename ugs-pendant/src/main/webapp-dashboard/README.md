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
| `node --test tests/*.test.cjs` | unit tests for the pure logic in `src/utils` and the reducers |

Where things are, how the backend and plugin bridge fit together, and the gotchas learned so far:

- [`docs/ugs-backend-api-anchor.md`](../../../../docs/ugs-backend-api-anchor.md) - architectural map
- [`docs/dashboard-ui-working-notes.md`](../../../../docs/dashboard-ui-working-notes.md) - build/verify routine,
  isolated preview, testing real input, gotchas
- [`ugs-pendant/PLUGIN_API.md`](../../../PLUGIN_API.md) - the plugin API

`src/` at a glance: `pages/` (Dashboard, Tablet/Portrait variants, Settings, Waiting) · `components/`
(one file per UI piece; the center panes are `CenterPaneLayoutDemo.tsx`) · `store/` (Redux slices, socket
middleware, plugin window reducer) · `services/` (thin REST wrappers) · `hooks/` · `utils/` (pure,
tested logic) · `theme/` (palette + accent presets) · `demo/` (in-browser simulated backend).
