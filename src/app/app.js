import { appConfig } from "./config/app-config.js";
import { getDomRefs } from "./config/dom-refs.js";
import { fallbackToilets } from "./config/fallback-toilets.js";
import { createAccountController } from "./controllers/account-controller.js";
import { createMapController } from "./controllers/map-controller.js";
import { createTabController } from "./controllers/tab-controller.js";
import { loadToiletsFromApi, loadToiletsFromCsv } from "./services/toilets-service.js";
import { distanceInMetres } from "./utils/geo.js";

export function createApp() {
  const elements = getDomRefs();
  let accountController = null;
  let tabController = null;

  const mapController = createMapController(elements, () => {}, {
    isAuthenticated: () => accountController?.isAuthenticated() ?? false,
    showLoginPrompt: (message) => accountController?.showAuthModal("login", message),
    onPublicProfileSelected: (userId) => {
      accountController?.loadPublicProfile(userId);
      tabController?.setTab("account");
    },
    onCleanlinessSaved: () =>
      initializeToilets(elements.cleanlinessRangeSelect?.value ?? "3days", {
        allowFallback: false,
        force: true
      })
  });

  accountController = createAccountController(
    elements,
    (user, enabled) => mapController.applyProfilePreferences(user, enabled),
    {
      onCommentSelected: ({ toiletId, commentId }) => {
        tabController?.setTab("map");
        mapController.openCommentThread(toiletId, commentId);
      }
    }
  );

  tabController = createTabController({
    tabs: elements.tabs,
    views: elements.views,
    titleElement: elements.title,
    titles: appConfig.titles,
    onMapTabActivated: () => mapController.refreshAfterTabVisible(),
    onAccountTabActivated: () => accountController?.loadPanelData(),
    onTabChanged: (nextTab) => {
      if (elements.headerLocateButton) {
        elements.headerLocateButton.hidden = nextTab !== "map";
      }
    }
  });

  let toiletLoadRequestId = 0;
  let toiletRetryTimerId = null;
  let hasLoadedApiToilets = false;
  let lastLoadedRange = null;

  function clearToiletRetry() {
    if (toiletRetryTimerId) {
      window.clearTimeout(toiletRetryTimerId);
      toiletRetryTimerId = null;
    }
  }

  function scheduleToiletRetry(range) {
    clearToiletRetry();
    toiletRetryTimerId = window.setTimeout(() => {
      toiletRetryTimerId = null;
      initializeToilets(range, { allowFallback: false });
    }, 5000);
  }

  function getCurrentDetailSection() {
    const activeSectionLink = elements.detailSectionLinks
      ? Array.from(elements.detailSectionLinks).find((link) => link.classList.contains("is-active"))
      : null;

    return activeSectionLink?.dataset.detailSection ?? null;
  }

  function setLoadedToilets(
    toilets,
    { currentSelectedId = null, currentSection = null, hideDetails = true, status = "" } = {}
  ) {
    const southKen = appConfig.initialView;
    const sorted = [...toilets].sort((a, b) => {
      const distA = distanceInMetres(southKen.lat, southKen.lng, a.lat, a.lng);
      const distB = distanceInMetres(southKen.lat, southKen.lng, b.lat, b.lng);
      return distA - distB;
    });

    mapController.setToilets(sorted, { hideDetails });

    if (currentSelectedId) {
      mapController.setToilet(currentSelectedId, {
        fly: false,
        updateDistance: false,
        defaultSection: currentSection
      });
    }

    if (status) {
      mapController.setStatus(status);
    }
  }

  async function loadLocalToilets() {
    const loadedFromCsv = await loadToiletsFromCsv();

    if (loadedFromCsv.length > 0) {
      return {
        toilets: loadedFromCsv,
        status: `Using local toilet data (${loadedFromCsv.length} toilets). Reconnecting to database...`
      };
    }

    return {
      toilets: fallbackToilets,
      status: "Using starter toilet data. Reconnecting to database..."
    };
  }

  async function initializeToilets(
    range = elements.cleanlinessRangeSelect?.value ?? "3days",
    { allowFallback = true, force = false } = {}
  ) {
    if (!force && range === lastLoadedRange && hasLoadedApiToilets) {
      return;
    }

    const requestId = toiletLoadRequestId + 1;
    toiletLoadRequestId = requestId;
    clearToiletRetry();
    mapController.setStatus("Connecting to database...");

    const currentSelectedId = mapController.getSelectedToilet()?.id;
    const currentSection = getCurrentDetailSection();

    try {
      const loadedFromApi = await loadToiletsFromApi(range);

      if (requestId !== toiletLoadRequestId) {
        return;
      }

      if (loadedFromApi.length > 0) {
        setLoadedToilets(loadedFromApi, {
          currentSelectedId,
          currentSection,
          hideDetails: !currentSelectedId,
          status: `Loaded ${loadedFromApi.length} toilets from database.`
        });
        hasLoadedApiToilets = true;
        lastLoadedRange = range;
        return;
      }

      throw new Error("Toilets API returned no toilets.");
    } catch (error) {
      if (requestId !== toiletLoadRequestId) {
        return;
      }
      console.warn("Toilets API loading failed:", error);
    }

    if (allowFallback && !hasLoadedApiToilets) {
      try {
        const localData = await loadLocalToilets();

        if (requestId !== toiletLoadRequestId) {
          return;
        }

        setLoadedToilets(localData.toilets, {
          currentSelectedId,
          currentSection,
          hideDetails: !currentSelectedId,
          status: localData.status
        });
      } catch (error) {
        if (requestId !== toiletLoadRequestId) {
          return;
        }

        console.warn("Initial local load failed:", error);
      }
    }

    if (requestId === toiletLoadRequestId) {
      scheduleToiletRetry(range);
    }
  }

  function bindEvents() {
    elements.toggleSearchButton?.addEventListener("click", () => {
      const isCollapsed = elements.searchCard?.classList.toggle("is-collapsed");
      if (elements.toggleSearchButton) {
        elements.toggleSearchButton.setAttribute("aria-label", isCollapsed ? "Expand search panel" : "Collapse search panel");
      }
    });

    elements.resetMapButton?.addEventListener("click", () => mapController.resetFilters());
    elements.searchInput?.addEventListener("input", (event) => {
      if (event.target.value.trim().length > 0 && elements.searchCard?.classList.contains("is-collapsed")) {
        elements.searchCard.classList.remove("is-collapsed");
        if (elements.toggleSearchButton) {
          elements.toggleSearchButton.setAttribute("aria-label", "Collapse search panel");
        }
      }
      mapController.setSearchQuery(event.target.value);
    });
    elements.sortSelect?.addEventListener("change", (event) => mapController.setSortMode(event.target.value));
    elements.cleanlinessRangeSelect?.addEventListener("change", (event) => {
      initializeToilets(event.target.value, { allowFallback: !hasLoadedApiToilets });
    });
    elements.featureFilterInputs.forEach((input) => {
      input?.addEventListener("change", () => mapController.setFeatureFilter(input.value, input.checked));
    });
    elements.closeDetailsButton?.addEventListener("click", () => mapController.hideToiletDetails());
    elements.directionsButton?.addEventListener("click", () => mapController.openDirections());
    elements.mapSurveyRatingButtons.forEach((button) => {
      button?.addEventListener("click", () => mapController.selectCleanlinessRating(button.dataset.surveyRating));
    });

    elements.submitCleanlinessSurveyButton?.addEventListener("click", () =>
      mapController.submitCleanlinessSurveySelection()
    );

    elements.commentComposerToggle?.addEventListener("click", () => mapController.toggleCommentComposer());
    elements.closeCommentComposerButton?.addEventListener("click", () => mapController.closeCommentComposer());
    elements.commentMediaInput?.addEventListener("change", () => mapController.previewCommentMediaSelection());
    elements.commentPresetButtons.forEach((button) => {
      button?.addEventListener("click", () => mapController.applyCommentPreset(button.dataset.commentPreset));
    });
    elements.commentSortSelect?.addEventListener("change", (event) => mapController.setCommentSortMode(event.target.value));
    elements.commentFilterInputs.forEach((input) => {
      input?.addEventListener("change", () => mapController.setCommentFilter(input.value, input.checked));
    });
    elements.commentForm?.addEventListener("submit", (event) => mapController.postComment(event));
    elements.detailSectionLinks.forEach((link) => {
      link?.addEventListener("click", () => mapController.setDetailSection(link.dataset.detailSection));
    });

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
