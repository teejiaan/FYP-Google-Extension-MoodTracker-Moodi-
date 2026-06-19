import React, { useEffect, useMemo, useState } from "react";
import { ExtensionMessage, SessionMetrics, SiteVisit } from "../../shared/types";

interface Props {
  uid: string;
}

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

export default function MiniScore({ uid: _uid }: Props) {
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
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

  return (
    <div className="today-panel">
      <section className="tracking-summary">
        <div className="metric-card metric-card-primary">
          <span className="metric-label">Screen time</span>
          <strong>{formatDuration(metrics.totalActiveMs)}</strong>
        </div>

        <div className="metric-grid">
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
        </div>
      </section>

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
