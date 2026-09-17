import { useAppSelector } from "../hooks/useAppSelector";
import { useNarrowLayout } from "../hooks/useNarrowLayout";
import TopBar from "../components/TopBar";
import DroPanel from "../components/DroPanel";
import FeedSpindleReadout from "../components/FeedSpindleReadout";
import PinsStatus from "../components/PinsStatus";
import JogPad from "../components/JogPad";
import CenterPanel from "../components/CenterPanel";
import RightRail from "../components/RightRail";
import PortraitDashboard from "../components/PortraitDashboard";
import JobBar from "../components/JobBar";
import AlarmModal from "../components/AlarmModal";
import PluginManagerProvider from "../components/PluginManager";
import "./Dashboard.scss";

const Dashboard = () => {
  const status = useAppSelector((state) => state.status);
  // Below this width, the normal 3-column layout has nowhere to put a
  // column's content but a squeezed sliver of its real height - a one-page-
  // at-a-time tabbed layout (see PortraitDashboard) actually fits a tall
  // narrow screen instead of just cramming the wide one into it.
  const isNarrow = useNarrowLayout();

  return (
    // Wraps the whole layout, not just RightRail, since PortraitDashboard
    // (the narrow/mobile branch below) mounts its own copy of RightRail too
    // - both need to reach the same plugin list and open-window state via
    // usePluginManager(), not independent copies of it.
    <PluginManagerProvider>
      <div className="dashboard">
        <TopBar />

        {isNarrow ? (
          <PortraitDashboard />
        ) : (
          <div className="dashboardBody">
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
              <CenterPanel />
            </div>

            <div className="dashboardRight">
              <RightRail />
            </div>
          </div>
        )}

        <JobBar />

        {status.state === "ALARM" && <AlarmModal />}
      </div>
    </PluginManagerProvider>
  );
};

export default Dashboard;
