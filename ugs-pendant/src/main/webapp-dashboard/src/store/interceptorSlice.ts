import { createSlice } from "@reduxjs/toolkit";
import { INACTIVE_INTERCEPTOR, InterceptorStatus } from "../model/InterceptorStatus";

export interface InterceptorSliceState {
  status: InterceptorStatus;
}

const initialState: InterceptorSliceState = {
  status: INACTIVE_INTERCEPTOR,
};

// Kept in the store (not in the prompt component) so it survives the component remounting and so the
// socket middleware, which is where the events arrive, can set it.
const interceptorSlice = createSlice({
  name: "interceptor",
  initialState,
  reducers: {
    setInterceptorStatus: (state, action: { payload: InterceptorStatus }) => {
      state.status = action.payload;
    },
  },
});

export const interceptorActions = interceptorSlice.actions;
export default interceptorSlice.reducer;
