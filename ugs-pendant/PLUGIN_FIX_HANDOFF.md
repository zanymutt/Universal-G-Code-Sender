# Plugin fixes for Claude — September 18, 2026

Implemented three remaining fixes. Changes are uncommitted. Multiple instances of the same plugin are intentionally deferred.

## Behavior

1. **Completion versus cancellation:** added `sendState` to backend file status, with IDLE/RUNNING/PAUSED/COMPLETED/CANCELED states driven by stream events. Both cancellation and completion previously went through `stop()` and could report zero remaining duration. Existing duration behavior is preserved; consumers now have an explicit outcome. Batch Runner requires COMPLETED, the expected file path, and controller IDLE before advancing. It also handles short jobs that never expose RUN to the plugin and completion without a time estimate.
2. **Delayed batch callbacks:** each file gets a new generation token. Polling and completion callbacks validate the generation and running state before updating or advancing. Stop and ALARM invalidate pending work. This supplements the existing checks in the open/load/start chain.
3. **Overlapping file pickers:** `PluginWindow` reserves the pending request in a ref synchronously, before React renders. A second request rejects without replacing the first. Selection/cancellation release the reservation.

## Changed files

Paths below are relative to `F:/git/projects/usg/Universal-G-Code-Sender/` unless absolute.

- `ugs-core/src/com/willwinder/universalgcodesender/services/SendProgressService.java` — explicit lifecycle state.
- `ugs-core/test/com/willwinder/universalgcodesender/services/SendProgressServiceTest.java` — two regression tests for cancellation with all rows acknowledged/zero time, lifecycle transitions, and completion without an estimate.
- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/v1/model/FileStatus.java` — response field.
- `ugs-pendant/src/main/java/com/willwinder/universalgcodesender/pendantui/v1/resources/FilesResource.java` — populate response state.
- `ugs-pendant/src/main/webapp-dashboard/src/model/FileStatus.ts` — state type.
- `ugs-pendant/src/main/webapp-dashboard/src/store/fileStatusSlice.ts` — initialize/store state.
- `ugs-pendant/src/main/webapp-dashboard/src/components/PluginWindow.tsx` — synchronous picker reservation.
- `ugs-pendant/PLUGIN_API.md` — remove incorrect zero-time success guidance; document lifecycle checks.
- `ugs-pendant/PLUGIN_API_REVISED.md` — add all five job/picker APIs and explicit completion guidance; remove outdated console-cap/device-save limitations already fixed by Claude.
- `ugs-pendant/examples/batch-runner/batch.js` — repository copy of patched runner logic (not a complete standalone plugin).
- `ugs-pendant/examples/batch-runner/batch.test.cjs` — eight executable regression checks using mocked SDK responses and the actual picker reservation branch.
- `ugs-pendant/examples/batch-runner/batch.before.js.txt` — original installed runner backup for review/diff.
- `C:/Users/qvipe/.ugs/dashboard-plugins/batch-runner/batch.js` — installed the identical tested runner. Verified original SHA256 before replacement to avoid overwriting concurrent work.
- `ugs-pendant/PLUGIN_FIX_HANDOFF.md` — this handoff.

No changes to the installed SDKs; Claude's five new wrappers remain intact. Prior announcement and Job Inspector files were not changed in this fix pass.

## Validation

- Focused Maven reactor run through `ugs-pendant`: **BUILD SUCCESS**; **25 SendProgressService tests passed**; Java core and pendant sources compiled.
- Node regression suite: **8 passed**, covering pending-open Stop, pending-completion Stop (resolve/reject), canceled jobs with zero time, short/no-estimate jobs, duplicate callbacks, controller IDLE/backend completion ordering, ALARM, and same-render picker overlap.
- Dashboard TypeScript check and Vite production build passed. Existing Sass deprecation and bundle-size warnings remain.
- `git diff --check` passed.
- No live machine commands or hardware tests were run.

Run the JavaScript checks from the repository root with:

```powershell
node --test ugs-pendant/examples/batch-runner/batch.test.cjs
```

## Deployment

The installed runner now needs the updated backend's `sendState` field. Rebuild/package and restart the UGS Platform distribution, then reload Dashboard/reopen Batch Runner. The source tests and Dashboard production assets were built here, but the running Platform distribution was not replaced or restarted. An old backend cannot provide a success outcome, so this runner will not auto-advance with it.

The protocol still describes a shared current job, not ownership or isolation across plugin instances. That separate design remains for the next task.
