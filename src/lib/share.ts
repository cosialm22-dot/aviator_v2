// ============================================================================
// Social-share URL builders for the marketer referral link. Pure functions so
// they are unit-testable and have no DOM/side-effect coupling. Each returns a
// canonical intent/share URL for the target platform with the message and link
// correctly percent-encoded.
// ============================================================================

export type SharePlatform = 'whatsapp' | 'x' | 'facebook' | 'telegram';

export interface ShareContent {
  /** The referral URL to share (e.g. https://host/?ref=ABC123). */
  url: string;
  /** Human message shown alongside the link (platform-dependent). */
  message: string;
}

/**
 * Build a share/intent URL for the given platform.
 * - WhatsApp: text carries message + URL (WhatsApp has no separate url field).
 * - X (Twitter): separate text and url params.
 * - Facebook: sharer takes only a url (message is ignored by FB).
 * - Telegram: separate url and text params.
 */
export function buildShareUrl(platform: SharePlatform, content: ShareContent): string {
  const url = content.url;
  const msg = content.message;
  const eUrl = encodeURIComponent(url);
  const eMsg = encodeURIComponent(msg);
  const eMsgWithUrl = encodeURIComponent(`${msg} ${url}`);

  switch (platform) {
    case 'whatsapp':
      return `https://wa.me/?text=${eMsgWithUrl}`;
    case 'x':
      return `https://twitter.com/intent/tweet?text=${eMsg}&url=${eUrl}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${eUrl}`;
    case 'telegram':
      return `https://t.me/share/url?url=${eUrl}&text=${eMsg}`;
  }
}
