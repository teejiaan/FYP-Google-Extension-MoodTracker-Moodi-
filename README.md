# Moodi Mental State Monitor

Moodi is a Chrome extension and Firebase web dashboard for passive browsing self-awareness. It tracks browser behaviour such as active screen time, tab switching, idle time, late-night use, website categories, and browsing sessions. It uses rule-based scoring to show reflective feedback, not medical diagnosis.


MINOR NOTE:

I have to add the 2.0 OAuth ID of the extension manually as I have not publish the extension yet. Thus, the authentication might come out a bit wonky. Have to key in the extension ID to my google console account.

## Project Structure

```text
FYP-Google-Extension-MoodTracker-Moodi-/
  extension/             Chrome extension source code
  extension/chrome-extension/
                         Built folder loaded into Chrome
  extension/chrome-extension.zip
                         Packaged extension upload file
  dashboard/             Web dashboard source code
  dashboard/dist/        Built Firebase Hosting files
  firestore.rules        Firestore security rules
  firestore.indexes.json Firestore indexes
  firebase.json          Firebase Hosting config
```

## Requirements

- Node.js and npm
- Google Chrome
- Firebase CLI
- Firebase project with Authentication, Firestore, and Hosting enabled
- Google OAuth 2.0 Client ID for a Chrome Extension

## 1. Install Dependencies

From the project root:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-
```

Install extension dependencies:

```powershell
cd extension
npm.cmd install
```

Install dashboard dependencies:

```powershell
cd ..\dashboard
npm.cmd install
```

## 2. Firebase Setup

In Firebase Console:

1. Create or open the Firebase project.
2. Enable **Authentication**.
3. Enable **Google** sign-in provider.
4. Enable **Cloud Firestore**.
5. Enable **Firebase Hosting**.

Then login locally:

```powershell
firebase login
firebase use moodi-aea62
```

Deploy Firestore rules when needed:

```powershell
firebase deploy --only firestore:rules
```

## 3. Chrome Extension OAuth Setup

In Google Cloud Console:

1. Go to **APIs & Services > Credentials**.
2. Create an OAuth client.
3. Select **Chrome Extension** as the application type.
4. Enter your extension ID.
5. Copy the generated client ID.

Put that client ID in:

```text
extension/public/manifest.json
```

Inside:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": ["openid", "email", "profile"]
}
```

Important: Chrome extension authentication uses the Google account attached to the current Chrome profile. If you need to test a different Google account, use a different Chrome profile.

## 4. Build The Extension

From the extension folder:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-\extension
npm.cmd run typecheck
npm.cmd run build
```

The build command does two things:

1. Builds the extension into `extension/dist`.
2. Syncs the built files into `extension/chrome-extension`.

The folder you load into Chrome is:

```text
extension/chrome-extension
```

## 5. Load The Extension In Chrome

1. Open Chrome.
2. Go to:

```text
chrome://extensions
```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select:

```text
C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-\extension\chrome-extension
```

6. Pin Moodi from the extensions menu.
7. Open Moodi and sign in with Google.

After every code change, run:

```powershell
npm.cmd run build
```

Then click **Reload** on Moodi in `chrome://extensions`.

## 6. Run The Dashboard Locally

From the dashboard folder:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-\dashboard
npm.cmd run dev
```

Open the local URL shown in the terminal, usually:

```text
http://localhost:5173
```

If Firebase Auth gives `auth/unauthorized-domain`, add the exact localhost domain in Firebase Console:

```text
Authentication > Settings > Authorized domains
```

For local development, add:

```text
localhost
```

## 7. Build And Deploy The Dashboard

Build:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-\dashboard
npm.cmd run typecheck
npm.cmd run build
```

Deploy from the project root:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-
firebase deploy --only hosting
```

Current dashboard URL:

```text
https://moodi-aea62.web.app
```

## 8. Package The Extension

After building the extension, refresh the ZIP file:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-\extension
Compress-Archive -Path .\chrome-extension\* -DestinationPath .\chrome-extension.zip -Force
```

Upload this file to the Chrome Web Store Developer Dashboard:

```text
extension/chrome-extension.zip
```

## 9. Test Checklist

Before submitting or sending to testers:

- Moodi loads without manifest errors.
- The popup opens.
- Consent notice appears on first use.
- Google sign-in works.
- Today page shows screen time, tab switches, open tabs, idle time, and recent websites.
- Website durations do not reset to `0s` after returning to Chrome.
- Away from Chrome does not increase while actively browsing.
- Mood check-in writes successfully.
- History page loads previous sessions.
- Settings page can pause tracking and disable overlays.
- Web dashboard opens from Settings.
- Export JSON and Export CSV work.
- Delete history requires confirmation.

## 10. Common Problems

### Failed to load manifest

Make sure Chrome loads:

```text
extension/chrome-extension
```

Do not load:

```text
extension/src
extension/dist
```

### OAuth bad client ID

Check:

- `extension/public/manifest.json` has the latest OAuth client ID.
- The Google Cloud OAuth client type is **Chrome Extension**.
- The OAuth client item ID matches the installed extension ID.
- You rebuilt the extension after changing the manifest.

Then run:

```powershell
npm.cmd run build
```

Reload the extension in `chrome://extensions`.

### Sign out logs into the same Google account again

This is expected with Chrome's identity API. The extension uses the Google account attached to the active Chrome profile. To use a different Google account, switch to a different Chrome profile and load Moodi there.

### Firestore missing permissions

Check:

- User is signed in.
- Firestore rules are deployed.
- The user document exists under `users/{uid}`.
- Developer dashboard collection-group reads are allowed by rules if using developer analytics.

Deploy rules:

```powershell
firebase deploy --only firestore:rules
```

### Dashboard login loops back to login

Check:

- Firebase Authentication Google provider is enabled.
- Dashboard domain is authorized in Firebase Authentication settings.
- The OAuth client used by Firebase has not been deleted.
- Redeploy the dashboard after auth code changes.

### Extension disappears from Chrome

For local testing, keep loading the stable built folder:

```text
extension/chrome-extension
```

Do not load a temporary folder or a build output that gets deleted.

## 11. Useful Commands

Extension:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-\extension
npm.cmd run typecheck
npm.cmd run build
```

Dashboard:

```powershell
cd C:\Users\daren\Desktop\School\FYP\FYP-Google-Extension-MoodTracker-Moodi-\dashboard
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Firebase:

```powershell
firebase login
firebase use moodi-aea62
firebase deploy --only hosting
firebase deploy --only firestore:rules
```

