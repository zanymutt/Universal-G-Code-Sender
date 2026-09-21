import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { Provider } from "react-redux";
import { store } from "./store/store.ts";

import "./index.css";

const start = async () => {
  // The online demo swaps the backend for an in-browser simulation before the
  // app makes its first request. The flag is a compile-time constant (see
  // vite.config.ts), so the normal build drops this branch and the demo code.
  // Written out here rather than via isDemo so the bundler prunes the import().
  if (import.meta.env.VITE_DEMO === "true") {
    const { installDemo } = await import("./demo/installDemo");
    installDemo();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <Provider store={store}>
      <App />
    </Provider>
  );
};

start();
