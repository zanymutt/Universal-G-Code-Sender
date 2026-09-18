import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type Message = {
  type: "ok" | "error" | "info" | "verbose";
  text: string;
  // Monotonically increasing, assigned by the reducer - never reused and
  // never reset by the splice below. A consumer diffing "what's new since
  // last time" (see PluginWindow.tsx's 'line' event forwarding) needs this
  // rather than the array's own length/index: once the cap below starts
  // dropping old entries, `messages.length` stays pinned at MAX_MESSAGES
  // forever, so a position/count-based diff against it goes permanently
  // stale the moment the buffer first fills up, even though the array's
  // contents keep changing. `id` keeps working regardless of how much has
  // been spliced off the front.
  id: number;
};

type ConsoleState = {
  messages: Message[];
  // Off by default - see EventsSocket.java's verboseSessionIds. Kept here
  // (rather than only as local component state) so socketMiddleware.ts can
  // re-send the toggle after a reconnect, and so it survives ConsolePanel
  // unmounting/remounting.
  verboseEnabled: boolean;
  nextMessageId: number;
};

// VERBOSE messages arrive as fast as every status poll - without a cap this
// would grow without bound over a long session.
const MAX_MESSAGES = 500;

const initialState: ConsoleState = {
  messages: [],
  verboseEnabled: false,
  nextMessageId: 1,
};

const consoleSlice = createSlice({
  name: "console",
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<Omit<Message, "id">>) => {
      state.messages.push({ ...action.payload, id: state.nextMessageId++ });
      if (state.messages.length > MAX_MESSAGES) {
        state.messages.splice(0, state.messages.length - MAX_MESSAGES);
      }
    },
    setVerboseEnabled: (state, action: PayloadAction<boolean>) => {
      state.verboseEnabled = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const consoleActions = consoleSlice.actions;
export default consoleSlice.reducer;
