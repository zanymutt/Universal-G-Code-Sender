# UGS-Desktop Codex Instructions

## Project context

For dashboard/backend/plugin architecture, read:

`docs/ugs-backend-api-anchor.md`

Use that document as an architectural map, not as a substitute for the current source. Verify implementation details against the repository before changing code.

## Working rules

- Inspect the relevant implementation before editing it.
- Keep each task focused on the requested goal.
- Avoid unrelated refactors unless they are required to complete the task.
- Preserve existing behavior unless the task explicitly asks to change it.
- Keep frontend/backend APIs and WebSocket behavior compatible unless the task explicitly requires an API change.
- For plugin work, preserve existing plugin bridge behavior unless the task explicitly changes it.
- Prefer small, reviewable changes over broad rewrites.
- Use the repository's existing patterns, dependencies, and conventions before introducing new ones.
- Run the relevant existing tests/build checks after changes when practical.
- Report what changed, which files were modified, and what tests/checks were run.
- For Dashboard plugin changes, distinguish the source example under `ugs-pendant/examples/<plugin>` from the installed runtime copy under `~/.ugs/dashboard-plugins/<plugin>`. Deploy the changed runtime files before reporting the work as ready to test, and verify that the deployed files match the source. If deployment requires a build, install step, plugin reload, or application restart, say so explicitly.
- Every completed change must include concise manual test instructions: the application or executable to run, how to open the affected feature, the exact interaction or input to exercise, the expected result, and any known untested conditions. Do not make the user infer how to validate the change.
- If requirements are ambiguous or a change could affect unrelated behavior, ask before making the broader change.

## Thread scope

Treat each Codex thread as one major goal. Continue the same thread for fixes and refinements to that goal. Start a new thread when the major goal changes.
