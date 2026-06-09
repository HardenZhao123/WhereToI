import { appConfig } from "./config/app-config.js";
import { getDomRefs } from "./config/dom-refs.js";
import { fallbackToilets } from "./config/fallback-toilets.js";
import { createAccountController } from "./controllers/account-controller.js";
import { createMapController } from "./controllers/map-controller.js";
import { createTabController } from "./controllers/tab-controller.js";
import { recordAccessHistory } from "./services/account-service.js";
import { getCachedToiletsFromApi, loadToiletsFromApi, loadToiletsFromCsv } from "./services/toilets-service.js";
import { distanceInMetres } from "./utils/geo.js";

export function createApp() {
  const elements = getDomRefs();
  let accountController = null;
  let tabController = null;
  let boundsFetchTimeoutId = null;

  const mapController = createMapController(elements, () => {}, {
    isAuthenticated: () => accountController?.isAuthenticated() ?? false,
    showLoginPrompt: (message) => accountController?.showAuthModal("login", message),
    recordAccessHistory,
    onPublicProfileSelected: (userId) => {
      accountController?.loadPublicProfile(userId);
      tabController?.setTab("account");
    },
    onCleanlinessSaved: () =>
      initializeToilets(elements.cleanlinessRangeSelect?.value ?? "3days", {
        allowFallback: false,
        force: true
      }),
    onBoundsChanged: (bounds) => {
      if (boundsFetchTimeoutId) {
        window.clearTimeout(boundsFetchTimeoutId);
      }

      boundsFetchTimeoutId = window.setTimeout(() => {
        boundsFetchTimeoutId = null;
        initializeToilets(elements.cleanlinessRangeSelect?.value ?? "3days", {
          bounds,
          merge: true,
          allowFallback: false
        });
      }, 400);
    }
  });

  accountController = createAccountController(
    elements,
    (user, enabled) => mapController.applyProfilePreferences(user, enabled),
    {
      onCommentSelected: async ({ toiletId, commentId }) => {
        tabController?.setTab("map");
        await mapController.openCommentThread(toiletId, commentId);
      },
      onAccessHistorySelected: async ({ toiletId }) => {
        tabController?.setTab("map");
        const opened = await mapController.setToilet(toiletId);
        if (!opened) {
          mapController.setStatus("Could not find that toilet in the current map data.");
        }
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

  async function setLoadedToilets(
    toilets,
    {
      currentSelectedId = null,
      currentSection = null,
      hideDetails = true,
      cleanlinessRange = elements.cleanlinessRangeSelect?.value ?? "3days",
      status = "",
      merge = false
    } = {}
  ) {
    const southKen = appConfig.initialView;
    const sorted = [...toilets].sort((a, b) => {
      const distA = distanceInMetres(southKen.lat, southKen.lng, a.lat, a.lng);
      const distB = distanceInMetres(southKen.lat, southKen.lng, b.lat, b.lng);
      return distA - distB;
    });

    mapController.setToilets(sorted, { hideDetails, cleanlinessRange, merge });

    if (currentSelectedId) {
      await mapController.setToilet(currentSelectedId, {
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
        status: `Using local toilet data (${loadedFromCsv.length} toilets). Connecting to database...`
      };
    }

    return {
      toilets: fallbackToilets,
      status: "Using starter toilet data. Connecting to database..."
    };
  }

  async function initializeToilets(
    range = elements.cleanlinessRangeSelect?.value ?? "3days",
    { allowFallback = true, force = false, bounds = null, merge = false } = {}
  ) {
    if (!force && !bounds && range === lastLoadedRange && hasLoadedApiToilets) {
      return;
    }

    const requestId = toiletLoadRequestId + 1;
    toiletLoadRequestId = requestId;
    clearToiletRetry();

    if (!hasLoadedApiToilets && !merge) {
      mapController.setStatus("Connecting to database...");
    }

    const currentSelectedId = mapController.getSelectedToilet()?.id;
    const currentSection = getCurrentDetailSection();
    const activeBounds = bounds ?? mapController.getBounds();
    const cachedToilets = !force ? getCachedToiletsFromApi(range, activeBounds) : null;
    const renderedCachedToilets = Array.isArray(cachedToilets) && cachedToilets.length > 0;

    if (renderedCachedToilets) {
      setLoadedToilets(cachedToilets, {
        currentSelectedId,
        currentSection,
        hideDetails: !currentSelectedId,
        cleanlinessRange: range,
        status: bounds ? "" : `Using recent toilet data (${cachedToilets.length} toilets). Checking for updates...`,
        merge
      });
      hasLoadedApiToilets = true;
      lastLoadedRange = range;
    }

    try {
      const loadedFromApi = await loadToiletsFromApi(range, 2, 30000, activeBounds, {
        force: force || renderedCachedToilets
      });

      if (requestId !== toiletLoadRequestId) {
        return;
      }

      if (loadedFromApi.length > 0) {
        await setLoadedToilets(loadedFromApi, {
          currentSelectedId,
          currentSection,
          hideDetails: !currentSelectedId,
          cleanlinessRange: range,
          status: bounds ? "" : `Loaded ${loadedFromApi.length} toilets from database.`,
          merge
        });
        hasLoadedApiToilets = true;
        lastLoadedRange = range;
        return;
      }

      if (!merge) {
        throw new Error("Toilets API returned no toilets.");
      }
    } catch (error) {
      if (requestId !== toiletLoadRequestId) {
        return;
      }
      console.warn("Toilets API loading failed:", error);
    }

    if (allowFallback && !hasLoadedApiToilets && !merge) {
      try {
        const localData = await loadLocalToilets();

        if (requestId !== toiletLoadRequestId) {
          return;
        }

        await setLoadedToilets(localData.toilets, {
          currentSelectedId,
          currentSection,
          hideDetails: !currentSelectedId,
          cleanlinessRange: range,
          status: localData.status,
          merge: false
        });
      } catch (error) {
        if (requestId !== toiletLoadRequestId) {
          return;
        }

        console.warn("Initial local load failed:", error);
      }
    }

    if (requestId === toiletLoadRequestId && !hasLoadedApiToilets) {
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
    elements.summarizeCommentsButton?.addEventListener("click", () => mapController.getAiSummary());
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
    elements.visualFeedbackToggle?.addEventListener("click", () => mapController.toggleVisualFeedback());
    elements.visualFeedbackOpenButtons?.forEach((button) => {
      button?.addEventListener("click", () => mapController.openVisualFeedback());
    });
    elements.closeVisualFeedbackButton?.addEventListener("click", () => mapController.closeVisualFeedback());
    elements.visualCleanlinessSlider?.addEventListener("input", (event) =>
      mapController.setVisualCleanlinessLevel(event.target.value)
    );
    elements.visualFeedbackForm?.addEventListener("submit", (event) => mapController.submitVisualFeedback(event));
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

    // 1. Load local data immediately for instant markers
    try {
      const localData = await loadLocalToilets();
      await setLoadedToilets(localData.toilets, {
        status: localData.status,
        merge: false
      });
    } catch (error) {
      console.warn("Failed to load local toilets on startup:", error);
    }

    mapController.requestLocation();

    // 2. Fetch live data in the background (using current map bounds)
    await Promise.all([
      initializeToilets(elements.cleanlinessRangeSelect?.value ?? "3days", {
        allowFallback: false,
        force: true,
        merge: true
      }),
      accountController.loadPanelData()
    ]);
  }

  return {
    initialize
  };
}
