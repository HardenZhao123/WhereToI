export function createTabController({ tabs, views, titleElement, titles, onMapTabActivated }) {
  function setTab(nextTab) {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === nextTab;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    views.forEach((view) => {
      view.classList.toggle("is-active", view.id === `${nextTab}-panel`);
    });

    if (titleElement) {
      titleElement.textContent = titles[nextTab] ?? "";
    }

    if (nextTab === "map") {
      onMapTabActivated();
    }
  }

  function bindEvents() {
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => setTab(tab.dataset.tab));
    });
  }

  return {
    bindEvents,
    setTab
  };
}
