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
  signOutBackgroundAuth,
  startNewSessionIdentity,
  startFlushTimer,
} from "./session-bundler";

// ─── State ────────────────────────────────────────────────────────────────────

let previousUrl = "";
let lastPageSignalTs = Date.now();
let lastContinuousIdleMs = 0;
let idleOverlayShown = false;
let activeRecommendationOverlay: ActiveRecommendationOverlay | null = null;
let focusChangeSequence = 0;

const CURRENT_FOCUS_KEY = "moodiCurrentDailyFocus";
const LAST_NOTIFICATION_KEY = "moodiLastRecommendationNotification";
const NOTIFICATION_ALARM_NAME = "moodiRecommendationCheck";
const NOTIFICATION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;
const ENCOURAGEMENT_DELAY_MS = 10 * 60 * 1000;
const ENCOURAGEMENT_WINDOW_MS = 30 * 60 * 1000;
const RECOMMENDATION_OVERLAY_VISIBLE_MS = 20 * 1000;
const SLEEP_SIGNAL_GAP_MS = 5 * 60 * 1000;
const LAST_ACTIVE_GRACE_MS = 15 * 1000;
const FOCUS_LOSS_RECHECK_MS = 1500;
const IDLE_OVERLAY_THRESHOLD_MS = 15 * 60 * 1000;
const IDLE_SIGNAL_STATE_KEY = "moodiIdleSignalState";

interface StoredDailyFocus {
  date: string;
  focus: DailyFocus;
}

interface StoredNotification {
  id: string;
  shownAt: number;
  encouragedAt?: number;
  focus?: DailyFocus;
  snapshot?: RecommendationSnapshot;
}

interface RecommendationSnapshot {
  activeMinutes: number;
  tabSwitchesPerHour: number;
  productiveRatio: number;
  distractionRatio: number;
  idleMs: number;
}

interface ActiveRecommendationOverlay {
  title: string;
  message: string;
  expiresAt: number;
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

async function hasFocusedNormalBrowserWindow() {
  const windows = await chrome.windows
    .getAll({ windowTypes: ["normal"] })
    .catch(() => []);

  return windows.some((chromeWindow) => chromeWindow.focused);
}

async function seedBrowserFocusState() {
  initializeBrowserFocusState(await hasFocusedNormalBrowserWindow());
}

async function handleBrowserFocusChange(windowId: number) {
  if (!(await isTrackingEnabled())) return;

  const sequence = ++focusChangeSequence;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    setTimeout(async () => {
      if (sequence !== focusChangeSequence) return;

      const focused = await hasFocusedNormalBrowserWindow();
      recordBrowserFocusChange(focused);
      lastPageSignalTs = Date.now();
    }, FOCUS_LOSS_RECHECK_MS);
    return;
  }

  recordBrowserFocusChange(await hasFocusedNormalBrowserWindow());
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
  const {
    activeMinutes,
    productiveRatio,
    distractionRatio,
    tabSwitchesPerHour,
  } = getRecommendationSnapshot(metrics);

  if (focus === "academic" && activeMinutes >= 120 && productiveRatio >= 0.55) {
    return {
      id: "academic-long-reset",
      title: "Take a focused reset",
      message:
        "You have been in a long research or work stretch. Step away for 10 to 15 minutes, hydrate, and rest your eyes.",
    };
  }

  if (focus === "academic" && activeMinutes >= 60 && productiveRatio >= 0.55) {
    return {
      id: "academic-short-break",
      title: "Keep your pace sustainable",
      message:
        "You are building a focused work block. Consider a short pause soon so your attention stays fresh.",
    };
  }

  if (
    focus === "academic" &&
    activeMinutes >= 15 &&
    tabSwitchesPerHour >= 45 &&
    metrics.tabSwitches >= 12
  ) {
    return {
      id: "academic-context-switching",
      title: "Reduce tab switching",
      message:
        "Your switching pattern is getting scattered. Close unused tabs and choose one task to finish next.",
    };
  }

  if (focus === "academic" && distractionRatio >= 0.35 && activeMinutes >= 20) {
    return {
      id: "academic-distraction",
      title: "Check your intention",
      message:
        "Social or entertainment browsing is taking a noticeable share of this academic/work session.",
    };
  }

  if (focus === "casual" && activeMinutes >= 90 && distractionRatio >= 0.45) {
    return {
      id: "casual-long-break",
      title: "Pause and check in",
      message:
        "This casual browsing stretch is getting longer. A quick pause can help keep it restorative.",
    };
  }

  return null;
}

function getRecommendationSnapshot(metrics: SessionMetrics): RecommendationSnapshot {
  const productiveMs =
    (metrics.categoryBreakdown.productive ?? 0) +
    (metrics.categoryBreakdown.reference ?? 0);
  const distractionMs =
    (metrics.categoryBreakdown.social ?? 0) +
    (metrics.categoryBreakdown.entertainment ?? 0);

  return {
    activeMinutes: metrics.totalActiveMs / 60000,
    tabSwitchesPerHour:
      metrics.tabSwitches / Math.max(metrics.totalActiveMs / 3600000, 0.25),
    productiveRatio: productiveMs / Math.max(metrics.totalActiveMs, 1),
    distractionRatio: distractionMs / Math.max(metrics.totalActiveMs, 1),
    idleMs: metrics.idleMs,
  };
}

function getFollowThroughEncouragement(
  last: Partial<StoredNotification> | undefined,
  metrics: SessionMetrics,
  focus: DailyFocus,
  now: number
) {
  if (
    !last?.id ||
    !last.snapshot ||
    last.focus !== focus ||
    typeof last.shownAt !== "number" ||
    typeof last.encouragedAt === "number"
  ) {
    return null;
  }

  const elapsedMs = now - last.shownAt;
  if (
    elapsedMs < ENCOURAGEMENT_DELAY_MS ||
    elapsedMs > ENCOURAGEMENT_WINDOW_MS
  ) {
    return null;
  }

  const current = getRecommendationSnapshot(metrics);
  const tabSwitchingImproved =
    current.tabSwitchesPerHour <= last.snapshot.tabSwitchesPerHour * 0.85 ||
    current.tabSwitchesPerHour <= 24;
  const distractionImproved =
    current.distractionRatio <= last.snapshot.distractionRatio * 0.85 ||
    current.distractionRatio <= 0.25;
  const stayedProductive =
    focus === "academic" &&
    current.productiveRatio >= Math.min(0.8, last.snapshot.productiveRatio);
  const tookShortReset = current.idleMs - last.snapshot.idleMs >= 60 * 1000;

  if (last.id.includes("context-switching") && tabSwitchingImproved) {
    return {
      title: "Good focus recovery",
      message:
        "Your browsing looks steadier since the last reminder. Keep one priority in front of you.",
    };
  }

  if (last.id.includes("distraction") && distractionImproved) {
    return {
      title: "Back on track",
      message:
        "You have shifted away from distracting browsing. Stay with the task while the momentum is there.",
    };
  }

  if (last.id.includes("reset") || last.id.includes("break")) {
    if (tookShortReset) {
      return {
        title: "Nice reset",
        message:
          "You stepped away for a bit. Ease back in and keep the pace comfortable.",
      };
    }

    if (stayedProductive) {
      return {
        title: "Steady follow-through",
        message:
          "You stayed with productive browsing after the reminder. Keep checking in with your energy.",
      };
    }
  }

  if (current.activeMinutes >= last.snapshot.activeMinutes + 4) {
    return {
      title: "Good follow-through",
      message:
        "Your session looks steady since the last reminder. Keep going at a comfortable pace.",
    };
  }

  return null;
}

function getFocusConfirmationOverlay(focus: DailyFocus) {
  if (focus === "academic") {
    return {
      title: "Academic mode is active",
      message:
        "Moodi will show gentle reminders here when your research or work session becomes long, scattered, or tiring.",
    };
  }

  return {
    title: "Casual mode is active",
    message:
      "Moodi will show gentle reminders here when casual browsing starts running long or may need a pause.",
  };
}

async function maybeShowRecommendationNotification() {
  if (!(await isOverlayEnabled())) return;

  const focus = await getCurrentDailyFocus();
  if (!focus) return;

  const metrics = getSessionMetrics();
  const stored = await chrome.storage.local.get(LAST_NOTIFICATION_KEY);
  const last = stored[LAST_NOTIFICATION_KEY] as Partial<StoredNotification> | undefined;
  const now = Date.now();
  const encouragement = getFollowThroughEncouragement(last, metrics, focus, now);

  if (encouragement) {
    await showRecommendationOverlay(encouragement.title, encouragement.message);
    await chrome.storage.local.set({
      [LAST_NOTIFICATION_KEY]: {
        ...last,
        encouragedAt: now,
      },
    });
    return;
  }

  const recommendation = getNotificationRecommendation(metrics, focus);
  if (!recommendation) return;

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
      focus,
      snapshot: getRecommendationSnapshot(metrics),
    },
  });
}

async function showRecommendationOverlay(title: string, message: string) {
  if (!(await isOverlayEnabled())) return;

  activeRecommendationOverlay = {
    title,
    message,
    expiresAt: Date.now() + RECOMMENDATION_OVERLAY_VISIBLE_MS,
  };

  const [tab] = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .catch(() => []);

  if (!tab?.id || !isTrackableUrl(tab.url)) return;

  await sendRecommendationOverlayToTab(tab.id, title, message);
}

async function replayActiveRecommendationOverlay(tabId: number, url?: string) {
  if (!activeRecommendationOverlay) return;

  if (Date.now() >= activeRecommendationOverlay.expiresAt) {
    activeRecommendationOverlay = null;
    return;
  }

  if (!(await isOverlayEnabled())) return;
  if (!isTrackableUrl(url)) return;

  await sendRecommendationOverlayToTab(
    tabId,
    activeRecommendationOverlay.title,
    activeRecommendationOverlay.message
  );
}

async function sendRecommendationOverlayToTab(
  tabId: number,
  title: string,
  message: string
) {
  await chrome.tabs
    .sendMessage(tabId, {
      type: "SHOW_RECOMMENDATION_OVERLAY",
      title,
      message,
    } satisfies ExtensionMessage)
    .catch(() => injectRecommendationOverlay(tabId, title, message));
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
        "border: 1px solid rgba(255, 255, 255, 0.96)",
        "border-radius: 30px",
        "background: radial-gradient(circle at 12% 0%, rgba(255, 255, 255, 0.98), transparent 38%), linear-gradient(145deg, rgba(253, 255, 255, 0.98), rgba(242, 251, 249, 0.97) 52%, rgba(232, 244, 255, 0.96))",
        "box-shadow: 0 24px 58px rgba(23, 32, 51, 0.2), 0 0 0 1px rgba(23, 32, 51, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.96)",
        "font-family: Aptos, 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif",
        "color: #172033",
        "overflow: hidden",
        "backdrop-filter: blur(18px) saturate(1.12)",
        "-webkit-backdrop-filter: blur(18px) saturate(1.12)",
      ].join(";");

      const accent = document.createElement("div");
      accent.style.cssText =
        "height:1px;background:linear-gradient(90deg, rgba(47, 158, 143, 0), rgba(47, 158, 143, 0.72), rgba(129, 140, 248, 0.42), rgba(47, 158, 143, 0));";

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:flex-start;gap:13px;padding:17px;";

      const badge = document.createElement("div");
      badge.textContent = "M";
      badge.style.cssText =
        "display:grid;place-items:center;flex:0 0 auto;width:40px;height:40px;border-radius:18px;background:linear-gradient(145deg, rgba(233, 247, 245, 0.98), rgba(255, 255, 255, 0.9), rgba(230, 243, 255, 0.78));color:#237b70;font-size:15px;font-weight:850;box-shadow:0 8px 18px rgba(23, 32, 51, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.92);";

      const content = document.createElement("div");
      content.style.cssText = "min-width:0;flex:1;padding-top:1px;";

      const eyebrow = document.createElement("div");
      eyebrow.textContent = "Moodi";
      eyebrow.style.cssText =
        "margin:0 0 5px;font-size:11px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#237b70;";

      const heading = document.createElement("div");
      heading.textContent = overlayTitle;
      heading.style.cssText =
        "margin:0 0 7px;font-size:16px;font-weight:850;line-height:1.25;color:#172033;";

      const body = document.createElement("div");
      body.textContent = overlayMessage;
      body.style.cssText =
        "margin:0;font-size:13px;line-height:1.5;color:#3f4a5f;";

      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "x";
      close.setAttribute("aria-label", "Dismiss Moodi recommendation");
      close.style.cssText =
        "display:grid;place-items:center;flex:0 0 auto;width:28px;height:28px;border:1px solid rgba(23, 32, 51, 0.08);border-radius:999px;background:rgba(255, 255, 255, 0.84);color:#3f4a5f;font-size:16px;line-height:1;cursor:pointer;padding:0;box-shadow:0 5px 12px rgba(23, 32, 51, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.9);";
      close.addEventListener("click", () => {
        overlay.remove();
        chrome.runtime.sendMessage({ type: "RECOMMENDATION_OVERLAY_DISMISSED" });
      });

      content.append(eyebrow, heading, body);
      row.append(badge, content, close);
      overlay.append(accent, row);
      document.documentElement.appendChild(overlay);
      setTimeout(() => overlay.remove(), 20_000);
    },
  });
}

function startRecommendationTimer() {
  chrome.alarms.create(NOTIFICATION_ALARM_NAME, {
    delayInMinutes: 5,
    periodInMinutes: 5,
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
  await replayActiveRecommendationOverlay(tabId, tab.url);

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
  if (tab.active) {
    await replayActiveRecommendationOverlay(tabId, tab.url);
  }

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

          if (!enabled) {
            return;
          }

          if (signal.isFocused) {
            focusChangeSequence++;
            recordBrowserFocusChange(true);
          }

          if (!signal.isFocused || signalUrl !== previousUrl) {
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

      case "RECOMMENDATION_OVERLAY_DISMISSED": {
        activeRecommendationOverlay = null;
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

      case "SIGN_OUT_BACKGROUND_AUTH": {
        signOutBackgroundAuth().catch((error) => {
          console.warn("[Moodi] Could not sign out background auth.", error);
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
console.log("[Moodi] Service worker started.");
