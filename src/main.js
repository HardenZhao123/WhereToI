import { createApp } from "./app/app.js";
import { hydrateHtmlIncludes } from "./app/html-includes.js";

await hydrateHtmlIncludes();
const app = createApp();
app.initialize();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}
