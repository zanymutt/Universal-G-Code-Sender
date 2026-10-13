import { createSlice } from "@reduxjs/toolkit";

// Cross-panel UI state that doesn't belong to any one feature: which page is
// showing, and the editor/visualizer values that components which know nothing
// about each other need to share. (What each center pane shows is not here: the
// pane layout owns it, see CenterPaneLayoutDemo.)
export type DashboardPage = "dashboard" | "settings";

type UiState = {
  activePage: DashboardPage;
  // The 1-based editor line "Run from here" last armed on the backend, or 0
  // for a normal full run. Lives here (not in GcodeEditor's own state)
  // because the job bar - always visible, regardless of which center tab is
  // active - needs to show it and offer a way to clear it back to 0.
  runFromLine: number;
  // The 1-based line the editor's cursor is currently on, or 0 for none -
  // unlike runFromLine this updates live on every cursor move, not just on
  // confirm. Lives here so Visualizer3D can highlight the matching toolpath
  // segment without GcodeEditor and Visualizer3D needing to know about each
  // other directly.
  editorCursorLine: number;
  // The line the visualizer's toolpath simulation has most recently drawn (in
  // the same line-number space as a running job's lastCompletedLineNumber), or
  // 0 when no simulation is active/started. GcodeEditor highlights and scrolls
  // to it exactly like the live "currently running" line.
  simLine: number;
  // Bumped by socketMiddleware specifically on FileState.FILE_LOADED (see
  // its comment) - Visualizer3D watches this instead of (well, in addition
  // to) fileStatus.fileName, since fileName already updates on the much
  // earlier OPENING_FILE event, before the processed file getToolpath()
  // reads has actually been written - fetching right then can race ahead
  // of that file existing and come back empty, with nothing left to
  // trigger a retry once it's actually ready.
  toolpathVersion: number;
  // Mirrors GcodeEditor's own local isDirty state - lives here too (not only
  // there) so the job bar's Start button, which GcodeEditor knows nothing
  // about, can warn before running: the backend runs whatever's saved on
  // disk, not the editor's live buffer, so starting with unsaved edits
  // silently runs stale gcode otherwise.
  editorIsDirty: boolean;
};

const initialState: UiState = {
  activePage: "dashboard",
  runFromLine: 0,
  editorCursorLine: 0,
  simLine: 0,
  toolpathVersion: 0,
  editorIsDirty: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setActivePage: (state, action: { payload: DashboardPage }) => {
      state.activePage = action.payload;
    },
    setRunFromLine: (state, action: { payload: number }) => {
      state.runFromLine = action.payload;
    },
    setEditorCursorLine: (state, action: { payload: number }) => {
      state.editorCursorLine = action.payload;
    },
    setSimLine: (state, action: { payload: number }) => {
      state.simLine = action.payload;
    },
    bumpToolpathVersion: (state) => {
      state.toolpathVersion += 1;
    },
    setEditorIsDirty: (state, action: { payload: boolean }) => {
      state.editorIsDirty = action.payload;
    },
  },
});

export const uiActions = uiSlice.actions;
export default uiSlice.reducer;
