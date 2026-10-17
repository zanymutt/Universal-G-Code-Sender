// Things in a G-code program that a person at the machine would notice or have
// to act on, and that the toolpath simulation should surface while it plays:
// operator messages "(MSG, ...)", program stops (M0), optional stops (M1) and
// tool changes. Pure, so it is unit-tested in node (tests/programEvents.test.cjs).

import type { ToolChange } from "./toolTable";

export type ProgramEventKind =
  // Shown for a few seconds as the simulation passes; never stops it.
  | "message"
  // The machine would stop and wait (M0, or a tool change); the simulation can pause.
  | "stop";

export type ProgramEvent = {
  // The file line (1-based) the event is on; it takes effect before any
  // motion on a later line.
  line: number;
  kind: ProgramEventKind;
  text: string;
};

// A message this close above an M0 is that stop's explanation ("(MSG, change
// the bit)" then "M0"), so the two are shown as one stop.
const MESSAGE_REACH = 3;

const stripComments = (line: string) => {
  const comments: string[] = [];
  let code = line.replace(/\(([^)]*)\)?/g, (_match, text: string) => {
    comments.push(text.trim());
    return " ";
  });
  const semicolon = code.indexOf(";");
  if (semicolon >= 0) {
    const text = code.slice(semicolon + 1).trim();
    if (text) comments.push(text);
    code = code.slice(0, semicolon);
  }
  return { code: code.toUpperCase(), comments };
};

const MESSAGE_COMMENT = /^(?:MSG|PRINT)\s*,\s*(.*)$/i;

export const scanProgramEvents = (text: string): ProgramEvent[] => {
  const events: ProgramEvent[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const { code, comments } = stripComments(raw);

    const messages: string[] = [];
    const plain: string[] = [];
    for (const comment of comments) {
      const match = MESSAGE_COMMENT.exec(comment);
      if (match) {
        if (match[1].trim()) messages.push(match[1].trim());
      } else if (comment) {
        plain.push(comment);
      }
    }

    // Order within a line: its message first, then the stop it belongs to.
    for (const message of messages) events.push({ line, kind: "message", text: message });

    if (/\bM0{1,2}(?!\d)/.test(code)) {
      // Why the machine stops: a comment on the same line, else a message just above.
      let reason = messages.length > 0 ? messages[messages.length - 1] : plain.join(" ");
      if (messages.length > 0) {
        // The line's own message has become the stop's reason.
        events.splice(events.length - messages.length, messages.length);
      } else {
        const above = [...events].reverse().find((e) => e.kind === "message" && line - e.line <= MESSAGE_REACH);
        if (above) {
          if (!reason) reason = above.text;
          events.splice(events.indexOf(above), 1);
        }
      }
      events.push({ line, kind: "stop", text: reason ? `Program stop (M0): ${reason}` : "Program stop (M0)" });
    } else if (/\bM0?1(?!\d)/.test(code)) {
      const why = plain.join(" ");
      events.push({ line, kind: "message", text: why ? `Optional stop (M1): ${why}` : "Optional stop (M1)" });
    }
  });
  return events;
};

// A tool change is a stop too: the machine waits for the new tool. `describe`
// supplies the tool's description for the text ("T2 (Ball nose 3 mm)").
export const toolChangeEvents = (changes: ToolChange[], describe: (tool: number) => string): ProgramEvent[] =>
  changes.map((change) => ({ line: change.line, kind: "stop", text: `Tool change: ${describe(change.tool)}` }));

// The two lists as one, in file order (stable for events on the same line).
export const mergeProgramEvents = (...lists: ProgramEvent[][]): ProgramEvent[] =>
  lists
    .flat()
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.line - b.event.line || a.order - b.order)
    .map((entry) => entry.event);
