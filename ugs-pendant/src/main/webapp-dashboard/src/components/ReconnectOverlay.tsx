import { useEffect, useState } from "react";
import { Button, Spinner } from "react-bootstrap";
import { formatOutage } from "../utils/reconnect";
import "./ReconnectOverlay.scss";

type Props = {
  onRetry: () => void;
};

// Covers the dashboard while the link to UGS is down. The dashboard behind it
// stays mounted (and inert - see App.tsx) so nothing about it is lost; this
// only says so, and keeps retrying in the background. It mounts when the link
// drops, so its own clock is the outage length.
const ReconnectOverlay = ({ onRetry }: Props) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds((Date.now() - started) / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="reconnectOverlay" role="alertdialog" aria-modal="true" aria-labelledby="reconnect-title">
      <div className="reconnectCard">
        <h2 id="reconnect-title">
          <Spinner animation="border" size="sm" variant="primary" /> Reconnecting to UGS…
        </h2>
        <p>
          The dashboard lost its link to UGS (it may have been closed or restarted, or the network dropped). It keeps
          trying automatically and will pick up where it left off.
        </p>
        <p className="reconnectKept">Your pane layout and open plugin windows are kept.</p>
        <p className="reconnectCaveat">
          Unsaved editor text is kept too, as long as UGS still has the same file loaded when it comes back. If UGS
          was restarted it starts with no file loaded, and unsaved changes can't be kept.
        </p>
        <div className="reconnectFooter">
          <span className="reconnectElapsed">Disconnected for {formatOutage(seconds)}</span>
          <Button size="sm" variant="primary" onClick={onRetry}>
            Retry now
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ReconnectOverlay;
