import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../shared/firebase";
import { DailyFocus, Session } from "../../shared/types";
import { calculateStressIndicator, StressIndicatorLevel } from "../../shared/stress-score";

interface Props {
  uid: string;
  dailyFocus: DailyFocus;
}

interface DailyTrend {
  date: string;
  label: string;
  sessionCount: number;
  totalActiveMs: number;
  tabSwitches: number;
  lateNightMs: number;
  averageStressPoints: number;
  highestLevel: StressIndicatorLevel;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getDateKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function getShortDayLabel(dateKey: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(new Date(`${dateKey}T12:00:00`));
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function getStartOfHistoryWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.getTime() - 6 * DAY_MS;
}

function getEmptyTrendDays(): DailyTrend[] {
  const start = getStartOfHistoryWindow();

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start + index * DAY_MS);
    const dateKey = getDateKey(date.getTime());

    return {
      date: dateKey,
      label: getShortDayLabel(dateKey),
      sessionCount: 0,
      totalActiveMs: 0,
      tabSwitches: 0,
      lateNightMs: 0,
      averageStressPoints: 0,
      highestLevel: "low",
    };
  });
}

function getHighestLevel(levels: StressIndicatorLevel[]) {
  if (levels.includes("high")) return "high";
  if (levels.includes("moderate")) return "moderate";
  return "low";
}

function buildDailyTrends(sessions: Session[], dailyFocus: DailyFocus) {
  const trends = getEmptyTrendDays();
  const trendMap = new Map(trends.map((trend) => [trend.date, trend]));
  const stressPointsByDate = new Map<string, number[]>();
  const stressLevelsByDate = new Map<string, StressIndicatorLevel[]>();

  sessions.forEach((session) => {
    if (!session.metrics) return;

    const dateKey = getDateKey(session.endedAt);
    const trend = trendMap.get(dateKey);
    if (!trend) return;

    const score = calculateStressIndicator(session.metrics, dailyFocus);
    const points = stressPointsByDate.get(dateKey) ?? [];
    const levels = stressLevelsByDate.get(dateKey) ?? [];

    trend.sessionCount += 1;
    trend.totalActiveMs += session.metrics.totalActiveMs;
    trend.tabSwitches += session.metrics.tabSwitches;
    trend.lateNightMs += score.lateNightMs;
    points.push(score.points);
    levels.push(score.level);
    stressPointsByDate.set(dateKey, points);
    stressLevelsByDate.set(dateKey, levels);
  });

  trends.forEach((trend) => {
    const points = stressPointsByDate.get(trend.date) ?? [];
    const levels = stressLevelsByDate.get(trend.date) ?? [];

    if (points.length > 0) {
      trend.averageStressPoints =
        points.reduce((total, point) => total + point, 0) / points.length;
      trend.highestLevel = getHighestLevel(levels);
    }
  });

  return trends;
}

export default function History({ uid, dailyFocus }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      const sessionsRef = collection(db, "users", uid, "sessions");
      const historyQuery = query(
        sessionsRef,
        where("endedAt", ">=", getStartOfHistoryWindow()),
        orderBy("endedAt", "asc")
      );

      try {
        const snapshot = await getDocs(historyQuery);
        if (cancelled) return;

        const rows = snapshot.docs.map((doc) => {
          return { id: doc.id, ...doc.data() } as Session;
        });
        setSessions(rows);
        setError(null);
      } catch (err) {
        console.warn("[Moodi] Could not load history", err);
        if (!cancelled) {
          setError("Could not load historical sessions.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const trends = useMemo(() => {
    return buildDailyTrends(sessions, dailyFocus);
  }, [sessions, dailyFocus]);

  const totals = useMemo(() => {
    return trends.reduce(
      (acc, trend) => {
        acc.totalActiveMs += trend.totalActiveMs;
        acc.tabSwitches += trend.tabSwitches;
        acc.lateNightMs += trend.lateNightMs;
        acc.sessionCount += trend.sessionCount;
        acc.stressPoints += trend.averageStressPoints;
        return acc;
      },
      {
        totalActiveMs: 0,
        tabSwitches: 0,
        lateNightMs: 0,
        sessionCount: 0,
        stressPoints: 0,
      }
    );
  }, [trends]);

  const maxActiveMs = Math.max(...trends.map((trend) => trend.totalActiveMs), 1);
  const maxStressPoints = Math.max(
    ...trends.map((trend) => trend.averageStressPoints),
    1
  );
  const activeDays = trends.filter((trend) => trend.sessionCount > 0).length;
  const averageStress =
    activeDays > 0 ? totals.stressPoints / activeDays : 0;

  if (loading) {
    return <div className="score-loading">Loading history...</div>;
  }

  if (error) {
    return (
      <div className="score-empty">
        <strong>History unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }

  return (
    <section className="history-panel">
      <div className="history-intro">
        <span className="metric-label">7 day history</span>
        <h1>Weekly trends</h1>
        <p>Compare browsing duration, stress indicators, and late-night use.</p>
      </div>

      <div className="history-summary-grid">
        <div className="metric-card">
          <span className="metric-label">Screen time</span>
          <strong>{formatDuration(totals.totalActiveMs)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Avg indicator</span>
          <strong>{averageStress.toFixed(1)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Sessions</span>
          <strong>{totals.sessionCount}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Late-night</span>
          <strong>{formatDuration(totals.lateNightMs)}</strong>
        </div>
      </div>

      <div className="trend-card">
        <div className="section-heading">
          <h2>Daily screen time</h2>
        </div>
        <div className="trend-bars">
          {trends.map((trend) => (
            <div className="trend-day" key={trend.date}>
              <div className="trend-bar-track">
                <div
                  className="trend-bar-fill"
                  style={{
                    height: `${Math.max(6, (trend.totalActiveMs / maxActiveMs) * 100)}%`,
                  }}
                />
              </div>
              <span>{trend.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="trend-card">
        <div className="section-heading">
          <h2>Stress indicator trend</h2>
        </div>
        <div className="history-list">
          {trends.map((trend) => (
            <div className="history-row" key={trend.date}>
              <div>
                <strong>{trend.label}</strong>
                <span>
                  {trend.sessionCount} sessions · {formatDuration(trend.totalActiveMs)}
                </span>
              </div>
              <div className="history-score">
                <span className={`level-pill stress-${trend.highestLevel}`}>
                  {trend.highestLevel}
                </span>
                <b style={{ width: `${(trend.averageStressPoints / maxStressPoints) * 72}px` }} />
                <em>{trend.averageStressPoints.toFixed(1)}</em>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
