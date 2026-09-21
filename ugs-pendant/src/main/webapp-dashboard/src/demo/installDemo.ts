import { DemoRequest, handleRequest, initDemoMachine, subscribe, verboseLine } from "./demoMachine";

const API_PREFIX = "/api/v1/";
const EVENTS_PATH = "/ws/v1/events";
const VERBOSE_MS = 300;

// Just enough of the browser WebSocket for the dashboard's Socket wrapper and
// socketMiddleware: open/message events, send() for the "ping"/"verbose:on"
// text frames, close(), and the readyState constants. It talks to the
// simulated machine in-process instead of a network.
class DemoSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 0;
  url: string;
  private unsubscribe: (() => void) | undefined;
  private verboseTimer: number | undefined;

  constructor(url: string) {
    super();
    this.url = url;
    window.setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      this.unsubscribe = subscribe((message) => this.deliver(message));
    }, 0);
  }

  private deliver(message: unknown) {
    if (this.readyState !== 1) return;
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  send(data: unknown) {
    if (this.readyState !== 1 || typeof data !== "string") return;
    if (data === "ping") {
      this.deliver({ eventType: "Pong" });
    } else if (data === "verbose:on") {
      window.clearInterval(this.verboseTimer);
      this.verboseTimer = window.setInterval(
        () => this.deliver({ eventType: "ConsoleMessageEvent", event: { message: verboseLine() } }),
        VERBOSE_MS
      );
    } else if (data === "verbose:off") {
      window.clearInterval(this.verboseTimer);
      this.verboseTimer = undefined;
    }
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    window.clearInterval(this.verboseTimer);
    this.unsubscribe?.();
    this.dispatchEvent(new Event("close"));
  }
}

const asDemoBody = (body: BodyInit | null | undefined): string | FormData | null => {
  if (typeof body === "string") return body;
  if (body instanceof FormData) return body;
  return null;
};

// Replaces fetch (for the dashboard's own /api/v1 calls) and WebSocket (for its
// events socket) with the simulated machine, and puts the sample workspace in
// place. Everything else still goes to the real browser APIs.
export const installDemo = () => {
  initDemoMachine();

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.href);
    const apiIndex = url.pathname.indexOf(API_PREFIX);
    if (url.origin !== window.location.origin || apiIndex === -1) return realFetch(input, init);

    const request: DemoRequest = {
      method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
      path: url.pathname.slice(apiIndex),
      query: url.searchParams,
      body: asDemoBody(init?.body),
    };
    const response = await handleRequest(request);
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.contentType },
    });
  };

  const RealWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(RealWebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      const url = String(args[0]);
      if (url.includes(EVENTS_PATH)) return new DemoSocket(url) as unknown as WebSocket;
      return new target(...args);
    },
  });
};
