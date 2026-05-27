import { appConfig } from "./config/app-config.js";
import { getDomRefs } from "./config/dom-refs.js";
import { fallbackToilets } from "./config/fallback-toilets.js";
import { createAccountController } from "./controllers/account-controller.js";
import { createMapController } from "./controllers/map-controller.js";
import { createTabController } from "./controllers/tab-controller.js";
import { loadToiletsFromApi, loadToiletsFromCsv } from "./services/toilets-service.js";

export function createApp() {
  const elements = getDomRefs();
  let accountController = null;

  const mapController = createMapController(elements, (toilet) => {
    accountController?.updateTicketToilet(toilet);
  });

  accountController = createAccountController(elements, () => mapController.getSelectedToilet());

  const tabController = createTabController({
    tabs: elements.tabs,
    views: elements.views,
    titleElement: elements.title,
    titles: appConfig.titles,
    onMapTabActivated: () => mapController.refreshAfterTabVisible()
  });

  async function initializeToilets() {
    mapController.setStatus("Loading toilets data...");

    let apiLoadFailed = false;

    try {
      const loadedFromApi = await loadToiletsFromApi();

      if (loadedFromApi.length > 0) {
        mapController.setToilets(loadedFromApi);
        mapController.setStatus(`Loaded ${loadedFromApi.length} toilets from database.`);
        return;
      }

      apiLoadFailed = true;
    } catch (error) {
      apiLoadFailed = true;
      console.error("Toilets API loading failed:", error);
    }

    if (!apiLoadFailed) return;

    try {
      const loadedFromCsv = await loadToiletsFromCsv();
      if (loadedFromCsv.length > 0) {
        mapController.setToilets(loadedFromCsv);
        mapController.setStatus(`Database unavailable. Loaded ${loadedFromCsv.length} toilets from CSV fallback.`);
        return;
      }

      mapController.setToilets(fallbackToilets);
      mapController.setStatus("Dataset was empty. Showing sample toilets instead.");
    } catch (error) {
      console.error("CSV loading failed:", error);
      mapController.setToilets(fallbackToilets);
      mapController.setStatus("Could not load API or CSV data. Showing sample toilets instead.");
    }
  }

  function bindEvents() {
    elements.resetMapButton?.addEventListener("click", () => mapController.resetFilters());
    elements.searchInput?.addEventListener("input", (event) => mapController.setSearchQuery(event.target.value));
    elements.sortSelect?.addEventListener("change", (event) => mapController.setSortMode(event.target.value));
    elements.featureFilterInputs.forEach((input) => {
      input?.addEventListener("change", () => mapController.setFeatureFilter(input.value, input.checked));
    });
    elements.closeDetailsButton?.addEventListener("click", () => mapController.hideToiletDetails());
    elements.directionsButton?.addEventListener("click", () => mapController.openDirections());

    elements.locateButtons.forEach((button) => {
      button?.addEventListener("click", () => mapController.requestLocation());
    });

    tabController.bindEvents();
    accountController.bindEvents();
  }

  async function initialize() {
    if (!mapController.createInteractiveMap()) {
      return;
    }

    bindEvents();
    await Promise.all([initializeToilets(), accountController.loadPanelData()]);
  }

  return {
    initialize
  };
}
