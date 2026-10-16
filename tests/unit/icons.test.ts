import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWebsiteIcon, publicIconHostname } from '../../apps/api/src/icons';

afterEach(() => vi.restoreAllMocks());
describe('fixed destination icon proxy', () => {
  it('does not send IPs, private names, credentials, unusual ports or invalid URLs to the provider', () => {
    for (const url of ['https://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'https://internal', 'https://host.local', 'https://host.home.arpa', 'https://name:pass@example.com', 'https://example.com:8443', 'javascript:alert(1)']) expect(publicIconHostname(url), url).toBeNull();
    expect(publicIconHostname('https://www.example.com/private?q=secret')).toBe('www.example.com');
  });
  it.each([
    () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1' } }),
    () => new Response('<svg onload="alert(1)"/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    () => new Response('<html>login</html>', { headers: { 'Content-Type': 'image/png' } }),
    () => new Response(new Uint8Array(128 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }),
  ])('rejects redirects, active content, invalid bytes and excessive bodies', async response => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    await expect(fetchWebsiteIcon('example.com')).rejects.toMatchObject({ code: 'ICON_UNAVAILABLE' });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
