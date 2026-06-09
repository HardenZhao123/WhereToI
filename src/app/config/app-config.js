export const appConfig = {
  apiBasePath: "/api",
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
    account: "Account"
  }
};
