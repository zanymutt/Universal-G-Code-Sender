// What a running command interceptor (UGS's tool change for an M6 in the file) is doing. Mirrors
// pendantui/v1/model/InterceptorStatus.java: pushed over the events socket as "InterceptorStateEvent"
// whenever it changes and returned by GET /api/v1/interceptor.
export type InterceptorState =
  | "INACTIVE"
  // The machine is finishing the commands already sent.
  | "PENDING"
  // The routine is moving the machine (to a safe height, spindle off) or restoring it.
  | "RUNNING"
  // Waiting for the operator: see `prompt`.
  | "WAITING_FOR_USER"
  | "RESUMING"
  // The routine failed or timed out and left the job paused; only ABORT is possible.
  | "FAILED";

export type InterceptorResponse = "CONTINUE" | "SKIP" | "ABORT";

export type InterceptorPrompt = {
  // "toolChange.changeTool" (jog, change the tool, zero Z) or "toolChange.continue" (ready to resume?).
  stepId: string;
  options: InterceptorResponse[];
};

export type InterceptorStatus = {
  state: InterceptorState;
  previousState?: InterceptorState | null;
  prompt?: InterceptorPrompt | null;
  // The command that triggered it, e.g. "T2 M6".
  triggerCommand?: string | null;
  // The tool that command asks for, read from the command itself; null when it names none.
  toolNumber?: number | null;
};

export const INACTIVE_INTERCEPTOR: InterceptorStatus = { state: "INACTIVE" };
