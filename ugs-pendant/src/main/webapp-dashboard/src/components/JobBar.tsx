import {
  faFile,
  faPause,
  faPlay,
  faStop,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, ProgressBar } from "react-bootstrap";
import { useAppSelector } from "../hooks/useAppSelector";
import { useEffect, useState } from "react";
import { fetchFileStatus } from "../store/fileStatusSlice";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { closeFile, pause, runFromLine, send, stop } from "../services/files";
import { saveEditorContent } from "../services/editorSaveBridge";
import { uiActions } from "../store/uiSlice";
import OpenFileModal from "./OpenFileModal";
import ConfirmDialog from "./ConfirmDialog";
import "./JobBar.scss";

const getProgressVariant = (state: string) => {
  if (state === "HOLD") return "warning";
  if (state === "RUN" || state === "CHECK") return "success";
  return "secondary";
};

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  return (
    String(Math.floor(totalSeconds / 3600)).padStart(2, "0") +
    ":" +
    String(Math.floor((totalSeconds / 60) % 60)).padStart(2, "0") +
    ":" +
    String(totalSeconds % 60).padStart(2, "0")
  );
};

const getFileName = (filePath: string) => {
  if (filePath === "") return "No file loaded";
  return filePath.replace(/^.*[\\/]/, "");
};

const JobBar = () => {
  const dispatch = useAppDispatch();
  const fileStatus = useAppSelector((state) => state.fileStatus);
  const status = useAppSelector((state) => state.status);
  const armedRunFromLine = useAppSelector((state) => state.ui.runFromLine);
  const editorIsDirty = useAppSelector((state) => state.ui.editorIsDirty);
  const [showOpenFile, setShowOpenFile] = useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [isSavingBeforeRun, setIsSavingBeforeRun] = useState(false);
  const [unsavedSaveError, setUnsavedSaveError] = useState<string | null>(null);

  const resetRunFromLine = () => {
    runFromLine(0).then(() => dispatch(uiActions.setRunFromLine(0)));
  };

  // The backend runs whatever's saved on disk, not the editor's live buffer
  // (confirmed: running with unsaved edits silently ran the stale, on-disk
  // version) - Start warns instead, rather than either silently running
  // stale gcode or silently saving on the user's behalf.
  const handleStartClick = () => {
    if (editorIsDirty) {
      setUnsavedSaveError(null);
      setShowUnsavedConfirm(true);
    } else {
      send();
    }
  };

  const handleSaveOnly = () => {
    setIsSavingBeforeRun(true);
    saveEditorContent()
      .then(() => setShowUnsavedConfirm(false))
      .catch(() => setUnsavedSaveError("Couldn't save the file."))
      .finally(() => setIsSavingBeforeRun(false));
  };

  const handleSaveAndRun = () => {
    setIsSavingBeforeRun(true);
    saveEditorContent()
      .then(() => {
        setShowUnsavedConfirm(false);
        send();
      })
      .catch(() => setUnsavedSaveError("Couldn't save the file."))
      .finally(() => setIsSavingBeforeRun(false));
  };

  useEffect(() => {
    dispatch(fetchFileStatus());
  }, [dispatch]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (status.state === "RUN") {
        dispatch(fetchFileStatus());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status.state, dispatch]);

  const isRunning =
    status.state === "RUN" || status.state === "HOLD" || status.state === "CHECK";
  // Jogging is also something you need to be able to abort - the backend already
  // handles this correctly (sends GRBL's real-time jog-cancel byte instead of a
  // full reset when it sees state JOG), this button just wasn't enabled for it.
  const isStoppable = isRunning || status.state === "JOG";

  return (
    <div className="jobBar">
      {showOpenFile && <OpenFileModal handleClose={() => setShowOpenFile(false)} />}

      <ConfirmDialog
        show={showUnsavedConfirm}
        title="Unsaved changes"
        message={
          "The gcode editor has unsaved changes - running now would send the version still saved on " +
          "disk, not what's currently in the editor." +
          (unsavedSaveError ? `\n\n${unsavedSaveError}` : "")
        }
        onCancel={() => setShowUnsavedConfirm(false)}
        cancelVariant="danger"
        secondaryLabel="Save"
        secondaryVariant="primary"
        onSecondary={handleSaveOnly}
        confirmLabel="Save and run"
        confirmVariant="primary"
        onConfirm={handleSaveAndRun}
        actionsDisabled={isSavingBeforeRun}
      />

      <div className="jobFile">{getFileName(fileStatus.fileName)}</div>

      {fileStatus.fileName !== "" && (
        <div className="jobProgress">
          <ProgressBar
            now={fileStatus.completedRowCount}
            min={0}
            max={fileStatus.rowCount || 1}
            variant={getProgressVariant(status.state)}
            animated={status.state === "RUN"}
            label={`${fileStatus.completedRowCount} / ${fileStatus.rowCount}`}
          />
          <div className="jobSendStatus">
            <span className="jobSendStatusLabel">Send status:</span>
            <span>{status.state}</span>
            <span>{fileStatus.completedRowCount}/{fileStatus.rowCount} lines</span>
            <span>{fileStatus.remainingRowCount} remaining</span>
            <span>elapsed {formatTime(fileStatus.sendDuration)}</span>
            <span>{formatTime(fileStatus.sendRemainingDuration)} left</span>
            {armedRunFromLine > 0 && (
              <span className="jobRunFromArmed">
                Will run from line {armedRunFromLine}
                <button type="button" className="jobRunFromReset" onClick={resetRunFromLine}>
                  Reset
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* All four always render (only `disabled` changes) so the bar's width/height
          never jumps around as the machine moves between states - e.g. a jog
          briefly puts the controller in "JOG", which used to hide every button here
          at once and made the whole bar visibly resize. */}
      <div className="jobActions">
        <Button variant="secondary" disabled={isRunning} onClick={() => setShowOpenFile(true)}>
          <FontAwesomeIcon icon={faFile} /> Open
        </Button>
        <Button
          variant="secondary"
          disabled={fileStatus.fileName === "" || isRunning}
          onClick={() => closeFile()}
        >
          <FontAwesomeIcon icon={faXmark} /> Close
        </Button>
        <Button
          variant="success"
          disabled={fileStatus.fileName === "" || (status.state !== "IDLE" && status.state !== "HOLD")}
          onClick={handleStartClick}
        >
          <FontAwesomeIcon icon={faPlay} /> Start
        </Button>
        <Button
          variant="warning"
          disabled={status.state !== "RUN" && status.state !== "CHECK"}
          onClick={() => pause()}
        >
          <FontAwesomeIcon icon={faPause} /> Pause
        </Button>
        <Button variant="danger" disabled={!isStoppable} onClick={() => stop()}>
          <FontAwesomeIcon icon={faStop} /> Stop
        </Button>
      </div>
    </div>
  );
};

export default JobBar;
