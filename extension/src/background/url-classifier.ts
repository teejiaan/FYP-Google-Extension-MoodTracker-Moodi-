import { SiteCategory } from "../shared/types";

// ─── Category Maps ────────────────────────────────────────────────────────────
// Add or remove domains as needed. Matching is done on hostname (no www prefix).

const CATEGORY_MAP: Record<string, SiteCategory> = {
  // Productive
  "github.com": "productive",
  "gitlab.com": "productive",
  "notion.so": "productive",
  "linear.app": "productive",
  "figma.com": "productive",
  "docs.google.com": "productive",
  "stackoverflow.com": "productive",
  "jira.atlassian.com": "productive",

  // Social
  "twitter.com": "social",
  "x.com": "social",
  "instagram.com": "social",
  "facebook.com": "social",
  "tiktok.com": "social",
  "linkedin.com": "social",
  "discord.com": "social",

  // Entertainment
  "youtube.com": "entertainment",
  "netflix.com": "entertainment",
  "twitch.tv": "entertainment",
  "reddit.com": "entertainment",
  "spotify.com": "entertainment",

  // News
  "bbc.com": "news",
  "cnn.com": "news",
  "nytimes.com": "news",
  "theguardian.com": "news",
  "reuters.com": "news",

  // Shopping
  "amazon.com": "shopping",
  "shopee.com": "shopping",
  "lazada.com": "shopping",
  "ebay.com": "shopping",

  // Reference
  "wikipedia.org": "reference",
  "developer.mozilla.org": "reference",
  "medium.com": "reference",
  "dev.to": "reference",
};

/**
 * Extracts the root hostname from a URL string.
 * e.g. "https://www.github.com/foo" → "github.com"
 */
function getRootHostname(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Returns the category for a given URL.
 * Falls back to "other" if no match is found.
 */
export function classifyUrl(url: string): SiteCategory {
  const hostname = getRootHostname(url);
  if (!hostname) return "other";

  // Exact match first
  if (CATEGORY_MAP[hostname]) return CATEGORY_MAP[hostname];

  // Partial match (e.g. subdomain of a known domain)
  for (const [domain, category] of Object.entries(CATEGORY_MAP)) {
    if (hostname.endsWith(domain)) return category;
  }

  return "other";
}