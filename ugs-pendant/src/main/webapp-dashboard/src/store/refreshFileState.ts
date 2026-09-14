import type { AppDispatch } from "./store";
import { fetchFileStatus } from "./fileStatusSlice";
import { uiActions } from "./uiSlice";

// fileStatus and the visualizer's toolpath otherwise only refresh from a
// FileStateEvent pushed over the websocket - confirmed that isn't reliable
// enough to depend on for a file operation this session itself just made:
// the backend only dispatches it conditionally in some cases (e.g.
// GUIBackend#unsetGcodeFile skips it unless a processed file happened to
// already exist), and separately a push arriving late or not at all over a
// real (especially remote) connection leaves this session's own view stuck
// showing the old file with nothing left to trigger a retry. Call this
// directly after closeFile/openWorkspaceFile/uploadAndOpen/save(As) succeed,
// rather than trusting the push alone - other sessions connected at the same
// time still pick up the change via their own copy of the same event, when
// it does arrive.
export function refreshFileState(dispatch: AppDispatch) {
  dispatch(fetchFileStatus());
  dispatch(uiActions.bumpToolpathVersion());
}
