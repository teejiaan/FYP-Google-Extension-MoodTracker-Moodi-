export type SiteCategory =
  | "productive"
  | "social"
  | "entertainment"
  | "news"
  | "shopping"
  | "reference"
  | "other";

export type DailyFocus = "casual" | "academic";
export type UserRole = "user" | "developer";

export interface SiteVisit {
  url: string;
  hostname: string;
  category: SiteCategory;
  dwellMs: number;
  startedAt: number;
}

export interface SessionMetrics {
  sessionStartedAt: number;
  tabSwitches: number;
  openTabCount: number;
  totalActiveMs: number;
  idleMs: number;
  unfocusedMs?: number;
  sites: SiteVisit[];
  categoryBreakdown: Partial<Record<SiteCategory, number>>;
}

export interface Session {
  id: string;
  uid: string;
  startedAt: number;
  endedAt: number;
  metrics: SessionMetrics;
  status?: string;
}

export interface DailySummary {
  id: string;
  date: string;
  uid: string;
  totalScreentimeMs: number;
  totalIdleMs: number;
  totalUnfocusedMs: number;
  tabSwitches: number;
  sessionCount: number;
  completedSessionCount: number;
  dominantCategory: SiteCategory | "none";
  categoryBreakdown: Partial<Record<SiteCategory, number>>;
}

export interface MoodEntry {
  id: string;
  score: number;
  note?: string;
  recordedAt?: {
    seconds: number;
    nanoseconds: number;
  } | null;
}

export interface FeedbackEntry {
  id: string;
  uid: string;
  email?: string;
  displayName?: string;
  type: "Accuracy" | "UI" | "Suggestion" | "Bug";
  rating: number;
  message: string;
  appVersion?: string;
  source?: string;
  createdAt?: {
    seconds: number;
    nanoseconds: number;
  } | null;
}
