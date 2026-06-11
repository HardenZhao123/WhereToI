import { appConfig } from "./config/app-config.js";
import { getDomRefs } from "./config/dom-refs.js";
import { createAccountController } from "./controllers/account-controller.js";
import { createMapController } from "./controllers/map-controller.js";
import { createTabController } from "./controllers/tab-controller.js";
import { recordAccessHistory } from "./services/account-service.js";
import { getCachedToiletsFromApi, loadToiletsFromApi } from "./services/toilets-service.js";
import { createToiletPlayground } from "./toilet-playground/toilet-playground.js";
import { distanceInMetres } from "./utils/geo.js";

export function createApp() {
  const elements = getDomRefs();
  let accountController = null;
  let tabController = null;
  let boundsFetchTimeoutId = null;
  const mapCleanlinessRange = "3days";
  const toiletPlayground = createToiletPlayground(elements.feedbackSceneRoot, {
    onDone: () => {
      tabController?.setTab("map");
      mapController?.refreshFeedbackSceneStatus();
    }
  });

  const mapController = createMapController(elements, (toilet) => toiletPlayground.setContext(toilet), {
    isAuthenticated: () => accountController?.isAuthenticated() ?? false,
    showLoginPrompt: (message) => accountController?.showAuthModal("login", message),
    recordAccessHistory,
    onPublicProfileSelected: (userId) => {
      accountController?.loadPublicProfile(userId);
      tabController?.setTab("account");
    },
    onCleanlinessSaved: () =>
      initializeToilets(mapCleanlinessRange, {
        force: true
      }),
    getFeedbackSceneSnapshot: () => toiletPlayground.getSubmissionSnapshot(),
    resetFeedbackScene: () => toiletPlayground.reset(),
    openFeedbackSceneView: () => tabController?.setTab("scene"),
    onBoundsChanged: (bounds) => {
      if (boundsFetchTimeoutId) {
        window.clearTimeout(boundsFetchTimeoutId);
      }

      boundsFetchTimeoutId = window.setTimeout(() => {
        boundsFetchTimeoutId = null;
        initializeToilets(mapCleanlinessRange, {
          bounds,
          merge: true
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
      initializeToilets(range);
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
      cleanlinessRange = "all",
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

  async function initializeToilets(
    range = "all",
    { force = false, bounds = null, merge = false } = {}
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

    if (requestId === toiletLoadRequestId && !hasLoadedApiToilets) {
      scheduleToiletRetry(range);
    }
  }

  function bindEvents() {
    elements.toggleSearchButton?.addEventListener("click", () => mapController.toggleSearchPanel());

    elements.resetMapButton?.addEventListener("click", () => mapController.resetFilters());
    elements.searchInput?.addEventListener("input", (event) => {
      if (event.target.value.trim().length > 0 && elements.searchCard?.classList.contains("is-collapsed")) {
        mapController.expandSearchPanel();
      }
      mapController.setSearchQuery(event.target.value);
    });
    elements.sortSelect?.addEventListener("change", (event) => mapController.setSortMode(event.target.value));
    elements.cleanlinessRangeSelect?.addEventListener("change", (event) => {
      mapController.setCleanlinessRange(event.target.value);
    });
    elements.featureFilterInputs.forEach((input) => {
      input?.addEventListener("change", () => mapController.setFeatureFilter(input.value, input.checked));
    });
    elements.summarizeCommentsButton?.addEventListener("click", () => mapController.getAiSummary());
    elements.closeDetailsButton?.addEventListener("click", () => mapController.hideToiletDetails());
    elements.directionsButton?.addEventListener("click", () => mapController.openDirections());
    elements.commentComposerToggle?.addEventListener("click", () => mapController.toggleCommentComposer());
    elements.closeCommentComposerButton?.addEventListener("click", () => mapController.closeCommentComposer());
    elements.visualCleanlinessStars?.addEventListener("click", (event) => {
      const target = event.target;
      const starButton = target?.closest?.("[data-visual-star]");
      if (starButton && elements.visualCleanlinessStars.contains(starButton)) {
        mapController.openCleanlinessRatingChoices(starButton.dataset.visualStar, starButton);
      }
    });
    elements.visualRatingChoiceButtons.forEach((button) => {
      button?.addEventListener("click", () => mapController.selectCleanlinessRating(button.dataset.visualRating));
    });
    document.addEventListener("click", (event) => {
      if (elements.visualRatingChoicePopover?.hidden) return;
      if (elements.visualRatingPicker?.contains(event.target)) return;
      mapController.closeCleanlinessRatingChoices();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || elements.visualRatingChoicePopover?.hidden) return;
      mapController.closeCleanlinessRatingChoices({ restoreFocus: true });
    });
    elements.commentMediaInput?.addEventListener("change", () => mapController.previewCommentMediaSelection());
    elements.commentSceneToggle?.addEventListener("click", () => mapController.toggleFeedbackScene());
    elements.sceneBackButton?.addEventListener("click", () => {
      tabController?.setTab("map");
      mapController.refreshFeedbackSceneStatus();
    });
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

    mapController.requestLocation();

    // Fetch live data using current map bounds.
    await Promise.all([
      initializeToilets(mapCleanlinessRange, {
        force: true,
        merge: false
      }),
      accountController.loadPanelData()
    ]);
  }

  return {
    initialize
  };
}
