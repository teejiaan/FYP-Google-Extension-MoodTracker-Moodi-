export const TRACKING_ENABLED_KEY = "moodiTrackingEnabled";
export const OVERLAY_ENABLED_KEY = "moodiOverlayEnabled";

export interface MoodiSettings {
  trackingEnabled: boolean;
  overlayEnabled: boolean;
}

export async function getMoodiSettings(): Promise<MoodiSettings> {
  const stored = await chrome.storage.local.get([
    TRACKING_ENABLED_KEY,
    OVERLAY_ENABLED_KEY,
  ]);

  return {
    trackingEnabled: stored[TRACKING_ENABLED_KEY] !== false,
    overlayEnabled: stored[OVERLAY_ENABLED_KEY] !== false,
  };
}
