import { fetchAccountSnapshot, saveAccessRecord } from "../services/account-service.js";
import { submitCleanlinessSurvey } from "../services/toilets-service.js";
import { renderAccessHistory, renderAccount, setActivationStatus } from "../views/account-view.js";

export function createAccountController(elements, getSelectedToilet, onCleanlinessUpdated = () => {}) {
  const {
    activatePassButton,
    activationStatus,
    walletBalance,
    subscriptionPlan,
    monthlyTicketsLeft,
    accessHistoryList,
    ticketToiletName,
    surveyModal,
    surveyCleanYesButton,
    surveyCleanNoButton,
    closeSurveyButton,
    surveyQuestion,
    surveyStatus
  } = elements;

  const surveyStorageKey = "wheretoi-qr-cleanliness-survey";
  let pendingSurveyToilet = null;
  let ticketToilet = null;

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

  function saveSurveyAnswer(toilet, answer) {
    if (!toilet || (answer !== "yes" && answer !== "no")) return;

    const surveyAnswers = {
      ...loadSurveyAnswers(),
      [toilet.id ?? toilet.name]: {
        answer,
        toiletName: toilet.name,
        submittedAt: new Date().toISOString()
      }
    };

    try {
      window.localStorage?.setItem(surveyStorageKey, JSON.stringify(surveyAnswers));
    } catch {
      // Keep the confirmation flow usable even when browser storage is blocked.
    }
  }

  function showCleanlinessSurvey(toilet) {
    if (!surveyModal || !toilet) return;

    pendingSurveyToilet = toilet;
    surveyModal.classList.remove("is-hidden");
    surveyCleanYesButton?.classList.remove("is-selected");
    surveyCleanNoButton?.classList.remove("is-selected");
    surveyCleanYesButton?.setAttribute("aria-pressed", "false");
    surveyCleanNoButton?.setAttribute("aria-pressed", "false");

    if (surveyQuestion) {
      surveyQuestion.textContent = `Was ${toilet.name} clean?`;
    }

    if (surveyStatus) {
      surveyStatus.textContent = "Choose an answer to help others.";
    }

    surveyCleanYesButton?.focus();
  }

  function hideCleanlinessSurvey() {
    pendingSurveyToilet = null;
    surveyModal?.classList.add("is-hidden");
  }

  async function answerCleanlinessSurvey(answer) {
    if (!pendingSurveyToilet) return;

    surveyCleanYesButton?.classList.toggle("is-selected", answer === "yes");
    surveyCleanNoButton?.classList.toggle("is-selected", answer === "no");
    surveyCleanYesButton?.setAttribute("aria-pressed", answer === "yes" ? "true" : "false");
    surveyCleanNoButton?.setAttribute("aria-pressed", answer === "no" ? "true" : "false");

    if (surveyStatus) {
      surveyStatus.textContent = "Saving answer to database...";
    }

    try {
      const result = await submitCleanlinessSurvey({
        toiletId: pendingSurveyToilet.id,
        toiletName: pendingSurveyToilet.name,
        answer
      });

      onCleanlinessUpdated(result.toilet);

      if (surveyStatus) {
        surveyStatus.textContent = "Thanks, your answer has been saved.";
      }
    } catch (error) {
      console.error("Cleanliness survey failed:", error);
      if (surveyStatus) {
        surveyStatus.textContent = "Could not save to database. Saved on this device only.";
      }
    }

    saveSurveyAnswer(pendingSurveyToilet, answer);
    window.setTimeout(hideCleanlinessSurvey, 650);
  }

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
    const fallbackToilet = ticketToilet ?? {
      id: null,
      name: ticketToiletName?.textContent?.trim() || "South Kensington Station Toilet"
    };
    const activatedToilet = {
      id: selectedToilet?.paid ? selectedToilet.id : fallbackToilet.id,
      name: selectedToilet?.paid ? selectedToilet.name : fallbackToilet.name
    };

    try {
      const payload = await saveAccessRecord({
        toiletId: selectedToilet?.id ?? null,
        toiletName: activatedToilet.name,
        eventType: "QR access",
        amountGbp: 0.5,
        useFreeTicket: false
      });

      renderAccount({ walletBalance, subscriptionPlan, monthlyTicketsLeft }, payload.account);
      renderAccessHistory(accessHistoryList, payload.history);
      setActivationStatus(activationStatus, "Pass activated. Access record saved to database.");
      showCleanlinessSurvey(activatedToilet);
    } catch (error) {
      console.error("Activation failed:", error);
      setActivationStatus(activationStatus, "Could not save access record. Please try again.");
    } finally {
      activatePassButton.disabled = false;
    }
  }

  function updateTicketToilet(toilet) {
    if (!ticketToiletName || !toilet?.paid) return;
    ticketToilet = toilet;
    ticketToiletName.textContent = `${toilet.name} Toilet`;
  }

  function bindEvents() {
    activatePassButton?.addEventListener("click", activatePass);
    surveyCleanYesButton?.addEventListener("click", () => answerCleanlinessSurvey("yes"));
    surveyCleanNoButton?.addEventListener("click", () => answerCleanlinessSurvey("no"));
    closeSurveyButton?.addEventListener("click", hideCleanlinessSurvey);
  }

  return {
    bindEvents,
    loadPanelData,
    updateTicketToilet
  };
}
