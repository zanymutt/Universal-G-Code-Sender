// True only in the online-demo build (`npm run build:demo`), where the backend
// is simulated in the browser. The normal dashboard build replaces this with
// `false` at compile time, so none of the demo code ships in it.
export const isDemo = import.meta.env.VITE_DEMO === "true";
