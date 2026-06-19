import { ExtensionMessage, PageSignal } from "../shared/types";
import {
  recordTabSwitch,
  recordPageSignal,
  recordOpenTabCount,
  getSessionMetrics,
  flushSession,
  startFlushTimer,
} from "./session-bundler";

// ─── State ────────────────────────────────────────────────────────────────────

let previousUrl = "";
let lastPageSignalTs = Date.now();

function isTrackableUrl(url?: string) {
  return Boolean(url) && !url!.startsWith("chrome://") && !url!.startsWith("edge://");
}

async function updateOpenTabCount() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  recordOpenTabCount(tabs.length);
}

async function seedActiveTab() {
  const [tab] = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .catch(() => []);

  if (!isTrackableUrl(tab?.url)) return;

  recordTabSwitch("", tab!.url!);
  previousUrl = tab!.url!;
}

// ─── Tab event listeners ──────────────────────────────────────────────────────

/** Fires when the user switches to a different tab. */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  updateOpenTabCount();
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const url = tab.url;
  if (!url || !isTrackableUrl(url)) return;

  recordTabSwitch(previousUrl, url);
  previousUrl = url;
});

/** Fires when a tab navigates to a new URL. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  updateOpenTabCount();
  if (!tab.active || !isTrackableUrl(tab.url)) return;

  recordTabSwitch(previousUrl, tab.url!);
  previousUrl = tab.url!;
});

chrome.tabs.onCreated.addListener(() => {
  updateOpenTabCount();
});

chrome.tabs.onRemoved.addListener(() => {
  updateOpenTabCount();
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
        console.log("[MindExt] Auth token received, Firestore writes enabled.");
        break;
      }
    }
    return false;
  }
);

// ─── Boot ─────────────────────────────────────────────────────────────────────

startFlushTimer();
updateOpenTabCount();
seedActiveTab();
console.log("[MindExt] Service worker started.");
