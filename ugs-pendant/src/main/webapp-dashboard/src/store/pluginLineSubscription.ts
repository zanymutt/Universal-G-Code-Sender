import { consoleActions } from "../store/consoleSlice";
import type { AppDispatch } from "../store/store";

// EventsSocket.java has exactly one verbose-mode flag per WebSocket session
// (verboseSessionIds), not one per plugin - so if two plugin windows are
// both subscribed to 'line' and one of them unsubscribes, the other must
// keep receiving events. This reference-counts subscribers across every
// open plugin window and only actually toggles verbose mode off once none
// of them still want it.
//
// Known gap: the Console panel's own "show verbose output" checkbox drives
// the same consoleActions.setVerboseEnabled action independently of this
// counter. If a person turns that on by hand while a plugin is also
// subscribed, whichever one unsubscribes/toggles off last will turn it off
// for the other too. Not a problem for a single plugin with no one also
// staring at the console at the same time, but worth unifying properly
// (route the checkbox through this same counter) before this sees real use.
let subscriberCount = 0;

export const acquireLineSubscription = (dispatch: AppDispatch) => {
  subscriberCount += 1;
  if (subscriberCount === 1) {
    dispatch(consoleActions.setVerboseEnabled(true));
  }
};

export const releaseLineSubscription = (dispatch: AppDispatch) => {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0) {
    dispatch(consoleActions.setVerboseEnabled(false));
  }
};
