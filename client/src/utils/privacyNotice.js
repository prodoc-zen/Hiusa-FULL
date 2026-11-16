// Keep in step with server/config/hiusa.php (privacy_notice_version): that is the version stored when someone agrees.
// Bumping it asks everyone who agreed to an older one to agree again.
export const PRIVACY_NOTICE_VERSION = '2026-11';

// The server refuses AI requests with this code until the signed-in person has agreed to the current notice.
export const PRIVACY_CONSENT_REQUIRED = 'privacy_consent_required';
export const PRIVACY_CONSENT_EVENT = 'hiusa-privacy-consent-required';
// Sent once the agreement is recorded, so a refusal still on screen from before it can go.
export const PRIVACY_CONSENT_RECORDED_EVENT = 'hiusa-privacy-consent-recorded';
