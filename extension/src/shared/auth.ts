import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { auth } from "./firebase";
import { ExtensionMessage } from "./types";

/**
 * Signs the user in via Google OAuth using Chrome's identity API.
 * Must be called from the popup (requires user gesture).
 * After sign-in, sends the ID token to the service worker.
 */
export async function signInWithGoogle(): Promise<User> {
  await clearChromeIdentityCache();
  const token = await getChromeAuthToken();
  const credential = GoogleAuthProvider.credential(null, token);
  const result = await signInWithCredential(auth, credential);

  // Notify service worker so it can attach the token to Firestore writes
  const message: ExtensionMessage = { type: "AUTH_TOKEN_READY", token };
  chrome.runtime.sendMessage(message);

  return result.user;
}

/**
 * Retrieves a Google OAuth access token through Chrome's supported extension flow.
 */
function getChromeAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      const err = chrome.runtime.lastError;

      if (err) {
        reject(err);
        return;
      }

      if (!token || typeof token !== "string") {
        reject(new Error("Invalid Chrome auth token"));
        return;
      }

      resolve(token);
    });
  });
}

export async function signOutUser(): Promise<void> {
  chrome.runtime.sendMessage({ type: "SIGN_OUT_BACKGROUND_AUTH" } satisfies ExtensionMessage);
  await signOut(auth);
  await clearChromeIdentityCache();
}

function clearChromeIdentityCache(): Promise<void> {
  return new Promise((resolve) => {
    if (chrome.identity.clearAllCachedAuthTokens) {
      chrome.identity.clearAllCachedAuthTokens(() => resolve());
      return;
    }

    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token && typeof token === "string") {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
        return;
      }

      resolve();
    });
  });
}

/**
 * Subscribe to auth state changes — use in popup to reactively show/hide UI.
 */
export function onAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}
