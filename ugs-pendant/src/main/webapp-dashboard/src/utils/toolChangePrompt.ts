// What the dashboard says while UGS performs a tool change for an M6, and which answers it offers. The
// wording follows the desktop's Tool Change dialog (MessagesBundle "toolchange.*"). Pure, so it is
// unit-tested in node (tests/toolChangePrompt.test.cjs).

import type { InterceptorResponse, InterceptorStatus } from "../model/InterceptorStatus";

export const STEP_CHANGE_TOOL = "toolChange.changeTool";
export const STEP_CONTINUE = "toolChange.continue";

export type PromptAction = {
  response: InterceptorResponse;
  label: string;
  // Aborting cancels the job, so it is drawn as the dangerous choice.
  kind: "primary" | "secondary" | "danger";
};

export type PromptView = {
  title: string;
  message: string;
  // The machine or the routine is working; nothing to answer yet.
  busy: boolean;
  // The jog / zero / probe helpers belong to the step where the tool is being changed.
  showToolHelpers: boolean;
  actions: PromptAction[];
};

const ACTION_ORDER: InterceptorResponse[] = ["ABORT", "SKIP", "CONTINUE"];
const ACTION_LABELS: Record<InterceptorResponse, PromptAction> = {
  ABORT: { response: "ABORT", label: "Abort", kind: "danger" },
  SKIP: { response: "SKIP", label: "Skip", kind: "secondary" },
  CONTINUE: { response: "CONTINUE", label: "Continue", kind: "primary" },
};

const toolLabel = (toolNumber: number | null | undefined) =>
  toolNumber === null || toolNumber === undefined ? "the new tool" : `tool #${toolNumber}`;

// null when there is nothing to show (INACTIVE).
export const describeInterceptor = (status: InterceptorStatus | null | undefined): PromptView | null => {
  if (!status || status.state === "INACTIVE") return null;

  const none = { showToolHelpers: false, actions: [] as PromptAction[] };
  switch (status.state) {
    case "PENDING":
      return { title: "Tool change", message: "The machine is finishing the current commands.", busy: true, ...none };
    case "RUNNING":
      return { title: "Tool change", message: "Please wait…", busy: true, ...none };
    case "RESUMING":
      return { title: "Resuming the job", message: "Restoring the machine state…", busy: true, ...none };
    case "FAILED":
      return {
        title: "Tool change failed",
        message: "The tool change could not be completed. The job is paused; abort it to start over.",
        busy: false,
        showToolHelpers: false,
        actions: [ACTION_LABELS.ABORT],
      };
    case "WAITING_FOR_USER": {
      const offered = new Set(status.prompt?.options ?? []);
      const actions = ACTION_ORDER.filter((response) => offered.has(response)).map((response) => ACTION_LABELS[response]);
      switch (status.prompt?.stepId) {
        case STEP_CHANGE_TOOL:
          return {
            title: "Change tool",
            message: `Jog to a place where the tool can be changed, change to ${toolLabel(status.toolNumber)} then zero out Z.`,
            busy: false,
            showToolHelpers: true,
            actions,
          };
        case STEP_CONTINUE:
          return {
            title: "Ready to continue with the job?",
            message: "Press continue to resume the job",
            busy: false,
            showToolHelpers: false,
            actions,
          };
        default:
          return { title: "Action required", message: "", busy: false, showToolHelpers: false, actions };
      }
    }
  }
};
