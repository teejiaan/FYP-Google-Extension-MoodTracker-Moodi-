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
  const token = await getChromeAuthToken();
  const credential = GoogleAuthProvider.credential(null, token);
  const result = await signInWithCredential(auth, credential);

  // Notify service worker so it can attach the token to Firestore writes
  const message: ExtensionMessage = { type: "AUTH_TOKEN_READY", token };
  chrome.runtime.sendMessage(message);

  return result.user;
}

/**
 * Retrieves a Google OAuth access token via chrome.identity.
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
  // Revoke the Chrome identity token so re-login prompts fresh consent
  const token = await getChromeAuthToken().catch(() => null);
  if (token) {
    await new Promise<void>((res) =>
      chrome.identity.removeCachedAuthToken({ token }, res)
    );
  }
  await signOut(auth);
}

/**
 * Subscribe to auth state changes — use in popup to reactively show/hide UI.
 */
export function onAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}