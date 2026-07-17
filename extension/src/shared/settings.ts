export const TRACKING_ENABLED_KEY = "moodiTrackingEnabled";
export const OVERLAY_ENABLED_KEY = "moodiOverlayEnabled";
export const CONSENT_ACCEPTED_KEY = "moodiConsentAccepted";

export interface MoodiSettings {
  trackingEnabled: boolean;
  overlayEnabled: boolean;
  consentAccepted: boolean;
}

export async function getMoodiSettings(): Promise<MoodiSettings> {
  const stored = await chrome.storage.local.get([
    CONSENT_ACCEPTED_KEY,
    TRACKING_ENABLED_KEY,
    OVERLAY_ENABLED_KEY,
  ]);
  const consentAccepted = stored[CONSENT_ACCEPTED_KEY] === true;

  return {
    consentAccepted,
    trackingEnabled: consentAccepted && stored[TRACKING_ENABLED_KEY] !== false,
    overlayEnabled: consentAccepted && stored[OVERLAY_ENABLED_KEY] !== false,
  };
}
