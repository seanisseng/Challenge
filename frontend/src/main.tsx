import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./index.css";
import "./race-ui.css";
import "./player-ui.css";
import "./team-progress.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
