import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Visualizer3D from "./Visualizer3D";
import GcodeEditor from "./GcodeEditor";
import ConsolePanel from "./ConsolePanel";
import MacroEditor from "./MacroEditor";
import ProbePanel from "./ProbePanel";
import "./CenterPaneLayoutDemo.scss";

type PaneContent = "visualize" | "edit" | "macros" | "probe" | "console";
type Orientation = "horizontal" | "vertical";
type Coordinate = 0 | 1 | 2;
type Rect = { x0: Coordinate; x1: Coordinate; y0: Coordinate; y1: Coordinate };
type SegmentSizes = { xFull: number; xTop: number; xBottom: number; yFull: number; yLeft: number; yRight: number };
type RestoreRecord = { panes: Pane[]; originId: number; spine: Orientation | null };
type Pane = { id: number; content: PaneContent; rect: Rect; restore?: Partial<Record<Orientation, RestoreRecord>> };
type LayoutState = { panes: Pane[]; spine: Orientation | null; sizes: SegmentSizes };

const CONTENT: { value: PaneContent; label: string }[] = [
  { value: "visualize", label: "Visualize" },
  { value: "edit", label: "Edit" },
  { value: "macros", label: "Macros" },
  { value: "probe", label: "Probe" },
  { value: "console", label: "Console" },
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const initialLayout = (): LayoutState => ({
  panes: [
    { id: 1, content: "visualize", rect: { x0: 0, x1: 2, y0: 0, y1: 1 } },
    { id: 2, content: "console", rect: { x0: 0, x1: 2, y0: 1, y1: 2 } },
  ],
  spine: "horizontal",
  sizes: { xFull: 50, xTop: 50, xBottom: 50, yFull: 70, yLeft: 70, yRight: 70 },
});
const area = (rect: Rect) => (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
const inside = (inner: Rect, outer: Rect) => inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
const sameRect = (a: Rect, b: Rect) => a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1;
const opposite = (orientation: Orientation): Orientation => orientation === "horizontal" ? "vertical" : "horizontal";

const mergeTarget = (pane: Pane, orientation: Orientation): Rect => orientation === "vertical"
  ? { ...pane.rect, x0: 0, x1: 2 }
  : { ...pane.rect, y0: 0, y1: 2 };

const mergeGroup = (panes: Pane[], pane: Pane, orientation: Orientation): Pane[] => {
  const target = mergeTarget(pane, orientation);
  if (sameRect(target, pane.rect)) return [];
  const group = panes.filter(candidate => inside(candidate.rect, target));
  return group.length > 1 && group.reduce((sum, candidate) => sum + area(candidate.rect), 0) === area(target) ? group : [];
};

const nextContent = (panes: Pane[], current: PaneContent): PaneContent => {
  const used = new Set(panes.map(pane => pane.content));
  return CONTENT.find(item => item.value !== current && !used.has(item.value))?.value ?? "console";
};

const uniqueIntervals = (intervals: [number, number][]) => Array.from(
  new Map(intervals.map(interval => [`${interval[0]}-${interval[1]}`, interval])).values(),
);

const mergeIntervals = (intervals: [number, number][]) => {
  const sorted = uniqueIntervals(intervals).sort((a, b) => a[0] - b[0]);
  const result: [number, number][] = [];
  for (const interval of sorted) {
    const last = result[result.length - 1];
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else result.push([...interval]);
  }
  return result;
};

const verticalSize = (state: LayoutState, y0: number, y1: number) => state.spine === "horizontal"
  ? (y0 === 0 && y1 === 1 ? state.sizes.xTop : y0 === 1 && y1 === 2 ? state.sizes.xBottom : state.sizes.xFull)
  : state.sizes.xFull;
const horizontalSize = (state: LayoutState, x0: number, x1: number) => state.spine === "vertical"
  ? (x0 === 0 && x1 === 1 ? state.sizes.yLeft : x0 === 1 && x1 === 2 ? state.sizes.yRight : state.sizes.yFull)
  : state.sizes.yFull;

type PaneHeaderProps = {
  content: PaneContent;
  onChange: (content: PaneContent) => void;
  splitButtons: ReactNode;
};

const PaneHeader = ({ content, onChange, splitButtons }: PaneHeaderProps) => {
  const headerRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const measure = measureRef.current;
    const controls = controlsRef.current;
    if (!header || !measure || !controls) return;
    const update = () => setCompact(header.clientWidth < measure.scrollWidth + controls.offsetWidth + 10);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    observer.observe(measure);
    return () => observer.disconnect();
  }, []);

  return <header className="centerPaneLayoutLeafHeader" ref={headerRef}>
    <div className="centerPaneLayoutTabsMeasure" ref={measureRef} aria-hidden="true">
      {CONTENT.map(item => <span key={item.value}>{item.label}</span>)}
    </div>
    {compact ? <select className="centerPaneLayoutContentSelect" value={content}
      onChange={event => onChange(event.target.value as PaneContent)} aria-label="Pane content">
      {CONTENT.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select> : <nav className="centerPaneLayoutTabs" aria-label="Pane content">
      {CONTENT.map(item => <button type="button" key={item.value} className={item.value === content ? "active" : ""}
        onClick={() => onChange(item.value)}>{item.label}</button>)}
    </nav>}
    <div className="centerPaneLayoutSplitControls" ref={controlsRef}>{splitButtons}</div>
  </header>;
};

const CenterPaneLayoutDemo = () => {
  const [layout, setLayout] = useState<LayoutState>(() => initialLayout());
  const nextId = useRef(3);
  const consoleRestore = useRef<{ id: number; content: PaneContent } | null>(null);
  const { panes } = layout;

  const toggleSplit = (id: number, orientation: Orientation) => setLayout(current => {
    const next = clone(current);
    const pane = next.panes.find(item => item.id === id);
    if (!pane) return current;

    const group = mergeGroup(next.panes, pane, orientation);
    if (group.length) {
      const target = mergeTarget(pane, orientation);
      const merged: Pane = {
        id: pane.id,
        content: pane.content,
        rect: target,
        restore: { [orientation]: { panes: clone(group), originId: pane.id, spine: next.spine } },
      };
      const remaining = next.panes.filter(candidate => !group.some(groupPane => groupPane.id === candidate.id));
      const resultPanes = [...remaining, merged];
      const resultSizes = clone(next.sizes);
      if (resultPanes.length === 1) {
        return { panes: resultPanes, spine: null, sizes: resultSizes };
      }

      const resultSpine = opposite(orientation);
      if (next.spine === resultSpine) {
        // Removing one perpendicular segment must not move the segment that
        // remains visible. Forget the hidden segment's old size by aligning
        // it to the visible one for any later reopen.
        if (resultSpine === "horizontal") {
          if (pane.rect.y0 === 0) resultSizes.xTop = next.sizes.xBottom;
          else resultSizes.xBottom = next.sizes.xTop;
        } else {
          if (pane.rect.x0 === 0) resultSizes.yLeft = next.sizes.yRight;
          else resultSizes.yRight = next.sizes.yLeft;
        }
      } else if (orientation === "horizontal") {
        resultSizes.xFull = verticalSize(next, pane.rect.y0, pane.rect.y1);
        resultSizes.xTop = resultSizes.xFull;
        resultSizes.xBottom = resultSizes.xFull;
        resultSizes.yLeft = next.sizes.yFull;
        resultSizes.yRight = next.sizes.yFull;
      } else {
        resultSizes.yFull = horizontalSize(next, pane.rect.x0, pane.rect.x1);
        resultSizes.yLeft = resultSizes.yFull;
        resultSizes.yRight = resultSizes.yFull;
        resultSizes.xTop = next.sizes.xFull;
        resultSizes.xBottom = next.sizes.xFull;
      }
      return { panes: resultPanes, spine: resultSpine, sizes: resultSizes };
    }

    if (next.panes.length >= 4) return current;
    const remembered = pane.restore?.[orientation];
    if (remembered) {
      const restored = clone(remembered.panes);
      const origin = restored.find(item => item.id === remembered.originId) ?? restored[0];
      const previousOriginContent = origin.content;
      const duplicate = restored.find(item => item.id !== origin.id && item.content === pane.content);
      if (duplicate) duplicate.content = previousOriginContent;
      origin.content = pane.content;
      const restoredSizes = clone(next.sizes);
      // Reopening uses the geometry that is currently visible. Old hidden
      // percentages do not reappear unexpectedly; named presets can restore
      // exact sizes later.
      if (remembered.spine === "horizontal") {
        const visibleX = next.spine === "horizontal"
          ? (pane.rect.y0 === 0 ? restoredSizes.xBottom : restoredSizes.xTop)
          : restoredSizes.xFull;
        restoredSizes.xTop = visibleX;
        restoredSizes.xBottom = visibleX;
      } else if (remembered.spine === "vertical") {
        const visibleY = next.spine === "vertical"
          ? (pane.rect.x0 === 0 ? restoredSizes.yRight : restoredSizes.yLeft)
          : restoredSizes.yFull;
        restoredSizes.yLeft = visibleY;
        restoredSizes.yRight = visibleY;
      }
      return {
        panes: [...next.panes.filter(item => item.id !== pane.id), ...restored],
        spine: remembered.spine,
        sizes: restoredSizes,
      };
    }

    const canDivide = orientation === "vertical" ? pane.rect.x1 - pane.rect.x0 === 2 : pane.rect.y1 - pane.rect.y0 === 2;
    if (!canDivide) return current;
    const first: Pane = { id: pane.id, content: pane.content, rect: clone(pane.rect) };
    const second: Pane = { id: nextId.current++, content: nextContent(next.panes, pane.content), rect: clone(pane.rect) };
    if (orientation === "vertical") {
      first.rect.x1 = 1;
      second.rect.x0 = 1;
    } else {
      first.rect.y1 = 1;
      second.rect.y0 = 1;
    }
    return {
      ...next,
      panes: [...next.panes.filter(item => item.id !== pane.id), first, second],
      spine: next.spine ?? orientation,
    };
  });

  const changeContent = (id: number, content: PaneContent) => setLayout(current => {
    const next = clone(current);
    const target = next.panes.find(pane => pane.id === id);
    if (!target || target.content === content) return current;
    const other = next.panes.find(pane => pane.id !== id && pane.content === content);
    if (other) other.content = target.content;
    target.content = content;
    return next;
  });

  useEffect(() => {
    const onConsoleShortcut = (event: Event) => {
      const show = (event as CustomEvent<{ show?: boolean }>).detail?.show !== false;
      setLayout(current => {
        const next = clone(current);
        const consolePane = next.panes.find(pane => pane.content === "console");
        if (show) {
          if (consolePane) return next;
          const target = next.panes[0];
          consoleRestore.current = { id: target.id, content: target.content };
          target.content = "console";
          return next;
        }
        if (!consolePane) return next;
        const restore = consoleRestore.current;
        const target = restore && next.panes.find(pane => pane.id === restore.id);
        if (target && !next.panes.some(pane => pane.id !== target.id && pane.content === restore.content)) target.content = restore.content;
        consoleRestore.current = null;
        return next;
      });
    };
    window.addEventListener("ugs-layout-demo-console", onConsoleShortcut);
    return () => window.removeEventListener("ugs-layout-demo-console", onConsoleShortcut);
  }, []);

  const dividerSegments = useMemo(() => {
    const vertical: [number, number][] = [];
    const horizontal: [number, number][] = [];
    for (const first of panes) for (const second of panes) {
      if (first.rect.x1 === 1 && second.rect.x0 === 1) {
        const start = Math.max(first.rect.y0, second.rect.y0);
        const end = Math.min(first.rect.y1, second.rect.y1);
        if (start < end) vertical.push([start, end]);
      }
      if (first.rect.y1 === 1 && second.rect.y0 === 1) {
        const start = Math.max(first.rect.x0, second.rect.x0);
        const end = Math.min(first.rect.x1, second.rect.x1);
        if (start < end) horizontal.push([start, end]);
      }
    }
    return {
      vertical: layout.spine === "vertical" ? mergeIntervals(vertical) : uniqueIntervals(vertical),
      horizontal: layout.spine === "horizontal" ? mergeIntervals(horizontal) : uniqueIntervals(horizontal),
    };
  }, [layout.spine, panes]);

  const paneStyle = (rect: Rect): CSSProperties => {
    const x = verticalSize(layout, rect.y0, rect.y1);
    const y = horizontalSize(layout, rect.x0, rect.x1);
    return {
      left: rect.x0 === 0 ? 0 : `calc(${x}% + 1px)`,
      right: rect.x1 === 2 ? 0 : `calc(${100 - x}% + 1px)`,
      top: rect.y0 === 0 ? 0 : `calc(${y}% + 1px)`,
      bottom: rect.y1 === 2 ? 0 : `calc(${100 - y}% + 1px)`,
    };
  };

  const canOpen = (pane: Pane, orientation: Orientation) => panes.length < 4 && (orientation === "vertical"
    ? pane.rect.x1 - pane.rect.x0 === 2
    : pane.rect.y1 - pane.rect.y0 === 2);

  const renderContent = (content: PaneContent) => {
    switch (content) {
      case "visualize": return <Visualizer3D />;
      case "edit": return <GcodeEditor />;
      case "console": return <ConsolePanel />;
      case "macros": return <MacroEditor compact />;
      case "probe": return <ProbePanel compact />;
    }
  };

  const renderSplitButton = (pane: Pane, orientation: Orientation) => {
    const active = mergeGroup(panes, pane, orientation).length > 0;
    const enabled = active || canOpen(pane, orientation) || !!pane.restore?.[orientation];
    const description = orientation === "vertical" ? "vertical split (left and right)" : "horizontal split (top and bottom)";
    return <button type="button" className={`centerPaneLayoutSplitButton ${orientation} ${active ? "active" : ""}`}
      onClick={() => toggleSplit(pane.id, orientation)} disabled={!enabled} aria-pressed={active}
      aria-label={`${active ? "Close" : "Open"} ${description}`} title={`${active ? "Close" : "Open"} ${description}`}>
      <span className="centerPaneLayoutSplitIcon" aria-hidden="true" />
    </button>;
  };

  const boundaryPosition = (value: Coordinate, orientation: Orientation, start: number, end: number) => {
    if (value === 0) return "0";
    if (value === 2) return "100%";
    return `${orientation === "vertical" ? verticalSize(layout, start, end) : horizontalSize(layout, start, end)}%`;
  };

  const resize = (orientation: Orientation, start: number, end: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    const raw = orientation === "vertical"
      ? ((event.clientX - bounds.left) / bounds.width) * 100
      : ((event.clientY - bounds.top) / bounds.height) * 100;
    const percent = Math.max(20, Math.min(80, raw));
    setLayout(current => {
      const next = clone(current);
      if (orientation === "vertical") {
        const key = current.spine === "horizontal" && start === 0 && end === 1 ? "xTop"
          : current.spine === "horizontal" && start === 1 && end === 2 ? "xBottom" : "xFull";
        next.sizes[key] = percent;
      } else {
        const key = current.spine === "vertical" && start === 0 && end === 1 ? "yLeft"
          : current.spine === "vertical" && start === 1 && end === 2 ? "yRight" : "yFull";
        next.sizes[key] = percent;
      }
      return next;
    });
  };

  return <div className="centerPaneLayoutDemo">
    {panes.map(pane => <section className="centerPaneLayoutLeaf" style={paneStyle(pane.rect)}
      data-layout-rect={`${pane.rect.x0}${pane.rect.x1}${pane.rect.y0}${pane.rect.y1}`} key={pane.id}>
      <PaneHeader content={pane.content} onChange={content => changeContent(pane.id, content)} splitButtons={<>
          {renderSplitButton(pane, "horizontal")}
          {renderSplitButton(pane, "vertical")}
        </>} />
      <div className="centerPaneLayoutLeafBody">{renderContent(pane.content)}</div>
    </section>)}

    {dividerSegments.vertical.map(([start, end]) => <div key={`v-${start}-${end}`} className="centerPaneLayoutResizer vertical"
      data-divider={`vertical-${start}-${end}`}
      style={{ left: `${verticalSize(layout, start, end)}%`, top: boundaryPosition(start as Coordinate, "horizontal", 0, 2), bottom: `calc(100% - ${boundaryPosition(end as Coordinate, "horizontal", 0, 2)})` }}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={event => resize("vertical", start, end, event)} title="Drag to resize panes" />)}
    {dividerSegments.horizontal.map(([start, end]) => <div key={`h-${start}-${end}`} className="centerPaneLayoutResizer horizontal"
      data-divider={`horizontal-${start}-${end}`}
      style={{ top: `${horizontalSize(layout, start, end)}%`, left: boundaryPosition(start as Coordinate, "vertical", 0, 2), right: `calc(100% - ${boundaryPosition(end as Coordinate, "vertical", 0, 2)})` }}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={event => resize("horizontal", start, end, event)} title="Drag to resize panes" />)}
  </div>;
};

export default CenterPaneLayoutDemo;
