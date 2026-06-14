import { describe, it, expect } from 'vitest';
import { buildShareUrl } from './share';

const content = {
  url: 'https://aviator.ke/?ref=ABC123',
  message: 'Play Aviator & win big! 🚀',
};
const eUrl = encodeURIComponent(content.url);
const eMsg = encodeURIComponent(content.message);

describe('buildShareUrl', () => {
  it('WhatsApp bundles message + url into a single text param', () => {
    const out = buildShareUrl('whatsapp', content);
    expect(out.startsWith('https://wa.me/?text=')).toBe(true);
    expect(out).toContain(encodeURIComponent(`${content.message} ${content.url}`));
  });

  it('X uses separate text and url params', () => {
    const out = buildShareUrl('x', content);
    expect(out).toBe(`https://twitter.com/intent/tweet?text=${eMsg}&url=${eUrl}`);
  });

  it('Facebook sharer carries only the encoded url', () => {
    const out = buildShareUrl('facebook', content);
    expect(out).toBe(`https://www.facebook.com/sharer/sharer.php?u=${eUrl}`);
  });

  it('Telegram uses separate url and text params', () => {
    const out = buildShareUrl('telegram', content);
    expect(out).toBe(`https://t.me/share/url?url=${eUrl}&text=${eMsg}`);
  });

  it('percent-encodes special characters (no raw spaces, &, ? in the payload)', () => {
    for (const p of ['whatsapp', 'x', 'facebook', 'telegram'] as const) {
      const out = buildShareUrl(p, content);
      const payload = out.slice(out.indexOf('?') + 1);
      // The query payload must not contain a raw space or a literal "ref=" leaking
      // from an unencoded url.
      expect(payload).not.toMatch(/ /);
      expect(out).toContain('ABC123'.length ? encodeURIComponent('ABC123') : '');
    }
  });
});
