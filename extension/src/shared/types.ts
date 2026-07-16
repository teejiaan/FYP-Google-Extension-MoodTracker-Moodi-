// ─── Domain Types ────────────────────────────────────────────────────────────

export type SiteCategory =
  | "productive"   // github, notion, docs, stackoverflow
  | "social"       // twitter, instagram, facebook, tiktok
  | "entertainment"// youtube, netflix, twitch, reddit
  | "news"         // bbc, cnn, nytimes
  | "shopping"     // amazon, shopee, lazada
  | "reference"    // wikipedia, mdn, medium
  | "other";

export type DailyFocus = "casual" | "academic";

export interface SiteVisit {
  url: string;
  hostname: string;
  category: SiteCategory;
  dwellMs: number;       // time spent on this tab (ms)
  startedAt: number;     // epoch ms
}

export interface SessionMetrics {
  sessionStartedAt: number;
  tabSwitches: number;
  openTabCount: number;
  totalActiveMs: number;
  idleMs: number;
  unfocusedMs: number;
  sites: SiteVisit[];
  categoryBreakdown: Record<SiteCategory, number>; // ms per category
}

export interface Session {
  id: string;
  uid: string;
  startedAt: number;     // epoch ms
  endedAt: number;
  metrics: SessionMetrics;
  mentalStateScore?: number;  // 0–100, written by Cloud Function
  diagnosis?: string;         // short text label e.g. "Focused", "Scattered"
}

export interface DailySummary {
  date: string;          // YYYY-MM-DD
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

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: number;
}

// ─── Chrome Messaging Types ───────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "AUTH_TOKEN_READY"; token: string }
  | { type: "DAILY_FOCUS_UPDATED"; focus: DailyFocus }
  | { type: "GET_SESSION_METRICS" }
  | { type: "SESSION_METRICS_RESPONSE"; metrics: SessionMetrics }
  | { type: "RESET_SESSION_TRACKING" }
  | { type: "SESSION_RESET_COMPLETE" }
  | { type: "PAGE_SIGNAL"; signal: PageSignal }
  | {
      type: "SHOW_RECOMMENDATION_OVERLAY";
      title: string;
      message: string;
    }
  | {
      type: "SHOW_IDLE_OVERLAY";
      idleMinutes: number;
    };

export interface PageSignal {
  url: string;
  scrollDepth: number;    // 0–1
  isIdle: boolean;
  continuousIdleMs: number;
  isFocused: boolean;
  timestamp: number;
}
