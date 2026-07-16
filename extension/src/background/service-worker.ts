import { DailyFocus, ExtensionMessage, PageSignal, SessionMetrics } from "../shared/types";
import { getMoodiSettings } from "../shared/settings";
import {
  recordTabSwitch,
  recordPageSignal,
  recordOpenTabCount,
  initializeBrowserFocusState,
  recordBrowserFocusChange,
  getSessionMetrics,
  flushSession,
  endCurrentSession,
  initializeSessionIdentity,
  signInBackgroundWithToken,
  startNewSessionIdentity,
  startFlushTimer,
} from "./session-bundler";

// ─── State ────────────────────────────────────────────────────────────────────

let previousUrl = "";
let lastPageSignalTs = Date.now();
let lastContinuousIdleMs = 0;
let idleOverlayShown = false;

const CURRENT_FOCUS_KEY = "moodiCurrentDailyFocus";
const LAST_NOTIFICATION_KEY = "moodiLastRecommendationNotification";
const NOTIFICATION_ALARM_NAME = "moodiRecommendationCheck";
// Demo timing for documentation screenshots. Revert after capturing screenshots.
const NOTIFICATION_CHECK_INTERVAL_MS = 30 * 1000;
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;
const SLEEP_SIGNAL_GAP_MS = 5 * 60 * 1000;
const LAST_ACTIVE_GRACE_MS = 15 * 1000;
const IDLE_OVERLAY_THRESHOLD_MS = 15 * 60 * 1000;
const IDLE_SIGNAL_STATE_KEY = "moodiIdleSignalState";

interface StoredDailyFocus {
  date: string;
  focus: DailyFocus;
}

interface StoredNotification {
  id: string;
  shownAt: number;
}

async function isTrackingEnabled() {
  const settings = await getMoodiSettings();
  return settings.trackingEnabled;
}

async function isOverlayEnabled() {
  const settings = await getMoodiSettings();
  return settings.overlayEnabled;
}

function isTrackableUrl(url?: string) {
  if (!url || url.startsWith("chrome://") || url.startsWith("edge://")) return false;
  if (!url.startsWith("chrome-extension://")) return true;

  return Boolean(getPdfViewerSourceUrl(url));
}

function getTrackableUrl(url: string) {
  return getPdfViewerSourceUrl(url) ?? url;
}

function getPdfViewerSourceUrl(url: string) {
  try {
    const parsed = new URL(url);
    const sourceUrl = parsed.searchParams.get("src");

    if (parsed.protocol === "chrome-extension:" && sourceUrl) {
      return decodeURIComponent(sourceUrl);
    }
  } catch {
    return null;
  }

  return null;
}

async function updateOpenTabCount() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  recordOpenTabCount(tabs.length);
}

async function seedBrowserFocusState() {
  const window = await chrome.windows.getLastFocused().catch(() => null);
  initializeBrowserFocusState(Boolean(window?.focused));
}

async function handleBrowserFocusChange(windowId: number) {
  if (!(await isTrackingEnabled())) return;

  recordBrowserFocusChange(windowId !== chrome.windows.WINDOW_ID_NONE);
  lastPageSignalTs = Date.now();
}

async function restoreIdleSignalState() {
  const stored = await chrome.storage.local.get(IDLE_SIGNAL_STATE_KEY);
  const state = stored[IDLE_SIGNAL_STATE_KEY] as
    | { lastContinuousIdleMs?: number; idleOverlayShown?: boolean }
    | undefined;

  if (typeof state?.lastContinuousIdleMs === "number") {
    lastContinuousIdleMs = state.lastContinuousIdleMs;
  }

  if (typeof state?.idleOverlayShown === "boolean") {
    idleOverlayShown = state.idleOverlayShown;
  }
}

function persistIdleSignalState() {
  chrome.storage.local.set({
    [IDLE_SIGNAL_STATE_KEY]: {
      lastContinuousIdleMs,
      idleOverlayShown,
    },
  });
}

function resetIdleSignalState() {
  lastContinuousIdleMs = 0;
  idleOverlayShown = false;
  persistIdleSignalState();
}

async function seedActiveTab() {
  if (!(await isTrackingEnabled())) return;

  const [tab] = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .catch(() => []);

  if (!isTrackableUrl(tab?.url)) return;

  const url = getTrackableUrl(tab!.url!);
  recordTabSwitch("", url);
  previousUrl = url;
  lastPageSignalTs = Date.now();
  resetIdleSignalState();
}

async function startFreshSessionFromCurrentTab() {
  previousUrl = "";
  await startNewSessionIdentity();
  await seedBrowserFocusState();
  await seedActiveTab();
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getCurrentDailyFocus(): Promise<DailyFocus | null> {
  const stored = await chrome.storage.local.get(CURRENT_FOCUS_KEY);
  const value = stored[CURRENT_FOCUS_KEY] as Partial<StoredDailyFocus> | undefined;

  if (
    value &&
    value.date === getTodayKey() &&
    (value.focus === "academic" || value.focus === "casual")
  ) {
    return value.focus;
  }

  return null;
}

function getNotificationRecommendation(
  metrics: SessionMetrics,
  focus: DailyFocus
) {
  const activeMinutes = metrics.totalActiveMs / 60000;
  const productiveMs =
    (metrics.categoryBreakdown.productive ?? 0) +
    (metrics.categoryBreakdown.reference ?? 0);
  const distractionMs =
    (metrics.categoryBreakdown.social ?? 0) +
    (metrics.categoryBreakdown.entertainment ?? 0);
  const productiveRatio = productiveMs / Math.max(metrics.totalActiveMs, 1);
  const distractionRatio = distractionMs / Math.max(metrics.totalActiveMs, 1);
  const tabSwitchesPerHour =
    metrics.tabSwitches / Math.max(metrics.totalActiveMs / 3600000, 0.25);

  if (focus === "academic" && activeMinutes >= 5 && productiveRatio >= 0.55) {
    return {
      id: "academic-long-reset",
      title: "Time for a 15 minute reset",
      message:
        "You have been in a long research or work stretch. Step away, hydrate, and rest your eyes.",
    };
  }

  if (focus === "academic" && activeMinutes >= 3 && productiveRatio >= 0.55) {
    return {
      id: "academic-short-break",
      title: "Plan a short break soon",
      message:
        "You have crossed about an hour of focused activity. A 10 minute pause can help protect your attention.",
    };
  }

  if (focus === "academic" && tabSwitchesPerHour >= 30 && metrics.tabSwitches >= 6) {
    return {
      id: "academic-context-switching",
      title: "Reduce context switching",
      message:
        "Your tab switching is high. Try closing unused tabs and finishing one task before moving on.",
    };
  }

  if (focus === "academic" && distractionRatio >= 0.35 && activeMinutes >= 3) {
    return {
      id: "academic-distraction",
      title: "Check your intention",
      message:
        "Social or entertainment browsing is taking a noticeable share of your academic/work session.",
    };
  }

  if (focus === "casual" && activeMinutes >= 5 && distractionRatio >= 0.45) {
    return {
      id: "casual-long-break",
      title: "Take a quick pause",
      message:
        "This is becoming a longer casual browsing stretch. A short break can keep it restorative.",
    };
  }

  if (focus === "academic" && activeMinutes >= 5) {
    return {
      id: "academic-demo-general",
      title: "Time for a short reset",
      message:
        "You have been active for a few minutes in academic/work mode. This demo reminder can be used for documentation.",
    };
  }

  if (focus === "casual" && activeMinutes >= 5) {
    return {
      id: "casual-demo-general",
      title: "Take a quick pause",
      message:
        "You have been casually browsing for a few minutes. This demo reminder can be used for documentation.",
    };
  }

  return null;
}

function getFocusConfirmationOverlay(focus: DailyFocus) {
  if (focus === "academic") {
    return {
      title: "Academic mode is active",
      message:
        "Moodi will show recommendations here when your research or work session gets long, scattered, or needs a reset.",
    };
  }

  return {
    title: "Casual mode is active",
    message:
      "Moodi will show recommendations here when casual browsing starts running long or could use a quick pause.",
  };
}

async function maybeShowRecommendationNotification() {
  if (!(await isOverlayEnabled())) return;

  const focus = await getCurrentDailyFocus();
  if (!focus) return;

  const recommendation = getNotificationRecommendation(getSessionMetrics(), focus);
  if (!recommendation) return;

  const stored = await chrome.storage.local.get(LAST_NOTIFICATION_KEY);
  const last = stored[LAST_NOTIFICATION_KEY] as Partial<StoredNotification> | undefined;
  const now = Date.now();

  if (
    last &&
    last.id === recommendation.id &&
    typeof last.shownAt === "number" &&
    now - last.shownAt < NOTIFICATION_COOLDOWN_MS
  ) {
    return;
  }

  await showRecommendationOverlay(recommendation.title, recommendation.message);

  await chrome.storage.local.set({
    [LAST_NOTIFICATION_KEY]: {
      id: recommendation.id,
      shownAt: now,
    },
  });
}

async function showRecommendationOverlay(title: string, message: string) {
  if (!(await isOverlayEnabled())) return;

  const [tab] = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .catch(() => []);

  if (!tab?.id || !isTrackableUrl(tab.url)) return;

  await chrome.tabs
    .sendMessage(tab.id, {
      type: "SHOW_RECOMMENDATION_OVERLAY",
      title,
      message,
    } satisfies ExtensionMessage)
    .catch(() => injectRecommendationOverlay(tab.id!, title, message));
}

async function showIdleWarningOverlay(idleMinutes: number) {
  if (!(await isOverlayEnabled())) return;

  const [tab] = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .catch(() => []);

  if (!tab?.id || !isTrackableUrl(tab.url)) return;

  await chrome.tabs
    .sendMessage(tab.id, {
      type: "SHOW_IDLE_OVERLAY",
      idleMinutes,
    } satisfies ExtensionMessage)
    .catch(() => null);
}

function injectRecommendationOverlay(tabId: number, title: string, message: string) {
  return chrome.scripting.executeScript({
    target: { tabId },
    args: [title, message],
    func: (overlayTitle, overlayMessage) => {
      document.getElementById("moodi-recommendation-overlay")?.remove();

      const overlay = document.createElement("div");
      overlay.id = "moodi-recommendation-overlay";
      overlay.style.cssText = [
        "position: fixed",
        "right: 24px",
        "bottom: 24px",
        "z-index: 2147483647",
        "width: min(390px, calc(100vw - 48px))",
        "padding: 0",
        "border: 1px solid rgba(255, 255, 255, 0.72)",
        "border-radius: 30px",
        "background: radial-gradient(circle at 12% 0%, rgba(255, 255, 255, 0.92), transparent 38%), linear-gradient(145deg, rgba(255, 255, 255, 0.76), rgba(236, 248, 246, 0.54) 52%, rgba(222, 239, 255, 0.4))",
        "box-shadow: 0 28px 80px rgba(23, 32, 51, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
        "font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
        "color: #172033",
        "overflow: hidden",
        "backdrop-filter: blur(24px) saturate(1.25)",
        "-webkit-backdrop-filter: blur(24px) saturate(1.25)",
      ].join(";");

      const accent = document.createElement("div");
      accent.style.cssText =
        "height:1px;background:linear-gradient(90deg, rgba(47, 158, 143, 0), rgba(47, 158, 143, 0.72), rgba(129, 140, 248, 0.42), rgba(47, 158, 143, 0));";

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:flex-start;gap:13px;padding:17px;";

      const badge = document.createElement("div");
      badge.textContent = "M";
      badge.style.cssText =
        "display:grid;place-items:center;flex:0 0 auto;width:40px;height:40px;border-radius:18px;background:linear-gradient(145deg, rgba(233, 247, 245, 0.9), rgba(255, 255, 255, 0.62), rgba(222, 239, 255, 0.38));color:#2f9e8f;font-size:15px;font-weight:850;box-shadow:0 10px 24px rgba(23, 32, 51, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.82);";

      const content = document.createElement("div");
      content.style.cssText = "min-width:0;flex:1;padding-top:1px;";

      const eyebrow = document.createElement("div");
      eyebrow.textContent = "Moodi";
      eyebrow.style.cssText =
        "margin:0 0 5px;font-size:11px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#2f9e8f;";

      const heading = document.createElement("div");
      heading.textContent = overlayTitle;
      heading.style.cssText =
        "margin:0 0 7px;font-size:16px;font-weight:850;line-height:1.25;color:#172033;";

      const body = document.createElement("div");
      body.textContent = overlayMessage;
      body.style.cssText =
        "margin:0;font-size:13px;line-height:1.5;color:#667085;";

      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "x";
      close.setAttribute("aria-label", "Dismiss Moodi recommendation");
      close.style.cssText =
        "display:grid;place-items:center;flex:0 0 auto;width:28px;height:28px;border:1px solid rgba(255, 255, 255, 0.72);border-radius:999px;background:rgba(255, 255, 255, 0.48);color:#667085;font-size:16px;line-height:1;cursor:pointer;padding:0;box-shadow:inset 0 1px 0 rgba(255, 255, 255, 0.72);";
      close.addEventListener("click", () => overlay.remove());

      content.append(eyebrow, heading, body);
      row.append(badge, content, close);
      overlay.append(accent, row);
      document.documentElement.appendChild(overlay);
      window.setTimeout(() => overlay.remove(), 20_000);
    },
  });
}

function startRecommendationTimer() {
  chrome.alarms.create(NOTIFICATION_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });

  setInterval(() => {
    maybeShowRecommendationNotification().catch((error) => {
      console.warn("[Moodi] Could not show recommendation overlay.", error);
    });
  }, NOTIFICATION_CHECK_INTERVAL_MS);
}

// ─── Tab event listeners ──────────────────────────────────────────────────────

/** Fires when the user switches to a different tab. */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  updateOpenTabCount();
  if (!(await isTrackingEnabled())) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const url = tab.url;
  if (!url || !isTrackableUrl(url)) return;

  const trackableUrl = getTrackableUrl(url);
  recordTabSwitch(previousUrl, trackableUrl);
  previousUrl = trackableUrl;
  lastPageSignalTs = Date.now();
  resetIdleSignalState();
});

/** Fires when a tab navigates to a new URL. */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  updateOpenTabCount();
  if (!(await isTrackingEnabled())) return;
  if (!tab.active || !isTrackableUrl(tab.url)) return;

  const url = getTrackableUrl(tab.url!);
  recordTabSwitch(previousUrl, url, { inheritProductiveContext: true });
  previousUrl = url;
  lastPageSignalTs = Date.now();
  resetIdleSignalState();
});

chrome.tabs.onCreated.addListener(() => {
  updateOpenTabCount();
});

chrome.tabs.onRemoved.addListener(() => {
  updateOpenTabCount();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  handleBrowserFocusChange(windowId);
});

chrome.runtime.onStartup.addListener(() => {
  startFreshSessionFromCurrentTab();
});

/** Flush before the browser closes. */
chrome.runtime.onSuspend.addListener(() => {
  endCurrentSession("chrome_closed");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== NOTIFICATION_ALARM_NAME) return;

  maybeShowRecommendationNotification().catch((error) => {
    console.warn("[Moodi] Could not show recommendation overlay.", error);
  });
});

// ─── Message handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "GET_SESSION_METRICS": {
        const metrics = getSessionMetrics();
        const reply: ExtensionMessage = {
          type: "SESSION_METRICS_RESPONSE",
          metrics,
        };
        sendResponse(reply);
        break;
      }

      case "PAGE_SIGNAL": {
        const signal: PageSignal = message.signal;
        const now = Date.now();
        isTrackingEnabled().then(async (enabled) => {
          const signalUrl = getTrackableUrl(signal.url);

          if (!enabled || !signal.isFocused || signalUrl !== previousUrl) {
            return;
          }

          const signalGapMs = now - lastPageSignalTs;

          if (signalGapMs > SLEEP_SIGNAL_GAP_MS) {
            const previousSessionEndMs = lastPageSignalTs + LAST_ACTIVE_GRACE_MS;
            endCurrentSession("sleep", previousSessionEndMs)
              .then(startFreshSessionFromCurrentTab)
              .catch((error) => {
                console.warn("[Moodi] Could not split session after sleep.", error);
              });
            return;
          }

          const likelySuspendedMs =
            !signal.isIdle && signalGapMs > 30_000 ? signalGapMs - 15_000 : 0;
          const continuousIdleMs = signal.isIdle ? signal.continuousIdleMs : 0;
          const idleDeltaMs = signal.isIdle
            ? Math.max(0, continuousIdleMs - lastContinuousIdleMs)
            : 0;

          recordPageSignal(likelySuspendedMs + idleDeltaMs);
          lastContinuousIdleMs = continuousIdleMs;
          lastPageSignalTs = now;

          if (!signal.isIdle) {
            idleOverlayShown = false;
            persistIdleSignalState();
            return;
          }

          if (continuousIdleMs >= IDLE_OVERLAY_THRESHOLD_MS && !idleOverlayShown) {
            idleOverlayShown = true;
            showIdleWarningOverlay(Math.round(continuousIdleMs / 60000)).catch(
              (error) => {
                console.warn("[Moodi] Could not show idle overlay.", error);
              }
            );
          }

          persistIdleSignalState();
        });
        break;
      }

      case "AUTH_TOKEN_READY": {
        signInBackgroundWithToken(message.token)
          .then(() => {
            console.log("[Moodi] Background auth ready, Firestore writes enabled.");
            return flushSession();
          })
          .catch((error) => {
            console.warn("[Moodi] Could not sign in background auth.", error);
          });
        break;
      }

      case "DAILY_FOCUS_UPDATED": {
        const confirmation = getFocusConfirmationOverlay(message.focus);
        setTimeout(() => {
          chrome.storage.local.remove(LAST_NOTIFICATION_KEY).then(() => {
            showRecommendationOverlay(confirmation.title, confirmation.message).catch(
              (error) => {
                console.warn("[Moodi] Could not show recommendation overlay.", error);
              }
            );
          });
        }, 1000);
        break;
      }

      case "RESET_SESSION_TRACKING": {
        endCurrentSession("manual_reset")
          .then(startFreshSessionFromCurrentTab)
          .then(() => {
            const reply: ExtensionMessage = { type: "SESSION_RESET_COMPLETE" };
            sendResponse(reply);
          });
        return true;
      }
    }
    return false;
  }
);

// ─── Boot ─────────────────────────────────────────────────────────────────────

startFlushTimer();
startRecommendationTimer();
initializeSessionIdentity();
updateOpenTabCount();
restoreIdleSignalState();
seedBrowserFocusState();
initializeSessionIdentity().then(seedActiveTab);
console.log("[MindExt] Service worker started.");
