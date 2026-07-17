import React, { useState } from "react";

interface ConsentNoticeProps {
  onAccept: () => Promise<void>;
}

export default function ConsentNotice({ onAccept }: ConsentNoticeProps) {
  const [accepting, setAccepting] = useState(false);

  async function handleAccept() {
    setAccepting(true);
    await onAccept();
    setAccepting(false);
  }

  return (
    <div className="consent-container">
      <div className="consent-header">
        <img src="/icons/moodi-logo.png" className="signin-logo-image" alt="" />
        <div>
          <span className="metric-label">Before using Moodi</span>
          <h1>Privacy notice</h1>
        </div>
      </div>

      <section className="consent-card">
        <p>
          Moodi passively monitors browser behaviour to create reflective wellness
          summaries and historical trends.
        </p>

        <div className="consent-list">
          <div className="consent-item">
            <strong>Collected</strong>
            <span>
              Tab switches, active time, idle time, website categories, session
              timing, and late-night usage.
            </span>
          </div>
          <div className="consent-item">
            <strong>Not collected</strong>
            <span>
              Page content, messages, form inputs, passwords, credentials, or
              private text typed into websites.
            </span>
          </div>
          <div className="consent-item">
            <strong>Purpose</strong>
            <span>
              Self-awareness feedback only. Moodi is not a medical diagnosis
              system or a replacement for professional support.
            </span>
          </div>
        </div>

        <p className="consent-agreement">
          By continuing, you agree that Moodi can collect these behavioural
          signals for your extension dashboard and analytics.
        </p>
      </section>

      <button
        type="button"
        className="settings-action consent-accept"
        disabled={accepting}
        onClick={handleAccept}
      >
        {accepting ? "Saving..." : "I understand and agree"}
      </button>
    </div>
  );
}
