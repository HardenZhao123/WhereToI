import { formatAccessTime, formatCharge, formatCurrency, formatRenewDate } from "../utils/account-formatters.js";

export function setActivationStatus(element, message) {
  if (!element) return;
  element.textContent = message;
}

export function renderAccount({ walletBalance, subscriptionPlan, monthlyTicketsLeft }, account) {
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

export function renderAccessHistory(historyContainer, history) {
  if (!historyContainer) return;

  historyContainer.textContent = "";

  if (!Array.isArray(history) || history.length === 0) {
    const empty = document.createElement("div");
    const info = document.createElement("p");
    info.textContent = "No access history yet.";
    empty.append(info);
    historyContainer.append(empty);
    return;
  }

  history.forEach((entry) => {
    const block = document.createElement("div");
    const heading = document.createElement("strong");
    const line = document.createElement("p");

    heading.textContent = entry.toiletName || "Unknown toilet";
    line.textContent = `${formatAccessTime(entry.accessTime)} - ${entry.eventType || "Access"} - ${formatCharge(entry.amountGbp)}`;

    block.append(heading, line);
    historyContainer.append(block);
  });
}
