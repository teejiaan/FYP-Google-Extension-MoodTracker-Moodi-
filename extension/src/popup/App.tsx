import React, { useEffect, useState } from "react";
import { User } from "firebase/auth";
import { onAuth } from "../shared/auth";
import SignIn from "./components/SignIn";
import MiniScore from "./components/MiniScore";
import MoodCheckIn from "./components/MoodCheckIn";

type View = "score" | "mood";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("score");

  useEffect(() => {
    const unsub = onAuth((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <div className="popup-loading">
        <span className="pulse-dot" />
      </div>
    );
  }

  if (!user) return <SignIn />;

  return (
    <div className="popup-root">
      <header className="popup-header">
        <span className="logo">𝗠𝗶𝗻𝗱𝗘𝘅𝘁</span>
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
      </nav>

      <main className="popup-main">
        {view === "score" ? <MiniScore uid={user.uid} /> : <MoodCheckIn uid={user.uid} />}
      </main>
    </div>
  );
}