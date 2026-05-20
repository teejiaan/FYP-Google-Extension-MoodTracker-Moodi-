import React, { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../shared/firebase";

interface Props {
  uid: string;
}

const MOODS = [
  { emoji: "😄", label: "Great", value: 5 },
  { emoji: "🙂", label: "Good", value: 4 },
  { emoji: "😐", label: "Okay", value: 3 },
  { emoji: "😔", label: "Low", value: 2 },
  { emoji: "😰", label: "Stressed", value: 1 },
];

export default function MoodCheckIn({ uid }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSubmit() {
    if (selected === null) return;

    await addDoc(collection(db, "users", uid, "moodEntries"), {
      score: selected,
      note: note.trim(),
      recordedAt: serverTimestamp(),
    });

    setSaved(true);
  }

  if (saved) {
    return (
      <div className="mood-saved">
        <span>✓</span>
        <p>Logged! Check your dashboard for insights.</p>
      </div>
    );
  }

  return (
    <div className="mood-checkin">
      <p className="mood-question">How are you feeling right now?</p>

      <div className="mood-options">
        {MOODS.map((m) => (
          <button
            key={m.value}
            className={`mood-btn ${selected === m.value ? "selected" : ""}`}
            onClick={() => setSelected(m.value)}
            title={m.label}
          >
            <span className="mood-emoji">{m.emoji}</span>
            <span className="mood-label">{m.label}</span>
          </button>
        ))}
      </div>

      <textarea
        className="mood-note"
        placeholder="Optional note… (what are you working on?)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />

      <button
        className="btn-submit"
        onClick={handleSubmit}
        disabled={selected === null}
      >
        Log mood
      </button>
    </div>
  );
}