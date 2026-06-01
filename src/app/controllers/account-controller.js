import { fetchAccountSnapshot, saveAccessRecord, loginUser, registerUser, logoutUser, getCurrentUser, updateUserProfile } from "../services/account-service.js";
import { submitCleanlinessSurvey } from "../services/toilets-service.js";
import { renderAccessHistory, renderAccount, setActivationStatus } from "../views/account-view.js";

export function createAccountController(elements, getSelectedToilet, onCleanlinessUpdated = () => {}, onProfilePreferenceToggled = () => {}) {
  const {
    activatePassButton,
    activationStatus,
    walletBalance,
    subscriptionPlan,
    monthlyTicketsLeft,
    accessHistoryList,
    accountWelcome,
    accountUsername,
    ticketToiletName,
    ticketPrice,
    surveyModal,
    surveyCleanYesButton,
    surveyCleanNoButton,
    closeSurveyButton,
    surveyQuestion,
    surveyStatus,
    authModal,
    authForm,
    authTitle,
    authSubmit,
    authToggle,
    authStatus,
    authUsername,
    authPassword,
    authEmail,
    emailGroup,
    logoutButton,
    profileModal,
    profileForm,
    profileGender,
    profileNeeds,
    skipProfileButton,
    displayGender,
    displayNeeds,
    autoFilterToggle,
    editProfileButton
  } = elements;

  const surveyStorageKey = "wheretoi-qr-cleanliness-survey";
  const autoFilterStorageKey = "wheretoi-auto-filter-enabled";
  let pendingSurveyToilet = null;
  let ticketToilet = null;
  let currentUser = null;
  let isRegisterMode = false;

  function loadAutoFilterState() {
    return window.localStorage?.getItem(autoFilterStorageKey) === "true";
  }

  function saveAutoFilterState(enabled) {
    window.localStorage?.setItem(autoFilterStorageKey, enabled ? "true" : "false");
  }

  function handleAutoFilterToggle() {
    const enabled = autoFilterToggle?.checked ?? false;
    saveAutoFilterState(enabled);
    onProfilePreferenceToggled(currentUser, enabled);
  }

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

  function showAuthModal() {
    authModal?.classList.remove("is-hidden");
    authStatus.textContent = "";
  }

  function hideAuthModal() {
    authModal?.classList.add("is-hidden");
  }

  function showProfileModal() {
    profileModal?.classList.remove("is-hidden");
  }

  function hideProfileModal() {
    profileModal?.classList.add("is-hidden");
  }

  function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    if (authTitle) authTitle.textContent = isRegisterMode ? "Sign up for WhereToI" : "Log in to WhereToI";
    if (authSubmit) authSubmit.textContent = isRegisterMode ? "Sign up" : "Log in";
    if (authToggle) authToggle.textContent = isRegisterMode ? "Log in" : "Sign up";
    if (emailGroup) emailGroup.classList.toggle("is-hidden", !isRegisterMode);
    if (authEmail) authEmail.required = isRegisterMode;
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (authStatus) authStatus.textContent = isRegisterMode ? "Creating account..." : "Logging in...";

    const payload = {
      username: authUsername.value,
      password: authPassword.value,
      email: isRegisterMode ? authEmail.value : undefined
    };

    try {
      if (isRegisterMode) {
        await registerUser(payload);
        if (authStatus) authStatus.textContent = "Account created! Now logging in...";
        await loginUser({ username: payload.username, password: payload.password });
        hideAuthModal();
        await loadPanelData();
        showProfileModal();
      } else {
        await loginUser(payload);
        hideAuthModal();
        await loadPanelData();
      }
    } catch (error) {
      console.error("Auth failed:", error);
      if (authStatus) authStatus.textContent = error.message || "Authentication failed. Please try again.";
    }
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    
    const preferences = [];
    profileNeeds?.forEach(checkbox => {
      if (checkbox.checked) preferences.push(checkbox.value);
    });

    try {
      await updateUserProfile({
        gender: profileGender?.value || null,
        preferences: preferences
      });
      hideProfileModal();
      await loadPanelData();
    } catch (error) {
      console.error("Profile update failed:", error);
      alert("Could not save profile. You can try again later in the Account settings.");
      hideProfileModal();
    }
  }

  function handleEditProfile() {
    if (!currentUser) return;

    if (profileGender) {
      profileGender.value = currentUser.gender || "";
    }

    if (profileNeeds) {
      try {
        const preferences = JSON.parse(currentUser.preferences || "[]");
        profileNeeds.forEach(checkbox => {
          checkbox.checked = preferences.includes(checkbox.value);
        });
      } catch {
        profileNeeds.forEach(checkbox => checkbox.checked = false);
      }
    }

    showProfileModal();
  }

  async function handleLogout() {
    try {
      await logoutUser();
      currentUser = null;
      window.location.reload(); // Simplest way to clear state
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  async function loadPanelData() {
    try {
      // First, check if we are logged in
      const me = await getCurrentUser();
      currentUser = me.user;

      if (autoFilterToggle) {
        autoFilterToggle.checked = loadAutoFilterState();
        if (autoFilterToggle.checked) {
          onProfilePreferenceToggled(currentUser, true);
        }
      }

      const payload = await fetchAccountSnapshot();
      renderAccount(
        { walletBalance, subscriptionPlan, monthlyTicketsLeft, accountUsername, accountWelcome, displayGender, displayNeeds },
        payload.account,
        currentUser
      );
      renderAccessHistory(accessHistoryList, payload.history);
      setActivationStatus(activationStatus, `Welcome, ${currentUser.username}. Database connected.`);
      if (activatePassButton) activatePassButton.disabled = false;
    } catch (error) {
      console.error("Account API failed:", error);
      if (error.message?.includes("authenticated") || error.status === 401) {
        setActivationStatus(activationStatus, "Log in to access your wallet and history.");
        showAuthModal();
      } else {
        setActivationStatus(activationStatus, "Database API unavailable. Pass activation is disabled.");
      }

      if (activatePassButton) {
        activatePassButton.disabled = true;
      }
    }
  }

  async function activatePass() {
    if (!activatePassButton) return;

    if (!currentUser) {
      showAuthModal();
      return;
    }

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
      if (error.message?.includes("authenticated") || error.status === 401) {
        showAuthModal();
      } else {
        setActivationStatus(activationStatus, "Could not save access record. Please try again.");
      }
    } finally {
      activatePassButton.disabled = false;
    }
  }

  function updateTicketToilet(toilet) {
    if (!ticketToiletName || !toilet?.paid) return;
    ticketToilet = toilet;
    ticketToiletName.textContent = `${toilet.name} Toilet`;
    if (ticketPrice) {
      ticketPrice.textContent = "GBP 0.50";
    }
  }

  function bindEvents() {
    activatePassButton?.addEventListener("click", activatePass);
    surveyCleanYesButton?.addEventListener("click", () => answerCleanlinessSurvey("yes"));
    surveyCleanNoButton?.addEventListener("click", () => answerCleanlinessSurvey("no"));
    closeSurveyButton?.addEventListener("click", hideCleanlinessSurvey);

    authForm?.addEventListener("submit", handleAuthSubmit);
    authToggle?.addEventListener("click", toggleAuthMode);
    logoutButton?.addEventListener("click", handleLogout);

    profileForm?.addEventListener("submit", handleProfileSubmit);
    skipProfileButton?.addEventListener("click", hideProfileModal);
    editProfileButton?.addEventListener("click", handleEditProfile);
    autoFilterToggle?.addEventListener("change", handleAutoFilterToggle);
  }

  return {
    bindEvents,
    loadPanelData,
    updateTicketToilet
  };
}
