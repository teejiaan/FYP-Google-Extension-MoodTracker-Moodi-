import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../shared/firebase";
import {
  ExtensionMessage,
  DailyFocus,
  Session,
  SessionMetrics,
  SiteCategory,
  SiteVisit,
} from "../../shared/types";
import { calculateStressIndicator } from "../../shared/stress-score";

interface Props {
  uid: string;
  dailyFocus: DailyFocus;
  onChangeFocus: () => void;
}

interface BaselineComparison {
  sessionCount: number;
  avgActiveMs: number;
  avgTabSwitchesPerHour: number;
  durationDeltaPct: number;
  tabSwitchDeltaPct: number;
  summary: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_WINDOW_DAYS = 21;
const MIN_BASELINE_SESSIONS = 10;
const MIN_BASELINE_ACTIVE_DAYS = 7;
const MIN_BASELINE_SESSION_MS = 5 * 60 * 1000;

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getVisitKey(site: SiteVisit) {
  return `${site.url}-${site.startedAt}`;
}

function formatClockTime(ms: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function getDominantCategory(metrics: SessionMetrics): SiteCategory | "none" {
  const entries = Object.entries(metrics.categoryBreakdown) as Array<
    [SiteCategory, number]
  >;

  if (entries.length === 0) return "none";

  return entries.reduce((best, current) =>
    current[1] > best[1] ? current : best
  )[0];
}

function getTabSwitchesPerHour(metrics: SessionMetrics) {
  return metrics.tabSwitches / Math.max(metrics.totalActiveMs / 3600000, 0.25);
}

function formatPercentChange(value: number) {
  const rounded = Math.abs(Math.round(value));

  if (rounded === 0) return "about the same";
  return `${rounded}% ${value > 0 ? "higher" : "lower"}`;
}

function getLocalDateKey(ms: number) {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildBaselineComparison(
  currentMetrics: SessionMetrics,
  sessions: Session[]
): BaselineComparison | null {
  const validSessions = sessions.filter((session) => {
    return (
      session.metrics &&
      session.metrics.totalActiveMs >= MIN_BASELINE_SESSION_MS
    );
  });
  const activeDays = new Set(
    validSessions.map((session) => getLocalDateKey(session.endedAt))
  );

  if (
    validSessions.length < MIN_BASELINE_SESSIONS ||
    activeDays.size < MIN_BASELINE_ACTIVE_DAYS
  ) {
    return null;
  }

  const avgActiveMs =
    validSessions.reduce((total, session) => {
      return total + session.metrics.totalActiveMs;
    }, 0) / validSessions.length;
  const avgTabSwitchesPerHour =
    validSessions.reduce((total, session) => {
      return total + getTabSwitchesPerHour(session.metrics);
    }, 0) / validSessions.length;
  const currentTabSwitchesPerHour = getTabSwitchesPerHour(currentMetrics);
  const durationDeltaPct =
    ((currentMetrics.totalActiveMs - avgActiveMs) / Math.max(avgActiveMs, 1)) * 100;
  const tabSwitchDeltaPct =
    ((currentTabSwitchesPerHour - avgTabSwitchesPerHour) /
      Math.max(avgTabSwitchesPerHour, 1)) *
    100;
  const mainShift =
    Math.abs(tabSwitchDeltaPct) >= Math.abs(durationDeltaPct)
      ? `Tab switching is ${formatPercentChange(tabSwitchDeltaPct)} than your recent baseline.`
      : `Session duration is ${formatPercentChange(durationDeltaPct)} than your recent baseline.`;

  return {
    sessionCount: validSessions.length,
    avgActiveMs,
    avgTabSwitchesPerHour,
    durationDeltaPct,
    tabSwitchDeltaPct,
    summary: mainShift,
  };
}

function getRecommendation(metrics: SessionMetrics, dailyFocus: DailyFocus) {
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

  if (
    dailyFocus === "academic" &&
    activeMinutes >= 120 &&
    productiveRatio >= 0.55
  ) {
    return {
      title: "Take a 15 minute reset",
      body: "You have been in a long research or work stretch. Step away, hydrate, and rest your eyes before continuing.",
      tone: "rest",
    };
  }

  if (
    dailyFocus === "academic" &&
    activeMinutes >= 60 &&
    productiveRatio >= 0.55
  ) {
    return {
      title: "Plan a short break soon",
      body: "You have crossed about an hour of focused activity. A 10 minute pause can help protect attention and reduce fatigue.",
      tone: "rest",
    };
  }

  if (
    dailyFocus === "academic" &&
    tabSwitchesPerHour >= 45 &&
    metrics.tabSwitches >= 12
  ) {
    return {
      title: "Reduce context switching",
      body: "Your tab switching is high. Close unused tabs or choose one task to finish before moving to the next.",
      tone: "focus",
    };
  }

  if (
    dailyFocus === "academic" &&
    distractionRatio >= 0.35 &&
    activeMinutes >= 20
  ) {
    return {
      title: "Check your intention",
      body: "You chose academic or work mode, but social or entertainment browsing is taking a noticeable share. Try returning to one priority.",
      tone: "focus",
    };
  }

  if (dailyFocus === "casual" && activeMinutes >= 90 && distractionRatio >= 0.45) {
    return {
      title: "Enjoy it, then pause",
      body: "This looks like a longer casual browsing stretch. Consider a short break before continuing so it stays restorative.",
      tone: "rest",
    };
  }

  if (dailyFocus === "casual" && activeMinutes >= 45 && productiveRatio >= 0.55) {
    return {
      title: "Casual mode, productive pattern",
      body: "Your browsing looks more work-like than casual. If your goal changed, switch today's focus to academic or work.",
      tone: "steady",
    };
  }

  if (dailyFocus === "academic" && metrics.openTabCount >= 12) {
    return {
      title: "Tidy your workspace",
      body: "You have many tabs open. Closing what you no longer need may make the next task feel lighter.",
      tone: "focus",
    };
  }

  return {
    title: dailyFocus === "academic" ? "Keep a steady pace" : "Browse mindfully",
    body:
      dailyFocus === "academic"
        ? "Your current session looks manageable. Keep checking in with your energy as you work."
        : "Your current session looks manageable. Keep it intentional and take a break if it stops feeling restorative.",
    tone: "steady",
  };
}

export default function MiniScore({ uid, dailyFocus, onChangeFocus }: Props) {
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [previousSession, setPreviousSession] = useState<Session | null>(null);
  const [baselineSessions, setBaselineSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function fetchLiveMetrics() {
      const message: ExtensionMessage = { type: "GET_SESSION_METRICS" };

      chrome.runtime.sendMessage(message, (response?: ExtensionMessage) => {
        if (cancelled) return;

        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          setError(runtimeError.message ?? "Could not read live tracking data.");
          setLoading(false);
          return;
        }

        if (!response || response.type !== "SESSION_METRICS_RESPONSE") {
          setError("The background tracker did not return session metrics.");
          setLoading(false);
          return;
        }

        setMetrics(response.metrics);
        setError(null);
        setLoading(false);
      });
    }

    fetchLiveMetrics();
    const interval = window.setInterval(fetchLiveMetrics, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchSessionContext() {
      if (!metrics) return;

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startOfBaseline = Date.now() - BASELINE_WINDOW_DAYS * DAY_MS;

      const sessionsRef = collection(db, "users", uid, "sessions");
      const todaySessionsQuery = query(
        sessionsRef,
        where("endedAt", ">=", startOfDay.getTime()),
        where("endedAt", "<", metrics.sessionStartedAt),
        orderBy("endedAt", "desc"),
        limit(1)
      );
      const baselineQuery = query(
        sessionsRef,
        where("endedAt", ">=", startOfBaseline),
        where("endedAt", "<", metrics.sessionStartedAt),
        orderBy("endedAt", "desc"),
        limit(80)
      );

      try {
        const [todaySnapshot, baselineSnapshot] = await Promise.all([
          getDocs(todaySessionsQuery),
          getDocs(baselineQuery),
        ]);
        if (cancelled) return;

        if (!todaySnapshot.empty) {
          const doc = todaySnapshot.docs[0];
          setPreviousSession({ id: doc.id, ...doc.data() } as Session);
        }

        setBaselineSessions(
          baselineSnapshot.docs.map((doc) => {
            return { id: doc.id, ...doc.data() } as Session;
          })
        );
      } catch (e) {
        console.warn("[Moodi] Could not load session context", e);
      }
    }

    fetchSessionContext();

    return () => {
      cancelled = true;
    };
  }, [uid, metrics?.sessionStartedAt]);

  const recentSites = useMemo(() => {
    return [...(metrics?.sites ?? [])].reverse().slice(0, 5);
  }, [metrics]);

  if (loading) return <div className="score-loading">Loading tracking data...</div>;

  if (error) {
    return (
      <div className="score-empty">
        <strong>Tracking unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!metrics) {
    return <div className="score-empty">No live tracking data yet.</div>;
  }

  const totalForBreakdown = Math.max(metrics.totalActiveMs, 1);
  const hasSites = recentSites.length > 0;
  const recommendation = getRecommendation(metrics, dailyFocus);
  const stressIndicator = calculateStressIndicator(metrics, dailyFocus);
  const baseline = buildBaselineComparison(metrics, baselineSessions);
  const focusLabel =
    dailyFocus === "academic" ? "Academic or work" : "Casual browsing";

  return (
    <div className="today-panel">
      <section className="focus-chip-row">
        <span>{focusLabel}</span>
        <button type="button" onClick={onChangeFocus}>
          Change
        </button>
      </section>

      <section className="tracking-summary">
        <div className="metric-card metric-card-primary">
          <span className="metric-label">Screen time</span>
          <strong>{formatDuration(metrics.totalActiveMs)}</strong>
        </div>

        <div className="metric-grid">
          <div className={`metric-card stress-score-card stress-${stressIndicator.level}`}>
            <span className="metric-label">Stress indicator</span>
            <strong>{stressIndicator.level}</strong>
            <span>{stressIndicator.points}/{stressIndicator.maxPoints} points</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tab switches</span>
            <strong>{metrics.tabSwitches}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open tabs</span>
            <strong>{metrics.openTabCount}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Idle time</span>
            <strong>{formatDuration(metrics.idleMs)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Late-night</span>
            <strong>{formatDuration(stressIndicator.lateNightMs)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Away from Chrome</span>
            <strong>{formatDuration(metrics.unfocusedMs ?? 0)}</strong>
          </div>
        </div>
      </section>

      <section className={`stress-detail-card stress-${stressIndicator.level}`}>
        <span className="metric-label">Rule-based explanation</span>
        <h2>{stressIndicator.summary}</h2>
        {stressIndicator.contributors.length > 0 ? (
          <div className="contributor-list">
            {stressIndicator.contributors.map((contributor) => (
              <div className="contributor-row" key={contributor.label}>
                <div>
                  <strong>{contributor.label}</strong>
                  <span>{contributor.detail}</span>
                </div>
                <b>+{contributor.points}</b>
              </div>
            ))}
          </div>
        ) : (
          <p>No major stress-related browsing indicators detected yet.</p>
        )}
      </section>

      <section className="baseline-card">
        <span className="metric-label">Personal baseline</span>
        {baseline ? (
          <>
            <h2>{baseline.summary}</h2>
            <div className="baseline-grid">
              <div>
                <span>Duration</span>
                <strong>{formatPercentChange(baseline.durationDeltaPct)}</strong>
              </div>
              <div>
                <span>Tab switching</span>
                <strong>{formatPercentChange(baseline.tabSwitchDeltaPct)}</strong>
              </div>
            </div>
            <p>
              Compared with {baseline.sessionCount} recent sessions averaging{" "}
              {formatDuration(baseline.avgActiveMs)} and{" "}
              {Math.round(baseline.avgTabSwitchesPerHour)} switches/hour.
            </p>
          </>
        ) : (
          <>
            <h2>Insufficient data</h2>
            <p>
              Moodi needs at least {MIN_BASELINE_SESSIONS} meaningful sessions
              across {MIN_BASELINE_ACTIVE_DAYS} active days before comparing your
              current activity against a personal baseline.
            </p>
          </>
        )}
      </section>

      <section className={`recommendation-card recommendation-${recommendation.tone}`}>
        <span className="metric-label">Recommended action</span>
        <h2>{recommendation.title}</h2>
        <p>{recommendation.body}</p>
      </section>

      {previousSession && (
        <section className="previous-session-card">
          <div className="section-heading">
            <h2>Previous session today</h2>
            <span>
              {formatClockTime(previousSession.startedAt)} -{" "}
              {formatClockTime(previousSession.endedAt)}
            </span>
          </div>

          <div className="previous-session-grid">
            <div>
              <span className="metric-label">Duration</span>
              <strong>{formatDuration(previousSession.metrics.totalActiveMs)}</strong>
            </div>
            <div>
              <span className="metric-label">Tabs</span>
              <strong>{previousSession.metrics.tabSwitches}</strong>
            </div>
            <div>
              <span className="metric-label">Main activity</span>
              <strong>{getDominantCategory(previousSession.metrics)}</strong>
            </div>
          </div>
        </section>
      )}

      <section className="category-section">
        <div className="section-heading">
          <h2>Category split</h2>
        </div>

        <div className="category-bar">
          {Object.entries(metrics.categoryBreakdown).map(([cat, ms]) => {
            const pct = (ms / totalForBreakdown) * 100;
            return (
              <div
                key={cat}
                className={`bar-segment cat-${cat}`}
                style={{ width: `${pct}%` }}
                title={`${cat}: ${Math.round(pct)}%`}
              />
            );
          })}
        </div>
      </section>

      <section className="visited-section">
        <div className="section-heading">
          <h2>Recent websites</h2>
        </div>

        {hasSites ? (
          <div className="site-list">
            {recentSites.map((site) => (
              <div className="site-row" key={getVisitKey(site)}>
                <div>
                  <strong>{site.hostname}</strong>
                  <span>{site.category}</span>
                </div>
                <span>{formatDuration(site.dwellMs)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-text">Open or switch tabs to start tracking websites.</p>
        )}
      </section>
    </div>
  );
}
