const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");
const title = document.querySelector("#view-title");
const statusText = document.querySelector("#map-status");
const searchInput = document.querySelector("#location-search");
const directionsButton = document.querySelector("#directions-button");
const detailsCard = document.querySelector("#details-card");
const mapPanel = document.querySelector("#map-panel");
const mapElement = document.querySelector("#map");
const closeDetailsButton = document.querySelector("#close-details");
const locateButtons = [document.querySelector("#locate-button"), document.querySelector("#find-near-me")];
const activatePassButton = document.querySelector("#activate-pass");
const activationStatus = document.querySelector("#activation-status");
const walletBalance = document.querySelector("#wallet-balance");
const subscriptionPlan = document.querySelector("#subscription-plan");
const monthlyTicketsLeft = document.querySelector("#monthly-tickets-left");
const accessHistoryList = document.querySelector("#access-history-list");
const ticketToiletName = document.querySelector("#ticket-toilet-name");

const titles = {
  map: "Map",
  qr: "Access QR",
  account: "Account"
};

const apiBasePath = "/api";
const csvDataPath = "./src/data/toilets.csv";
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const todayDayIndex = (new Date().getDay() + 6) % 7;
const markerRenderLimit = 1000;
const initialView = {
  lat: 51.4974,
  lng: -0.1751,
  zoom: 15
};

const fallbackToilets = [
  {
    id: "city",
    name: "City and Guilds building",
    area: "Imperial College London",
    lat: 51.49876,
    lng: -0.17687,
    paid: false,
    comment: "Comment: clean today, short queue.",
    features: { women: "Y", men: "Y", accessible: "N", neutral: "?" },
    hours: { today: "Tue 09:00 - 17:00", sat: "Sat Closed", sun: "Sun Closed" }
  },
  {
    id: "station",
    name: "South Kensington Station",
    area: "Partner paid toilet",
    lat: 51.49412,
    lng: -0.17392,
    paid: true,
    comment: "Comment: QR gate required, usually busy after lectures.",
    features: { women: "Y", men: "Y", accessible: "Y", neutral: "N" },
    hours: { today: "Tue 06:00 - 23:30", sat: "Sat 07:00 - 23:30", sun: "Sun 08:00 - 22:30" }
  },
  {
    id: "library",
    name: "Imperial Library",
    area: "Campus access",
    lat: 51.49818,
    lng: -0.17821,
    paid: false,
    comment: "Comment: open late with accessible facilities nearby.",
    features: { women: "Y", men: "Y", accessible: "Y", neutral: "Y" },
    hours: { today: "Tue 08:30 - 23:00", sat: "Sat 10:00 - 20:00", sun: "Sun 10:00 - 20:00" }
  },
  {
    id: "museum",
    name: "Museum Quarter",
    area: "Public toilet",
    lat: 51.49661,
    lng: -0.17222,
    paid: false,
    comment: "Comment: free access, closes early on Sundays.",
    features: { women: "Y", men: "Y", accessible: "Y", neutral: "N" },
    hours: { today: "Tue 10:00 - 18:00", sat: "Sat 10:00 - 18:00", sun: "Sun 10:00 - 17:00" }
  }
];

let allToilets = [...fallbackToilets];
let filteredToilets = [...allToilets];
let visibleToilets = [...filteredToilets];
let selectedToilet = null;
let userLocation = null;
let queryText = "";
let accessibleOnly = false;
let map = null;
let markersLayer = null;
let userLocationMarker = null;
let markerById = new Map();
let hiddenByMarkerLimit = 0;

function setActivationStatus(message) {
  if (!activationStatus) return;
  activationStatus.textContent = message;
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const [headers, ...records] = rows;

  return records
    .filter((record) => record.some((cell) => cell.trim() !== ""))
    .map((record) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = record[index] ?? "";
      });
      return object;
    });
}

function normaliseText(value) {
  return value ? value.replace(/\s+/g, " ").trim() : "";
}

function toFeatureFlag(value) {
  const normalised = normaliseText(value).toLowerCase();
  if (normalised === "true") return "Y";
  if (normalised === "false") return "N";
  return "?";
}

function parseAreaName(areasField) {
  if (!areasField) return "Unknown area";

  try {
    const parsed = JSON.parse(areasField);
    if (typeof parsed?.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name.trim();
    }
  } catch {}

  return "Unknown area";
}

function parseOpeningTimes(openingTimesField) {
  if (!openingTimesField) return [];

  try {
    const parsed = JSON.parse(openingTimesField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDayHours(openingTimes, dayIndex) {
  const dayLabel = dayLabels[dayIndex] ?? "Day";
  const slot = openingTimes[dayIndex];

  if (!Array.isArray(slot) || slot.length < 2) {
    return `${dayLabel} Closed`;
  }

  const [openTime, closeTime] = slot;
  if (!openTime || !closeTime) {
    return `${dayLabel} Closed`;
  }

  return `${dayLabel} ${openTime} - ${closeTime}`;
}

function mapRecordToToilet(record) {
  if (record.active !== "true") return null;

  const lat = Number(record.latitude);
  const lng = Number(record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const openingTimes = parseOpeningTimes(record.opening_times);
  const note = normaliseText(record.notes);
  const paymentDetails = normaliseText(record.payment_details);
  const commentBody = note || paymentDetails || "No notes yet.";
  const name = normaliseText(record.name) || "Unnamed toilet";
  const area = parseAreaName(record.areas);
  const noPayment = normaliseText(record.no_payment).toLowerCase();
  const paid = noPayment === "false" || paymentDetails.length > 0;

  return {
    id: record.id || `${name}-${lat}-${lng}`,
    name,
    area,
    lat,
    lng,
    paid,
    comment: `Comment: ${commentBody}`,
    features: {
      women: toFeatureFlag(record.women),
      men: toFeatureFlag(record.men),
      accessible: toFeatureFlag(record.accessible),
      neutral: toFeatureFlag(record.all_gender)
    },
    hours: {
      today: formatDayHours(openingTimes, todayDayIndex),
      sat: formatDayHours(openingTimes, 5),
      sun: formatDayHours(openingTimes, 6)
    }
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function loadToiletsFromApi() {
  const payload = await fetchJson(`${apiBasePath}/toilets`);
  if (!Array.isArray(payload.toilets)) {
    throw new Error("Invalid toilets API response.");
  }
  return payload.toilets;
}

async function loadToiletsFromCsv() {
  const response = await fetch(csvDataPath);
  if (!response.ok) {
    throw new Error(`CSV request failed with status ${response.status}`);
  }

  const csvContent = await response.text();
  const rows = parseCsv(csvContent);
  const records = rowsToObjects(rows);
  return records.map(mapRecordToToilet).filter(Boolean);
}

function formatCurrency(amount) {
  const value = Number.isFinite(amount) ? amount : 0;
  return `GBP ${value.toFixed(2)}`;
}

function formatRenewDate(dateValue) {
  if (!dateValue) return "Unknown";
  const parsed = new Date(dateValue);
  if (!Number.isFinite(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatAccessTime(isoText) {
  const parsed = new Date(isoText);
  if (!Number.isFinite(parsed.getTime())) return "Unknown time";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const timeText = parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  if (parsed >= startOfToday) {
    return `Today ${timeText}`;
  }

  if (parsed >= startOfYesterday) {
    return `Yesterday ${timeText}`;
  }

  const dayText = parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short"
  });

  return `${dayText} ${timeText}`;
}

function formatCharge(amountGbp) {
  const amount = Number(amountGbp);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "free access";
  }
  return formatCurrency(amount);
}

function renderAccount(account) {
  if (!account) return;

  if (walletBalance) {
    walletBalance.textContent = formatCurrency(account.walletBalanceGbp);
  }

  if (subscriptionPlan) {
    const renewDate = formatRenewDate(account.subscriptionRenewsOn);
    subscriptionPlan.textContent = `${account.subscriptionName} - renews ${renewDate}`;
  }

  if (monthlyTicketsLeft) {
    monthlyTicketsLeft.textContent = `${Number(account.monthlyFreeTicketsLeft ?? 0)} left`;
  }
}

function renderAccessHistory(history) {
  if (!accessHistoryList) return;

  accessHistoryList.textContent = "";

  if (!Array.isArray(history) || history.length === 0) {
    const empty = document.createElement("div");
    const info = document.createElement("p");
    info.textContent = "No access history yet.";
    empty.append(info);
    accessHistoryList.append(empty);
    return;
  }

  history.forEach((entry) => {
    const block = document.createElement("div");
    const heading = document.createElement("strong");
    const line = document.createElement("p");

    heading.textContent = entry.toiletName || "Unknown toilet";
    line.textContent = `${formatAccessTime(entry.accessTime)} - ${entry.eventType || "Access"} - ${formatCharge(entry.amountGbp)}`;

    block.append(heading, line);
    accessHistoryList.append(block);
  });
}

async function loadAccountPanel() {
  try {
    const payload = await fetchJson(`${apiBasePath}/account`);
    renderAccount(payload.account);
    renderAccessHistory(payload.history);
    setActivationStatus("Database connected. Pass activation will be saved.");
  } catch (error) {
    console.error("Account API failed:", error);
    setActivationStatus("Database API unavailable. Pass activation is disabled.");

    if (activatePassButton) {
      activatePassButton.disabled = true;
    }
  }
}

async function activatePass() {
  if (!activatePassButton) return;

  activatePassButton.disabled = true;
  setActivationStatus("Activating pass and writing to database...");

  const defaultToiletName = ticketToiletName?.textContent?.trim() || "South Kensington Station Toilet";

  try {
    const payload = await fetchJson(`${apiBasePath}/access-history`, {
      method: "POST",
      body: JSON.stringify({
        toiletId: selectedToilet?.id ?? null,
        toiletName: selectedToilet?.paid ? selectedToilet.name : defaultToiletName,
        eventType: "QR access",
        amountGbp: 0.5,
        useFreeTicket: false
      })
    });

    renderAccount(payload.account);
    renderAccessHistory(payload.history);
    setActivationStatus("Pass activated. Access record saved to database.");
  } catch (error) {
    console.error("Activation failed:", error);
    setActivationStatus("Could not save access record. Please try again.");
  } finally {
    activatePassButton.disabled = false;
  }
}

function setTab(nextTab) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === nextTab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  views.forEach((view) => {
    view.classList.toggle("is-active", view.id === `${nextTab}-panel`);
  });

  title.textContent = titles[nextTab];

  if (nextTab === "map" && map) {
    requestAnimationFrame(() => {
      map.invalidateSize();
      renderMarkers();
      renderUserMarker();
    });
  }
}

function formatDistance(from, to) {
  if (!from) return "Enable location to see distance.";

  const metres = distanceInMetres(from.lat, from.lng, to.lat, to.lng);
  if (metres < 1000) return `${Math.round(metres)} m away`;
  return `${(metres / 1000).toFixed(1)} km away`;
}

function distanceInMetres(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function renderMarkers() {
  if (!map || !markersLayer) {
    visibleToilets = [...filteredToilets];
    hiddenByMarkerLimit = 0;
    return;
  }

  const inBoundsToilets = getMapVisibleToilets();
  hiddenByMarkerLimit = Math.max(0, inBoundsToilets.length - markerRenderLimit);
  visibleToilets = inBoundsToilets.slice(0, markerRenderLimit);
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

function updateSelectedMarkerAppearance() {
  markerById.forEach((marker, id) => {
    const toilet = visibleToilets.find((item) => item.id === id);
    if (!toilet) return;
    marker.setIcon(createToiletIcon(toilet, selectedToilet?.id === id));
  });
}

function setToilet(toiletId) {
  const toilet = allToilets.find((item) => item.id === toiletId);
  if (!toilet) return;

  selectedToilet = toilet;
  detailsCard.classList.remove("is-hidden");
  mapPanel.classList.add("has-details");
  directionsButton.disabled = false;

  document.querySelector("#toilet-name").textContent = toilet.name;
  document.querySelector("#toilet-area").textContent = toilet.area;
  document.querySelector("#toilet-comment").textContent = toilet.comment;
  document.querySelector("#feature-women").textContent = toilet.features.women;
  document.querySelector("#feature-men").textContent = toilet.features.men;
  document.querySelector("#feature-accessible").textContent = toilet.features.accessible;
  document.querySelector("#feature-neutral").textContent = toilet.features.neutral;
  document.querySelector("#hours-today").textContent = toilet.hours.today;
  document.querySelector("#hours-sat").textContent = toilet.hours.sat;
  document.querySelector("#hours-sun").textContent = toilet.hours.sun;
  document.querySelector("#distance-line").textContent = formatDistance(userLocation, toilet);

  if (ticketToiletName && toilet.paid) {
    ticketToiletName.textContent = `${toilet.name} Toilet`;
  }

  const marker = markerById.get(toilet.id);
  if (marker && map) {
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.45 });
  }

  updateSelectedMarkerAppearance();
}

function hideToiletDetails() {
  selectedToilet = null;
  detailsCard.classList.add("is-hidden");
  mapPanel.classList.remove("has-details");
  directionsButton.disabled = true;
  updateSelectedMarkerAppearance();
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

function requestLocation() {
  if (!navigator.geolocation) {
    statusText.textContent = "Your browser does not support location.";
    return;
  }

  statusText.textContent = "Requesting location permission...";

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

      statusText.textContent = "Location found. Distances are now updated.";
    },
    () => {
      statusText.textContent = "Location permission was denied or unavailable.";
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
    statusText.textContent = "Select a toilet marker first.";
    return;
  }

  const destination = `${selectedToilet.lat},${selectedToilet.lng}`;
  const origin = userLocation ? `&origin=${userLocation.lat},${userLocation.lng}` : "";
  const url = `https://www.google.com/maps/dir/?api=1${origin}&destination=${destination}&travelmode=walking`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function updateFilterStatus() {
  if (filteredToilets.length === 0) {
    statusText.textContent = "No matching toilets. Try removing some filters.";
    return;
  }

  const inViewCount = visibleToilets.length;
  const limitHint = hiddenByMarkerLimit > 0 ? ` Zoom in to load ${hiddenByMarkerLimit} more.` : "";
  if (accessibleOnly && queryText) {
    statusText.textContent = `Found ${filteredToilets.length} accessible matches. ${inViewCount} visible on map.${limitHint}`;
    return;
  }

  if (accessibleOnly) {
    statusText.textContent = `Showing ${filteredToilets.length} accessible toilets. ${inViewCount} visible on map.${limitHint}`;
    return;
  }

  if (queryText) {
    statusText.textContent = `Found ${filteredToilets.length} matches. ${inViewCount} visible on map.${limitHint}`;
    return;
  }

  statusText.textContent = `Showing ${filteredToilets.length} toilets. ${inViewCount} visible on map.${limitHint}`;
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

function filterBySearch() {
  queryText = searchInput.value;
  applyFilters();
}

function resetFilters() {
  accessibleOnly = false;
  queryText = "";
  searchInput.value = "";
  applyFilters();
}

function createInteractiveMap() {
  if (!mapElement || !window.L) {
    statusText.textContent = "Map engine failed to load.";
    return false;
  }

  map = window.L.map(mapElement, {
    zoomControl: false,
    attributionControl: true
  }).setView([initialView.lat, initialView.lng], initialView.zoom);

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

async function initializeToilets() {
  statusText.textContent = "Loading toilets data...";

  let apiLoadFailed = false;

  try {
    const loadedFromApi = await loadToiletsFromApi();

    if (loadedFromApi.length > 0) {
      allToilets = loadedFromApi;
      statusText.textContent = `Loaded ${allToilets.length} toilets from database.`;
    } else {
      apiLoadFailed = true;
    }
  } catch (error) {
    apiLoadFailed = true;
    console.error("Toilets API loading failed:", error);
  }

  if (apiLoadFailed) {
    try {
      const loadedFromCsv = await loadToiletsFromCsv();
      if (loadedFromCsv.length > 0) {
        allToilets = loadedFromCsv;
        statusText.textContent = `Database unavailable. Loaded ${allToilets.length} toilets from CSV fallback.`;
      } else {
        allToilets = [...fallbackToilets];
        statusText.textContent = "Dataset was empty. Showing sample toilets instead.";
      }
    } catch (error) {
      allToilets = [...fallbackToilets];
      statusText.textContent = "Could not load API or CSV data. Showing sample toilets instead.";
      console.error("CSV loading failed:", error);
    }
  }

  filteredToilets = [...allToilets];
  renderMarkers();
  hideToiletDetails();
  updateFilterStatus();
}

async function initializeApp() {
  if (!createInteractiveMap()) {
    return;
  }

  await Promise.all([initializeToilets(), loadAccountPanel()]);
}

document.querySelector("#filter-accessible").addEventListener("click", () => {
  accessibleOnly = true;
  applyFilters();
});

document.querySelector("#reset-map").addEventListener("click", resetFilters);

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab));
});

locateButtons.forEach((button) => {
  button.addEventListener("click", requestLocation);
});

directionsButton.addEventListener("click", openDirections);
closeDetailsButton.addEventListener("click", hideToiletDetails);
searchInput.addEventListener("input", filterBySearch);
activatePassButton?.addEventListener("click", activatePass);

initializeApp();
