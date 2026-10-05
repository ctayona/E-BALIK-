
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";
  import { initTheme } from "./app/utils/theme";

  initTheme();

  createRoot(document.getElementById("root")!).render(<App />);

  // Installable PWA: register the app-shell service worker in production builds only
  // (in development it would interfere with Vite's hot module reloading).
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.warn("Service worker registration failed", error);
      });
    });
  }
