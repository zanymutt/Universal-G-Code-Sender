import { jogContinuous } from "./machine";
import { ContinuousJog, createContinuousJog } from "../utils/continuousJog";

// The one continuous-jog stream for the whole page: every input source
// (keyboard now, gamepad later) sets its own direction on this and the stream
// combines them, so two inputs can never fight over the machine.
let session: ContinuousJog | null = null;
const refusedListeners = new Set<() => void>();

export const getContinuousJog = (): ContinuousJog => {
  if (!session) {
    session = createContinuousJog({
      send: (direction) => jogContinuous(direction.x, direction.y, direction.z),
      setInterval: (callback, ms) => window.setInterval(callback, ms),
      clearInterval: (handle) => window.clearInterval(handle as number),
      onRefused: () => refusedListeners.forEach((listener) => listener()),
    });
  }
  return session;
};

// Called when the backend declined to jog and everything held was let go.
export const onContinuousJogRefused = (listener: () => void) => {
  refusedListeners.add(listener);
  return () => {
    refusedListeners.delete(listener);
  };
};
