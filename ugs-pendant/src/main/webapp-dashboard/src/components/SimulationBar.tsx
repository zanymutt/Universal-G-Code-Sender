import { useEffect, useState } from "react";
import { Button, ButtonGroup, Dropdown, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBackwardStep,
  faForwardStep,
  faGear,
  faPause,
  faPlay,
  faRotateLeft,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import "./SimulationBar.scss";

type Props = {
  playing: boolean;
  speed: number;
  speeds: number[];
  // Whether elapsed/total below are estimated real seconds (the file carries
  // feed rates) or just a stand-in clock that shouldn't be shown as a time.
  realTime: boolean;
  elapsedSeconds: number;
  totalSeconds: number;
  rapidRate: number;
  // 0..1 through the whole job.
  progress: number;
  // The line most recently drawn (0 = nothing yet).
  line: number;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSeek: (fraction: number) => void;
  onSpeed: (speed: number) => void;
  onRapidRate: (rate: number) => void;
  onClose: () => void;
};

const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

// The rapid-rate number field keeps its own text while you type (so clearing
// it to retype doesn't fight a committed value) and only commits valid, positive
// numbers upward.
const RapidRateField = ({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) => {
  const [text, setText] = useState(String(rate));
  useEffect(() => setText(String(rate)), [rate]);
  return (
    <Form.Group className="simulationRapidField">
      <Form.Label>Rapid speed (mm/min)</Form.Label>
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
      <Form.Text>
        How fast rapid moves are assumed to travel. Cuts use the file&apos;s own feed rates. Real machines
        accelerate and pause, so an actual run is usually a little longer.
      </Form.Text>
    </Form.Group>
  );
};

const SCRUBBER_STEPS = 1000;

// Transport controls for the toolpath simulation, floated along the bottom of
// the viewport (clear of the zoom control on the right edge). Purely
// presentational - all playback state lives in ToolpathSimulation.
const SimulationBar = ({
  playing,
  speed,
  speeds,
  realTime,
  elapsedSeconds,
  totalSeconds,
  rapidRate,
  progress,
  line,
  onPlay,
  onPause,
  onRestart,
  onStepBack,
  onStepForward,
  onSeek,
  onSpeed,
  onRapidRate,
  onClose,
}: Props) => (
  <div className="simulationBar">
    <div className="simulationBarRow">
      <ButtonGroup>
        <Button variant="outline-secondary" aria-label="Restart" title="Restart" onClick={onRestart}>
          <FontAwesomeIcon icon={faRotateLeft} />
        </Button>
        <Button variant="outline-secondary" aria-label="Previous line" title="Previous line" onClick={onStepBack}>
          <FontAwesomeIcon icon={faBackwardStep} />
        </Button>
        <Button
          variant="primary"
          className="simulationPlay"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={playing ? onPause : onPlay}
        >
          <FontAwesomeIcon icon={playing ? faPause : faPlay} />
        </Button>
        <Button variant="outline-secondary" aria-label="Next line" title="Next line" onClick={onStepForward}>
          <FontAwesomeIcon icon={faForwardStep} />
        </Button>
      </ButtonGroup>

      <ButtonGroup className="simulationSpeeds" aria-label="Playback speed">
        {speeds.map((value) => (
          <Button
            key={value}
            variant={value === speed ? "secondary" : "outline-secondary"}
            onClick={() => onSpeed(value)}
          >
            {value}&times;
          </Button>
        ))}
      </ButtonGroup>

      <div className="simulationReadout">
        <div className="simulationLine">{line > 0 ? `Line ${line}` : "Start"}</div>
        {realTime && (
          <div
            className="simulationClock"
            title="Estimated from the file's feed rates - real runs are usually a little longer"
          >
            {formatClock(elapsedSeconds)} / {formatClock(totalSeconds)}
          </div>
        )}
      </div>

      {realTime && (
        <Dropdown drop="up" align="end" autoClose="outside">
          <Dropdown.Toggle variant="outline-secondary" className="simulationRapidToggle" aria-label="Timing settings">
            <FontAwesomeIcon icon={faGear} />
          </Dropdown.Toggle>
          <Dropdown.Menu className="simulationRapidMenu">
            <RapidRateField rate={rapidRate} onChange={onRapidRate} />
          </Dropdown.Menu>
        </Dropdown>
      )}

      <Button variant="outline-secondary" className="simulationClose" aria-label="Exit simulation" onClick={onClose}>
        <FontAwesomeIcon icon={faXmark} />
      </Button>
    </div>

    <input
      className="simulationScrubber"
      type="range"
      min={0}
      max={SCRUBBER_STEPS}
      step={1}
      value={Math.round(progress * SCRUBBER_STEPS)}
      aria-label="Simulation position"
      onChange={(event) => onSeek(Number(event.target.value) / SCRUBBER_STEPS)}
    />
  </div>
);

export default SimulationBar;
