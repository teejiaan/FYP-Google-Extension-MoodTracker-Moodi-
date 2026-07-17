import React, { useEffect, useState } from "react";
import { User } from "firebase/auth";
import { onAuth } from "../shared/auth";
import SignIn from "./components/SignIn";
import ConsentNotice from "./components/ConsentNotice";
import MiniScore from "./components/MiniScore";
import MoodCheckIn from "./components/MoodCheckIn";
import Settings from "./components/Settings";
import History from "./components/History";
import { DailyFocus } from "../shared/types";
import { CONSENT_ACCEPTED_KEY } from "../shared/settings";

type View = "score" | "history" | "mood" | "settings";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getFocusStorageKey(uid: string) {
  return `moodiDailyFocus:${uid}:${getTodayKey()}`;
}

const CURRENT_FOCUS_KEY = "moodiCurrentDailyFocus";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [consentAccepted, setConsentAccepted] = useState<boolean | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [dailyFocus, setDailyFocus] = useState<DailyFocus | null>(null);
  const [view, setView] = useState<View>("score");

  useEffect(() => {
    let cancelled = false;

    chrome.storage.local.get(CONSENT_ACCEPTED_KEY).then((stored) => {
      if (cancelled) return;
      setConsentAccepted(stored[CONSENT_ACCEPTED_KEY] === true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = onAuth((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) {
      setDailyFocus(null);
      return;
    }

    let cancelled = false;
    setFocusLoading(true);

    chrome.storage.local.get(getFocusStorageKey(user.uid)).then((stored) => {
      if (cancelled) return;

      const focus = stored[getFocusStorageKey(user.uid)];
      if (focus === "casual" || focus === "academic") {
        setDailyFocus(focus);
        chrome.storage.local.set({
          [CURRENT_FOCUS_KEY]: {
            date: getTodayKey(),
            focus,
          },
        });
      } else {
        setDailyFocus(null);
      }
      setFocusLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleFocusSelect(focus: DailyFocus) {
    if (!user) return;

    await chrome.storage.local.set({
      [getFocusStorageKey(user.uid)]: focus,
      [CURRENT_FOCUS_KEY]: {
        date: getTodayKey(),
        focus,
      },
    });
    chrome.runtime.sendMessage({ type: "DAILY_FOCUS_UPDATED", focus });
    setDailyFocus(focus);
  }

  async function handleConsentAccept() {
    await chrome.storage.local.set({ [CONSENT_ACCEPTED_KEY]: true });
    setConsentAccepted(true);
  }

  async function showConsentNotice() {
    await chrome.storage.local.set({ [CONSENT_ACCEPTED_KEY]: false });
    setConsentAccepted(false);
  }

  if (loading || consentAccepted === null) {
    return (
      <div className="popup-loading">
        <span className="pulse-dot" />
      </div>
    );
  }

  if (!consentAccepted) return <ConsentNotice onAccept={handleConsentAccept} />;

  if (!user) return <SignIn />;

  if (focusLoading) {
    return (
      <div className="popup-loading">
        <span className="pulse-dot" />
      </div>
    );
  }

  return (
    <div className="popup-root">
      <header className="popup-header">
        <div className="brand-lockup">
          <img src="/icons/moodi-logo.png" className="brand-logo" alt="" />
          <span className="logo">Moodi</span>
        </div>
        <img src={user.photoURL ?? ""} className="avatar" alt={user.displayName ?? ""} />
      </header>

      <nav className="popup-nav">
        <button
          className={view === "score" ? "active" : ""}
          onClick={() => setView("score")}
        >
          Today
        </button>
        <button
          className={view === "mood" ? "active" : ""}
          onClick={() => setView("mood")}
        >
          Check in
        </button>
        <button
          className={view === "history" ? "active" : ""}
          onClick={() => setView("history")}
        >
          History
        </button>
        <button
          className={view === "settings" ? "active" : ""}
          onClick={() => setView("settings")}
        >
          Settings
        </button>
      </nav>

      <main className="popup-main">
        {!dailyFocus ? (
          <section className="focus-prompt">
            <span className="metric-label">Today's focus</span>
            <h1>What kind of browsing are you doing?</h1>
            <p>
              Moodi will tune today's recommendations based on your intent.
            </p>

            <div className="focus-options">
              <button type="button" onClick={() => handleFocusSelect("academic")}>
                <strong>Academic or work</strong>
                <span>Research, writing, coding, study, planning</span>
              </button>
              <button type="button" onClick={() => handleFocusSelect("casual")}>
                <strong>Casual browsing</strong>
                <span>Leisure, social, entertainment, light reading</span>
              </button>
            </div>
          </section>
        ) : view === "score" ? (
          <MiniScore uid={user.uid} dailyFocus={dailyFocus} onChangeFocus={() => setDailyFocus(null)} />
        ) : view === "history" ? (
          <History uid={user.uid} dailyFocus={dailyFocus} />
        ) : view === "mood" ? (
          <MoodCheckIn uid={user.uid} />
        ) : (
          <Settings onShowConsent={showConsentNotice} />
        )}
      </main>
    </div>
  );
}
