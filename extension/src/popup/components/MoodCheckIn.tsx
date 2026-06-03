import React, { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../shared/firebase";

interface Props {
  uid: string;
}

const MOODS = [
  { marker: "5", label: "Great", value: 5 },
  { marker: "4", label: "Good", value: 4 },
  { marker: "3", label: "Okay", value: 3 },
  { marker: "2", label: "Low", value: 2 },
  { marker: "1", label: "Stressed", value: 1 },
];

export default function MoodCheckIn({ uid }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (selected === null || saving) return;

    setSaving(true);
    setError(null);

    try {
      await addDoc(collection(db, "users", uid, "moodEntries"), {
        score: selected,
        note: note.trim(),
        recordedAt: serverTimestamp(),
      });

      setSaved(true);
      setNote("");
      setSelected(null);
    } catch (e: any) {
      setError(e.message ?? "Could not save your check-in. Please try again.");
    } finally {
      setSaving(false);
    }
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
            type="button"
          >
            <span className="mood-marker">{m.marker}</span>
            <span className="mood-label">{m.label}</span>
          </button>
        ))}
      </div>

      <textarea
        className="mood-note"
        placeholder="Optional note... (what are you working on?)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />

      {error && <p className="error-text">{error}</p>}

      <button
        className="btn-submit"
        onClick={handleSubmit}
        disabled={selected === null || saving}
        type="button"
      >
        {saving ? "Saving..." : "Log mood"}
      </button>

      {saved && (
        <div className="success-overlay" role="status" aria-live="polite">
          <div className="success-dialog">
            <span className="success-icon">✓</span>
            <h2>Check-in saved</h2>
            <p>Your mood entry was written to Firestore.</p>
            <button
              className="btn-submit"
              onClick={() => setSaved(false)}
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
