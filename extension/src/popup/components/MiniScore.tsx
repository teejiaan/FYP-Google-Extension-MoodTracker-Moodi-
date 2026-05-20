import React, { useEffect, useState } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../../shared/firebase";
import { Session } from "../../shared/types";

interface Props {
  uid: string;
}

const LABELS: Record<string, string> = {
  focused: "🎯 Focused",
  scattered: "🌀 Scattered",
  relaxed: "😌 Relaxed",
  stressed: "😰 Stressed",
  balanced: "⚖️ Balanced",
};

export default function MiniScore({ uid }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLatest() {
      const ref = collection(db, "users", uid, "sessions");
      const q = query(ref, orderBy("endedAt", "desc"), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        setSession({ id: snap.docs[0].id, ...snap.docs[0].data() } as Session);
      }
      setLoading(false);
    }
    fetchLatest();
  }, [uid]);

  if (loading) return <div className="score-loading">Loading…</div>;
  if (!session) return <div className="score-empty">No sessions yet — keep browsing!</div>;

  const score = session.mentalStateScore ?? 0;
  const diagnosis = session.diagnosis ?? "unknown";
  const color = score >= 70 ? "#4ade80" : score >= 40 ? "#facc15" : "#f87171";

  return (
    <div className="mini-score">
      {/* Circular score gauge */}
      <div className="score-ring" style={{ "--score-color": color } as React.CSSProperties}>
        <svg viewBox="0 0 80 80" width="80" height="80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="#1e293b" strokeWidth="6" />
          <circle
            cx="40" cy="40" r="34"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={`${(score / 100) * 213.6} 213.6`}
            strokeLinecap="round"
            transform="rotate(-90 40 40)"
          />
        </svg>
        <span className="score-number">{score}</span>
      </div>

      <p className="score-label">{LABELS[diagnosis] ?? diagnosis}</p>

      {/* Category breakdown bar */}
      <div className="category-bar">
        {Object.entries(session.metrics.categoryBreakdown).map(([cat, ms]) => {
          const pct = (ms / session.metrics.totalActiveMs) * 100;
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

      <a
        className="dashboard-link"
        href="https://YOUR_DASHBOARD_URL"
        target="_blank"
        rel="noreferrer"
      >
        Full dashboard →
      </a>
    </div>
  );
}