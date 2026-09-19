import { KeyboardEvent, PointerEvent, useRef } from "react";
import { Button } from "react-bootstrap";
import "./VisualizerZoomControl.scss";

type Props = {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  // Absolute zoom, from dragging the thumb.
  onChange: (zoom: number) => void;
  // Relative zoom, from +/- and the arrow keys - a factor rather than a target so
  // the caller applies it to the camera's live zoom, not this (render-lagged) prop.
  onZoomBy: (factor: number) => void;
};

// Each +/- press (and each arrow-key press) scales zoom by this factor, so a
// step always feels the same size no matter how far in/out you already are.
const STEP_FACTOR = 1.25;

const logMin = (minZoom: number) => Math.log(minZoom);
const logSpan = (minZoom: number, maxZoom: number) => Math.log(maxZoom) - Math.log(minZoom);

// A vertical zoom slider with +/- buttons at its ends, built by hand instead of
// as a native <input type="range">: rotating a native one to vertical is done
// differently (writing-mode vs. transform) with inconsistent touch behavior
// across browsers, and this one has to be reliable on a touchscreen. The
// slider is logarithmic - orthographic zoom is multiplicative, so equal thumb
// travel should be an equal *ratio* of zoom rather than an equal difference,
// which would crush nearly all of the useful range into the bottom of the track.
const VisualizerZoomControl = ({ zoom, minZoom, maxZoom, onChange, onZoomBy }: Props) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const clamp = (value: number) => Math.min(maxZoom, Math.max(minZoom, value));
  const fraction = (Math.log(clamp(zoom)) - logMin(minZoom)) / logSpan(minZoom, maxZoom);

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.height === 0) return;
    // Top of the track is max zoom, so the fraction runs from the bottom up.
    const t = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
    onChange(Math.exp(logMin(minZoom) + t * logSpan(minZoom, maxZoom)));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromPointer(event);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) setFromPointer(event);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      onZoomBy(STEP_FACTOR);
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      onZoomBy(1 / STEP_FACTOR);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div className="visualizerZoomControl">
      <Button
        variant="outline-secondary"
        className="visualizerZoomButton"
        aria-label="Zoom in"
        disabled={zoom >= maxZoom}
        onClick={() => onZoomBy(STEP_FACTOR)}
      >
        +
      </Button>
      <div
        ref={trackRef}
        className="visualizerZoomTrack"
        role="slider"
        aria-label="Zoom"
        aria-orientation="vertical"
        aria-valuemin={minZoom}
        aria-valuemax={maxZoom}
        aria-valuenow={Number(zoom.toFixed(2))}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <div className="visualizerZoomRail" />
        <div className="visualizerZoomFill" style={{ height: `${fraction * 100}%` }} />
        <div className="visualizerZoomThumb" style={{ bottom: `${fraction * 100}%` }} />
      </div>
      <Button
        variant="outline-secondary"
        className="visualizerZoomButton"
        aria-label="Zoom out"
        disabled={zoom <= minZoom}
        onClick={() => onZoomBy(1 / STEP_FACTOR)}
      >
        &minus;
      </Button>
    </div>
  );
};

export default VisualizerZoomControl;
