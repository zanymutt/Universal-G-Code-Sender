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

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list
