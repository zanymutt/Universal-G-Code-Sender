import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Spinner } from "react-bootstrap";
import { useAppSelector } from "../hooks/useAppSelector";
import { InterceptorResponse } from "../model/InterceptorStatus";
import { resetToZero } from "../services/machine";
import { respondToInterceptor } from "../services/interceptor";
import { runProbe } from "../services/probe";
import { describeInterceptor, PromptAction } from "../utils/toolChangePrompt";
import "./ToolChangePrompt.scss";

const variantFor = (kind: PromptAction["kind"]) =>
  kind === "primary" ? "primary" : kind === "danger" ? "outline-danger" : "outline-secondary";

// UGS stops a job at an M6 and runs its own tool change: it moves up, stops the spindle and then waits for
// someone to change the tool and say go. The desktop asks in a dialog; this is the same question for the
// dashboard. It is deliberately not modal - the jog pad, zeroing and everything else on the page stay usable
// while the tool is being changed - and it is shown only while there is something going on (or waiting).
const ToolChangePrompt = () => {
  const status = useAppSelector((state) => state.interceptor.status);
  const isIdle = useAppSelector((state) => state.status.state === "IDLE");
  const [sending, setSending] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each new step starts clean: the answer to the last one has landed.
  const stepKey = `${status.state}:${status.prompt?.stepId ?? ""}`;
  useEffect(() => {
    setSending(false);
    setError(null);
  }, [stepKey]);

  const view = describeInterceptor(status);
  if (!view) return null;

  const answer = (response: InterceptorResponse) => {
    setSending(true);
    setError(null);
    respondToInterceptor(response).catch((reason: unknown) => {
      setSending(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  const probeZ = () => {
    setProbing(true);
    setError(null);
    runProbe("Z")
      .then((result) => {
        if (!result.success) setError(result.message ?? "The probe did not make contact");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setProbing(false));
  };

  return createPortal(
    <div className="toolChangePrompt" role="dialog" aria-modal="false" aria-labelledby="tool-change-title">
      <div className="toolChangePromptHeader">
        {view.busy && <Spinner animation="border" size="sm" aria-hidden="true" />}
        <div id="tool-change-title" className="toolChangePromptTitle">
          {view.title}
        </div>
      </div>
      <div className="toolChangePromptMessage" aria-live="polite">
        {view.message}
      </div>

      {view.showToolHelpers && (
        <div className="toolChangeHelpers">
          <Button
            variant="outline-secondary"
            disabled={!isIdle || probing}
            title="Set the work Z to zero where the tool is now"
            onClick={() => {
              setError(null);
              resetToZero("Z").catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
            }}
          >
            Zero Z
          </Button>
          <Button
            variant="outline-secondary"
            disabled={!isIdle || probing}
            title="Touch off on the probe plate and set Z zero (uses the probe settings)"
            onClick={probeZ}
          >
            {probing ? "Probing…" : "Probe and zero Z"}
          </Button>
        </div>
      )}

      {error && (
        <div className="toolChangePromptError" role="alert">
          {error}
        </div>
      )}

      {view.actions.length > 0 && (
        <div className="toolChangeActions">
          {view.actions.map((action) => (
            <Button
              key={action.response}
              variant={variantFor(action.kind)}
              disabled={sending || probing || !isIdle}
              onClick={() => answer(action.response)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>,
    document.querySelector(".app") ?? document.body
  );
};

export default ToolChangePrompt;
