import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { FileStatus } from "../model/FileStatus";
import { getFileStatus } from "../services/files";

export const fetchFileStatus = createAsyncThunk(
  "fileStatus/fetch",
  getFileStatus
);

// socketMiddleware dispatches fetchFileStatus() on every single CommandEvent
// (not just periodically) - during a fast job's final lines, commands can
// complete faster than a single request's round trip, so multiple GETs end
// up in flight at once with no guarantee they resolve in the order they were
// sent. Without latestRequestId below, whichever happened to resolve *last*
// would win regardless of which was actually the most recent line - GcodeEditor's
// scroll-to-current-line and dim-through-line both trust this value completely,
// so an out-of-order response could show (or scroll to) a stale line, or skip
// straight past the true final line to IDLE without ever reflecting it,
// leaving the last scroll correction uncorrected.
type FileStatusState = FileStatus & { latestRequestId: string | null };

const initialState: FileStatusState = {
  sendState: "IDLE",
  fileName: "",
  rowCount: 0,
  completedRowCount: 0,
  remainingRowCount: 0,
  sendDuration: 0,
  sendRemainingDuration: 0,
  lastCompletedLineNumber: -1,
  latestRequestId: null,
};

const statusSlice = createSlice({
  name: "fileStatus",
  initialState,
  reducers: {
    setFileStatus: (state, action) => {
      state.sendState = action.payload.sendState;
      state.fileName = action.payload.fileName;
      state.rowCount = action.payload.rowCount;
      state.completedRowCount = action.payload.completedRowCount;
      state.remainingRowCount = action.payload.remainingRowCount;
      state.sendDuration = action.payload.sendDuration;
      state.sendRemainingDuration = action.payload.sendRemainingDuration;
      state.lastCompletedLineNumber = action.payload.lastCompletedLineNumber;
    },
  },
  extraReducers(builder) {
    builder.addCase(fetchFileStatus.pending, (state, action) => {
      state.latestRequestId = action.meta.requestId;
    });
    builder.addCase(fetchFileStatus.fulfilled, (state, action) => {
      // A response from a request that's no longer the latest one dispatched
      // - some newer request (possibly already resolved, possibly still in
      // flight) supersedes it, so applying this one now would mean going
      // *backward*. Silently ignored rather than reflected, however briefly.
      if (action.meta.requestId !== state.latestRequestId) return;
      return { ...action.payload, latestRequestId: state.latestRequestId };
    });
    builder.addCase(fetchFileStatus.rejected, (state, action) => {
      if (action.meta.requestId !== state.latestRequestId) return;
      return { ...initialState, latestRequestId: state.latestRequestId };
    });
  },
});

// Action creators are generated for each case reducer function
export const statusActions = statusSlice.actions;
export default statusSlice.reducer;
