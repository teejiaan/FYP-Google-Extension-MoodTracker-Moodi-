import { ExtensionMessage, PageSignal } from "../shared/types";
import {
  recordTabSwitch,
  recordPageSignal,
  getSessionMetrics,
  flushSession,
  startFlushTimer,
} from "./session-bundler";

// ─── State ────────────────────────────────────────────────────────────────────

let previousUrl = "";
let lastPageSignalTs = Date.now();

// ─── Tab event listeners ──────────────────────────────────────────────────────

/** Fires when the user switches to a different tab. */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  if (!tab.url || tab.url.startsWith("chrome://")) return;

  recordTabSwitch(previousUrl, tab.url);
  previousUrl = tab.url;
});

/** Fires when a tab navigates to a new URL. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.active || !tab.url || tab.url.startsWith("chrome://")) return;

  recordTabSwitch(previousUrl, tab.url);
  previousUrl = tab.url;
});

/** Flush before the browser closes. */
chrome.runtime.onSuspend.addListener(() => {
  flushSession();
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
        const deltaMs = signal.isIdle ? now - lastPageSignalTs : 0;
        recordPageSignal(deltaMs);
        lastPageSignalTs = now;
        break;
      }

      case "AUTH_TOKEN_READY": {
        // Token stored in auth module via signInWithCredential — nothing extra needed
        console.log("[Moodi] Auth token received, Firestore writes enabled.");
        break;
      }
    }
    return false;
  }
);

// ─── Boot ─────────────────────────────────────────────────────────────────────

startFlushTimer();
console.log("[Moodi] Service worker started.");
