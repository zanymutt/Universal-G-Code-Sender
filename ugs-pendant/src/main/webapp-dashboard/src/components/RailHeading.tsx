import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCaretRight } from "@fortawesome/free-solid-svg-icons";

type Props = {
  // The section id: the body this controls has id `rail-section-<id>`.
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
};

// A right-rail section heading that folds its section. Still an h6 with the
// rail's heading style, so a section looks the same as before until it is
// folded.
const RailHeading = ({ id, title, collapsed, onToggle }: Props) => (
  <h6 className="rightRailHeading rightRailHeadingFold">
    <button
      type="button"
      className="rightRailFold"
      aria-expanded={!collapsed}
      aria-controls={`rail-section-${id}`}
      title={collapsed ? `Show ${title}` : `Hide ${title}`}
      onClick={onToggle}
    >
      <FontAwesomeIcon icon={collapsed ? faCaretRight : faCaretDown} className="rightRailFoldIcon" />
      {title}
    </button>
  </h6>
);

export default RailHeading;
