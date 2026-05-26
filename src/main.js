const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");
const title = document.querySelector("#view-title");
const statusText = document.querySelector("#map-status");
const searchInput = document.querySelector("#location-search");
const directionsButton = document.querySelector("#directions-button");
const detailsCard = document.querySelector("#details-card");
const mapPanel = document.querySelector("#map-panel");
const markerLayer = document.querySelector("#marker-layer");
const closeDetailsButton = document.querySelector("#close-details");
const locateButtons = [document.querySelector("#locate-button"), document.querySelector("#find-near-me")];

const titles = {
  map: "Map",
  qr: "Access QR",
  account: "Account"
};

const mapBounds = {
  west: -0.19,
  south: 51.489,
  east: -0.16,
  north: 51.505
};

const toilets = [
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

let selectedToilet = null;
let userLocation = null;
let visibleToilets = [...toilets];

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
}

function projectPoint(lat, lng) {
  const x = ((lng - mapBounds.west) / (mapBounds.east - mapBounds.west)) * 100;
  const y = ((mapBounds.north - lat) / (mapBounds.north - mapBounds.south)) * 100;
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y))
  };
}

function isInsideMap(lat, lng) {
  return lat <= mapBounds.north && lat >= mapBounds.south && lng >= mapBounds.west && lng <= mapBounds.east;
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

function setToilet(toiletId) {
  const toilet = toilets.find((item) => item.id === toiletId);
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

  renderMarkers(visibleToilets);
}

function hideToiletDetails() {
  selectedToilet = null;
  detailsCard.classList.add("is-hidden");
  mapPanel.classList.remove("has-details");
  directionsButton.disabled = true;
  renderMarkers(visibleToilets);
}

function renderMarkers(nextToilets = toilets) {
  visibleToilets = [...nextToilets];
  markerLayer.replaceChildren();

  nextToilets.forEach((toilet) => {
    const point = projectPoint(toilet.lat, toilet.lng);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `map-marker ${toilet.paid ? "is-paid" : ""} ${selectedToilet?.id === toilet.id ? "is-selected" : ""}`;
    marker.style.left = `${point.x}%`;
    marker.style.top = `${point.y}%`;
    marker.setAttribute("aria-label", `${toilet.name}, ${toilet.area}`);
    marker.addEventListener("click", () => setToilet(toilet.id));
    markerLayer.append(marker);
  });

  renderUserMarker();
}

function renderUserMarker() {
  const oldMarker = markerLayer.querySelector(".map-user-marker");
  oldMarker?.remove();

  if (!userLocation || !isInsideMap(userLocation.lat, userLocation.lng)) return;

  const point = projectPoint(userLocation.lat, userLocation.lng);
  const marker = document.createElement("span");
  marker.className = "map-user-marker";
  marker.style.left = `${point.x}%`;
  marker.style.top = `${point.y}%`;
  marker.setAttribute("aria-label", "Current location");
  markerLayer.append(marker);
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

      renderMarkers(visibleToilets);

      if (selectedToilet) {
        document.querySelector("#distance-line").textContent = formatDistance(userLocation, selectedToilet);
      }

      statusText.textContent = isInsideMap(userLocation.lat, userLocation.lng)
        ? "Location found. Distances are now updated."
        : "Location found. You are outside this preview map, but distances still work.";
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

function filterBySearch() {
  const query = searchInput.value.trim().toLowerCase();
  const matches = toilets.filter((toilet) => {
    return toilet.name.toLowerCase().includes(query) || toilet.area.toLowerCase().includes(query);
  });

  renderMarkers(matches);
  hideToiletDetails();
  statusText.textContent = matches.length === 1 ? "Showing 1 matching toilet." : `Showing ${matches.length} matching toilets.`;
}

document.querySelector("#filter-accessible").addEventListener("click", () => {
  const accessibleToilets = toilets.filter((toilet) => toilet.features.accessible === "Y");
  renderMarkers(accessibleToilets);
  hideToiletDetails();
  statusText.textContent = "Showing accessible toilets only. Tap a marker for details.";
});

document.querySelector("#reset-map").addEventListener("click", () => {
  searchInput.value = "";
  renderMarkers(toilets);
  hideToiletDetails();
  statusText.textContent = "Showing all nearby toilets. Tap a marker for details.";
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab));
});

locateButtons.forEach((button) => {
  button.addEventListener("click", requestLocation);
});

directionsButton.addEventListener("click", openDirections);
closeDetailsButton.addEventListener("click", hideToiletDetails);
searchInput.addEventListener("input", filterBySearch);

renderMarkers(toilets);
hideToiletDetails();
statusText.textContent = "Showing toilets near South Kensington. Tap a marker for details.";
