import React, { useEffect, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../shared/firebase";
import { signOutUser } from "../../shared/auth";
import { ExtensionMessage } from "../../shared/types";
import {
  OVERLAY_ENABLED_KEY,
  TRACKING_ENABLED_KEY,
  getMoodiSettings,
} from "../../shared/settings";

const FEEDBACK_TYPES = ["Accuracy", "UI", "Suggestion", "Bug"] as const;
const DASHBOARD_URL = "https://moodi-aea62.web.app";
const STAR_OPTIONS = [1, 2, 3, 4, 5];
type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export default function Settings() {
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("Accuracy");
  const [feedbackRating, setFeedbackRating] = useState(4);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getMoodiSettings().then((settings) => {
      if (cancelled) return;
      setTrackingEnabled(settings.trackingEnabled);
      setOverlayEnabled(settings.overlayEnabled);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function updateTracking(nextValue: boolean) {
    setTrackingEnabled(nextValue);
    await chrome.storage.local.set({ [TRACKING_ENABLED_KEY]: nextValue });
    setStatus(nextValue ? "Tracking resumed." : "Tracking paused.");
  }

  async function updateOverlay(nextValue: boolean) {
    setOverlayEnabled(nextValue);
    await chrome.storage.local.set({ [OVERLAY_ENABLED_KEY]: nextValue });
    setStatus(nextValue ? "Browser overlay enabled." : "Browser overlay disabled.");
  }

  function resetCurrentSession() {
    const message: ExtensionMessage = { type: "RESET_SESSION_TRACKING" };

    chrome.runtime.sendMessage(message, (response?: ExtensionMessage) => {
      if (chrome.runtime.lastError) {
        setStatus("Could not reset the current session.");
        return;
      }

      if (response?.type === "SESSION_RESET_COMPLETE") {
        setStatus("Current tracking session reset.");
      }
    });
  }

  function openDashboard() {
    chrome.tabs.create({ url: DASHBOARD_URL });
  }

  async function handleSignOut() {
    setSigningOut(true);
    setStatus("Signing out...");

    try {
      await new Promise<void>((resolve) => {
        const message: ExtensionMessage = { type: "RESET_SESSION_TRACKING" };
        chrome.runtime.sendMessage(message, () => resolve());
      });
      await signOutUser();
      setStatus("Signed out.");
    } catch (error) {
      console.warn("[Moodi] Could not sign out", error);
      setStatus("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  async function submitFeedback() {
    const user = auth.currentUser;
    const message = feedbackMessage.trim();

    if (!user) {
      setStatus("Please sign in before submitting feedback.");
      return;
    }

    if (!message) {
      setStatus("Write a short note before submitting feedback.");
      return;
    }

    setFeedbackSubmitting(true);

    try {
      await addDoc(collection(db, "feedback"), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        type: feedbackType,
        rating: feedbackRating,
        message,
        appVersion: chrome.runtime.getManifest().version,
        source: "extension-settings",
        createdAt: serverTimestamp(),
      });
      setFeedbackMessage("");
      setFeedbackRating(4);
      setFeedbackType("Accuracy");
      setStatus("Feedback submitted. Thank you for helping improve Moodi.");
    } catch (error) {
      console.warn("[Moodi] Could not submit feedback", error);
      setStatus("Could not submit feedback. Check Firestore permissions.");
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  return (
    <section className="settings-panel">
      <div className="settings-intro">
        <span className="metric-label">User control</span>
        <h1>Settings</h1>
        <p>Control what Moodi monitors and how feedback appears.</p>
      </div>

      <div className="settings-list">
        <label className="settings-row">
          <div>
            <strong>Passive tracking</strong>
            <span>Record tab activity, idle time, and website duration.</span>
          </div>
          <input
            type="checkbox"
            checked={trackingEnabled}
            onChange={(event) => updateTracking(event.currentTarget.checked)}
          />
        </label>

        <label className="settings-row">
          <div>
            <strong>Browser overlay</strong>
            <span>Show gentle recommendations directly on webpages.</span>
          </div>
          <input
            type="checkbox"
            checked={overlayEnabled}
            onChange={(event) => updateOverlay(event.currentTarget.checked)}
          />
        </label>
      </div>

      <button type="button" className="settings-action" onClick={openDashboard}>
        Open web dashboard
      </button>

      <button type="button" className="settings-action" onClick={resetCurrentSession}>
        Reset current session
      </button>

      <button
        type="button"
        className="settings-action settings-action-danger"
        disabled={signingOut}
        onClick={handleSignOut}
      >
        {signingOut ? "Signing out..." : "Sign out"}
      </button>

      <section className="feedback-card">
        <div>
          <span className="metric-label">System feedback</span>
          <h2>Help improve Moodi</h2>
          <p>Share whether the tracking, UI, or recommendations feel accurate.</p>
        </div>

        <div className="feedback-type-grid">
          {FEEDBACK_TYPES.map((type) => (
            <button
              type="button"
              key={type}
              className={feedbackType === type ? "selected" : ""}
              onClick={() => setFeedbackType(type)}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="feedback-rating" aria-label="Feedback rating">
          <span>Rating</span>
          <strong>{feedbackRating}/5</strong>
          <div className="star-rating" role="radiogroup" aria-label="Rating out of 5">
            {STAR_OPTIONS.map((rating) => (
              <button
                type="button"
                key={rating}
                className={rating <= feedbackRating ? "selected" : ""}
                role="radio"
                aria-checked={feedbackRating === rating}
                aria-label={`${rating} star${rating === 1 ? "" : "s"}`}
                onClick={() => setFeedbackRating(rating)}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <textarea
          className="feedback-note"
          value={feedbackMessage}
          onChange={(event) => setFeedbackMessage(event.currentTarget.value)}
          placeholder="What should be improved?"
        />

        <button
          type="button"
          className="settings-action"
          disabled={feedbackSubmitting}
          onClick={submitFeedback}
        >
          {feedbackSubmitting ? "Submitting..." : "Submit feedback"}
        </button>
      </section>

      {status && <p className="settings-status">{status}</p>}
    </section>
  );
}
