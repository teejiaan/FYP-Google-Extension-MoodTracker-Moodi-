import React, { useState } from "react";
import { signInWithGoogle } from "../../shared/auth";

export default function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError(e.message ?? "Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="signin-container">
      <div className="signin-logo">𝗠𝗶𝗻𝗱𝗘𝘅𝘁</div>
      <p className="signin-tagline">Understand your mind through your browsing.</p>

      <button className="btn-google" onClick={handleSignIn} disabled={loading}>
        {loading ? "Connecting…" : "Sign in with Google"}
      </button>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}