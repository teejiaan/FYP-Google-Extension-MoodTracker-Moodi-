import type { ExtensionMessage, PageSignal } from "../shared/types";

const SIGNAL_INTERVAL_MS = 10_000;
const IDLE_TIMEOUT_MS = 60_000;
const IDLE_OVERLAY_THRESHOLD_MS = 15 * 60 * 1000;
const CONSENT_ACCEPTED_KEY = "moodiConsentAccepted";
const OVERLAY_ENABLED_KEY = "moodiOverlayEnabled";

let lastInteractionTs = Date.now();
let maxScrollDepth = 0;
let idleOverlayShown = false;

function markInteraction() {
  lastInteractionTs = Date.now();
  idleOverlayShown = false;
}

[
  "mousemove",
  "pointermove",
  "pointerdown",
  "keydown",
  "click",
  "scroll",
  "wheel",
  "input",
  "touchstart",
].forEach((event) => {
  document.addEventListener(
    event,
    markInteraction,
    { passive: true }
  );
});

window.addEventListener("focus", () => {
  markInteraction();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    markInteraction();
  }
});

document.addEventListener(
  "scroll",
  () => {
    const scrolled = window.scrollY + window.innerHeight;
    const total = document.documentElement.scrollHeight;
    maxScrollDepth = Math.max(maxScrollDepth, scrolled / total);
  },
  { passive: true }
);

function isMediaPlaying() {
  const mediaElements = Array.from(
    document.querySelectorAll("video, audio")
  ) as HTMLMediaElement[];

  return mediaElements.some((media) => {
    return (
      !media.paused &&
      !media.ended &&
      media.readyState > HTMLMediaElement.HAVE_CURRENT_DATA &&
      media.currentTime > 0
    );
  });
}

function sendSignal() {
  const now = Date.now();
  const isFocused = document.visibilityState === "visible";
  const continuousIdleMs = Math.max(0, now - lastInteractionTs);
  const isIdle =
    isFocused && continuousIdleMs > IDLE_TIMEOUT_MS && !isMediaPlaying();

  maybeShowLocalIdleOverlay(isIdle, continuousIdleMs);

  const signal: PageSignal = {
    url: location.href,
    scrollDepth: maxScrollDepth,
    isIdle,
    continuousIdleMs: isIdle ? continuousIdleMs : 0,
    isFocused,
    timestamp: now,
  };

  const message: ExtensionMessage = { type: "PAGE_SIGNAL", signal };

  try {
    chrome.runtime.sendMessage(message);
  } catch {
    clearInterval(interval);
  }
}

async function isLocalOverlayEnabled() {
  const stored = await chrome.storage.local.get([
    CONSENT_ACCEPTED_KEY,
    OVERLAY_ENABLED_KEY,
  ]);

  return (
    stored[CONSENT_ACCEPTED_KEY] === true &&
    stored[OVERLAY_ENABLED_KEY] !== false
  );
}

function maybeShowLocalIdleOverlay(isIdle: boolean, continuousIdleMs: number) {
  if (!isIdle || idleOverlayShown || continuousIdleMs < IDLE_OVERLAY_THRESHOLD_MS) {
    return;
  }

  isLocalOverlayEnabled().then((enabled) => {
    if (!enabled || idleOverlayShown) return;

    idleOverlayShown = true;
    showIdleOverlay(Math.round(continuousIdleMs / 60000));
  });
}

function showIdleOverlay(idleMinutes: number) {
  document.getElementById("moodi-idle-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "moodi-idle-overlay";
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 2147483647",
    "display: grid",
    "place-items: center",
    "padding: 24px",
    "background: rgba(23, 32, 51, 0.28)",
    "backdrop-filter: blur(8px)",
    "-webkit-backdrop-filter: blur(8px)",
    "font-family: Aptos, 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif",
  ].join(";");

  const card = document.createElement("div");
  card.style.cssText = [
    "width: min(430px, calc(100vw - 48px))",
    "padding: 22px",
    "border: 1px solid rgba(255, 230, 150, 0.88)",
    "border-radius: 30px",
    "background: radial-gradient(circle at 12% 0%, rgba(255, 255, 255, 0.98), transparent 38%), linear-gradient(145deg, rgba(255, 252, 239, 0.96), rgba(255, 244, 204, 0.9), rgba(255, 255, 255, 0.86))",
    "box-shadow: 0 30px 90px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(23, 32, 51, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.95)",
    "color: #172033",
    "text-align: center",
    "backdrop-filter: blur(24px) saturate(1.22)",
    "-webkit-backdrop-filter: blur(24px) saturate(1.22)",
  ].join(";");

  const badge = document.createElement("div");
  badge.textContent = "!";
  badge.style.cssText =
    "display:grid;place-items:center;width:46px;height:46px;margin:0 auto 12px;border-radius:18px;background:rgba(255, 214, 102, 0.7);color:#8a5a00;font-size:22px;font-weight:900;box-shadow:inset 0 1px 0 rgba(255,255,255,0.7);";

  const title = document.createElement("h2");
  title.textContent = "You've been idle for a while";
  title.style.cssText =
    "margin:0 0 8px;font-size:20px;line-height:1.25;color:#172033;";

  const message = document.createElement("p");
  message.textContent = `Moodi has detected about ${idleMinutes} minutes of continuous inactivity. Move around, stretch, or resume when you're ready.`;
  message.style.cssText =
    "margin:0 0 18px;color:#3f4a5f;font-size:14px;line-height:1.5;";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Dismiss";
  closeButton.style.cssText =
    "min-height:38px;border:0;border-radius:999px;background:#d99a22;color:#fff;font:inherit;font-weight:850;padding:0 18px;cursor:pointer;";
  closeButton.addEventListener("click", () => overlay.remove());

  card.append(badge, title, message, closeButton);
  overlay.append(card);
  document.documentElement.appendChild(overlay);
}

function showRecommendationOverlay(title: string, message: string) {
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

  const titleEl = document.createElement("div");
  titleEl.textContent = title;
  titleEl.style.cssText =
    "margin:0 0 7px;font-size:16px;font-weight:850;line-height:1.25;color:#172033;";

  const messageEl = document.createElement("div");
  messageEl.textContent = message;
  messageEl.style.cssText =
    "margin:0;font-size:13px;line-height:1.5;color:#3f4a5f;";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "x";
  closeButton.setAttribute("aria-label", "Dismiss Moodi recommendation");
  closeButton.style.cssText =
    "display:grid;place-items:center;flex:0 0 auto;width:28px;height:28px;border:1px solid rgba(23, 32, 51, 0.08);border-radius:999px;background:rgba(255, 255, 255, 0.84);color:#3f4a5f;font-size:16px;line-height:1;cursor:pointer;padding:0;box-shadow:0 5px 12px rgba(23, 32, 51, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.9);";
  closeButton.addEventListener("click", () => {
    overlay.remove();
    chrome.runtime.sendMessage({ type: "RECOMMENDATION_OVERLAY_DISMISSED" });
  });

  content.append(eyebrow, titleEl, messageEl);
  row.append(badge, content, closeButton);
  overlay.append(accent, row);
  document.documentElement.appendChild(overlay);
  window.setTimeout(() => overlay.remove(), 20_000);
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "SHOW_IDLE_OVERLAY") {
    showIdleOverlay(message.idleMinutes);
    return false;
  }

  if (message.type !== "SHOW_RECOMMENDATION_OVERLAY") return false;

  showRecommendationOverlay(message.title, message.message);
  return false;
});

const interval = setInterval(sendSignal, SIGNAL_INTERVAL_MS);

sendSignal();
