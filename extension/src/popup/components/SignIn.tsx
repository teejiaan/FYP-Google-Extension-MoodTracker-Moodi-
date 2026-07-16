import React, { useState } from "react";
import { signInWithGoogle } from "../../shared/auth";

const APP_VERSION = "v1.0.0";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

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
      <div className="signin-brand-panel">
        <img className="signin-logo-image" src="/icons/moodi-logo.png" alt="Moodi" />
      </div>

      <div className="signin-copy">
        <span className="metric-label">Mental State Monitor</span>
        <h1>Moodi</h1>
        <small>{APP_VERSION}</small>
      </div>

      <div className="signin-bubble">
        <p>Sign in with Google to connect your browsing wellness dashboard.</p>

        <button className="btn-google" onClick={handleSignIn} disabled={loading}>
          <GoogleMark />
          <span>{loading ? "Connecting..." : "Sign in with Google"}</span>
        </button>

        <span>Your data stays linked to your signed-in account.</span>
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
