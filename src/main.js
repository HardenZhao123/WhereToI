import { createApp } from "./app/app.js";
import { hydrateHtmlIncludes } from "./app/html-includes.js";

await hydrateHtmlIncludes();
const app = createApp();
app.initialize();
