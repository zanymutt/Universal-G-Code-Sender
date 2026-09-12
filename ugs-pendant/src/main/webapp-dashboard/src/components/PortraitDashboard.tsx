import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCrosshairs, faFileCode, faSliders } from "@fortawesome/free-solid-svg-icons";
import DroPanel from "./DroPanel";
import FeedSpindleReadout from "./FeedSpindleReadout";
import PinsStatus from "./PinsStatus";
import JogPad from "./JogPad";
import CenterPanel from "./CenterPanel";
import RightRail from "./RightRail";
import "./PortraitDashboard.scss";

type PortraitTab = "position" | "program" | "machine";

const TABS: { key: PortraitTab; label: string; icon: typeof faCrosshairs }[] = [
  { key: "position", label: "Position", icon: faCrosshairs },
  { key: "program", label: "Program", icon: faFileCode },
  { key: "machine", label: "Machine", icon: faSliders },
];

// Stacking the normal landscape layout's three columns full-height, one
// under another, just trades a cramped width for a cramped height on a
// tall narrow screen (confirmed on an iPad-portrait-sized viewport: the
// position/jog column was squeezed down to an ~80px sliver so the other two
// full-height columns could fit below it). A phone/tablet-style tab bar -
// one page visible at a time, each given the full height - is the layout
// that actually works for this shape of screen, not a smaller version of
// the wide one.
//
// All three pages stay mounted always (via [hidden], not by only rendering
// the active one) - CenterPanel's own internal tabs already do the same for
// the same reason (see its comment): switching away from Program shouldn't
// lose the editor's cursor position or the visualizer's camera angle any
// more than switching tabs in landscape mode does today.
const PortraitDashboard = () => {
  const [tab, setTab] = useState<PortraitTab>("program");

  return (
    <div className="portraitDashboard">
      <div className="portraitDashboardPage portraitDashboardPosition" hidden={tab !== "position"}>
        <DroPanel />
        <FeedSpindleReadout />
        <PinsStatus />
        <div className="portraitDashboardJog">
          <h6 className="dashboardSectionHeading">Jog</h6>
          <JogPad />
        </div>
      </div>

      <div className="portraitDashboardPage" hidden={tab !== "program"}>
        <CenterPanel />
      </div>

      <div className="portraitDashboardPage" hidden={tab !== "machine"}>
        <RightRail />
      </div>

      <div className="portraitTabBar">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            className={"portraitTabBarButton" + (tab === key ? " active" : "")}
            onClick={() => setTab(key)}
          >
            <FontAwesomeIcon icon={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PortraitDashboard;
