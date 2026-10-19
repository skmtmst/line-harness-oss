import { describe, expect, it } from 'vitest';
import { escapeHtml, scriptString } from './html-escape.js';

describe('HTML and script contexts', () => {
  it('F2/F11: attribute payloads remain data', () => {
    const value = '" autofocus onfocus="alert(1)\'>&<';
    expect(escapeHtml(value)).toBe('&quot; autofocus onfocus=&quot;alert(1)&#39;&gt;&amp;&lt;');
  });
  it('F6: script terminators and separators stay within a string literal', () => {
    const value = 'https://x.com/</script><script>alert("x")</script>\u2028\u2029';
    const serialized = scriptString(value);
    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(serialized)).toBe(value);
  });
});
