import {
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../shared/firebase";
import { SiteVisit, SessionMetrics, SiteCategory } from "../shared/types";
import { classifyUrl } from "./url-classifier";

// ─── In-memory state ──────────────────────────────────────────────────────────

let sessionStartMs = Date.now();
let tabSwitches = 0;
let openTabCount = 0;
let currentSiteStart = Date.now();
let currentUrl = "";
const siteVisits: SiteVisit[] = [];
let pageSignals: { idleMs: number } = { idleMs: 0 };

// Flush session to Firestore every 15 minutes (or on browser close)
const FLUSH_INTERVAL_MS = 15 * 60 * 1000;

// ─── Public API ───────────────────────────────────────────────────────────────

/** Called by service worker when the active tab changes. */
export function recordTabSwitch(fromUrl: string, toUrl: string) {
  const now = Date.now();

  // Close out the previous site visit
  if (fromUrl) {
    closeSiteVisit(fromUrl, now);
  }

  currentUrl = toUrl;
  currentSiteStart = now;
  tabSwitches++;
}

/** Called by service worker when a page signal arrives from content script. */
export function recordPageSignal(idleDeltaMs: number) {
  pageSignals.idleMs += idleDeltaMs;
}

/** Called by service worker when the browser tab count changes. */
export function recordOpenTabCount(count: number) {
  openTabCount = count;
}

/** Computes and returns current session metrics without flushing. */
export function getSessionMetrics(): SessionMetrics {
  const now = Date.now();
  const visits = [...siteVisits];

  // Include the current ongoing visit
  if (currentUrl) {
    visits.push(buildVisit(currentUrl, currentSiteStart, now));
  }

  return buildMetrics(visits, now);
}

/** Persists the current session to Firestore and resets state. */
export async function flushSession(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return; // Not signed in — skip write

  const now = Date.now();
  if (currentUrl) closeSiteVisit(currentUrl, now);

  const metrics = buildMetrics(siteVisits, now);

  await addDoc(collection(db, "users", user.uid, "sessions"), {
    uid: user.uid,
    startedAt: sessionStartMs,
    endedAt: now,
    metrics,
    createdAt: serverTimestamp(),
  });

  // Reset state for next session
  siteVisits.length = 0;
  tabSwitches = 0;
  sessionStartMs = now;
  pageSignals.idleMs = 0;
}

/** Start the periodic flush timer. */
export function startFlushTimer() {
  setInterval(flushSession, FLUSH_INTERVAL_MS);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function closeSiteVisit(url: string, endMs: number) {
  siteVisits.push(buildVisit(url, currentSiteStart, endMs));
}

function buildVisit(url: string, startMs: number, endMs: number): SiteVisit {
  return {
    url,
    hostname: new URL(url).hostname.replace(/^www\./, ""),
    category: classifyUrl(url),
    dwellMs: endMs - startMs,
    startedAt: startMs,
  };
}


function buildMetrics(visits: SiteVisit[], now: number): SessionMetrics {
  const totalActiveMs = now - sessionStartMs - pageSignals.idleMs;
  const categoryBreakdown = visits.reduce(
    (acc, v) => {
      acc[v.category] = (acc[v.category] ?? 0) + v.dwellMs;
      return acc;
    },
    {} as Record<SiteCategory, number>
  );

  return {
    tabSwitches,
    openTabCount,
    totalActiveMs: Math.max(0, totalActiveMs),
    idleMs: pageSignals.idleMs,
    sites: visits,
    categoryBreakdown,
  };
}
