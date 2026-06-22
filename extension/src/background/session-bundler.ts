import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { db, auth } from "../shared/firebase";
import { SiteVisit, SessionMetrics, SiteCategory } from "../shared/types";
import { classifyUrl } from "./url-classifier";

// ─── In-memory state ──────────────────────────────────────────────────────────

let sessionStartMs = Date.now();
let tabSwitches = 0;
let currentSiteStart = Date.now();
let currentUrl = "";
const siteVisits: SiteVisit[] = [];
let pageSignals: { idleMs: number } = { idleMs: 0 };

// Flush session to Firestore every 15 minutes (or on browser close)
const FLUSH_INTERVAL_MS = 15 * 60 * 1000;

const CATEGORY_WEIGHTS: Record<SiteCategory, number> = {
  productive: 1,
  reference: 0.85,
  news: 0.35,
  other: 0.2,
  social: -0.45,
  entertainment: -0.65,
  shopping: -0.35,
};

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
  const latestMoodScore = await getLatestMoodScore(user.uid);
  const scoreResult = calculateSessionScore(metrics, latestMoodScore);

  await addDoc(collection(db, "users", user.uid, "sessions"), {
    uid: user.uid,
    startedAt: sessionStartMs,
    endedAt: now,
    metrics,
    mentalStateScore: scoreResult.mentalStateScore,
    diagnosis: scoreResult.diagnosis,
    scoring: scoreResult.scoring,
    scoredAt: serverTimestamp(),
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
    totalActiveMs: Math.max(0, totalActiveMs),
    idleMs: pageSignals.idleMs,
    sites: visits,
    categoryBreakdown,
  };
}

async function getLatestMoodScore(uid: string): Promise<number | null> {
  const moodRef = collection(db, "users", uid, "moodEntries");
  const moodQuery = query(moodRef, orderBy("recordedAt", "desc"), limit(1));
  const snap = await getDocs(moodQuery);

  if (snap.empty) return null;

  const score = snap.docs[0].data().score;
  return typeof score === "number" ? score : null;
}

function calculateSessionScore(metrics: SessionMetrics, latestMoodScore: number | null) {
  const totalActiveMs = Math.max(1, metrics.totalActiveMs);
  const categoryBreakdown = metrics.categoryBreakdown ?? {};

  const productiveMs =
    (categoryBreakdown.productive ?? 0) + (categoryBreakdown.reference ?? 0);
  const distractionMs =
    (categoryBreakdown.social ?? 0) +
    (categoryBreakdown.entertainment ?? 0) +
    (categoryBreakdown.shopping ?? 0);

  const productiveRatio = clamp(productiveMs / totalActiveMs, 0, 1);
  const distractionRatio = clamp(distractionMs / totalActiveMs, 0, 1);
  const idleRatio = clamp(metrics.idleMs / (totalActiveMs + metrics.idleMs), 0, 1);

  const weightedCategoryScore = Object.entries(categoryBreakdown).reduce(
    (sum, [category, ms]) => {
      const weight = CATEGORY_WEIGHTS[category as SiteCategory] ?? CATEGORY_WEIGHTS.other;
      return sum + (Math.max(0, ms ?? 0) / totalActiveMs) * weight * 100;
    },
    45
  );

  const sessionMinutes = Math.max(1, totalActiveMs / 60_000);
  const switchesPerMinute = metrics.tabSwitches / sessionMinutes;
  const tabSwitchPenalty = clamp(switchesPerMinute * 5, 0, 25);
  const productivityScore = clamp(
    weightedCategoryScore - tabSwitchPenalty - idleRatio * 20,
    0,
    100
  );

  const moodScore =
    latestMoodScore === null ? null : clamp(((latestMoodScore - 1) / 4) * 100, 0, 100);
  const mentalStateScore = Math.round(productivityScore * 0.7 + (moodScore ?? 55) * 0.3);
  const diagnosis = diagnoseSession({
    mentalStateScore,
    productivityScore,
    moodScore,
    productiveRatio,
    distractionRatio,
    switchesPerMinute,
  });

  return {
    mentalStateScore,
    diagnosis,
    scoring: {
      productivityScore: Math.round(productivityScore),
      moodScore: moodScore === null ? null : Math.round(moodScore),
      productiveRatio: roundRatio(productiveRatio),
      distractionRatio: roundRatio(distractionRatio),
      idleRatio: roundRatio(idleRatio),
      tabSwitchPenalty: Math.round(tabSwitchPenalty),
      moodSource: moodScore === null ? "neutral-default" : "latest-check-in",
      modelVersion: "client-productivity-mood-v1",
    },
  };
}

function diagnoseSession(input: {
  mentalStateScore: number;
  productivityScore: number;
  moodScore: number | null;
  productiveRatio: number;
  distractionRatio: number;
  switchesPerMinute: number;
}) {
  if (input.moodScore !== null && input.moodScore <= 25) return "stressed";
  if (input.distractionRatio >= 0.45 || input.switchesPerMinute >= 4) return "scattered";
  if (input.mentalStateScore >= 72 && input.productiveRatio >= 0.45) return "focused";
  if (input.moodScore !== null && input.moodScore >= 75 && input.productivityScore < 65) {
    return "relaxed";
  }
  return "balanced";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}
