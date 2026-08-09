import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./components/dialog/UnifiedDialog";
import { ThemeProvider } from "./theme";
import { LocaleProvider } from "./i18n/LocaleProvider";
import "./i18n";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ThemeProvider>
    </LocaleProvider>
  </React.StrictMode>
);
