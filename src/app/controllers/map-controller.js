import { appConfig } from "../config/app-config.js";
import { submitCleanlinessSurvey } from "../services/toilets-service.js";
import { formatDistance } from "../utils/geo.js";

export function createMapController(elements, onToiletSelected = () => {}) {
  const {
    statusText,
    searchInput,
    directionsButton,
    detailsCard,
    mapPanel,
    mapElement,
    mapSurveyCleanYesButton,
    mapSurveyCleanNoButton,
    mapSurveyStatus
  } = elements;

  const surveyStorageKey = "wheretoi-map-cleanliness-survey";

  let allToilets = [];
  let filteredToilets = [];
  let visibleToilets = [];
  let selectedToilet = null;
  let userLocation = null;
  let queryText = "";
  let accessibleOnly = false;
  let map = null;
  let markersLayer = null;
  let userLocationMarker = null;
  let markerById = new Map();
  let hiddenByMarkerLimit = 0;
  let cleanlinessSurveyAnswers = loadSurveyAnswers();

  function loadSurveyAnswers() {
    try {
      const storedAnswers = window.localStorage?.getItem(surveyStorageKey);
      if (!storedAnswers) return {};

      const parsedAnswers = JSON.parse(storedAnswers);
      return parsedAnswers && typeof parsedAnswers === "object" ? parsedAnswers : {};
    } catch {
      return {};
    }
  }

  function saveSurveyAnswers() {
    try {
      window.localStorage?.setItem(surveyStorageKey, JSON.stringify(cleanlinessSurveyAnswers));
    } catch {
      // Keep the survey usable for the current session when storage is blocked.
    }
  }

  function renderCleanlinessBar(toilet) {
    const cleanlinessBar = document.querySelector("#cleanliness-bar");
    if (!cleanlinessBar) return;

    const rating = Number(toilet?.cleanliness ?? 3);
    const percent = Math.min(Math.max((rating / 5) * 100, 0), 100);
    cleanlinessBar.style.width = `${percent}%`;
  }

  function setStatus(message) {
    if (!statusText) return;
    statusText.textContent = message;
  }

  function renderCleanlinessSurvey(toilet) {
    const answer = toilet ? cleanlinessSurveyAnswers[toilet.id]?.answer ?? cleanlinessSurveyAnswers[toilet.id] : null;
    const hasAnswer = answer === "yes" || answer === "no";

    mapSurveyCleanYesButton?.classList.toggle("is-selected", answer === "yes");
    mapSurveyCleanNoButton?.classList.toggle("is-selected", answer === "no");
    mapSurveyCleanYesButton?.setAttribute("aria-pressed", answer === "yes" ? "true" : "false");
    mapSurveyCleanNoButton?.setAttribute("aria-pressed", answer === "no" ? "true" : "false");

    if (mapSurveyStatus) {
      mapSurveyStatus.textContent = hasAnswer ? "Thanks, your answer has been saved." : "Choose an answer to help others.";
    }
  }

  function createToiletIcon(toilet, selected = false) {
    const classes = ["map-marker"];
    if (toilet.paid) classes.push("is-paid");
    if (selected) classes.push("is-selected");

    return window.L.divIcon({
      className: "map-marker-icon",
      html: `<span class="${classes.join(" ")}" aria-hidden="true"></span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });
  }

  function getMapVisibleToilets() {
    if (!map) return [...filteredToilets];

    const bounds = map.getBounds();
    return filteredToilets.filter((toilet) => bounds.contains([toilet.lat, toilet.lng]));
  }

  function updateSelectedMarkerAppearance() {
    markerById.forEach((marker, id) => {
      const toilet = visibleToilets.find((item) => item.id === id);
      if (!toilet) return;
      marker.setIcon(createToiletIcon(toilet, selectedToilet?.id === id));
    });
  }

  function hideToiletDetails() {
    selectedToilet = null;
    detailsCard?.classList.add("is-hidden");
    mapPanel?.classList.remove("has-details");

    if (directionsButton) {
      directionsButton.disabled = true;
    }

    renderCleanlinessSurvey(null);
    updateSelectedMarkerAppearance();
  }

  function setFeatureValue(selector, value) {
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = value ?? "?";
    }
  }

  function renderUserMarker() {
    if (!map) return;

    if (!userLocation) {
      userLocationMarker?.remove();
      userLocationMarker = null;
      return;
    }

    if (!userLocationMarker) {
      userLocationMarker = window.L.marker([userLocation.lat, userLocation.lng], {
        icon: window.L.divIcon({
          className: "map-user-marker-icon",
          html: '<span class="map-user-marker" aria-hidden="true"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        keyboard: false
      }).addTo(map);
    } else {
      userLocationMarker.setLatLng([userLocation.lat, userLocation.lng]);
    }
  }

  function setToilet(toiletId) {
    const toilet = allToilets.find((item) => item.id === toiletId);
    if (!toilet) return;

    selectedToilet = toilet;
    detailsCard?.classList.remove("is-hidden");
    mapPanel?.classList.add("has-details");

    if (directionsButton) {
      directionsButton.disabled = false;
    }

    document.querySelector("#toilet-name").textContent = toilet.name;
    document.querySelector("#toilet-area").textContent = toilet.area;
    document.querySelector("#toilet-comment").textContent = toilet.comment;
    setFeatureValue("#feature-women", toilet.features.women);
    setFeatureValue("#feature-men", toilet.features.men);
    setFeatureValue("#feature-accessible", toilet.features.accessible);
    setFeatureValue("#feature-neutral", toilet.features.neutral);
    setFeatureValue("#feature-children", toilet.features.children);
    setFeatureValue("#feature-baby-changing", toilet.features.babyChanging);
    setFeatureValue("#feature-bidet", toilet.features.bidet);
    setFeatureValue("#feature-automatic", toilet.features.automatic);
    setFeatureValue("#feature-urinal-only", toilet.features.urinalOnly);
    setFeatureValue("#feature-radar-key", toilet.features.radarKey);
    setFeatureValue("#feature-free", toilet.features.free);
    document.querySelector("#hours-today").textContent = toilet.hours.today;
    document.querySelector("#hours-sat").textContent = toilet.hours.sat;
    document.querySelector("#hours-sun").textContent = toilet.hours.sun;
    document.querySelector("#distance-line").textContent = formatDistance(userLocation, toilet);
    renderCleanlinessSurvey(toilet);

    renderCleanlinessBar(toilet);

    const marker = markerById.get(toilet.id);
    if (marker && map) {
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.45 });
    }

    updateSelectedMarkerAppearance();
    onToiletSelected(toilet);
  }

  function renderMarkers() {
    if (!map || !markersLayer) {
      visibleToilets = [...filteredToilets];
      hiddenByMarkerLimit = 0;
      return;
    }

    const inBoundsToilets = getMapVisibleToilets();
    hiddenByMarkerLimit = Math.max(0, inBoundsToilets.length - appConfig.markerRenderLimit);
    visibleToilets = inBoundsToilets.slice(0, appConfig.markerRenderLimit);
    markerById = new Map();
    markersLayer.clearLayers();

    visibleToilets.forEach((toilet) => {
      const marker = window.L.marker([toilet.lat, toilet.lng], {
        icon: createToiletIcon(toilet, selectedToilet?.id === toilet.id),
        keyboard: true,
        title: `${toilet.name}, ${toilet.area}`
      });

      marker.on("click", () => setToilet(toilet.id));
      marker.addTo(markersLayer);
      markerById.set(toilet.id, marker);
    });

    renderUserMarker();
  }

  function updateFilterStatus() {
    if (filteredToilets.length === 0) {
      setStatus("No matching toilets. Try removing some filters.");
      return;
    }

    const inViewCount = visibleToilets.length;
    const limitHint = hiddenByMarkerLimit > 0 ? ` Zoom in to load ${hiddenByMarkerLimit} more.` : "";

    if (accessibleOnly && queryText) {
      setStatus(`Found ${filteredToilets.length} accessible matches. ${inViewCount} visible on map.${limitHint}`);
      return;
    }

    if (accessibleOnly) {
      setStatus(`Showing ${filteredToilets.length} accessible toilets. ${inViewCount} visible on map.${limitHint}`);
      return;
    }

    if (queryText) {
      setStatus(`Found ${filteredToilets.length} matches. ${inViewCount} visible on map.${limitHint}`);
      return;
    }

    setStatus(`Showing ${filteredToilets.length} toilets. ${inViewCount} visible on map.${limitHint}`);
  }

  function applyFilters() {
    const query = queryText.trim().toLowerCase();

    filteredToilets = allToilets.filter((toilet) => {
      const matchesAccessible = !accessibleOnly || toilet.features.accessible === "Y";
      if (!matchesAccessible) return false;

      if (!query) return true;
      return toilet.name.toLowerCase().includes(query) || toilet.area.toLowerCase().includes(query);
    });

    if (selectedToilet && !filteredToilets.some((toilet) => toilet.id === selectedToilet.id)) {
      hideToiletDetails();
    }

    renderMarkers();
    updateFilterStatus();
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setStatus("Your browser does not support location.");
      return;
    }

    setStatus("Requesting location permission...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        renderUserMarker();

        if (selectedToilet) {
          document.querySelector("#distance-line").textContent = formatDistance(userLocation, selectedToilet);
        }

        if (map) {
          map.flyTo([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
        }

        setStatus("Location found. Distances are now updated.");
      },
      () => {
        setStatus("Location permission was denied or unavailable.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }

  function openDirections() {
    if (!selectedToilet) {
      setStatus("Select a toilet marker first.");
      return;
    }

    const destination = `${selectedToilet.lat},${selectedToilet.lng}`;
    const origin = userLocation ? `&origin=${userLocation.lat},${userLocation.lng}` : "";
    const url = `https://www.google.com/maps/dir/?api=1${origin}&destination=${destination}&travelmode=walking`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function createInteractiveMap() {
    if (!mapElement || !window.L) {
      setStatus("Map engine failed to load.");
      return false;
    }

    map = window.L.map(mapElement, {
      zoomControl: false,
      attributionControl: true
    }).setView([appConfig.initialView.lat, appConfig.initialView.lng], appConfig.initialView.zoom);

    window.L.control.zoom({ position: "topright" }).addTo(map);

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      minZoom: 3,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markersLayer = window.L.layerGroup().addTo(map);

    map.on("moveend zoomend", () => {
      renderMarkers();
      updateFilterStatus();
    });

    return true;
  }

  function setToilets(nextToilets) {
    allToilets = [...nextToilets];
    filteredToilets = [...allToilets];
    renderMarkers();
    hideToiletDetails();
    updateFilterStatus();
  }

  function refreshAfterTabVisible() {
    if (!map) return;

    requestAnimationFrame(() => {
      map.invalidateSize();
      renderMarkers();
      renderUserMarker();
    });
  }

  function setSearchQuery(value) {
    queryText = value;
    applyFilters();
  }

  function enableAccessibleOnly() {
    accessibleOnly = true;
    applyFilters();
  }

  function resetFilters() {
    accessibleOnly = false;
    queryText = "";

    if (searchInput) {
      searchInput.value = "";
    }

    applyFilters();
  }

  function getSelectedToilet() {
    return selectedToilet;
  }

  function updateToiletCleanliness(toiletUpdate) {
    if (!toiletUpdate?.id) return;

    const applyUpdate = (toilet) =>
      toilet.id === toiletUpdate.id
        ? {
            ...toilet,
            cleanliness: toiletUpdate.cleanliness,
            cleanlinessSurvey: toiletUpdate.cleanlinessSurvey
          }
        : toilet;

    allToilets = allToilets.map(applyUpdate);
    filteredToilets = filteredToilets.map(applyUpdate);
    visibleToilets = visibleToilets.map(applyUpdate);

    if (selectedToilet?.id === toiletUpdate.id) {
      selectedToilet = applyUpdate(selectedToilet);
      renderCleanlinessBar(selectedToilet);
    }
  }

  async function answerCleanlinessSurvey(answer) {
    if (!selectedToilet) {
      setStatus("Select a toilet marker before answering the survey.");
      return;
    }

    if (answer !== "yes" && answer !== "no") return;

    if (mapSurveyStatus) {
      mapSurveyStatus.textContent = "Saving answer to database...";
    }

    let savedToDatabase = false;

    try {
      const result = await submitCleanlinessSurvey({
        toiletId: selectedToilet.id,
        toiletName: selectedToilet.name,
        answer
      });

      savedToDatabase = true;

      if (result.toilet?.cleanliness != null) {
        updateToiletCleanliness(result.toilet);
      }
    } catch (error) {
      console.error("Cleanliness survey failed:", error);
      if (mapSurveyStatus) {
        mapSurveyStatus.textContent = "Could not save to database. Saved on this device only.";
      }
    }

    cleanlinessSurveyAnswers = {
      ...cleanlinessSurveyAnswers,
      [selectedToilet.id]: {
        answer,
        toiletName: selectedToilet.name,
        submittedAt: new Date().toISOString()
      }
    };

    saveSurveyAnswers();
    renderCleanlinessSurvey(selectedToilet);

    if (!savedToDatabase && mapSurveyStatus) {
      mapSurveyStatus.textContent = "Could not save to database. Saved on this device only.";
    }
  }

  return {
    createInteractiveMap,
    setStatus,
    setToilets,
    setSearchQuery,
    enableAccessibleOnly,
    resetFilters,
    requestLocation,
    openDirections,
    hideToiletDetails,
    refreshAfterTabVisible,
    getSelectedToilet,
    updateToiletCleanliness,
    answerCleanlinessSurvey
  };
}
