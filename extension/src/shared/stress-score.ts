import { DailyFocus, SessionMetrics, SiteVisit } from "./types";

export type StressIndicatorLevel = "low" | "moderate" | "high";

export interface StressContributor {
  label: string;
  detail: string;
  points: number;
}

export interface StressIndicatorResult {
  points: number;
  maxPoints: number;
  level: StressIndicatorLevel;
  summary: string;
  contributors: StressContributor[];
  lateNightMs: number;
  tabSwitchesPerHour: number;
  idleRatio: number;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const LATE_NIGHT_START_HOUR = 23;
const LATE_NIGHT_END_HOUR = 5;

function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) return `${hours}h ${remainingMinutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function getLateNightMs(visits: SiteVisit[]) {
  return visits.reduce((total, visit) => {
    const start = visit.startedAt;
    const end = visit.startedAt + visit.dwellMs;
    return total + getLateNightOverlapMs(start, end);
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

function getSummary(level: StressIndicatorLevel) {
  if (level === "high") {
    return "Several browsing patterns suggest possible cognitive load today.";
  }

  if (level === "moderate") {
    return "Some browsing patterns suggest rising strain or fragmented attention.";
  }

  return "Current browsing patterns look manageable.";
}

export function calculateStressIndicator(
  metrics: SessionMetrics,
  dailyFocus: DailyFocus
): StressIndicatorResult {
  const contributors: StressContributor[] = [];
  const activeHours = metrics.totalActiveMs / HOUR_MS;
  const activeMinutes = metrics.totalActiveMs / MINUTE_MS;
  const tabSwitchesPerHour = metrics.tabSwitches / Math.max(activeHours, 0.25);
  const idleRatio = metrics.idleMs / Math.max(metrics.totalActiveMs + metrics.idleMs, 1);
  const lateNightMs = Math.min(getLateNightMs(metrics.sites), metrics.totalActiveMs);
  const fragmentedVisits = metrics.sites.filter((site) => site.dwellMs < 2 * MINUTE_MS)
    .length;
  const socialEntertainmentMs =
    (metrics.categoryBreakdown.social ?? 0) +
    (metrics.categoryBreakdown.entertainment ?? 0);
  const distractionRatio = socialEntertainmentMs / Math.max(metrics.totalActiveMs, 1);

  if (lateNightMs >= 60 * MINUTE_MS) {
    contributors.push({
      label: "Late-night browsing",
      detail: `${formatDuration(lateNightMs)} between 11 PM and 5 AM`,
      points: 2,
    });
  }

  if (tabSwitchesPerHour >= 30 && metrics.tabSwitches >= 8) {
    contributors.push({
      label: "High tab switching",
      detail: `${Math.round(tabSwitchesPerHour)} switches per hour`,
      points: 2,
    });
  }

  if (activeMinutes >= 240) {
    contributors.push({
      label: "Long browsing session",
      detail: `${formatDuration(metrics.totalActiveMs)} active browsing`,
      points: 2,
    });
  }

  if (activeMinutes >= 45 && idleRatio < 0.08) {
    contributors.push({
      label: "Limited idle time",
      detail: `${Math.round(idleRatio * 100)}% of tracked time was idle`,
      points: 1,
    });
  }

  if (fragmentedVisits >= 10) {
    contributors.push({
      label: "Fragmented browsing",
      detail: `${fragmentedVisits} short website visits under 2 minutes`,
      points: 1,
    });
  }

  if (metrics.openTabCount >= 12) {
    contributors.push({
      label: "Many open tabs",
      detail: `${metrics.openTabCount} tabs currently open`,
      points: 1,
    });
  }

  if (
    dailyFocus === "academic" &&
    activeMinutes >= 20 &&
    distractionRatio >= 0.35
  ) {
    contributors.push({
      label: "Focus mismatch",
      detail: `${Math.round(distractionRatio * 100)}% social or entertainment browsing`,
      points: 2,
    });
  }

  const points = contributors.reduce((total, contributor) => {
    return total + contributor.points;
  }, 0);
  const level = getLevel(points);

  return {
    points,
    maxPoints: 11,
    level,
    summary: getSummary(level),
    contributors,
    lateNightMs,
    tabSwitchesPerHour,
    idleRatio,
  };
}
