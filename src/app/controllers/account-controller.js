import {
  fetchAccountSnapshot,
  fetchPublicProfile,
  fetchToiletReports,
  fetchToiletSubmissions,
  loginUser,
  registerUser,
  logoutUser,
  getCurrentUser,
  reviewToiletSubmission,
  reviewToiletReport,
  updateUserProfile,
  updateCommentProfileVisibility
} from "../services/account-service.js";
import {
  renderAccessHistory,
  renderAccount,
  renderMyComments,
  renderPublicProfile,
  renderToiletReports,
  renderToiletSubmissions
} from "../views/account-view.js";

export function createAccountController(elements, onProfilePreferenceToggled = () => {}, callbacks = {}) {
  const {
    accessHistoryList,
    myCommentsList,
    accountActivityTabs,
    accountActivityPanels,
    accountOwnView,
    publicProfileView,
    publicProfileBackButton,
    publicProfileUsername,
    publicProfileSummary,
    publicProfileCommentsList,
    submissionReviewList,
    toiletReportReviewList,
    accountWelcome,
    accountUsername,
    authModal,
    signupIntro,
    signupIntroVideo,
    signupIntroSkipButton,
    authForm,
    closeAuthButton,
    authTitle,
    authSubmit,
    authToggle,
    authSwitchCopy,
    authStatus,
    authUsername,
    authPassword,
    authConfirmPassword,
    authEmail,
    emailGroup,
    confirmPasswordGroup,
    accountSettingsButton,
    accountSettingsPanel,
    logoutButton,
    accountUnlockCard,
    accountSignupButton,
    accountLoginButton,
    profileModal,
    profileForm,
    profileGender,
    profileNeeds,
    skipProfileButton,
    displayGender,
    displayNeeds,
    autoFilterToggle,
    editProfileButton,
    creditsButton,
    creditsModal,
    closeCreditsButton,
    dismissCreditsButton
  } = elements;
  const {
    onCommentSelected = () => {},
    onAccessHistorySelected = () => {},
    onToiletSubmissionReviewed = () => {},
    onToiletReportReviewed = () => {}
  } = callbacks;

  const autoFilterStorageKey = "wheretoi-auto-filter-enabled";
  let currentUser = null;
  let isRegisterMode = false;
  let signupIntroActive = false;
  let publicProfileActive = false;
  let activePublicProfileUserId = null;
  let activeAccountActivityTab = "feedback";

  function loadAutoFilterState() {
    return window.localStorage?.getItem(autoFilterStorageKey) === "true";
  }

  function saveAutoFilterState(enabled) {
    window.localStorage?.setItem(autoFilterStorageKey, enabled ? "true" : "false");
  }

  function showOwnAccountView() {
    publicProfileActive = false;
    activePublicProfileUserId = null;
    publicProfileView?.classList.add("is-hidden");
    accountOwnView?.classList.remove("is-hidden");
  }

  function showPublicProfileView(userId) {
    publicProfileActive = true;
    activePublicProfileUserId = String(userId);
    hideSettingsPanel();
    accountOwnView?.classList.add("is-hidden");
    publicProfileView?.classList.remove("is-hidden");
  }

  function showPublicProfileMessage(message) {
    if (!publicProfileCommentsList) return;
    publicProfileCommentsList.textContent = "";
    const info = document.createElement("p");
    info.textContent = message;
    publicProfileCommentsList.append(info);
  }

  function handleAutoFilterToggle() {
    const enabled = autoFilterToggle?.checked ?? false;
    saveAutoFilterState(enabled);
    onProfilePreferenceToggled(currentUser, enabled);
  }

  function showAuthModal(mode = isRegisterMode ? "register" : "login", message = "") {
    hideSettingsPanel();
    setAuthMode(mode);
    authModal?.classList.remove("is-hidden");
    if (authStatus) authStatus.textContent = message;
  }

  function hideAuthModal() {
    authModal?.classList.add("is-hidden");
  }

  function focusAuthStartField() {
    window.setTimeout(() => {
      if (isRegisterMode && authEmail && !emailGroup?.classList.contains("is-hidden")) {
        authEmail.focus();
        return;
      }

      authUsername?.focus();
    }, 0);
  }

  function finishSignupIntro(message = "") {
    if (!signupIntroActive) return;
    signupIntroActive = false;
    signupIntro?.classList.add("is-hidden");
    signupIntro?.setAttribute("aria-hidden", "true");

    if (signupIntroVideo) {
      signupIntroVideo.pause();
      signupIntroVideo.muted = false;
      try {
        signupIntroVideo.currentTime = 0;
      } catch {
        // Some browsers reject seeking before metadata is ready.
      }
    }

    showAuthModal("register", message);
    focusAuthStartField();
  }

  function startSignupIntro() {
    hideSettingsPanel();
    hideAuthModal();

    if (!signupIntro || !signupIntroVideo) {
      showAuthModal("register");
      focusAuthStartField();
      return;
    }

    signupIntroActive = true;
    signupIntro.classList.remove("is-hidden");
    signupIntro.removeAttribute("aria-hidden");

    try {
      signupIntroVideo.currentTime = 0;
    } catch {
      // The browser can start playback from the beginning once metadata arrives.
    }
    signupIntroVideo.muted = false;

    const playAttempt = signupIntroVideo.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {
        if (!signupIntroActive) return;
        signupIntroVideo.muted = true;
        const mutedPlayAttempt = signupIntroVideo.play();
        if (mutedPlayAttempt && typeof mutedPlayAttempt.catch === "function") {
          mutedPlayAttempt.catch(() => {
            finishSignupIntro("Intro video could not be played. Continue sign up below.");
          });
        }
      });
    }
  }

  function showProfileModal() {
    hideSettingsPanel();
    profileModal?.classList.remove("is-hidden");
  }

  function hideProfileModal() {
    profileModal?.classList.add("is-hidden");
  }

  function showCreditsModal() {
    hideSettingsPanel();
    creditsModal?.classList.remove("is-hidden");
  }

  function hideCreditsModal() {
    creditsModal?.classList.add("is-hidden");
  }

  function setAuthMode(mode) {
    isRegisterMode = mode === "register";
    if (authTitle) authTitle.textContent = isRegisterMode ? "Sign up for WhereToI" : "Log in to WhereToI";
    if (authSubmit) authSubmit.textContent = isRegisterMode ? "Sign up" : "Log in";
    if (authToggle) authToggle.textContent = isRegisterMode ? "Log in" : "Sign up";
    if (authSwitchCopy) authSwitchCopy.textContent = isRegisterMode ? "Already have an account?" : "Don't have an account?";
    if (emailGroup) emailGroup.classList.toggle("is-hidden", !isRegisterMode);
    if (authEmail) authEmail.required = isRegisterMode;
    if (confirmPasswordGroup) confirmPasswordGroup.classList.toggle("is-hidden", !isRegisterMode);
    if (authConfirmPassword) authConfirmPassword.required = isRegisterMode;
    if (authPassword) authPassword.autocomplete = isRegisterMode ? "new-password" : "current-password";
  }

  function handleAuthToggle() {
    if (isRegisterMode) {
      setAuthMode("login");
      return;
    }

    startSignupIntro();
  }

  function setSettingsPanelOpen(isOpen) {
    accountSettingsPanel?.classList.toggle("is-hidden", !isOpen);
    accountSettingsButton?.setAttribute("aria-expanded", String(isOpen));
  }

  function isSettingsPanelOpen() {
    return Boolean(accountSettingsPanel && !accountSettingsPanel.classList.contains("is-hidden"));
  }

  function toggleSettingsPanel() {
    setSettingsPanelOpen(!isSettingsPanelOpen());
  }

  function hideSettingsPanel() {
    setSettingsPanelOpen(false);
  }

  function setAccountActivityTab(tabKey) {
    const nextTab = tabKey || "feedback";
    activeAccountActivityTab = nextTab;

    accountActivityTabs?.forEach((button) => {
      const isActive = button.dataset.accountActivityTab === nextTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    accountActivityPanels?.forEach((panel) => {
      const isActive = panel.dataset.accountActivityPanel === nextTab;
      panel.classList.toggle("is-hidden", !isActive);
      panel.hidden = !isActive;
    });
  }

  function isCurrentUserAdmin() {
    return Boolean(currentUser?.isAdmin || currentUser?.is_admin);
  }

  function syncReviewTabVisibility() {
    const adminReviewTabs = Array.from(accountActivityTabs ?? []).filter(
      (button) => button.dataset.accountActivityTab?.startsWith("review-")
    );
    const adminReviewPanels = Array.from(accountActivityPanels ?? []).filter(
      (panel) => panel.dataset.accountActivityPanel?.startsWith("review-")
    );
    const showReview = isCurrentUserAdmin();

    adminReviewTabs.forEach((reviewTab) => {
      reviewTab.hidden = !showReview;
      reviewTab.classList.toggle("is-hidden", !showReview);
    });

    if (!showReview && activeAccountActivityTab.startsWith("review-")) {
      setAccountActivityTab("feedback");
    } else if (!showReview) {
      adminReviewPanels.forEach((reviewPanel) => {
        reviewPanel.hidden = true;
        reviewPanel.classList.add("is-hidden");
      });
    }
  }

  async function loadAddedToiletsForReview() {
    if (!isCurrentUserAdmin()) {
      renderToiletSubmissions(submissionReviewList, []);
      return;
    }

    if (submissionReviewList) {
      submissionReviewList.textContent = "";
      const loading = document.createElement("p");
      loading.textContent = "Loading pending submissions...";
      submissionReviewList.append(loading);
    }
    try {
      const payload = await fetchToiletSubmissions("pending");
      renderToiletSubmissions(submissionReviewList, payload.submissions, {
        onReviewSubmission: handleReviewSubmission
      });
    } catch (error) {
      console.error("Toilet submissions loading failed:", error);
      if (submissionReviewList) {
        submissionReviewList.textContent = "";
        const message = document.createElement("p");
        message.textContent = error?.message || "Could not load pending submissions.";
        submissionReviewList.append(message);
      }
    }
  }

  async function loadToiletReportsForReview() {
    if (!isCurrentUserAdmin()) {
      renderToiletReports(toiletReportReviewList, []);
      return;
    }

    if (toiletReportReviewList) {
      toiletReportReviewList.textContent = "";
      const loading = document.createElement("p");
      loading.textContent = "Loading pending reports...";
      toiletReportReviewList.append(loading);
    }

    try {
      const payload = await fetchToiletReports("pending");
      renderToiletReports(toiletReportReviewList, payload.reports, {
        onReviewReport: handleReviewReport
      });
    } catch (error) {
      console.error("Toilet reports loading failed:", error);
      if (toiletReportReviewList) {
        toiletReportReviewList.textContent = "";
        const message = document.createElement("p");
        message.textContent = error?.message || "Could not load pending reports.";
        toiletReportReviewList.append(message);
      }
    }
  }

  function handleAccountActivityTabClick(event) {
    const button = event.currentTarget;
    const nextTab = button?.dataset?.accountActivityTab;
    if (!nextTab) return;
    setAccountActivityTab(nextTab);
    if (nextTab === "review-additions") {
      void loadAddedToiletsForReview();
    } else if (nextTab === "review-reports") {
      void loadToiletReportsForReview();
    }
  }

  function handleDocumentClick(event) {
    if (!isSettingsPanelOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (accountSettingsPanel?.contains(target) || accountSettingsButton?.contains(target)) return;
    hideSettingsPanel();
  }

  function handleDocumentKeydown(event) {
    if (event.key !== "Escape" || !isSettingsPanelOpen()) return;
    hideSettingsPanel();
    accountSettingsButton?.focus();
  }

  function renderGuestAccount() {
    currentUser = null;
    syncReviewTabVisibility();

    accountUnlockCard?.classList.remove("is-hidden");
    logoutButton?.classList.add("is-hidden");

    if (accountWelcome) accountWelcome.textContent = "Welcome";
    if (accountUsername) accountUsername.textContent = "Guest access";
    if (displayGender) displayGender.textContent = "Sign up to set";
    if (displayNeeds) displayNeeds.textContent = "Sign up to set";

    if (accessHistoryList) {
      accessHistoryList.replaceChildren();
      const empty = document.createElement("div");
      const info = document.createElement("p");
      info.textContent = "Create an account to save and view toilet access history.";
      empty.append(info);
      accessHistoryList.append(empty);
    }

    if (myCommentsList) {
      myCommentsList.replaceChildren();
      const info = document.createElement("p");
      info.textContent = "Create an account to see and manage your feedback.";
      myCommentsList.append(info);
    }

    if (autoFilterToggle) {
      autoFilterToggle.checked = false;
      autoFilterToggle.disabled = true;
    }

    if (editProfileButton) {
      editProfileButton.disabled = true;
    }

    onProfilePreferenceToggled(null, false);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (authStatus) authStatus.textContent = isRegisterMode ? "Creating account..." : "Logging in...";

    const payload = {
      username: authUsername.value,
      password: authPassword.value,
      email: isRegisterMode ? authEmail.value : undefined
    };

    if (isRegisterMode && payload.password !== authConfirmPassword?.value) {
      if (authStatus) authStatus.textContent = "Passwords do not match.";
      return;
    }

    try {
      if (isRegisterMode) {
        await registerUser(payload);
        if (authStatus) authStatus.textContent = "Account created! Now logging in...";
        await loginUser({ username: payload.username, password: payload.password });
        hideAuthModal();
        await loadPanelData({ forceOwn: true });
        showProfileModal();
      } else {
        await loginUser(payload);
        hideAuthModal();
        await loadPanelData({ forceOwn: true });
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
      await loadPanelData({ forceOwn: true });
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

  function handleOpenComment(comment) {
    if (!comment?.toilet_id || !comment?.id) return;
    onCommentSelected({
      toiletId: comment.toilet_id,
      commentId: comment.id
    });
  }

  function handleOpenAccessHistory(entry) {
    if (!entry?.toiletId) return;
    onAccessHistorySelected({
      toiletId: entry.toiletId,
      historyId: entry.id
    });
  }

  async function handleSetCommentProfileVisibility(comment, profileVisibility, button) {
    if (!comment?.id) return;

    if (button) {
      button.disabled = true;
    }

    try {
      const payload = await updateCommentProfileVisibility(comment.id, profileVisibility);
      renderMyComments(myCommentsList, payload.comments, {
        onOpenComment: handleOpenComment,
        onSetProfileVisibility: handleSetCommentProfileVisibility
      });
    } catch (error) {
      console.error("Comment profile visibility update failed:", error);
      alert(error?.message || "Could not update comment visibility. Please try again later.");
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function handleReviewSubmission(submission, status, button) {
    if (!submission?.id || !isCurrentUserAdmin()) return;

    if (button) {
      button.disabled = true;
    }

    try {
      await reviewToiletSubmission({
        toiletId: submission.id,
        status
      });
      await loadAddedToiletsForReview();
      await onToiletSubmissionReviewed(status);
    } catch (error) {
      console.error("Toilet submission review failed:", error);
      alert(error?.message || "Could not review this toilet submission.");
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function handleReviewReport(report, action, button) {
    if (!report?.id || !isCurrentUserAdmin()) return;
    if (action === "remove") {
      const confirmed = globalThis.confirm?.(
        `Remove ${report.toiletName || "this toilet"} and its feedback from the public map?`
      );
      if (!confirmed) return;
    }

    if (button) button.disabled = true;
    try {
      await reviewToiletReport({
        reportId: report.id,
        action
      });
      await loadToiletReportsForReview();
      await onToiletReportReviewed(action);
    } catch (error) {
      console.error("Toilet report review failed:", error);
      alert(error?.message || "Could not review this toilet report.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadPublicProfile(userId) {
    if (!userId) return;

    const requestUserId = String(userId);
    showPublicProfileView(requestUserId);
    if (publicProfileUsername) publicProfileUsername.textContent = "Profile";
    if (publicProfileSummary) publicProfileSummary.textContent = "Loading public feedback...";
    showPublicProfileMessage("Loading profile...");

    try {
      const payload = await fetchPublicProfile(requestUserId);
      if (!publicProfileActive || activePublicProfileUserId !== requestUserId) return;
      renderPublicProfile(
        { publicProfileUsername, publicProfileSummary, publicProfileCommentsList },
        payload.profile,
        { onOpenComment: handleOpenComment }
      );
    } catch (error) {
      console.error("Public profile loading failed:", error);
      if (!publicProfileActive || activePublicProfileUserId !== requestUserId) return;
      if (publicProfileUsername) publicProfileUsername.textContent = "Profile unavailable";
      if (publicProfileSummary) publicProfileSummary.textContent = "Public feedback could not be loaded.";
      showPublicProfileMessage(error?.message || "Could not load this profile.");
    }
  }

  async function handlePublicProfileBack() {
    showOwnAccountView();
    await loadPanelData({ forceOwn: true });
  }

  async function loadPanelData({ forceOwn = false } = {}) {
    if (publicProfileActive && !forceOwn) return;
    if (forceOwn) showOwnAccountView();

    try {
      // First, check if we are logged in
      const me = await getCurrentUser();
      currentUser = me.user;
      if (publicProfileActive && !forceOwn) return;
      accountUnlockCard?.classList.add("is-hidden");
      logoutButton?.classList.remove("is-hidden");
      syncReviewTabVisibility();

      if (autoFilterToggle) {
        autoFilterToggle.disabled = false;
        autoFilterToggle.checked = loadAutoFilterState();
        if (autoFilterToggle.checked) {
          onProfilePreferenceToggled(currentUser, true);
        }
      }

      if (editProfileButton) {
        editProfileButton.disabled = false;
      }

      const payload = await fetchAccountSnapshot();
      if (publicProfileActive && !forceOwn) return;
      renderAccount(
        { accountUsername, accountWelcome, displayGender, displayNeeds },
        payload.account,
        currentUser
      );
      renderAccessHistory(accessHistoryList, payload.history, {
        onOpenToilet: handleOpenAccessHistory
      });
      renderMyComments(myCommentsList, payload.comments, {
        onOpenComment: handleOpenComment,
        onSetProfileVisibility: handleSetCommentProfileVisibility
      });
      if (isCurrentUserAdmin() && activeAccountActivityTab === "review-additions") {
        await loadAddedToiletsForReview();
      } else if (isCurrentUserAdmin() && activeAccountActivityTab === "review-reports") {
        await loadToiletReportsForReview();
      }
    } catch (error) {
      console.error("Account API failed:", error);
      if (publicProfileActive && !forceOwn) return;
      if (error.message?.includes("authenticated") || error.status === 401) {
        renderGuestAccount();
      }
    }
  }

  function bindEvents() {
    authForm?.addEventListener("submit", handleAuthSubmit);
    authToggle?.addEventListener("click", handleAuthToggle);
    closeAuthButton?.addEventListener("click", hideAuthModal);
    signupIntroVideo?.addEventListener("ended", () => finishSignupIntro());
    signupIntroVideo?.addEventListener("error", () => {
      finishSignupIntro("Intro video could not be loaded. Continue sign up below.");
    });
    signupIntroSkipButton?.addEventListener("click", () => finishSignupIntro());
    accountActivityTabs?.forEach((button) => {
      button.addEventListener("click", handleAccountActivityTabClick);
    });
    setAccountActivityTab(activeAccountActivityTab);
    accountSettingsButton?.addEventListener("click", toggleSettingsPanel);
    logoutButton?.addEventListener("click", handleLogout);
    accountSignupButton?.addEventListener("click", startSignupIntro);
    accountLoginButton?.addEventListener("click", () => showAuthModal("login"));
    publicProfileBackButton?.addEventListener("click", () => handlePublicProfileBack());

    profileForm?.addEventListener("submit", handleProfileSubmit);
    skipProfileButton?.addEventListener("click", hideProfileModal);
    editProfileButton?.addEventListener("click", handleEditProfile);
    autoFilterToggle?.addEventListener("change", handleAutoFilterToggle);

    creditsButton?.addEventListener("click", showCreditsModal);
    closeCreditsButton?.addEventListener("click", hideCreditsModal);
    dismissCreditsButton?.addEventListener("click", hideCreditsModal);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeydown);
  }

  return {
    bindEvents,
    loadPanelData,
    loadPublicProfile,
    showAuthModal,
    isAuthenticated: () => Boolean(currentUser)
  };
}
