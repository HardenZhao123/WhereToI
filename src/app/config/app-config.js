const productionOrigin = "https://wheretoi-webapp.onrender.com";
const nativeAppProtocols = new Set(["capacitor:", "ionic:"]);
const isNativeAppShell = nativeAppProtocols.has(globalThis.location?.protocol);

export const appConfig = {
  productionOrigin,
  apiBasePath: isNativeAppShell ? `${productionOrigin}/api` : "/api",
  assetVersion: "toilet-small-floor-20260611",
  dayLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  todayDayIndex: (new Date().getDay() + 6) % 7,
  markerRenderLimit: 2000,
  markerHideZoomThreshold: 14,
  initialView: {
    lat: 51.4974,
    lng: -0.1751,
    zoom: 15
  },
  titles: {
    map: "Map",
    scene: "Interactive scene",
    account: "Account"
  }
};
