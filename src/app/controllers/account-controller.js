import {
  fetchAccountSnapshot,
  loginUser,
  registerUser,
  logoutUser,
  getCurrentUser,
  updateUserProfile,
  updateCommentProfileVisibility
} from "../services/account-service.js";
import { renderAccessHistory, renderAccount, renderMyComments } from "../views/account-view.js";

export function createAccountController(elements, onProfilePreferenceToggled = () => {}, callbacks = {}) {
  const {
    walletBalance,
    subscriptionPlan,
    monthlyTicketsLeft,
    accessHistoryList,
    myCommentsList,
    accountWelcome,
    accountUsername,
    authModal,
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
    editProfileButton
  } = elements;
  const { onCommentSelected = () => {} } = callbacks;

  const autoFilterStorageKey = "wheretoi-auto-filter-enabled";
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

  function showAuthModal(mode = isRegisterMode ? "register" : "login", message = "") {
    setAuthMode(mode);
    authModal?.classList.remove("is-hidden");
    if (authStatus) authStatus.textContent = message;
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

  function toggleAuthMode() {
    setAuthMode(isRegisterMode ? "login" : "register");
  }

  function renderGuestAccount() {
    currentUser = null;

    accountUnlockCard?.classList.remove("is-hidden");
    logoutButton?.classList.add("is-hidden");

    if (accountWelcome) accountWelcome.textContent = "Welcome";
    if (accountUsername) accountUsername.textContent = "Guest access";
    if (walletBalance) walletBalance.textContent = "Sign up to view";
    if (subscriptionPlan) subscriptionPlan.textContent = "Create an account to manage a plan.";
    if (monthlyTicketsLeft) monthlyTicketsLeft.textContent = "Sign up";
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
      info.textContent = "Create an account to see and manage your comments.";
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

  function handleOpenComment(comment) {
    if (!comment?.toilet_id || !comment?.id) return;
    onCommentSelected({
      toiletId: comment.toilet_id,
      commentId: comment.id
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

  async function loadPanelData() {
    try {
      // First, check if we are logged in
      const me = await getCurrentUser();
      currentUser = me.user;
      accountUnlockCard?.classList.add("is-hidden");
      logoutButton?.classList.remove("is-hidden");

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
      renderAccount(
        { walletBalance, subscriptionPlan, monthlyTicketsLeft, accountUsername, accountWelcome, displayGender, displayNeeds },
        payload.account,
        currentUser
      );
      renderAccessHistory(accessHistoryList, payload.history);
      renderMyComments(myCommentsList, payload.comments, {
        onOpenComment: handleOpenComment,
        onSetProfileVisibility: handleSetCommentProfileVisibility
      });
    } catch (error) {
      console.error("Account API failed:", error);
      if (error.message?.includes("authenticated") || error.status === 401) {
        renderGuestAccount();
      }
    }
  }

  function bindEvents() {
    authForm?.addEventListener("submit", handleAuthSubmit);
    authToggle?.addEventListener("click", toggleAuthMode);
    closeAuthButton?.addEventListener("click", hideAuthModal);
    logoutButton?.addEventListener("click", handleLogout);
    accountSignupButton?.addEventListener("click", () => showAuthModal("register"));
    accountLoginButton?.addEventListener("click", () => showAuthModal("login"));

    profileForm?.addEventListener("submit", handleProfileSubmit);
    skipProfileButton?.addEventListener("click", hideProfileModal);
    editProfileButton?.addEventListener("click", handleEditProfile);
    autoFilterToggle?.addEventListener("change", handleAutoFilterToggle);
  }

  return {
    bindEvents,
    loadPanelData,
    showAuthModal,
    isAuthenticated: () => Boolean(currentUser)
  };
}
