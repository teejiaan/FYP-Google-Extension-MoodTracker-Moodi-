import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  User,
} from "firebase/auth";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  DailySummary,
  FeedbackEntry,
  MoodEntry,
  Session,
  SiteCategory,
  UserRole,
} from "./types";
import { calculateStressIndicator } from "./stressScore";
import "./styles.css";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const APP_VERSION = "v1.0.0";
const CATEGORY_ORDER: SiteCategory[] = [
  "productive",
  "reference",
  "social",
  "entertainment",
  "news",
  "shopping",
  "other",
];
const MIN_MEANINGFUL_SESSION_MS = 5 * 60 * 1000;
const MIN_MEANINGFUL_SITE_MS = 30 * 1000;

function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  if (hours > 0 && remaining > 0) return `${hours}h ${remaining}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatDate(ms: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatFeedbackDate(entry: FeedbackEntry) {
  if (!entry.createdAt?.seconds) return "Recently";

  return formatDate(entry.createdAt.seconds * 1000);
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function getDominantCategory(session: Session): SiteCategory | "none" {
  const entries = Object.entries(session.metrics.categoryBreakdown ?? {}) as Array<
    [SiteCategory, number]
  >;

  if (entries.length === 0) return "none";
  return entries.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

function hasMeaningfulSession(session: Session) {
  const metrics = session.metrics;
  if (!metrics) return false;

  const hasMeaningfulSite = (metrics.sites ?? []).some((site) => {
    return site.dwellMs >= MIN_MEANINGFUL_SITE_MS && site.category !== "other";
  });

  return (
    metrics.totalActiveMs >= MIN_MEANINGFUL_SESSION_MS &&
    ((metrics.tabSwitches ?? 0) > 0 || hasMeaningfulSite)
  );
}

function getCategoryTotal(
  summaries: DailySummary[],
  category: SiteCategory
) {
  return summaries.reduce((total, day) => {
    return total + (day.categoryBreakdown?.[category] ?? 0);
  }, 0);
}

function getStressDistribution(sessions: Session[]) {
  return sessions.reduce(
    (totals, session) => {
      const score = calculateStressIndicator(session.metrics);
      totals[score.level] += 1;
      return totals;
    },
    { low: 0, moderate: 0, high: 0 }
  );
}

function getLocalDateKey(ms: number) {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildDailySummariesFromSessions(sessions: Session[]): DailySummary[] {
  const summaries = new Map<string, DailySummary>();

  for (const session of sessions) {
    if (!session.metrics) continue;

    const date = getLocalDateKey(session.startedAt ?? session.metrics.sessionStartedAt);
    const uid = session.uid ?? "unknown";
    const key = `${uid}-${date}`;
    const existing =
      summaries.get(key) ??
      ({
        id: key,
        date,
        uid,
        totalScreentimeMs: 0,
        totalIdleMs: 0,
        totalUnfocusedMs: 0,
        tabSwitches: 0,
        sessionCount: 0,
        completedSessionCount: 0,
        dominantCategory: "none",
        categoryBreakdown: {},
      } satisfies DailySummary);

    existing.totalScreentimeMs += session.metrics.totalActiveMs ?? 0;
    existing.totalIdleMs += session.metrics.idleMs ?? 0;
    existing.totalUnfocusedMs += session.metrics.unfocusedMs ?? 0;
    existing.tabSwitches += session.metrics.tabSwitches ?? 0;
    existing.sessionCount += 1;
    existing.completedSessionCount += session.status === "completed" ? 1 : 0;

    for (const [category, duration] of Object.entries(
      session.metrics.categoryBreakdown ?? {}
    )) {
      const siteCategory = category as SiteCategory;
      existing.categoryBreakdown[siteCategory] =
        (existing.categoryBreakdown[siteCategory] ?? 0) + duration;
    }

    const categoryEntries = Object.entries(existing.categoryBreakdown) as Array<
      [SiteCategory, number]
    >;
    existing.dominantCategory =
      categoryEntries.length > 0
        ? categoryEntries.reduce((best, current) =>
            current[1] > best[1] ? current : best
          )[0]
        : "none";

    summaries.set(key, existing);
  }

  return [...summaries.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function getAverageRating(feedback: FeedbackEntry[]) {
  if (feedback.length === 0) return 0;

  return (
    feedback.reduce((total, entry) => total + (entry.rating ?? 0), 0) /
    feedback.length
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("user");
  const [dashboardView, setDashboardView] = useState<"personal" | "developer">("personal");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [moodEntries, setMoodEntries] = useState<MoodEntry[]>([]);
  const [developerSessions, setDeveloperSessions] = useState<Session[]>([]);
  const [developerDailySummaries, setDeveloperDailySummaries] = useState<DailySummary[]>([]);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
  }, []);

  async function handleGoogleSignIn() {
    try {
      setAuthError(null);
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.warn("[Moodi] Could not start Google sign-in", error);
      setAuthError(
        `${error.code ?? "auth/error"}: ${
          error.message ?? "Could not start Google sign-in."
        }`
      );
    }
  }

  useEffect(() => {
    if (!user) {
      setRole("user");
      setDashboardView("personal");
      setSessions([]);
      setDailySummaries([]);
      setMoodEntries([]);
      setDeveloperSessions([]);
      setDeveloperDailySummaries([]);
      setFeedbackEntries([]);
      return;
    }

    loadData(user);
  }, [user]);

  async function ensureUserProfile(nextUser: User) {
    const userRef = doc(db, "users", nextUser.uid);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
      await setDoc(userRef, {
        uid: nextUser.uid,
        email: nextUser.email,
        displayName: nextUser.displayName,
        photoURL: nextUser.photoURL,
        role: "user",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
      return "user" as UserRole;
    }

    await setDoc(
      userRef,
      {
        email: nextUser.email,
        displayName: nextUser.displayName,
        photoURL: nextUser.photoURL,
        lastLoginAt: serverTimestamp(),
      },
      { merge: true }
    );

    const existingRole = userSnapshot.data().role;
    return existingRole === "developer" ? "developer" : "user";
  }

  async function loadData(nextUser = user) {
    if (!nextUser) return;

    setLoadingData(true);
    setStatus(null);

    try {
      const nextRole = await ensureUserProfile(nextUser);
      setRole(nextRole);

      const sessionsQuery = query(
        collection(db, "users", nextUser.uid, "sessions"),
        orderBy("endedAt", "desc")
      );
      const moodsQuery = query(
        collection(db, "users", nextUser.uid, "moodEntries"),
        orderBy("recordedAt", "desc")
      );
      const dailyQuery = query(
        collection(db, "users", nextUser.uid, "dailySummaries"),
        orderBy("date", "desc")
      );
      const [sessionSnapshot, moodSnapshot, dailySnapshot] = await Promise.all([
        getDocs(sessionsQuery),
        getDocs(moodsQuery),
        getDocs(dailyQuery),
      ]);

      setSessions(
        sessionSnapshot.docs
          .map((row) => ({ id: row.id, ...row.data() } as Session))
          .filter(hasMeaningfulSession)
      );
      setDailySummaries(
        dailySnapshot.docs.map((row) => ({ id: row.id, ...row.data() } as DailySummary))
      );
      setMoodEntries(
        moodSnapshot.docs.map((row) => ({ id: row.id, ...row.data() } as MoodEntry))
      );

      if (nextRole === "developer") {
        await loadDeveloperData();
      }
    } catch (error) {
      console.warn("[Moodi] Could not load dashboard data", error);
      setStatus("Could not load dashboard data. Check Firestore rules and indexes.");
    } finally {
      setLoadingData(false);
    }
  }

  async function loadDeveloperData() {
    const [sessionSnapshot, dailySnapshot, feedbackSnapshot] = await Promise.all([
      getDocs(collectionGroup(db, "sessions")),
      getDocs(collectionGroup(db, "dailySummaries")),
      getDocs(collection(db, "feedback")),
    ]);

    setDeveloperSessions(
      sessionSnapshot.docs
        .map((row) => ({ id: row.id, ...row.data() } as Session))
        .filter(hasMeaningfulSession)
        .sort((a, b) => b.endedAt - a.endedAt)
    );
    setDeveloperDailySummaries(
      dailySnapshot.docs
        .map((row) => ({ id: row.id, ...row.data() } as DailySummary))
        .sort((a, b) => b.date.localeCompare(a.date))
    );
    setFeedbackEntries(
      feedbackSnapshot.docs
        .map((row) => ({ id: row.id, ...row.data() } as FeedbackEntry))
        .sort((a, b) => {
          return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
        })
    );
  }

  const summary = useMemo(() => {
    const totalActiveMs = sessions.reduce((total, session) => {
      return total + (session.metrics?.totalActiveMs ?? 0);
    }, 0);
    const totalTabSwitches = sessions.reduce((total, session) => {
      return total + (session.metrics?.tabSwitches ?? 0);
    }, 0);
    const stressScores = sessions.map((session) => {
      return calculateStressIndicator(session.metrics).points;
    });
    const averageStress =
      stressScores.length > 0
        ? stressScores.reduce((total, score) => total + score, 0) / stressScores.length
        : 0;

    return {
      totalActiveMs,
      totalTabSwitches,
      averageStress,
      sessionCount: sessions.length,
      moodCount: moodEntries.length,
    };
  }, [sessions, moodEntries]);

  const developerSummary = useMemo(() => {
    const derivedDailySummaries = buildDailySummariesFromSessions(developerSessions);
    const analyticsDailySummaries =
      developerDailySummaries.length > 0
        ? developerDailySummaries
        : derivedDailySummaries;
    const uniqueUsers = new Set([
      ...analyticsDailySummaries.map((day) => day.uid),
      ...developerSessions.map((session) => session.uid),
    ]);
    const totalScreentimeMs = analyticsDailySummaries.reduce((total, day) => {
      return total + (day.totalScreentimeMs ?? 0);
    }, 0);
    const totalTabSwitches = analyticsDailySummaries.reduce((total, day) => {
      return total + (day.tabSwitches ?? 0);
    }, 0);
    const stressDistribution = getStressDistribution(developerSessions);
    const categoryTotals = CATEGORY_ORDER.map((category) => ({
      category,
      totalMs: getCategoryTotal(analyticsDailySummaries, category),
    })).filter((item) => item.totalMs > 0);
    const maxCategoryMs = Math.max(...categoryTotals.map((item) => item.totalMs), 1);
    const recentDaily = [...analyticsDailySummaries]
      .slice(0, 10)
      .reverse();
    const maxDailyMs = Math.max(
      ...recentDaily.map((day) => day.totalScreentimeMs ?? 0),
      1
    );

    return {
      uniqueUserCount: uniqueUsers.size,
      totalScreentimeMs,
      averageScreentimeMs:
        analyticsDailySummaries.length > 0
          ? totalScreentimeMs / analyticsDailySummaries.length
          : 0,
      totalTabSwitches,
      stressDistribution,
      categoryTotals,
      maxCategoryMs,
      recentDaily,
      maxDailyMs,
      averageFeedbackRating: getAverageRating(feedbackEntries),
      dataSource:
        developerDailySummaries.length > 0
          ? "Daily summaries"
          : developerSessions.length > 0
            ? "Derived from sessions"
            : "No analytics data yet",
    };
  }, [developerDailySummaries, developerSessions, feedbackEntries]);

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      uid: user?.uid,
      sessions,
      dailySummaries,
      moodEntries,
    };

    downloadFile(
      `moodi-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    setStatus("JSON export downloaded.");
  }

  function exportCsv() {
    const rows = sessions.map((session) => {
      const score = calculateStressIndicator(session.metrics);
      return [
        session.id,
        new Date(session.startedAt).toISOString(),
        new Date(session.endedAt).toISOString(),
        session.metrics.totalActiveMs,
        session.metrics.idleMs,
        session.metrics.unfocusedMs ?? 0,
        session.metrics.tabSwitches,
        session.metrics.openTabCount,
        score.points,
        score.level,
        getDominantCategory(session),
      ];
    });
    const header = [
      "sessionId",
      "startedAt",
      "endedAt",
      "activeMs",
      "idleMs",
      "awayFromChromeMs",
      "tabSwitches",
      "openTabCount",
      "stressPoints",
      "stressLevel",
      "dominantCategory",
    ];
    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");

    downloadFile(
      `moodi-sessions-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      "text/csv"
    );
    setStatus("CSV export downloaded.");
  }

  async function deleteHistory() {
    if (!user || !deleteConfirm) {
      setDeleteConfirm(true);
      setStatus("Click Delete all history again to confirm.");
      return;
    }

    setLoadingData(true);
    setStatus("Deleting history...");

    try {
      await Promise.all([
        ...sessions.map((session) => {
          return deleteDoc(doc(db, "users", user.uid, "sessions", session.id));
        }),
        ...moodEntries.map((entry) => {
          return deleteDoc(doc(db, "users", user.uid, "moodEntries", entry.id));
        }),
        ...dailySummaries.map((day) => {
          return deleteDoc(doc(db, "users", user.uid, "dailySummaries", day.id));
        }),
      ]);
      setSessions([]);
      setDailySummaries([]);
      setMoodEntries([]);
      setDeleteConfirm(false);
      setStatus("History deleted.");
    } catch (error) {
      console.warn("[Moodi] Could not delete history", error);
      setStatus("Could not delete history. Check Firestore permissions.");
    } finally {
      setLoadingData(false);
    }
  }

  if (authLoading) {
    return <main className="center-screen">Loading Moodi...</main>;
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="login-layout">
          <div className="login-logo-panel">
            <img className="login-logo" src="/moodi-logo.png" alt="Moodi" />
          </div>

          <div className="login-copy-panel">
            <span className="eyebrow">Mental State Monitor</span>
            <h1>Moodi</h1>
            <small>{APP_VERSION}</small>

            <div className="login-bubble">
              <p>Sign in with the same Google account used in the extension.</p>
              <button className="google-auth-button" onClick={handleGoogleSignIn}>
                <GoogleMark />
                <span>Sign in with Google</span>
              </button>
              <span>Personal dashboard and developer analytics use role-based access.</span>
            </div>

            {authError && <p className="auth-error">{authError}</p>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Moodi Dashboard</span>
          <h1>Browsing wellness history</h1>
        </div>
        <div className="user-actions">
          {role === "developer" && (
            <div className="view-switcher">
              <button
                className={dashboardView === "personal" ? "active" : ""}
                onClick={() => setDashboardView("personal")}
              >
                Personal
              </button>
              <button
                className={dashboardView === "developer" ? "active" : ""}
                onClick={() => setDashboardView("developer")}
              >
                Developer
              </button>
            </div>
          )}
          <span>{user.email}</span>
          <button onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      {role === "developer" && dashboardView === "developer" ? (
        <>
          <section className="summary-grid">
            <article>
              <span>Tracked users</span>
              <strong>{developerSummary.uniqueUserCount}</strong>
            </article>
            <article>
              <span>Avg daily screen time</span>
              <strong>{formatDuration(developerSummary.averageScreentimeMs)}</strong>
            </article>
            <article>
              <span>Total tab switches</span>
              <strong>{developerSummary.totalTabSwitches}</strong>
            </article>
            <article>
              <span>Avg feedback</span>
              <strong>{developerSummary.averageFeedbackRating.toFixed(1)}/5</strong>
            </article>
          </section>

          <section className="analytics-health panel">
            <div>
              <span className="eyebrow">Analytics source</span>
              <h2>{developerSummary.dataSource}</h2>
            </div>
            <div className="analytics-health-grid">
              <span>{developerSessions.length} sessions loaded</span>
              <span>{developerDailySummaries.length} daily summaries loaded</span>
              <span>{feedbackEntries.length} feedback entries loaded</span>
            </div>
          </section>

          <section className="developer-grid">
            <article className="panel chart-panel">
              <div className="section-heading">
                <h2>Daily screen time trend</h2>
                <button onClick={() => loadData(user)} disabled={loadingData}>
                  Refresh
                </button>
              </div>
              {developerSummary.recentDaily.length === 0 ? (
                <p className="empty-text">No aggregated daily summaries found yet.</p>
              ) : (
                <div className="bar-chart">
                  {developerSummary.recentDaily.map((day) => (
                    <div className="bar-column" key={`${day.uid}-${day.date}`}>
                      <div className="bar-track">
                        <span
                          style={{
                            height: `${Math.max(
                              8,
                              (day.totalScreentimeMs / developerSummary.maxDailyMs) * 100
                            )}%`,
                          }}
                        />
                      </div>
                      <small>{day.date.slice(5)}</small>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel chart-panel">
              <h2>Stress distribution</h2>
              <div className="stress-bars">
                {Object.entries(developerSummary.stressDistribution).map(
                  ([level, count]) => {
                    const maxCount = Math.max(
                      developerSummary.stressDistribution.low,
                      developerSummary.stressDistribution.moderate,
                      developerSummary.stressDistribution.high,
                      1
                    );
                    return (
                      <div className="horizontal-bar" key={level}>
                        <span>{level}</span>
                        <div>
                          <b
                            className={level}
                            style={{ width: `${Math.max(6, (count / maxCount) * 100)}%` }}
                          />
                        </div>
                        <strong>{count}</strong>
                      </div>
                    );
                  }
                )}
              </div>
            </article>

            <article className="panel chart-panel">
              <h2>Category breakdown</h2>
              {developerSummary.categoryTotals.length === 0 ? (
                <p className="empty-text">No category data yet.</p>
              ) : (
                <div className="category-chart">
                  {developerSummary.categoryTotals.map((item) => (
                    <div className="horizontal-bar" key={item.category}>
                      <span>{item.category}</span>
                      <div>
                        <b
                          className={`cat-${item.category}`}
                          style={{
                            width: `${Math.max(
                              6,
                              (item.totalMs / developerSummary.maxCategoryMs) * 100
                            )}%`,
                          }}
                        />
                      </div>
                      <strong>{formatDuration(item.totalMs)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel feedback-panel">
              <h2>User feedback</h2>
              {feedbackEntries.length === 0 ? (
                <p className="empty-text">No feedback submitted yet.</p>
              ) : (
                <div className="feedback-list">
                  {feedbackEntries.slice(0, 8).map((entry) => (
                    <div className="feedback-row" key={entry.id}>
                      <div>
                        <strong>
                          {entry.type} · {entry.rating}/5
                        </strong>
                        <span>{formatFeedbackDate(entry)} · {entry.email ?? "Unknown user"}</span>
                        <p>{entry.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      ) : (
        <>

      <section className="summary-grid">
        <article>
          <span>Total screen time</span>
          <strong>{formatDuration(summary.totalActiveMs)}</strong>
        </article>
        <article>
          <span>Sessions</span>
          <strong>{summary.sessionCount}</strong>
        </article>
        <article>
          <span>Tab switches</span>
          <strong>{summary.totalTabSwitches}</strong>
        </article>
        <article>
          <span>Avg indicator</span>
          <strong>{summary.averageStress.toFixed(1)}</strong>
        </article>
      </section>

      <section className="controls-card">
        <div>
          <span className="eyebrow">Data controls</span>
          <h2>Export or delete history</h2>
          <p>
            Exports include behavioural sessions and mood check-ins for the signed-in
            account.
          </p>
        </div>
        <div className="control-buttons">
          <button onClick={exportJson} disabled={loadingData}>Export JSON</button>
          <button onClick={exportCsv} disabled={loadingData}>Export CSV</button>
          <button className="danger" onClick={deleteHistory} disabled={loadingData}>
            {deleteConfirm ? "Confirm delete" : "Delete all history"}
          </button>
        </div>
        {status && <p className="status-text">{status}</p>}
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="section-heading">
            <h2>Recent sessions</h2>
            <button onClick={() => loadData(user)} disabled={loadingData}>
              Refresh
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="empty-text">No sessions found yet.</p>
          ) : (
            <div className="session-list">
              {sessions.slice(0, 12).map((session) => {
                const score = calculateStressIndicator(session.metrics);
                return (
                  <div className="session-row" key={session.id}>
                    <div>
                      <strong>{formatDate(session.endedAt)}</strong>
                      <span>
                        {formatDuration(session.metrics.totalActiveMs)} ·{" "}
                        {session.metrics.tabSwitches} switches ·{" "}
                        {getDominantCategory(session)}
                      </span>
                    </div>
                    <b className={`level-pill ${score.level}`}>{score.level}</b>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel">
          <h2>Daily summaries</h2>
          {dailySummaries.length === 0 ? (
            <p className="empty-text">No daily summaries found yet.</p>
          ) : (
            <div className="session-list">
              {dailySummaries.slice(0, 7).map((day) => (
                <div className="session-row" key={day.id}>
                  <div>
                    <strong>{day.date}</strong>
                    <span>
                      {formatDuration(day.totalScreentimeMs)} · {day.tabSwitches} switches ·{" "}
                      {day.completedSessionCount || day.sessionCount} sessions ·{" "}
                      {day.dominantCategory}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <h2>Mood check-ins</h2>
          {moodEntries.length === 0 ? (
            <p className="empty-text">No mood check-ins found yet.</p>
          ) : (
            <div className="session-list">
              {moodEntries.slice(0, 8).map((entry) => (
                <div className="session-row" key={entry.id}>
                  <div>
                    <strong>Score {entry.score}/5</strong>
                    <span>{entry.note || "No note"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
