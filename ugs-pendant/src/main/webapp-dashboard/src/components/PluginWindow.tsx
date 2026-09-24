import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMinus, faWindowMaximize, faWindowRestore, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useAppSelector } from "../hooks/useAppSelector";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useLayoutRect } from "../hooks/useLayoutRect";
import { PluginInfo, getPluginSettings, savePluginSettings } from "../services/plugins";
import { getFileContent, saveFileContent, saveFileContentAs } from "../services/fileContent";
import {
  getFileStatus,
  getWorkspaceFileList,
  openWorkspaceFile,
  pause as pauseFileSend,
  send as startFileSend,
  stop as stopFileSend,
} from "../services/files";
import { sendGcode } from "../services/machine";
import { acquireLineSubscription, releaseLineSubscription } from "../store/pluginLineSubscription";
import { refreshFileState } from "../store/refreshFileState";
import { getFileName } from "../utils/getFileName";
import { loadPluginWindowSize, PluginWindowSize, savePluginWindowSize } from "../utils/pluginWindowSize";
import { Status } from "../model/Status";
import SaveAsModal from "./SaveAsModal";
import OpenFileModal from "./OpenFileModal";
import "./PluginWindow.scss";

type Props = {
  plugin: PluginInfo;
  initialOffset: { x: number; y: number };
  onClose: () => void;
  onMinimize: () => void;
  minimized: boolean;
  isFront: boolean;
  focusRequest: number;
  onActivate: () => void;
};

type SubscribableEvent = "status" | "line";

// The shape handed to a plugin's getStatus()/'status' event - a flattened,
// FigUI-shaped view of Dashboard's own richer Status model, since a plugin
// author porting a FigUI plugin already expects exactly these field names.
const toPluginStatus = (status: Status) => ({
  state: status.state,
  wpos: status.workCoord,
  mpos: status.machineCoord,
  feed: status.feedSpeed,
  spindle: status.spindleSpeed,
  feedOverride: status.overrides.feed,
  rapidOverride: status.overrides.rapid,
  spindleOverride: status.overrides.spindle,
});

// Every plugin request this bridge currently understands. Deliberately
// throws (rather than silently no-op-ing) for the two FigUI methods that
// don't have a real backend equivalent yet - readFile/writeFile against an
// *arbitrary* workspace path (FilesResource only exposes the currently
// loaded file's content, plus the recursive listing used below) and
// getMachineSettings (FigUI's is a FluidNC-specific "$$" dump; UGS is
// firmware-agnostic and has no equivalent generic settings dump). A plugin
// that calls either gets a rejected promise with a clear reason, not a
// silent failure.
const notImplemented = (method: string): Promise<never> =>
  Promise.reject(new Error(`"${method}" isn't implemented yet`));

// A plugin's in-flight saveGcodeAs() call, waiting on the SaveAsModal it
// triggered - resolve/reject settle the promise the plugin is actually
// awaiting on window.Fluid's side.
type SaveAsRequest = {
  content: string;
  resolve: (result: { path: string }) => void;
  reject: (error: Error) => void;
};

// A plugin's in-flight pickFile() call, waiting on the OpenFileModal it
// triggered in pick mode (browses and returns a path without opening it).
type PickFileRequest = {
  resolve: (result: { path: string }) => void;
  reject: (error: Error) => void;
};

const PluginWindow = ({ plugin, initialOffset, onClose, onMinimize, minimized, isFront, focusRequest, onActivate }: Props) => {
  const dispatch = useAppDispatch();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the existing shell without reloading its iframe or losing plugin state.
    windowRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  const [position, setPosition] = useState(initialOffset);
  // Maximized fills the dashboard's main area (between the top and bottom
  // bars). It's only a style change - the iframe stays mounted, so the plugin
  // keeps its state - and the normal size/position are left untouched to
  // come back to.
  const [maximized, setMaximized] = useState(false);
  const maximizedRef = useRef(false);
  maximizedRef.current = maximized;
  const mainArea = useLayoutRect(".dashboardBody", maximized);
  // The size the person last gave this window (remembered per plugin across
  // launches). A ref, not state: it changes on every frame of a resize drag and
  // nothing needs to re-render for it - it's only read back when the window
  // goes from maximized to normal and needs its size re-applied.
  const sizeRef = useRef<PluginWindowSize | null>(null);
  if (sizeRef.current === null) sizeRef.current = loadPluginWindowSize(plugin.id);
  // Remembers the size after the person resizes the window (the native
  // `resize: both` grip sets it as an inline style - see PluginWindow.scss).
  // The observer also fires for the initial layout and for maximizing, which
  // aren't the person's own size, so those are skipped.
  useEffect(() => {
    const element = windowRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let timer: number | undefined;
    // With nothing remembered, the first observation is just the default size -
    // noted as the baseline to restore to, but not worth persisting.
    let baseline = sizeRef.current === null;
    const observer = new ResizeObserver(() => {
      if (maximizedRef.current || element.offsetWidth === 0) return;
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      const known = sizeRef.current;
      if (known && Math.abs(known.width - size.width) < 1 && Math.abs(known.height - size.height) < 1) return;
      sizeRef.current = size;
      if (baseline) {
        baseline = false;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => savePluginWindowSize(plugin.id, size), 250);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [plugin.id]);
  const [subscribedEvents, setSubscribedEvents] = useState<Set<SubscribableEvent>>(new Set());
  const [saveAsRequest, setSaveAsRequest] = useState<SaveAsRequest | null>(null);
  const [pickFileRequest, setPickFileRequest] = useState<PickFileRequest | null>(null);
  // Reserve synchronously: React state alone leaves a gap before the next render.
  const pickFileRequestRef = useRef<PickFileRequest | null>(null);

  const status = useAppSelector((state) => state.status);
  const consoleMessages = useAppSelector((state) => state.console.messages);
  // Same source GcodeEditor's own Save As uses for its defaultFileName - a
  // plugin calling saveGcodeAs() never supplies a filename itself, so this
  // is the only place that default can come from.
  const currentFileName = useAppSelector((state) => state.fileStatus.fileName);
  const defaultSaveAsName = useMemo(() => getFileName(currentFileName), [currentFileName]);
  // startSend() checks this itself - see that case below - since it doesn't
  // go through JobBar's handleStartClick, the one place this warning
  // normally lives.
  const editorIsDirty = useAppSelector((state) => state.ui.editorIsDirty);

  // Mirrors of Redux state, kept current via a plain ref rather than being
  // read from the closure a request handler was created in - postMessage
  // handlers are registered once (see the effect below) and must always
  // answer with whatever's current at the moment a request actually
  // arrives, not whatever was current when the listener was attached.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Same reasoning as statusRef above, plus one more thing it's needed for:
  // callMethod reads this to tell whether a subscribe/unsubscribe call is an
  // actual membership change or a redundant repeat (so the shared reference
  // count in pluginLineSubscription only moves on real transitions), and the
  // unmount cleanup below reads it to know what to release - a cleanup
  // closure with an empty dependency array would otherwise only ever see
  // subscribedEvents' initial empty-Set value, never what it actually held
  // when the window closed.
  const subscribedEventsRef = useRef(subscribedEvents);
  useEffect(() => {
    subscribedEventsRef.current = subscribedEvents;
  }, [subscribedEvents]);

  const postToPlugin = useCallback((payload: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(payload, "*");
  }, []);

  // --- Drag handling (header bar only) -------------------------------
  // Resizing is deliberately just native CSS `resize: both` on the window
  // element (see PluginWindow.scss) rather than a second hand-rolled drag
  // handler - the browser already does this correctly, including touch
  // support, for free.
  //
  // Uses Pointer Capture (setPointerCapture on the header itself) rather
  // than window-level pointermove/pointerup listeners. Without it, the
  // header sits directly above the plugin's <iframe> - a separate browsing
  // context - and the moment the cursor crosses into it mid-drag, the
  // window's listeners stop receiving events entirely (they get delivered
  // to the iframe's own document instead, or nowhere). Release the button
  // while over the iframe and the window's pointerup never fires, so the
  // drag never actually ends: dragRef stays armed, and the next pointermove
  // anywhere on the page - even one unrelated to dragging - snaps the
  // window to the cursor with no way to let go of it. Pointer Capture
  // redirects all of this pointer's events to the header regardless of
  // what's visually underneath it, iframe included, so the drag behaves
  // exactly like clicking-and-holding any normal element.
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // CSS `resize: both` supplies this affordance on desktop browsers, but the
  // native corner is not reliably hit-testable in an iPad Home Screen web app.
  // Keep the same behavior with an explicit pointer-driven grip so touch and
  // mouse resizing use one path everywhere.
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (maximizedRef.current) return;
    const element = windowRef.current;
    if (!element) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    const element = windowRef.current;
    if (!resize || !element) return;
    const maxWidth = window.innerWidth * 0.96;
    const maxHeight = window.innerHeight * 0.9;
    const width = Math.min(maxWidth, Math.max(220, resize.width + e.clientX - resize.startX));
    const height = Math.min(maxHeight, Math.max(160, resize.height + e.clientY - resize.startY));
    // Keep React's next render from restoring the pre-drag inline size while
    // the pointer is still moving. The final size is persisted on release.
    sizeRef.current = { width, height };
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  };

  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const element = windowRef.current;
    if (element && resizeRef.current) {
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      sizeRef.current = size;
      savePluginWindowSize(plugin.id, size);
    }
    resizeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Not the close button - that has its own onClick and shouldn't also
    // start a drag underneath it.
    if ((e.target as HTMLElement).closest("button")) return;
    if (maximizedRef.current) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: position.x, originY: position.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPosition({
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY),
    });
  };

  const endHeaderDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // --- RPC method table -------------------------------------------------
  const callMethod = useCallback(
    (method: string, params: Record<string, unknown>): Promise<unknown> => {
      switch (method) {
        case "getStatus":
          return Promise.resolve(toPluginStatus(statusRef.current));

        case "subscribe": {
          const event = params.event as SubscribableEvent;
          const alreadySubscribed = subscribedEventsRef.current.has(event);
          setSubscribedEvents((prev) => {
            const next = new Set(prev);
            next.add(event);
            return next;
          });
          if (event === "line" && !alreadySubscribed) acquireLineSubscription(dispatch);
          return Promise.resolve();
        }

        case "unsubscribe": {
          const event = params.event as SubscribableEvent;
          const wasSubscribed = subscribedEventsRef.current.has(event);
          setSubscribedEvents((prev) => {
            const next = new Set(prev);
            next.delete(event);
            return next;
          });
          if (event === "line" && wasSubscribed) releaseLineSubscription(dispatch);
          return Promise.resolve();
        }

        case "sendCommand":
          return sendGcode(params.command as string);

        case "getGcode":
          return getFileContent();

        case "setGcode":
          return saveFileContent(params.content as string);

        case "saveGcodeAs":
          // No filename or path in params - unlike the old raw setGcodeAs,
          // this is the "easy API" a plugin gets instead: it hands over
          // content and the dashboard's own Save As dialog (folder tree,
          // new-folder button, remembered last location, all of it) collects
          // where it actually goes. Resolves/rejects via the SaveAsModal
          // rendered below once the person confirms or cancels.
          return new Promise((resolve, reject) => {
            setSaveAsRequest({ content: params.content as string, resolve, reject });
          });

        case "listFiles":
          // Shaped differently from FigUI's {files:[{name,size,isDir}], total,
          // used} on purpose - UGS has one flat workspace, not FluidNC's
          // separate SD/internal filesystems with usage stats, so there's
          // nothing meaningful to put in a "used/total" pair here. Returns
          // Dashboard's own recursive WorkspaceFileList shape as-is.
          return getWorkspaceFileList();

        case "openFile":
          return openWorkspaceFile(params.path as string);

        case "pickFile":
          // Opens the dashboard's own Open dialog (folder tree, search,
          // everything a person gets from the Open button) but in pick
          // mode - resolves with the chosen path *without* loading it as
          // the active file, unlike openFile(). For a plugin that wants a
          // path to act on later (e.g. queueing several files up front)
          // rather than one to switch to right now.
          //
          // Rejects outright if one's already open rather than replacing the
          // pending request - there's only one pickFileRequest slot, so a
          // second call before the first settles would silently orphan the
          // first plugin call's promise forever (confirmed 2026-09-18: a
          // fast double-call left the first caller waiting with nothing left
          // to ever resolve or reject it).
          if (pickFileRequestRef.current) {
            return Promise.reject(new Error("A file picker is already open for this plugin"));
          }
          return new Promise((resolve, reject) => {
            const request = { resolve, reject };
            pickFileRequestRef.current = request;
            setPickFileRequest(request);
          });

        case "getFileStatus":
          // The one place a plugin can find out *which* file the backend actually has loaded
          // and how far a send has gotten - getStatus()'s flattened status has neither, since
          // that data lives on GUIBackend's own send-progress tracking, not ControllerStatus.
          return getFileStatus();

        case "startSend":
          // Mirrors JobBar's handleStartClick, which this bridges around
          // otherwise: the backend runs whatever's saved on disk, not the
          // editor's live buffer, so a plugin calling this with unsaved
          // editor changes present would silently run stale gcode with no
          // indication anything was wrong (confirmed 2026-09-18).
          if (editorIsDirty) {
            return Promise.reject(
              new Error("The gcode editor has unsaved changes - save or discard them before starting a send")
            );
          }
          return startFileSend();

        case "pauseSend":
          return pauseFileSend();

        case "stopSend":
          return stopFileSend();

        case "readFile":
        case "writeFile":
          return notImplemented(method);

        case "getSettings":
          return getPluginSettings(plugin.id);

        case "saveSettings":
          return savePluginSettings(plugin.id, params.data);

        case "getDeviceInfo":
        case "getMachineSettings":
          return notImplemented(method);

        case "close":
          onClose();
          return Promise.resolve();

        default:
          return Promise.reject(new Error(`Unknown method "${method}"`));
      }
    },
    [dispatch, onClose, plugin.id, editorIsDirty]
  );

  // --- Incoming requests from the plugin --------------------------------
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // Only ever trust messages from this window's own iframe - anything
      // else (another plugin window, a browser extension, whatever) is
      // ignored outright rather than processed as a request.
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== "fluid-request") return;

      const { id, method, params } = data;
      callMethod(method, params ?? {})
        .then((result) => postToPlugin({ type: "fluid-response", id, result }))
        .catch((error) =>
          postToPlugin({ type: "fluid-response", id, error: error instanceof Error ? error.message : String(error) })
        );
    };

    window.addEventListener("message", handleWindowMessage);
    return () => window.removeEventListener("message", handleWindowMessage);
  }, [callMethod, postToPlugin]);

  // --- Outgoing 'status' events ------------------------------------------
  useEffect(() => {
    if (!subscribedEvents.has("status")) return;
    postToPlugin({ type: "fluid-event", event: "status", data: toPluginStatus(status) });
  }, [status, subscribedEvents, postToPlugin]);

  // --- Outgoing 'line' events ---------------------------------------------
  // Only forwards messages that arrived *after* subscribing - the console
  // buffer can already hold hundreds of lines from before this plugin
  // opened, and replaying all of them on subscribe would look like a burst
  // of stale traffic rather than a live feed.
  //
  // Diffs by each message's own id, not array length/position. consoleSlice
  // caps its array at 500 by splicing off the oldest entries once it's full,
  // which pins `consoleMessages.length` at exactly 500 forever after that -
  // a position-based "everything past index N" diff against a length that
  // never changes again returns nothing forevermore, even though the
  // array's actual contents keep rotating. id is assigned once per message
  // by the reducer and never reused or shifted, so it keeps working
  // regardless of how much has been dropped off the front.
  const lastForwardedIdRef = useRef(consoleMessages[consoleMessages.length - 1]?.id ?? 0);
  useEffect(() => {
    const latestId = consoleMessages[consoleMessages.length - 1]?.id ?? lastForwardedIdRef.current;
    if (!subscribedEvents.has("line")) {
      lastForwardedIdRef.current = latestId;
      return;
    }
    const newMessages = consoleMessages.filter((message) => message.id > lastForwardedIdRef.current);
    lastForwardedIdRef.current = latestId;
    newMessages
      .filter((message) => message.type === "verbose")
      .forEach((message) => postToPlugin({ type: "fluid-event", event: "line", data: message.text }));
  }, [consoleMessages, subscribedEvents, postToPlugin]);

  // --- Unsubscribe from 'line' on unmount so the shared reference count
  // doesn't leak a subscriber this window can no longer release itself.
  // Reads subscribedEventsRef, not subscribedEvents directly - this effect
  // only ever runs its setup once (empty deps, so it only fires on mount and
  // unmount), so a closure over the state variable itself would only ever
  // see the initial empty Set from that first render, never whatever the
  // window was actually subscribed to by the time it closed.
  useEffect(() => {
    return () => {
      if (subscribedEventsRef.current.has("line")) releaseLineSubscription(dispatch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
    {saveAsRequest && (
      <SaveAsModal
        defaultFileName={defaultSaveAsName}
        getContent={() => saveAsRequest.content}
        // saveGcodeAs()'s contract is "resolves with a workspace-relative
        // path" - a device save has no such path, and its success path
        // doesn't go through onSaveToWorkspace below (the only place this
        // request actually resolves), so offering it here would report a
        // successful save to the plugin as a cancellation. See SaveAsModal's
        // own comment on this prop.
        allowDeviceSave={false}
        onSaveToWorkspace={(relativePath) =>
          saveFileContentAs(relativePath, saveAsRequest.content).then(() => {
            refreshFileState(dispatch);
            saveAsRequest.resolve({ path: relativePath });
          })
        }
        handleClose={() => {
          // A no-op if onSaveToWorkspace above already resolved this - a
          // settled promise silently ignores a later reject call. Only
          // actually matters for the cancel path, where nothing else does.
          saveAsRequest.reject(new Error("Save cancelled"));
          setSaveAsRequest(null);
        }}
      />
    )}
    {pickFileRequest && (
      <OpenFileModal
        onPick={(path) => {
          pickFileRequest.resolve({ path });
          pickFileRequestRef.current = null;
          setPickFileRequest(null);
        }}
        handleClose={() => {
          // Same no-op-if-already-settled note as SaveAsModal above - only
          // matters for the cancel path here too.
          pickFileRequest.reject(new Error("Pick cancelled"));
          pickFileRequestRef.current = null;
          setPickFileRequest(null);
        }}
      />
    )}
    <div className={"pluginWindow" + (maximized ? " pluginWindowMaximized" : "")} ref={windowRef} tabIndex={-1}
      aria-label={plugin.name}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      // Minimizing hides the window rather than unmounting it: an unmounted
      // iframe reloads from scratch, losing whatever the plugin had entered.
      // visibility (not display:none) so the frame keeps its layout size -
      // a display:none iframe is 0x0, and plugins that size a canvas off
      // their viewport would see a bogus resize on restore.
      style={{
        ...(maximized
          ? mainArea && { left: mainArea.left, top: mainArea.top, width: mainArea.width, height: mainArea.height }
          : { left: position.x, top: position.y, width: sizeRef.current?.width, height: sizeRef.current?.height }),
        zIndex: isFront ? 41 : 40,
        visibility: minimized ? "hidden" : "visible",
      }}>
      <div
        className="pluginWindowHeader"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={endHeaderDrag}
        onPointerCancel={endHeaderDrag}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) setMaximized((value) => !value);
        }}
      >
        {plugin.iconUrl && <img src={plugin.iconUrl} alt="" className="pluginWindowIcon" />}
        <span className="pluginWindowTitle">{plugin.name}</span>
        <button type="button" className="pluginWindowMinimize" onClick={onMinimize} aria-label="Minimize plugin" title="Minimize">
          <FontAwesomeIcon icon={faMinus} />
        </button>
        <button type="button" className="pluginWindowMaximize" onClick={() => setMaximized((value) => !value)}
          aria-label={maximized ? "Restore plugin size" : "Maximize plugin"} title={maximized ? "Restore" : "Maximize"}>
          <FontAwesomeIcon icon={maximized ? faWindowRestore : faWindowMaximize} />
        </button>
        <button type="button" className="pluginWindowClose" onClick={onClose} aria-label="Close plugin" title="Close">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={plugin.entryUrl}
        title={plugin.name}
        className="pluginWindowFrame"
        // No allow-same-origin: even though the plugin is served from this
        // same backend, this keeps it in a unique opaque origin with zero
        // access to the parent page except through postMessage. This is
        // the actual security boundary the whole bridge depends on - not
        // an incidental detail to relax later.
        sandbox="allow-scripts"
      />
      {!maximized && <div
        className="pluginWindowResizeGrip"
        role="separator"
        aria-label="Resize plugin window"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />}
    </div>
    </>
  );
};

export default PluginWindow;
