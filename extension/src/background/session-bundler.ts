import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db, auth } from "../shared/firebase";
import { SiteVisit, SessionMetrics, SiteCategory } from "../shared/types";
import { classifyUrl } from "./url-classifier";

let sessionStartMs = Date.now();
let tabSwitches = 0;
let openTabCount = 0;
let currentSiteStart = Date.now();
let currentUrl = "";
let currentCategoryOverride: SiteCategory | null = null;
let sessionDocId = `session-${sessionStartMs}`;
const siteVisits: SiteVisit[] = [];
let pageSignals: { idleMs: number; unfocusedMs: number } = {
  idleMs: 0,
  unfocusedMs: 0,
};
let browserFocused = true;
let browserFocusChangedAt = Date.now();

const CHECKPOINT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_SESSION_ACTIVE_MS = 5 * 60 * 1000;
const MIN_SITE_DWELL_MS = 30 * 1000;
const STALE_SESSION_MS = 8 * 60 * 60 * 1000;
const SESSION_ID_KEY = "moodiActiveSessionDocId";
const SESSION_START_KEY = "moodiActiveSessionStartMs";
const SESSION_SIGNALS_KEY = "moodiActiveSessionSignals";
const SESSION_STATE_KEY = "moodiActiveSessionState";
let sessionIdentityReady: Promise<void> | null = null;
let backgroundAuthReady: Promise<void> | null = null;

interface RecordVisitOptions {
  inheritProductiveContext?: boolean;
}

type SessionEndReason = "chrome_closed" | "sleep" | "manual_reset";
type SessionStatus = "active" | "completed";

interface StoredSessionState {
  sessionDocId: string;
  sessionStartMs: number;
  tabSwitches: number;
  openTabCount: number;
  currentSiteStart: number;
  currentUrl: string;
  currentCategoryOverride: SiteCategory | null;
  siteVisits: SiteVisit[];
  pageSignals: typeof pageSignals;
  browserFocused: boolean;
  browserFocusChangedAt: number;
}

export function recordTabSwitch(
  fromUrl: string,
  toUrl: string,
  options: RecordVisitOptions = {}
) {
  const now = Date.now();

  if (fromUrl) {
    closeSiteVisit(fromUrl, now);
  }

  currentUrl = toUrl;
  currentCategoryOverride = getInheritedCategory(fromUrl, toUrl, options);
  currentSiteStart = now;
  tabSwitches++;
  persistSessionState();
}

export function recordPageSignal(idleDeltaMs: number) {
  pageSignals.idleMs += idleDeltaMs;
  persistSessionState();
}

export function recordBrowserUnfocused(unfocusedDeltaMs: number) {
  pageSignals.unfocusedMs += unfocusedDeltaMs;
  persistSessionState();  
}

export function initializeBrowserFocusState(isFocused: boolean) {
  browserFocused = isFocused;
  browserFocusChangedAt = Date.now();
}

export function recordBrowserFocusChange(isFocused: boolean) {
  const now = Date.now();

  if (!browserFocused) {
    recordBrowserUnfocused(now - browserFocusChangedAt);
  }

  browserFocused = isFocused;
  browserFocusChangedAt = now;
  persistSessionState();
}

export function recordOpenTabCount(count: number) {
  openTabCount = count;
  persistSessionState();
}

export function getSessionMetrics(): SessionMetrics {
  const now = Date.now();
  return buildMetrics(getVisitsSnapshot(now), now);
}

export async function flushSession(): Promise<void> {
  await writeSession(Date.now(), "active");
}

export async function endCurrentSession(
  reason: SessionEndReason,
  endMs = Date.now()
): Promise<void> {
  await initializeSessionIdentity();

  await writeSession(endMs, "completed", reason);
  await clearSessionIdentity();
  resetSessionState(endMs, false);
}

async function writeSession(
  endMs: number,
  status: SessionStatus,
  endReason?: SessionEndReason
) {
  await initializeSessionIdentity();
  await ensureBackgroundAuth();

  const user = auth.currentUser;
  if (!user) {
    console.warn("[Moodi] Session not saved because the background is not signed in.");
    return;
  }

  const metrics = buildMetrics(getVisitsSnapshot(endMs), endMs);

  if (!hasMeaningfulActivity(metrics)) return;

  try {
    await setDoc(
      doc(db, "users", user.uid, "sessions", sessionDocId),
      {
        uid: user.uid,
        startedAt: sessionStartMs,
        endedAt: endMs,
        metrics,
        status,
        ...(endReason ? { endReason } : {}),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn("[Moodi] Could not save session to Firestore.", error);
    return;
  }

  try {
    await rebuildDailySummary(user.uid, getLocalDateKey(sessionStartMs));
  } catch (error) {
    console.warn("[Moodi] Session saved, but daily summary rebuild failed.", error);
  }
}

export async function signInBackgroundWithToken(token: string) {
  const credential = GoogleAuthProvider.credential(null, token);
  await signInWithCredential(auth, credential);
}

export async function signOutBackgroundAuth() {
  backgroundAuthReady = null;
  await signOut(auth);
}

async function ensureBackgroundAuth() {
  if (auth.currentUser) return;

  if (!backgroundAuthReady) {
    backgroundAuthReady = getCachedChromeAuthToken()
      .then((token) => {
        if (!token) return;
        return signInBackgroundWithToken(token);
      })
      .catch((error) => {
        console.warn("[Moodi] Could not restore background auth.", error);
      })
      .finally(() => {
        backgroundAuthReady = null;
      });
  }

  await backgroundAuthReady;
}

function getCachedChromeAuthToken() {
  return new Promise<string | null>((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token || typeof token !== "string") {
        resolve(null);
        return;
      }

      resolve(token);
    });
  });
}

export function startFlushTimer() {
  setInterval(flushSession, CHECKPOINT_INTERVAL_MS);
}

export function initializeSessionIdentity() {
  if (!sessionIdentityReady) {
    sessionIdentityReady = chrome.storage.local
      .get([SESSION_ID_KEY, SESSION_START_KEY])
      .then((stored) => {
        const storedId = stored[SESSION_ID_KEY];
        const storedStart = stored[SESSION_START_KEY];

        if (
          typeof storedId === "string" &&
          typeof storedStart === "number" &&
          Date.now() - storedStart < STALE_SESSION_MS
        ) {
          sessionDocId = storedId;
          sessionStartMs = storedStart;
          return restoreSessionSignals();
        }

        return persistSessionIdentity();
      });
  }

  return sessionIdentityReady;
}

export async function startNewSessionIdentity() {
  resetSessionState(Date.now(), true);
  sessionIdentityReady = null;
  await persistSessionIdentity();
  sessionIdentityReady = Promise.resolve();
}

function resetSessionState(startMs: number, isFocused: boolean) {
  sessionStartMs = startMs;
  currentSiteStart = sessionStartMs;
  sessionDocId = `session-${sessionStartMs}`;
  siteVisits.length = 0;
  tabSwitches = 0;
  currentUrl = "";
  currentCategoryOverride = null;
  pageSignals.idleMs = 0;
  pageSignals.unfocusedMs = 0;
  persistSessionState();
  initializeBrowserFocusState(isFocused);
}

function persistSessionIdentity() {
  return chrome.storage.local.set({
    [SESSION_ID_KEY]: sessionDocId,
    [SESSION_START_KEY]: sessionStartMs,
  });
}

function clearSessionIdentity() {
  sessionIdentityReady = null;
  return chrome.storage.local.remove([
    SESSION_ID_KEY,
    SESSION_START_KEY,
    SESSION_SIGNALS_KEY,
    SESSION_STATE_KEY,
  ]);
}

function persistSessionState() {
  chrome.storage.local.set({
    [SESSION_STATE_KEY]: {
      sessionDocId,
      sessionStartMs,
      tabSwitches,
      openTabCount,
      currentSiteStart,
      currentUrl,
      currentCategoryOverride,
      siteVisits,
      pageSignals,
      browserFocused,
      browserFocusChangedAt,
    } satisfies StoredSessionState,
    [SESSION_SIGNALS_KEY]: pageSignals,
  });
}

async function restoreSessionSignals() {
  const stored = await chrome.storage.local.get([
    SESSION_SIGNALS_KEY,
    SESSION_STATE_KEY,
  ]);
  const state = stored[SESSION_STATE_KEY] as Partial<StoredSessionState> | undefined;

  if (
    state &&
    state.sessionDocId === sessionDocId &&
    state.sessionStartMs === sessionStartMs
  ) {
    tabSwitches = typeof state.tabSwitches === "number" ? state.tabSwitches : 0;
    openTabCount = typeof state.openTabCount === "number" ? state.openTabCount : 0;
    currentSiteStart =
      typeof state.currentSiteStart === "number"
        ? state.currentSiteStart
        : sessionStartMs;
    currentUrl = typeof state.currentUrl === "string" ? state.currentUrl : "";
    currentCategoryOverride =
      state.currentCategoryOverride === "productive" ||
      state.currentCategoryOverride === "social" ||
      state.currentCategoryOverride === "entertainment" ||
      state.currentCategoryOverride === "news" ||
      state.currentCategoryOverride === "shopping" ||
      state.currentCategoryOverride === "reference" ||
      state.currentCategoryOverride === "other"
        ? state.currentCategoryOverride
        : null;
    siteVisits.length = 0;

    if (Array.isArray(state.siteVisits)) {
      siteVisits.push(
        ...state.siteVisits.filter((visit) => {
          return (
            typeof visit.url === "string" &&
            typeof visit.hostname === "string" &&
            typeof visit.category === "string" &&
            typeof visit.dwellMs === "number" &&
            typeof visit.startedAt === "number"
          );
        })
      );
    }

    if (typeof state.pageSignals?.idleMs === "number") {
      pageSignals.idleMs = state.pageSignals.idleMs;
    }

    if (typeof state.pageSignals?.unfocusedMs === "number") {
      pageSignals.unfocusedMs = state.pageSignals.unfocusedMs;
    }

    if (typeof state.browserFocused === "boolean") {
      browserFocused = state.browserFocused;
    }

    if (typeof state.browserFocusChangedAt === "number") {
      browserFocusChangedAt = state.browserFocusChangedAt;
    }

    return;
  }

  const signals = stored[SESSION_SIGNALS_KEY] as Partial<typeof pageSignals> | undefined;

  if (typeof signals?.idleMs === "number") {
    pageSignals.idleMs = signals.idleMs;
  }

  if (typeof signals?.unfocusedMs === "number") {
    pageSignals.unfocusedMs = signals.unfocusedMs;
  }
}

function getVisitsSnapshot(now: number) {
  const visits = [...siteVisits];

  if (currentUrl) {
    visits.push(buildVisit(currentUrl, currentSiteStart, now, currentCategoryOverride));
  }

  return visits;
}

function closeSiteVisit(url: string, endMs: number) {
  siteVisits.push(buildVisit(url, currentSiteStart, endMs, currentCategoryOverride));
  persistSessionState();
}

function buildVisit(
  url: string,
  startMs: number,
  endMs: number,
  categoryOverride: SiteCategory | null = null
): SiteVisit {
  return {
    url,
    hostname: new URL(url).hostname.replace(/^www\./, ""),
    category: categoryOverride ?? classifyUrl(url),
    dwellMs: endMs - startMs,
    startedAt: startMs,
  };
}

function getInheritedCategory(
  fromUrl: string,
  toUrl: string,
  options: RecordVisitOptions
): SiteCategory | null {
  if (!options.inheritProductiveContext || !fromUrl) return null;

  const fromCategory = classifyUrl(fromUrl);
  const toCategory = classifyUrl(toUrl);

  if (
    toCategory === "other" &&
    (fromCategory === "productive" || fromCategory === "reference")
  ) {
    return "productive";
  }

  return null;
}

function buildMetrics(visits: SiteVisit[], now: number): SessionMetrics {
  const pendingUnfocusedMs = browserFocused ? 0 : now - browserFocusChangedAt;
  const totalActiveMs =
    now - sessionStartMs - pageSignals.idleMs - pageSignals.unfocusedMs - pendingUnfocusedMs;
  const activeMs = Math.max(0, totalActiveMs);
  const visitsDwellMs = visits.reduce((total, visit) => total + visit.dwellMs, 0);
  const activeRatio =
    visitsDwellMs > 0 && activeMs < visitsDwellMs ? activeMs / visitsDwellMs : 1;
  const activeAdjustedVisits = visits.map((visit) => ({
    ...visit,
    dwellMs: Math.max(0, Math.round(visit.dwellMs * activeRatio)),
  }));
  const categoryBreakdown = activeAdjustedVisits.reduce(
    (acc, v) => {
      acc[v.category] = (acc[v.category] ?? 0) + v.dwellMs;
      return acc;
    },
    {} as Record<SiteCategory, number>
  );

  return {
    sessionStartedAt: sessionStartMs,
    tabSwitches,
    openTabCount,
    totalActiveMs: activeMs,
    idleMs: pageSignals.idleMs,
    unfocusedMs: pageSignals.unfocusedMs + pendingUnfocusedMs,
    sites: activeAdjustedVisits,
    categoryBreakdown,
  };
}

function hasMeaningfulActivity(metrics: SessionMetrics) {
  const hasMeaningfulSite = metrics.sites.some((site) => {
    return site.dwellMs >= MIN_SITE_DWELL_MS && site.category !== "other";
  });

  return (
    metrics.totalActiveMs >= MIN_SESSION_ACTIVE_MS &&
    (metrics.tabSwitches > 0 || hasMeaningfulSite)
  );
}

async function rebuildDailySummary(uid: string, dateKey: string) {
  const { startMs, endMs } = getLocalDayBounds(dateKey);
  const sessionsQuery = query(
    collection(db, "users", uid, "sessions"),
    where("startedAt", ">=", startMs),
    where("startedAt", "<", endMs)
  );
  const snapshot = await getDocs(sessionsQuery);
  const sessions = snapshot.docs
    .map((row) => row.data() as { metrics?: SessionMetrics; status?: string })
    .filter((session) => session.metrics && hasMeaningfulActivity(session.metrics));

  const categoryBreakdown = sessions.reduce(
    (totals, session) => {
      const metrics = session.metrics!;
      for (const [category, duration] of Object.entries(metrics.categoryBreakdown)) {
        const siteCategory = category as SiteCategory;
        totals[siteCategory] = (totals[siteCategory] ?? 0) + duration;
      }
      return totals;
    },
    {} as Partial<Record<SiteCategory, number>>
  );
  const dominantCategory = getDominantCategory(categoryBreakdown);

  await setDoc(
    doc(db, "users", uid, "dailySummaries", dateKey),
    {
      date: dateKey,
      uid,
      totalScreentimeMs: sessions.reduce((total, session) => {
        return total + (session.metrics?.totalActiveMs ?? 0);
      }, 0),
      totalIdleMs: sessions.reduce((total, session) => {
        return total + (session.metrics?.idleMs ?? 0);
      }, 0),
      totalUnfocusedMs: sessions.reduce((total, session) => {
        return total + (session.metrics?.unfocusedMs ?? 0);
      }, 0),
      tabSwitches: sessions.reduce((total, session) => {
        return total + (session.metrics?.tabSwitches ?? 0);
      }, 0),
      sessionCount: sessions.length,
      completedSessionCount: sessions.filter((session) => session.status === "completed")
        .length,
      dominantCategory,
      categoryBreakdown,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

function getDominantCategory(
  categoryBreakdown: Partial<Record<SiteCategory, number>>
): SiteCategory | "none" {
  const entries = Object.entries(categoryBreakdown) as Array<[SiteCategory, number]>;
  if (entries.length === 0) return "none";

  return entries.reduce((best, current) => {
    return current[1] > best[1] ? current : best;
  })[0];
}

function getLocalDateKey(ms: number) {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getLocalDayBounds(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}
