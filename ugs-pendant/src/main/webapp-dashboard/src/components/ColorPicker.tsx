import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, ButtonGroup, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEyeDropper, faXmark } from "@fortawesome/free-solid-svg-icons";
import { fractionInBox, Hsv, hexToHsv, hexToRgb, hsvToHex, hueColor, normalizeHex, rgbToHex } from "../utils/colorUtils";
import { layoutRect, layoutScale } from "../utils/layoutRect";
import { Box, placePopover } from "../utils/placePopover";
import "./ColorPicker.scss";

const POPOVER_WIDTH = 252;

// Whether the numbers are shown as one hex code or as red / green / blue, remembered for next time.
type Mode = "hex" | "rgb";
const MODE_STORAGE_KEY = "ugs.dashboard.colorPickerMode";
const readMode = (): Mode => {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === "rgb" ? "rgb" : "hex";
  } catch {
    return "hex";
  }
};
const rgbStrings = (hex: string): [string, string, string] => hexToRgb(hex).map(String) as [string, string, string];

// The browser's eyedropper (Chrome and Edge on a secure context such as localhost; not Firefox, Safari or
// Android): click any pixel on the screen, in or out of the browser.
type EyeDropperLike = { open: () => Promise<{ sRGBHex: string }> };
const eyeDropperConstructor = (): (new () => EyeDropperLike) | null =>
  typeof window !== "undefined" && "EyeDropper" in window
    ? (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper
    : null;

type Drag = "sv" | "hue" | null;

// What the pop-up is placed against, in the layout units position:fixed uses inside .app (see layoutRect),
// and the dashboard zoom scale those units are drawn at.
export type PickerAnchor = { box: Box; scale: number };

export type CloseReason = "escape" | "button" | "outside" | "blur";

type PopoverProps = {
  // The color the picker starts on.
  value: string;
  // Measured again whenever the pop-up is placed, so it follows its anchor.
  anchor: () => PickerAnchor | null;
  // Called with the color the user settled on: when the pointer is released (mouse up, touch end), a hex
  // code is entered, or a key is pressed - never for the steps of a drag.
  onCommit: (color: string) => void;
  // Called with the color being picked as it moves, for an anchor that shows it live. Not for storing.
  onLive?: (color: string) => void;
  onClose: (reason: CloseReason) => void;
  // A click here is the opener's own business (it toggles the pop-up), not an outside click.
  ignoreOutside?: RefObject<HTMLElement | null>;
  // Close when the page loses focus - a click into a plugin's iframe never reaches the page's own
  // pointer events, so this is the only way to see it.
  closeOnWindowBlur?: boolean;
  label: string;
};

// The dashboard's own color picker pop-up: a saturation/brightness square, a hue slider and a hex box. It
// replaces the browser's <input type="color"> because that pop-up is the browser's, drawn outside the
// page: the page can't tell when the mouse is released in it (so the Stock view repainted for every step
// of a drag), it opens in the wrong place when the dashboard is zoomed, and it has no close button. Here
// `onCommit` fires on release. Rendered into .app (inside the zoom transform) and placed with
// placePopover, like the other pop-ups.
export const ColorPickerPopover = ({
  value,
  anchor,
  onCommit,
  onLive,
  onClose,
  ignoreOutside,
  closeOnWindowBlur = false,
  label,
}: PopoverProps) => {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const [rgbText, setRgbText] = useState<[string, string, string]>(() => rgbStrings(value));
  const [mode, setMode] = useState<Mode>(readMode);
  // True while the eyedropper is open: the page loses focus to it, which must not close the picker.
  const picking = useRef(false);
  const EyeDropper = eyeDropperConstructor();
  const popoverRef = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(null);
  const latest = useRef({ hsv, value, onCommit, onLive, onClose, anchor });
  latest.current = { ...latest.current, value, onCommit, onLive, onClose, anchor };
  latest.current.hsv = hsv;

  const shown = hsvToHex(hsv);

  const show = (next: Hsv) => {
    latest.current.hsv = next;
    setHsv(next);
    setHexText(hsvToHex(next));
    setRgbText(rgbStrings(hsvToHex(next)));
    latest.current.onLive?.(hsvToHex(next));
  };
  // The last color committed, so the same color isn't handed on twice (the opening value to begin with).
  const committed = useRef(value);
  const commit = (next: Hsv = latest.current.hsv) => {
    const hex = hsvToHex(next);
    if (hex === committed.current) return;
    committed.current = hex;
    latest.current.onCommit(hex);
  };

  const place = () => {
    const popover = popoverRef.current;
    const target = latest.current.anchor();
    if (!popover || !target) return;
    popover.style.maxHeight = "none";
    popover.style.overflowY = "visible";
    popover.style.width = `${POPOVER_WIDTH}px`;
    const placement = placePopover(
      target.box,
      { width: POPOVER_WIDTH, height: popover.scrollHeight },
      { width: window.innerWidth / target.scale, height: window.innerHeight / target.scale }
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

  useLayoutEffect(() => {
    place();
  });

  // Opened from inside a plugin's iframe, focus is still in that frame. Take it, so a later click back into
  // the frame is a focus change the page can see (and close on) rather than a click it never hears about.
  useEffect(() => {
    if (closeOnWindowBlur) squareRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !ignoreOutside?.current?.contains(target)) {
        latest.current.onClose("outside");
      }
    };
    const onBlur = () => {
      if (!picking.current) latest.current.onClose("blur");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", place);
    if (closeOnWindowBlur) window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeOnWindowBlur]);

  // Moves the thumb of whichever control is being dragged to the pointer.
  const follow = (event: React.PointerEvent) => {
    if (drag.current === "sv" && squareRef.current) {
      const { x, y } = fractionInBox(event.clientX, event.clientY, squareRef.current.getBoundingClientRect());
      show({ h: latest.current.hsv.h, s: x, v: 1 - y });
    } else if (drag.current === "hue" && hueRef.current) {
      const { x } = fractionInBox(event.clientX, event.clientY, hueRef.current.getBoundingClientRect());
      show({ ...latest.current.hsv, h: x * 360 });
    }
  };
  const startDrag = (kind: Drag) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = kind;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    follow(event);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    commit();
  };

  const nudge = (change: Partial<Hsv>) => {
    const current = latest.current.hsv;
    const next = {
      h: (((current.h + (change.h ?? 0)) % 360) + 360) % 360,
      s: Math.min(1, Math.max(0, current.s + (change.s ?? 0))),
      v: Math.min(1, Math.max(0, current.v + (change.v ?? 0))),
    };
    show(next);
    commit(next);
  };

  const squareKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const change: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: -step },
      ArrowRight: { s: step },
      ArrowUp: { v: step },
      ArrowDown: { v: -step },
    };
    if (!change[event.key]) return;
    event.preventDefault();
    nudge(change[event.key]);
  };
  const hueKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nudge({ h: -step });
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nudge({ h: step });
    else return;
    event.preventDefault();
  };

  // Takes a typed or picked color as the new one: shown, and committed.
  const applyHex = (hex: string) => {
    const next = hexToHsv(hex);
    // A gray has no hue of its own: keep the one the slider was on.
    show(next.s === 0 || next.v === 0 ? { ...next, h: latest.current.hsv.h } : next);
    commit(next);
  };

  const commitHex = () => {
    const hex = normalizeHex(hexText);
    if (hex) applyHex(hex);
    else setHexText(hsvToHex(latest.current.hsv));
  };

  // Red, green and blue: each 0-255 (a decimal is rounded, a number outside is brought into range); anything
  // that isn't a number puts the boxes back to the current color.
  const commitRgb = () => {
    const channels = rgbText.map((text) => (text.trim() === "" ? NaN : Number(text)));
    if (channels.some((channel) => !Number.isFinite(channel))) {
      setRgbText(rgbStrings(hsvToHex(latest.current.hsv)));
      return;
    }
    applyHex(rgbToHex(channels[0], channels[1], channels[2]));
  };

  const chooseMode = (next: Mode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Not remembering the choice is fine.
    }
  };

  const pickFromScreen = async () => {
    if (!EyeDropper || picking.current) return;
    picking.current = true;
    try {
      const picked = await new EyeDropper().open();
      const hex = normalizeHex(picked.sRGBHex);
      // Clicking a pixel is a release: the color is settled on.
      if (hex) applyHex(hex);
    } catch {
      // Escape, or the browser refused: nothing was picked.
    } finally {
      picking.current = false;
    }
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="colorPicker"
      data-color-picker=""
      role="dialog"
      aria-label={label}
      style={{ visibility: "hidden" }}
      onKeyDown={(event) => {
        // Keep Escape from also closing the pop-up or panel this picker was opened from.
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose("escape");
        }
      }}
    >
      <div className="colorPickerHeader">
        <strong>Color</strong>
        <span className="colorPickerTools">
          <ButtonGroup size="sm" aria-label="Show the color as">
            <Button variant={mode === "hex" ? "secondary" : "outline-secondary"} aria-pressed={mode === "hex"} onClick={() => chooseMode("hex")}>
              Hex
            </Button>
            <Button variant={mode === "rgb" ? "secondary" : "outline-secondary"} aria-pressed={mode === "rgb"} onClick={() => chooseMode("rgb")}>
              RGB
            </Button>
          </ButtonGroup>
          {EyeDropper && (
            <Button
              size="sm"
              variant="outline-secondary"
              aria-label="Pick a color from the screen"
              title="Pick a color from anywhere on the screen"
              onClick={pickFromScreen}
            >
              <FontAwesomeIcon icon={faEyeDropper} />
            </Button>
          )}
          <Button size="sm" variant="outline-secondary" aria-label="Close color picker" title="Close" onClick={() => onClose("button")}>
            <FontAwesomeIcon icon={faXmark} />
          </Button>
        </span>
      </div>
      <div
        ref={squareRef}
        className="colorPickerSquare"
        style={{ backgroundColor: hueColor(hsv.h) }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
        onPointerDown={startDrag("sv")}
        onPointerMove={follow}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={squareKey}
      >
        <span className="colorPickerThumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: shown }} />
      </div>
      <div
        ref={hueRef}
        className="colorPickerHue"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={startDrag("hue")}
        onPointerMove={follow}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={hueKey}
      >
        <span className="colorPickerThumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", backgroundColor: hueColor(hsv.h) }} />
      </div>
      <div className="colorPickerFooter">
        <span className="colorPickerChips" aria-hidden="true">
          <span className="colorPickerChip" style={{ backgroundColor: value }} title="Starting color" />
          <span className="colorPickerChip" style={{ backgroundColor: shown }} title="New color" />
        </span>
        {mode === "rgb" ? (
          <span className="colorPickerRgb">
            {(["Red", "Green", "Blue"] as const).map((name, index) => (
              <Form.Control
                key={name}
                size="sm"
                type="number"
                inputMode="numeric"
                min={0}
                max={255}
                step={1}
                aria-label={name}
                title={name}
                value={rgbText[index]}
                onChange={(event) => {
                  const next = [...rgbText] as [string, string, string];
                  next[index] = event.target.value;
                  setRgbText(next);
                }}
                onBlur={commitRgb}
                onKeyDown={(event) => {
                  // Enter commits itself: a blur only follows when the page has focus.
                  if (event.key === "Enter") {
                    commitRgb();
                    event.currentTarget.blur();
                  }
                }}
              />
            ))}
          </span>
        ) : (
        <Form.Control
          size="sm"
          className="colorPickerHex"
          aria-label="Hex color"
          value={hexText}
          spellCheck={false}
          maxLength={7}
          onChange={(event) => setHexText(event.target.value)}
          onBlur={commitHex}
          onKeyDown={(event) => {
            // Enter commits itself rather than through the blur it causes: a blur only follows when the page
            // has focus, and committing twice is harmless (the same color isn't handed on again).
            if (event.key === "Enter") {
              commitHex();
              event.currentTarget.blur();
            }
          }}
        />
        )}
      </div>
    </div>,
    document.querySelector(".app") ?? document.body
  );
};

type Props = {
  value: string;
  // Called with the color the user settled on: when the pointer is released, a hex code is entered, or a
  // key is pressed - never for the steps of a drag.
  onCommit: (color: string) => void;
  // Extra classes for the swatch button (its size and shape).
  className?: string;
  title?: string;
  disabled?: boolean;
  "aria-label": string;
};

// A swatch button that opens the color picker. The swatch follows the drag; `onCommit` waits for the release.
const ColorPicker = ({ value, onCommit, className, title, disabled, "aria-label": ariaLabel }: Props) => {
  const [open, setOpen] = useState(false);
  // The color being picked right now; null when the swatch just shows `value`.
  const [live, setLive] = useState<string | null>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);

  const close = (reason: CloseReason) => {
    setOpen(false);
    setLive(null);
    if (reason === "escape") swatchRef.current?.focus();
  };

  return (
    <>
      <button
        ref={swatchRef}
        type="button"
        className={`colorPickerSwatch ${className ?? ""}`}
        style={{ backgroundColor: open ? (live ?? value) : value }}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close("button") : setOpen(true))}
      />
      {open && (
        <ColorPickerPopover
          value={value}
          label={`${ariaLabel} picker`}
          anchor={() => {
            const swatch = swatchRef.current;
            if (!swatch) return null;
            const rect = layoutRect(swatch);
            return {
              box: { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height },
              scale: layoutScale(swatch),
            };
          }}
          ignoreOutside={swatchRef}
          onCommit={onCommit}
          onLive={setLive}
          onClose={close}
        />
      )}
    </>
  );
};

export default ColorPicker;
