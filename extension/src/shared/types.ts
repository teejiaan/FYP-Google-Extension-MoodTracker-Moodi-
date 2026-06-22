// ─── Domain Types ────────────────────────────────────────────────────────────

export type SiteCategory =
  | "productive"   // github, notion, docs, stackoverflow
  | "social"       // twitter, instagram, facebook, tiktok
  | "entertainment"// youtube, netflix, twitch, reddit
  | "news"         // bbc, cnn, nytimes
  | "shopping"     // amazon, shopee, lazada
  | "reference"    // wikipedia, mdn, medium
  | "other";

export interface SiteVisit {
  url: string;
  hostname: string;
  category: SiteCategory;
  dwellMs: number;       // time spent on this tab (ms)
  startedAt: number;     // epoch ms
}

export interface SessionMetrics {
  tabSwitches: number;
  totalActiveMs: number;
  idleMs: number;
  sites: SiteVisit[];
  categoryBreakdown: Record<SiteCategory, number>; // ms per category
}

export interface Session {
  id: string;
  uid: string;
  startedAt: number;     // epoch ms
  endedAt: number;
  metrics: SessionMetrics;
  mentalStateScore?: number;  // 0-100, calculated when the session is saved
  diagnosis?: string;         // short text label e.g. "Focused", "Scattered"
}

export interface DailySummary {
  date: string;          // YYYY-MM-DD
  uid: string;
  avgMentalStateScore: number;
  totalScreentimeMs: number;
  dominantCategory: SiteCategory;
  sessionCount: number;
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
  | { type: "GET_SESSION_METRICS" }
  | { type: "SESSION_METRICS_RESPONSE"; metrics: SessionMetrics }
  | { type: "PAGE_SIGNAL"; signal: PageSignal };

export interface PageSignal {
  url: string;
  scrollDepth: number;    // 0–1
  isIdle: boolean;
  isFocused: boolean;
  timestamp: number;
}
