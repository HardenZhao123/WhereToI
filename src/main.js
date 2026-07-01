import { createApp } from "./app/app.js";
import { hydrateHtmlIncludes } from "./app/html-includes.js";

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}

hydrateHtmlIncludes()
  .then(() => {
    const app = createApp();
    app.initialize();
    registerServiceWorker();
  })
  .catch((error) => {
    console.error("WhereToI failed to initialize:", error);
  });
