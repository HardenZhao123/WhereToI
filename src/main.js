const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");
const title = document.querySelector("#view-title");
const pins = document.querySelectorAll(".pin");

const titles = {
  map: "Map",
  qr: "Access QR",
  account: "Account"
};

const toilets = {
  city: {
    name: "City and Guilds building",
    area: "Imperial College London",
    comment: "Comment: clean today, short queue."
  },
  station: {
    name: "South Kensington Station",
    area: "Partner paid toilet",
    comment: "Comment: QR gate required, usually busy after lectures."
  },
  library: {
    name: "Imperial Library",
    area: "Campus access",
    comment: "Comment: open late with accessible facilities nearby."
  },
  museum: {
    name: "Museum Quarter",
    area: "Public toilet",
    comment: "Comment: free access, closes early on Sundays."
  }
};

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

function setToilet(locationId) {
  const toilet = toilets[locationId];
  if (!toilet) return;

  pins.forEach((pin) => pin.classList.toggle("is-selected", pin.dataset.location === locationId));
  document.querySelector("#toilet-name").textContent = toilet.name;
  document.querySelector("#toilet-area").textContent = toilet.area;
  document.querySelector(".comment").textContent = toilet.comment;
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab));
});

pins.forEach((pin) => {
  pin.addEventListener("click", () => setToilet(pin.dataset.location));
});
