import type { AppDispatch } from "./store";
import { fetchFileStatus } from "./fileStatusSlice";
import { uiActions } from "./uiSlice";

// fileStatus and the visualizer's toolpath otherwise only refresh from a
// FileStateEvent pushed over the websocket - confirmed that isn't reliable
// enough to depend on for a file operation this session itself just made: a
// push arriving late or not at all over a real (especially remote)
// connection leaves this session's own view stuck showing the old file with
// nothing left to trigger a retry. Call this directly after
// closeFile/openWorkspaceFile/uploadAndOpen/save(As) succeed, rather than
// trusting the push alone - other sessions connected at the same time still
// pick up the change via their own copy of the same event (GUIBackend now
// always dispatches FILE_UNLOADED from unsetGcodeFile, previously skipped
// when a FileLoader like the platform edition's processes the open
// asynchronously and a fast close raced past it - see that method's
// comment).
export function refreshFileState(dispatch: AppDispatch) {
  dispatch(fetchFileStatus());
  dispatch(uiActions.bumpToolpathVersion());
}
