import "./VisualizerReadout.scss";

export type ReadoutRow = { axis: string; value: string };

type Props = {
  rows: ReadoutRow[];
  units: string;
  label: string;
  // The toolpath's extents are a reference number, the simulated position a
  // live one - the latter gets the bigger, DRO-sized digits.
  live?: boolean;
};

// Floats over the top-left of the viewport in the DRO's own look. Shows the
// toolpath's X/Y extents normally and the simulated tool's X/Y/Z while a
// simulation is up, so the real DRO (which keeps showing the machine) is left
// alone. The toolpath only carries X/Y/Z, so the rotary axes aren't shown.
const VisualizerReadout = ({ rows, units, label, live = false }: Props) => (
  <div className={"visualizerReadout" + (live ? " visualizerReadoutLive" : "")} aria-label={label}>
    {rows.map(({ axis, value }) => (
      <div key={axis} className="visualizerReadoutRow">
        <span className="visualizerReadoutAxis">{axis}</span>
        <span className="visualizerReadoutValue">{value}</span>
        <span className="visualizerReadoutUnits">{units}</span>
      </div>
    ))}
  </div>
);

export default VisualizerReadout;
