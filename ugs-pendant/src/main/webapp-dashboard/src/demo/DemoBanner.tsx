import { useState } from "react";
import { Button } from "react-bootstrap";
import "./DemoBanner.scss";

const REPO_URL = "https://github.com/zanymutt/Universal-G-Code-Sender";

// A strip across the top of the online demo saying what it is - a simulated
// machine, nothing sent or saved - so nobody mistakes it for the real thing.
const DemoBanner = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="demoBanner" role="note">
      <span>
        <strong>Live demo</strong> - a simulated machine running entirely in your browser. Edit the G-code, jog, and
        run the job; nothing is sent to hardware or saved, and a reload starts over.
      </span>
      <span className="demoBannerActions">
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Source
        </a>
        <Button size="sm" variant="outline-light" onClick={() => window.location.reload()}>
          Reset demo
        </Button>
        <button type="button" className="demoBannerClose" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          &times;
        </button>
      </span>
    </div>
  );
};

export default DemoBanner;
