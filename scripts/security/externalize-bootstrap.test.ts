import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Native build module also used without a TypeScript runtime.
import { externalizeHtml } from './externalize-bootstrap.mjs';

describe('static CSP bootstrap', () => {
  it('preserves script order and exact bytes with content hashes, without deferring execution', () => {
    const saved = new Map<string, string>();
    const code = 'self.__next_f.push([1,"日本語"]);';
    const hash = createHash('sha256').update(code).digest();
    const html = externalizeHtml(`<script src="/main.js" async></script><script>${code}</script><script>two()</script>`, (name: string, bytes: string) => saved.set(name, bytes));
    expect(html).toContain(`<script src="/_next/static/csp/${hash.toString('hex')}.js" integrity="sha256-${hash.toString('base64')}"></script>`);
    expect([...saved.values()]).toEqual([code, 'two()']);
    expect(html.indexOf('/main.js')).toBeLessThan(html.indexOf('/csp/'));
    expect(html).not.toMatch(/<script>\S|defer/);
    expect(externalizeHtml(html, () => { throw new Error('not idempotent'); })).toBe(html);
  });
  it('keeps data blocks and refuses new executable script types until reviewed', () => {
    const data = '<script type="application/json">{"a":1}</script>';
    expect(externalizeHtml(data, () => {})).toBe(data);
    expect(() => externalizeHtml('<script type="module">start()</script>', () => {})).toThrow();
  });
});
