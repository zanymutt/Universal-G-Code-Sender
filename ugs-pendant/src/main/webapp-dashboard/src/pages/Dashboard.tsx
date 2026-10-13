import { useAppSelector } from "../hooks/useAppSelector";
import { useState } from "react";
import TopBar from "../components/TopBar";
import DroPanel from "../components/DroPanel";
import FeedSpindleReadout from "../components/FeedSpindleReadout";
import PinsStatus from "../components/PinsStatus";
import JogPad from "../components/JogPad";
import CenterPaneLayout from "../components/CenterPaneLayoutDemo";
import RightRail from "../components/RightRail";
import JobBar from "../components/JobBar";
import AlarmModal from "../components/AlarmModal";
import PluginManagerProvider from "../components/PluginManager";
import DemoBanner from "../demo/DemoBanner";
import { isDemo } from "../demo/isDemo";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useGamepadShortcuts } from "../hooks/useGamepadShortcuts";
import "./Dashboard.scss";
import "./TabletDashboard.scss";
import SettingsPage from "./SettingsPage";

const Dashboard = () => {
  const status = useAppSelector((state) => state.status);
  const activePage = useAppSelector((state) => state.ui.activePage);
  // Keep the panels mounted across responsive layout changes.
  const [panel, setPanel] = useState("program");
  useKeyboardShortcuts();
  useGamepadShortcuts();

  return (
    <PluginManagerProvider>
      <div className="dashboard" data-panel={panel}>
        {isDemo && <DemoBanner />}
        <TopBar />
        {activePage === "settings" && <SettingsPage />}
        {/* display:contents when visible - this wrapper takes no part in the
            flex layout below it, so it doesn't need any of its own sizing
            rules to pass sibling layout through untouched. Kept mounted
            (not conditionally rendered) so switching to Settings and back
            doesn't unmount the panes/RightRail - that would reset their
            own local state (the pane layout, its splits/sizes, which pane
            is maximized) back to defaults every time. */}
        <div className="dashboardMain" style={{ display: activePage === "settings" ? "none" : "contents" }}>
        <div className="tabletReadout" aria-label="Current work position">
          {(["x", "y", "z"] as const).map(axis => <span key={axis}>{axis.toUpperCase()} <strong>{Number(status.workCoord?.[axis] ?? 0).toFixed(3)}</strong></span>)}
          <span>{status.workCoord?.units === "INCH" ? "in" : "mm"}</span>
        </div>
          <div className="dashboardBody">
            {/* Panel switcher for the tablet and tabbed layouts (hidden on
                desktop). Inside the body, as its first item, so on a tablet it
                sits above the position readout in the left column and the
                workspace beside it runs all the way up to the top bar; in the
                tabbed layout it is still the first row. */}
            <nav className="tabletNavigation" aria-label="Dashboard panels">
              <button className="tabletPositionTab" aria-pressed={panel === "position"} onClick={() => setPanel("position")}>Position / Jog</button>
              <button aria-pressed={panel === "program"} onClick={() => setPanel("program")}>Program</button>
              <button aria-pressed={panel === "machine"} onClick={() => setPanel("machine")}>Machine / Macros</button>
            </nav>
            <div className="dashboardLeft">
              <DroPanel />
              <FeedSpindleReadout />
              <PinsStatus />

              <div className="dashboardLeftJog">
                <h6 className="dashboardSectionHeading">Jog</h6>
                <JogPad />
              </div>
            </div>

            <div className="dashboardCenter">
              <CenterPaneLayout />
            </div>

            <div className="dashboardRight">
              <RightRail />
            </div>
          </div>

        <JobBar />

        {status.state === "ALARM" && <AlarmModal />}
        </div>
      </div>
    </PluginManagerProvider>
  );
};

export default Dashboard;
