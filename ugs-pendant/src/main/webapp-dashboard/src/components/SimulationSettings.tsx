import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Form, OverlayTrigger, Tooltip } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretUp, faCircleInfo, faGear } from "@fortawesome/free-solid-svg-icons";
import { layoutRect, layoutScale } from "../utils/layoutRect";
import { placePopover } from "../utils/placePopover";
import "./SimulationSettings.scss";

const POPOVER_WIDTH = 260;

// The rapid-rate number field keeps its own text while you type (so clearing
// it to retype doesn't fight a committed value) and only commits valid, positive
// numbers upward.
const RapidRateField = ({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) => {
  const [text, setText] = useState(String(rate));
  useEffect(() => setText(String(rate)), [rate]);
  return (
    <Form.Group className="simulationRapidField">
      <Form.Label>
        Rapid speed (mm/min)
        {/* On focus as well as hover, so a tap on a touchscreen shows it too. */}
        <OverlayTrigger
          placement="top"
          trigger={["hover", "focus"]}
          overlay={
            <Tooltip id="simulation-rapid-help">
              Assumed speed of rapid moves. Cuts use the file&apos;s own feed rates. Real machines accelerate and
              pause, so an actual run is usually a little longer.
            </Tooltip>
          }
        >
          <button type="button" className="simulationHelp" aria-label="About rapid speed">
            <FontAwesomeIcon icon={faCircleInfo} />
          </button>
        </OverlayTrigger>
      </Form.Label>
      <Form.Control
        type="number"
        inputMode="numeric"
        min={1}
        step={100}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value > 0) onChange(value);
        }}
      />
    </Form.Group>
  );
};

type Props = {
  speed: number;
  speeds: number[];
  // Playback speed normally has its own button row on the bar; when that row
  // is hidden for lack of width, the speeds move into this popover instead.
  showSpeeds: boolean;
  realTime: boolean;
  rapidRate: number;
  onSpeed: (speed: number) => void;
  onRapidRate: (rate: number) => void;
};

// The button and its popover (playback speed when the bar is too narrow for its
// own speed buttons, plus the rapid-rate setting). The button is a gear when
// the popover only holds the rapid-rate setting, and a chip showing the current
// speed (with a caret) when it's also where playback speed is picked. Not a Bootstrap
// dropdown: those cap their height and scroll, and position with popper, which
// left this one running off the edge of a narrow pane or the top of a short
// window. This one is measured and placed by placePopover so it always fits
// on screen, scrolling only when it truly can't.
//
// It's rendered into .app (not the bar) so it can extend past the visualizer
// pane, but still inside the dashboard's zoom transform so it scales with the
// rest of the UI - which is why all the measuring here is in layout units.
const SimulationSettings = ({ speed, speeds, showSpeeds, realTime, rapidRate, onSpeed, onRapidRate }: Props) => {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const toggle = toggleRef.current;
    const popover = popoverRef.current;
    if (!toggle || !popover) return;
    const scale = layoutScale(toggle);
    const anchor = layoutRect(toggle);
    // Measured unconstrained, so a previous max-height doesn't hide the natural size.
    popover.style.maxHeight = "none";
    popover.style.overflowY = "visible";
    popover.style.width = `${POPOVER_WIDTH}px`;
    const placement = placePopover(
      { left: anchor.left, top: anchor.top, right: anchor.left + anchor.width, bottom: anchor.top + anchor.height },
      { width: POPOVER_WIDTH, height: popover.scrollHeight },
      { width: window.innerWidth / scale, height: window.innerHeight / scale }
    );
    popover.style.left = `${placement.left}px`;
    popover.style.top = `${placement.top}px`;
    popover.style.width = `${placement.width}px`;
    if (placement.maxHeight !== null) {
      popover.style.maxHeight = `${placement.maxHeight}px`;
      popover.style.overflowY = "auto";
    }
    popover.style.visibility = "visible";
  };

  // Before paint, so it never shows in the wrong place for a frame.
  useLayoutEffect(() => {
    if (open) place();
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !toggleRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (toggleRef.current) observer?.observe(toggleRef.current);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <Button
        ref={toggleRef}
        variant="outline-secondary"
        className="simulationRapidToggle"
        aria-label="Playback and timing settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {showSpeeds ? (
          <>
            <span className="simulationSpeedChip">{speed}&times;</span>
            <FontAwesomeIcon icon={faCaretUp} className="simulationSpeedCaret" />
          </>
        ) : (
          <FontAwesomeIcon icon={faGear} />
        )}
      </Button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="simulationSettings"
            role="dialog"
            aria-label="Simulation settings"
            // Hidden until place() has run, so it can't flash at 0,0 first.
            style={{ visibility: "hidden" }}
          >
            {showSpeeds && (
              <div className="simulationSettingsSpeeds" role="group" aria-label="Playback speed">
                <div className="simulationSettingsHeading">Playback speed</div>
                <div className="simulationSettingsSpeedGrid">
                  {speeds.map((value) => (
                    <Button
                      key={value}
                      variant={value === speed ? "secondary" : "outline-secondary"}
                      onClick={() => onSpeed(value)}
                    >
                      {value}&times;
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {realTime && <RapidRateField rate={rapidRate} onChange={onRapidRate} />}
          </div>,
          document.querySelector(".app") ?? document.body
        )}
    </>
  );
};

export default SimulationSettings;
