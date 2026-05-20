import { ExtensionMessage, PageSignal } from "../shared/types";

// ─── Config ───────────────────────────────────────────────────────────────────

const SIGNAL_INTERVAL_MS = 10_000; // send a signal every 10 seconds
const IDLE_TIMEOUT_MS = 60_000;    // considered idle after 60s of no interaction

// ─── State ────────────────────────────────────────────────────────────────────

let lastInteractionTs = Date.now();
let maxScrollDepth = 0;

// ─── Interaction tracking ─────────────────────────────────────────────────────

["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((event) => {
  document.addEventListener(event, () => {
    lastInteractionTs = Date.now();
  }, { passive: true });
});

document.addEventListener("scroll", () => {
  const scrolled = window.scrollY + window.innerHeight;
  const total = document.documentElement.scrollHeight;
  maxScrollDepth = Math.max(maxScrollDepth, scrolled / total);
}, { passive: true });

// ─── Periodic signal ──────────────────────────────────────────────────────────

function sendSignal() {
  const now = Date.now();
  const isIdle = now - lastInteractionTs > IDLE_TIMEOUT_MS;

  const signal: PageSignal = {
    url: location.href,
    scrollDepth: maxScrollDepth,
    isIdle,
    isFocused: document.visibilityState === "visible",
    timestamp: now,
  };

  const message: ExtensionMessage = { type: "PAGE_SIGNAL", signal };

  // chrome.runtime.sendMessage can throw if the extension context is invalidated
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // Extension reloaded — stop the interval
    clearInterval(interval);
  }
}

const interval = setInterval(sendSignal, SIGNAL_INTERVAL_MS);

// Send immediately on page load
sendSignal();