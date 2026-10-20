import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Ensure i18n + document locale are fully initialized before first paint:
// Arabic is the default (ar/rtl), translations are local, no remote loads.
const i18nModule = await import("./i18n");
await i18nModule.readyPromise;

// Paired-phone entry: capture the QR pairing token from the URL fragment
// into sessionStorage (and scrub it from the address bar) before anything
// touches the database layer.
await import("./lan/client").then((m) => m.captureLanTokenFromUrl());
await import("./styles.css");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
