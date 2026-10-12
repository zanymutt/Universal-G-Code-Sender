import { useEffect, useState } from "react";
import { useAppSelector } from "../hooks/useAppSelector";
import { subscribeGamepads } from "../services/gamepadPoller";
import {
  axisName,
  axisThresholds,
  buttonName,
  decodeHat,
  hatAxisIndex,
  HAT_POSITION_NAMES,
  PadSnapshot,
} from "../utils/gamepadInput";

type Frame = { pads: PadSnapshot[]; deltas: number[][]; active: Set<string> };

// Values are shown to the nearest 2%, and a frame is only taken when one of them
// changes, so a still controller does not re-render the card at the polling rate.
const signature = (frame: Frame) =>
  frame.pads
    .map((pad, index) =>
      [
        pad.index,
        pad.id,
        pad.mapping,
        (frame.deltas[index] ?? []).map((d) => Math.round(d * 50)).join(","),
        pad.axes.map((value) => (Number.isFinite(value) && Math.abs(value) < 1.5 ? "" : "x")).join(""),
        pad.axes[hatAxisIndex(pad)] === undefined ? "" : String(decodeHat(pad.axes[hatAxisIndex(pad)])),
        pad.buttons.map((button) => Math.round(button.value * 50)).join(","),
      ].join("|")
    )
    .join("#") + "@" + [...frame.active].sort().join(",");

const percent = (value: number) => `${Math.round(value * 100)}%`;
const at = (value: number) => `${((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100}%`;

// Every axis and every button of each controller, all the time (nothing appears
// or disappears as it moves), so a layout can be read off and the activation
// point and dead band tuned against real travel. Axes show movement from rest;
// buttons show how far they are pressed, so analog triggers read as partial.
const AxisMonitor = () => {
  const { padTuning } = useAppSelector((state) => state.keyBindings);
  const { press, release } = axisThresholds(padTuning);
  const [frame, setFrame] = useState<Frame>({ pads: [], deltas: [], active: new Set() });

  useEffect(() => {
    let last = "";
    return subscribeGamepads((next) => {
      const key = signature(next);
      if (key === last) return;
      last = key;
      setFrame(next);
    });
  }, []);

  if (frame.pads.length === 0) {
    return (
      <div className="padMonitor" id="pad-monitor">
        <p className="keyBindingNone">No controller seen yet. Press a button on it while this window is in front.</p>
      </div>
    );
  }

  return (
    <div className="padMonitor" id="pad-monitor">
      {frame.pads.map((pad, padIndex) => {
        const hat = hatAxisIndex(pad);
        const deltas = frame.deltas[padIndex] ?? [];
        return (
          <div key={pad.index}>
            <p className="padMonitorPad">
              <strong>#{pad.index}</strong> {pad.id} — mapping {pad.mapping || "none"}
            </p>

            <h4>Axes — travel from rest</h4>
            {pad.axes.map((raw, index) => {
              if (index === hat) {
                const position = decodeHat(raw);
                return (
                  <div className="padMonitorAxis" key={index}>
                    <span className="padMonitorAxisLabel">Axis {index} - D-pad (hat)</span>
                    <span className="keyBindingNone">
                      {position === null ? "centre" : HAT_POSITION_NAMES[position]}
                    </span>
                  </div>
                );
              }
              const delta = deltas[index] ?? 0;
              const name = axisName(pad.mapping, index);
              const usable = Number.isFinite(raw) && Math.abs(raw) < 1.5;
              return (
                <div className="padMonitorAxis" key={index}>
                  <span className="padMonitorAxisLabel">
                    Axis {index}
                    {name ? ` - ${name}` : ""}
                  </span>
                  <span className="padAxisBar">
                    <i className="padAxisDead" style={{ left: at(-release), width: `${release * 100}%` }} />
                    <i className="padAxisMark" style={{ left: at(-press) }} />
                    <i className="padAxisMark" style={{ left: at(press) }} />
                    <i className="padAxisDot" style={{ left: at(delta) }} />
                  </span>
                  <span className="padMonitorAxisValue">
                    {usable ? `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%  (${raw.toFixed(2)})` : "n/a"}
                  </span>
                </div>
              );
            })}

            <h4>Buttons — how far pressed</h4>
            <div className="padMonitorButtons">
              {pad.buttons.map((button, index) => {
                const name = buttonName(pad.mapping, index);
                const value = Math.max(0, Math.min(1, button.value > 0 ? button.value : button.pressed ? 1 : 0));
                const held = frame.active.has(`Pad.B${index}`);
                return (
                  <div className={`padMonitorButton${held ? " padMonitorHeld" : ""}`} key={index} title={held ? "held" : ""}>
                    <strong>
                      B{index}
                      {name ? ` ${name}` : ""}
                    </strong>
                    <span>{percent(value)}</span>
                    <i className="padMonitorFill" style={{ width: percent(value) }} />
                    <i className="padMonitorMark" style={{ left: percent(press) }} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="settingsFieldHint">
        Bars show movement from each axis's own rest position. The shaded middle is the dead band and the two lines
        are the activation point; a button's line is the same activation point. Buttons that only ever show 0% or
        100% are digital; triggers show everything in between.
      </p>
    </div>
  );
};

export default AxisMonitor;
