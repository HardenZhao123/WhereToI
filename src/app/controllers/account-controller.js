import { fetchAccountSnapshot, saveAccessRecord } from "../services/account-service.js";
import { renderAccessHistory, renderAccount, setActivationStatus } from "../views/account-view.js";

export function createAccountController(elements, getSelectedToilet) {
  const {
    activatePassButton,
    activationStatus,
    walletBalance,
    subscriptionPlan,
    monthlyTicketsLeft,
    accessHistoryList,
    ticketToiletName
  } = elements;

  async function loadPanelData() {
    try {
      const payload = await fetchAccountSnapshot();
      renderAccount({ walletBalance, subscriptionPlan, monthlyTicketsLeft }, payload.account);
      renderAccessHistory(accessHistoryList, payload.history);
      setActivationStatus(activationStatus, "Database connected. Pass activation will be saved.");
    } catch (error) {
      console.error("Account API failed:", error);
      setActivationStatus(activationStatus, "Database API unavailable. Pass activation is disabled.");

      if (activatePassButton) {
        activatePassButton.disabled = true;
      }
    }
  }

  async function activatePass() {
    if (!activatePassButton) return;

    activatePassButton.disabled = true;
    setActivationStatus(activationStatus, "Activating pass and writing to database...");

    const selectedToilet = getSelectedToilet();
    const fallbackToiletName = ticketToiletName?.textContent?.trim() || "South Kensington Station Toilet";

    try {
      const payload = await saveAccessRecord({
        toiletId: selectedToilet?.id ?? null,
        toiletName: selectedToilet?.paid ? selectedToilet.name : fallbackToiletName,
        eventType: "QR access",
        amountGbp: 0.5,
        useFreeTicket: false
      });

      renderAccount({ walletBalance, subscriptionPlan, monthlyTicketsLeft }, payload.account);
      renderAccessHistory(accessHistoryList, payload.history);
      setActivationStatus(activationStatus, "Pass activated. Access record saved to database.");
    } catch (error) {
      console.error("Activation failed:", error);
      setActivationStatus(activationStatus, "Could not save access record. Please try again.");
    } finally {
      activatePassButton.disabled = false;
    }
  }

  function updateTicketToilet(toilet) {
    if (!ticketToiletName || !toilet?.paid) return;
    ticketToiletName.textContent = `${toilet.name} Toilet`;
  }

  function bindEvents() {
    activatePassButton?.addEventListener("click", activatePass);
  }

  return {
    bindEvents,
    loadPanelData,
    updateTicketToilet
  };
}
