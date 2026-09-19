# Dashboard sizing preview

## Named presets

Layout now includes Save current layout, Apply saved layout, Update with current, and Delete preset. Each named preset saves page zoom, compact mode, and both column widths. Presets are local to this browser and address, not synchronized between devices. Choosing a name in the list does not change the layout until Apply is pressed. The UI indicates whether current settings match the selected preset. Duplicate names are rejected without regard to capitalization. Deleting a preset leaves the current layout unchanged.

The built-in buttons are now neutral actions labeled Apply compact preset and Apply comfortable preset, rather than looking like selection indicators. They remain fixed defaults; personal layouts are saved separately.

Named-preset changes: src/components/DashboardSizing.tsx, src/components/TopBar.tsx, src/hooks/useZoomLevel.ts, and new src/hooks/useLayoutPresets.ts (relative to ugs-pendant/src/main/webapp-dashboard/). Pre-change copies are in dashboard-sizing-backup-20260918/before-named-presets.

Validation: TypeScript and production build passed; live simulator browser checks passed for saving, updating, restoring compact mode and column widths, non-100% zoom restoration, persistence after reload, duplicate-name prevention, and deletion. Test presets were removed afterward.

Use Layout > Compact at 100% for 280px side columns and reduced control sizes/padding without whole-page scaling. Comfortable at 100% restores larger controls and 360px columns. Independent width sliders range from 260 to 420px. Preferences persist per browser origin. Original zoom controls and independent editor/console font settings remain available.

Column widths apply to the wide layout; the existing narrow-screen tabbed layout remains. Smaller screens may still need vertical scrolling inside the side panels.

## Code backup and rollback

Before editing, 4,148 tracked and untracked non-ignored files were copied to F:/git/projects/usg/dashboard-sizing-backup-20260918/. Its backup-hashes.csv records SHA256 hashes. The backup includes earlier uncommitted plugin fixes; it excludes build outputs, dependencies, and Git-ignored files. No git reset or clean was run.

For a sizing-only rollback, restore these files from matching backup paths, relative to ugs-pendant/src/main/webapp-dashboard/:

- src/hooks/useZoomLevel.ts
- src/components/TopBar.tsx
- src/components/TopBar.scss
- src/components/JogPad.scss
- src/pages/Dashboard.scss

New files added for sizing:

- src/hooks/useDashboardSizing.ts
- src/components/DashboardSizing.tsx
- src/components/DashboardSizing.scss
- ugs-pendant/DASHBOARD_SIZING_NOTES.md (this document, relative to repo root)

After restoring the five existing files, the new files can be removed and Dashboard rebuilt. Restore only the affected files to preserve later unrelated work.

## Validation and preview

TypeScript and the production build passed. Browser checks at 1440x1000 and 1200x900 covered preset selection, independent widths, and persistence after reload. DOM inspection confirmed no app transform at 100%, the selected column widths, and an unchanged 14px console font.

The preview uses the existing mock backend on loopback port 18080, not a real machine. Open http://127.0.0.1:5176/dashboard/ while the preview processes are running. This address has separate browser preferences from the regular Dashboard. The Platform distribution was not replaced or restarted for this change.

Temporary preview helpers:

- ugs-pendant/mock-backend/sizing-preview.mjs: copy of the existing simulator, listening on 127.0.0.1:18080.
- ugs-pendant/src/main/webapp-dashboard/sizing-preview.config.mjs: Vite proxy configuration for that simulator.

## Tablet layout prototype (September 18)

Layout now offers Auto, Desktop, Tablet, and Tabbed. Saved presets include this choice; older presets default to Auto. Compact uses the preferred 280px left / 290px right at 100%.

Auto uses three columns above 1400 CSS pixels, two columns at 901–1400px, and tabs at 900px or below. CSS viewport width differs from hardware resolution. Desktop forces three columns. Tablet keeps position/jog beside Program or Machine / Macros, and falls back to tabs below 901px. Tabbed shows one panel at a time with a persistent XYZ strip and two-column axis readouts. Job controls stay visible; the console has a Show/Hide toggle. Short screens can still require scrolling inside panels.

Panels remain mounted through layout changes to preserve unsaved editor text. Separate automatic portrait/landscape preset recall is not implemented.

Preview: http://10.0.1.93:5176/dashboard/ on the local network. Choose Layout > Auto and 100%. This uses simulated machine data. Source and frontend build are updated; the installed Platform distribution was not rebuilt or restarted.

Files changed for this prototype, relative to dashboard source:
- src/pages/Dashboard.tsx
- src/pages/TabletDashboard.scss (new)
- src/hooks/useDashboardSizing.ts
- src/components/DashboardSizing.tsx
- This document at ugs-pendant/DASHBOARD_SIZING_NOTES.md

Pre-prototype copies: F:/git/projects/usg/dashboard-sizing-backup-20260918/before-tablet-prototype/. Restore Dashboard.tsx, useDashboardSizing.ts and DashboardSizing.tsx from there and remove TabletDashboard.scss for rollback, after reviewing any subsequent edits.

Validation: TypeScript and Vite production build passed (bundle-size advisory remains). Simulator checks covered 1194x780 landscape, 600x900 portrait, 834x1100 forced Tablet portrait, Desktop override, bottom control visibility, and unsaved editor text surviving rotation. Hardware Safari/Android touch testing remains.

### Tablet follow-up: viewport and console

Replaced app height with dynamic viewport height (100dvh, with 100vh fallback), including scaled mode. Tablet header/footer no longer flex-shrink. This addresses iPad browser chrome reducing the visible area and footer compression. Show console now switches to Program and selects the console bottom view, including when invoked from Jog or Machine; its label reflects whether that containing panel is visible. Console height is capped at half the center panel on tablets.

Files: src/App.scss, src/pages/Dashboard.tsx, src/pages/TabletDashboard.scss. Pre-change backup: dashboard-sizing-backup-20260918/before-tablet-viewport-fix. TypeScript/build passed; browser checks verified console from Jog/Machine and visible footer buttons at 834x1000 and 1194x650. Actual iPad verification remains pending.

### Overrides tab

RightRail now defaults to Machine / Macros, with a separate Overrides tab for rapid/feed/spindle overrides. Toolbox, macros, plugins and spindle/coolant on/off stay together. Applies to desktop and tablet machine panels. Changed RightRail.tsx and RightRail.scss; backups in dashboard-sizing-backup-20260918/before-override-tabs. TypeScript and frontend build passed; simulator tab switching verified without sending machine commands. Platform distribution not rebuilt for this change.
