export const appConfig = {
  apiBasePath: "/api",
  csvDataPath: "./src/data/toilets.csv",
  dayLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  todayDayIndex: (new Date().getDay() + 6) % 7,
  markerRenderLimit: 2000,
  initialView: {
    lat: 51.4974,
    lng: -0.1751,
    zoom: 15
  },
  titles: {
    map: "My Map",
    account: "Account"
  }
};
