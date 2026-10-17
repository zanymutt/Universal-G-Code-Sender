import { InterceptorResponse, InterceptorStatus } from "../model/InterceptorStatus";

// What the interceptor is doing right now - for a page that loads (or reconnects) while a tool change
// is already waiting, since the socket only pushes changes.
export const getInterceptorStatus = (): Promise<InterceptorStatus> => {
  return fetch("/api/v1/interceptor").then((response) => {
    if (!response.ok) {
      throw new Error(`Couldn't read the tool change state (${response.status})`);
    }
    return response.json();
  });
};

// Answers the waiting prompt. ABORT also ends a routine that failed. The backend answers 409 when
// nothing is waiting any more (someone else, e.g. the desktop dialog, got there first).
export const respondToInterceptor = (response: InterceptorResponse): Promise<InterceptorStatus> => {
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response }),
  };
  return fetch("/api/v1/interceptor/respond", request).then((reply) => {
    if (!reply.ok) {
      throw new Error(
        reply.status === 409 ? "Nothing is waiting for an answer any more" : `Couldn't send the answer (${reply.status})`
      );
    }
    return reply.json();
  });
};
