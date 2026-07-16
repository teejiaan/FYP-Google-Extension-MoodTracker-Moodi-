import { DailyFocus, SessionMetrics, SiteVisit } from "./types";

export type StressIndicatorLevel = "low" | "moderate" | "high";

export interface StressIndicatorResult {
  points: number;
  maxPoints: number;
  level: StressIndicatorLevel;
  lateNightMs: number;
  tabSwitchesPerHour: number;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const LATE_NIGHT_START_HOUR = 23;
const LATE_NIGHT_END_HOUR = 5;

function getLateNightMs(visits: SiteVisit[]) {
  return visits.reduce((total, visit) => {
    return total + getLateNightOverlapMs(visit.startedAt, visit.startedAt + visit.dwellMs);
  }, 0);
}

function getLateNightOverlapMs(startMs: number, endMs: number) {
  if (endMs <= startMs) return 0;

  let total = 0;
  let windowStart = getLateNightWindowStart(startMs);

  while (windowStart < endMs) {
    const windowEndDate = new Date(windowStart);
    windowEndDate.setDate(windowEndDate.getDate() + 1);
    windowEndDate.setHours(LATE_NIGHT_END_HOUR, 0, 0, 0);

    const windowEnd = windowEndDate.getTime();
    const overlapStart = Math.max(startMs, windowStart);
    const overlapEnd = Math.min(endMs, windowEnd);

    if (overlapEnd > overlapStart) {
      total += overlapEnd - overlapStart;
    }

    const nextWindowStart = new Date(windowStart);
    nextWindowStart.setDate(nextWindowStart.getDate() + 1);
    windowStart = nextWindowStart.getTime();
  }

  return total;
}

function getLateNightWindowStart(timestamp: number) {
  const date = new Date(timestamp);
  const hour = date.getHours();

  if (hour < LATE_NIGHT_END_HOUR) {
    date.setDate(date.getDate() - 1);
  }

  date.setHours(LATE_NIGHT_START_HOUR, 0, 0, 0);
  return date.getTime();
}

function getLevel(points: number): StressIndicatorLevel {
  if (points >= 6) return "high";
  if (points >= 3) return "moderate";
  return "low";
}

export function calculateStressIndicator(
  metrics: SessionMetrics,
  dailyFocus: DailyFocus = "academic"
): StressIndicatorResult {
  const activeHours = metrics.totalActiveMs / HOUR_MS;
  const activeMinutes = metrics.totalActiveMs / MINUTE_MS;
  const tabSwitchesPerHour = metrics.tabSwitches / Math.max(activeHours, 0.25);
  const idleRatio = metrics.idleMs / Math.max(metrics.totalActiveMs + metrics.idleMs, 1);
  const lateNightMs = Math.min(
    getLateNightMs(metrics.sites ?? []),
    metrics.totalActiveMs
  );
  const fragmentedVisits = (metrics.sites ?? []).filter(
    (site) => site.dwellMs < 2 * MINUTE_MS
  ).length;
  const socialEntertainmentMs =
    (metrics.categoryBreakdown.social ?? 0) +
    (metrics.categoryBreakdown.entertainment ?? 0);
  const distractionRatio = socialEntertainmentMs / Math.max(metrics.totalActiveMs, 1);

  let points = 0;
  if (lateNightMs >= 60 * MINUTE_MS) points += 2;
  if (tabSwitchesPerHour >= 30 && metrics.tabSwitches >= 8) points += 2;
  if (activeMinutes >= 240) points += 2;
  if (activeMinutes >= 45 && idleRatio < 0.08) points += 1;
  if (fragmentedVisits >= 10) points += 1;
  if (metrics.openTabCount >= 12) points += 1;
  if (dailyFocus === "academic" && activeMinutes >= 20 && distractionRatio >= 0.35) {
    points += 2;
  }

  return {
    points,
    maxPoints: 11,
    level: getLevel(points),
    lateNightMs,
    tabSwitchesPerHour,
  };
}
