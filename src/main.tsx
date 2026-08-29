import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { OverlayView } from "./OverlayView";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

const view = new URLSearchParams(window.location.search).get("view");
const content = view === "overlay"
  ? <OverlayView />
  : view === "capture"
    ? <main className="capture-view" aria-hidden="true" />
    : <App />;

createRoot(rootElement).render(<StrictMode>{content}</StrictMode>);
