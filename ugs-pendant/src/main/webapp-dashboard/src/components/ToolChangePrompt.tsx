import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Spinner } from "react-bootstrap";
import { useAppSelector } from "../hooks/useAppSelector";
import { InterceptorResponse } from "../model/InterceptorStatus";
import { clampPanelPosition } from "../utils/floatingPanel";
import { layoutRect, layoutScale } from "../utils/layoutRect";
import { resetToZero } from "../services/machine";
import { respondToInterceptor } from "../services/interceptor";
import { runProbe } from "../services/probe";
import { describeInterceptor, PromptAction } from "../utils/toolChangePrompt";
import "./ToolChangePrompt.scss";

// Where the person last dragged the prompt to (null: its default place, top centre). Kept for the session and
// across reloads, because the prompt comes and goes with every tool change and shouldn't jump back each time.
type Spot = { left: number; top: number };
const SPOT_STORAGE_KEY = "ugs.dashboard.toolChangePromptSpot";
let rememberedSpot: Spot | null | undefined;
const readSpot = (): Spot | null => {
  if (rememberedSpot !== undefined) return rememberedSpot;
  let spot: Spot | null = null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SPOT_STORAGE_KEY) ?? "null");
    if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) spot = { left: parsed.left, top: parsed.top };
  } catch {
    // Not remembering it is fine.
  }
  rememberedSpot = spot;
  return spot;
};
const writeSpot = (spot: Spot | null) => {
  rememberedSpot = spot;
  try {
    if (spot) window.localStorage.setItem(SPOT_STORAGE_KEY, JSON.stringify(spot));
    else window.localStorage.removeItem(SPOT_STORAGE_KEY);
  } catch {
    // Not remembering it is fine.
  }
};

const variantFor = (kind: PromptAction["kind"]) =>
  kind === "primary" ? "primary" : kind === "danger" ? "outline-danger" : "outline-secondary";

// UGS stops a job at an M6 and runs its own tool change: it moves up, stops the spindle and then waits for
// someone to change the tool and say go. The desktop asks in a dialog; this is the same question for the
// dashboard. It is deliberately not modal - the jog pad, zeroing and everything else on the page stay usable
// while the tool is being changed - and it is shown only while there is something going on (or waiting). Drag
// it by its title to move it out of the way of the editor or the console (double-click the title to put it
// back at the top centre).
const ToolChangePrompt = () => {
  const status = useAppSelector((state) => state.interceptor.status);
  const isIdle = useAppSelector((state) => state.status.state === "IDLE");
  const [sending, setSending] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot | null>(readSpot);
  // The spot as of the last pointer move, so the drop saves exactly where the prompt was left.
  const lastSpot = useRef<Spot | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number; scale: number } | null>(null);

  // Each new step starts clean: the answer to the last one has landed.
  const stepKey = `${status.state}:${status.prompt?.stepId ?? ""}`;
  useEffect(() => {
    setSending(false);
    setError(null);
  }, [stepKey]);

  // A smaller window must not strand the prompt off screen.
  useEffect(() => {
    const onResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const scale = layoutScale(panel);
      setSpot((current) =>
        current
          ? clampPanelPosition(current.left, current.top, panel.offsetWidth, {
              width: window.innerWidth / scale,
              height: window.innerHeight / scale,
            })
          : current
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const view = describeInterceptor(status);
  if (!view) return null;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = layoutRect(panel);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      scale: layoutScale(panel),
    };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const panel = panelRef.current;
    if (!current || current.pointer !== event.pointerId || !panel) return;
    const next = clampPanelPosition(
      current.left + (event.clientX - current.x) / current.scale,
      current.top + (event.clientY - current.y) / current.scale,
      panel.offsetWidth,
      { width: window.innerWidth / current.scale, height: window.innerHeight / current.scale }
    );
    lastSpot.current = next;
    setSpot(next);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    if (lastSpot.current) writeSpot(lastSpot.current);
  };

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
    <div
      ref={panelRef}
      className={`toolChangePrompt${spot ? " toolChangePromptMoved" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="tool-change-title"
      style={spot ? { left: spot.left, top: spot.top } : undefined}
    >
      <div
        className="toolChangePromptHeader"
        title="Drag to move this out of the way (double-click to put it back)"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          writeSpot(null);
          setSpot(null);
        }}
      >
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
