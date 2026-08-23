import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manuals } from './lib/manuals';

const template = readFileSync(
  new URL('./app/manual/line-account-setup/page.mdx', import.meta.url),
  'utf8',
);
const elements = readFileSync(
  new URL('./components/manual-elements.tsx', import.meta.url),
  'utf8',
);

describe('manual site shell', () => {
  it('registers the template under /manual/<slug>', () => {
    expect(manuals).toEqual([
      expect.objectContaining({
        slug: 'line-account-setup',
        title: '記事テンプレート',
      }),
    ]);
  });

  it('includes every reusable article element', () => {
    for (const component of [
      'StepList',
      'Warning',
      'Tip',
      'ManualFigure',
      'Troubleshooting',
    ]) {
      expect(template).toContain(`<${component}`);
    }
    expect(elements).toContain('うまくいかないときは');
  });

  it('uses only the public manual asset path in the template', () => {
    expect(template).toContain('src="/manual/setup-placeholder.svg"');
    expect(template).not.toMatch(/(?:https?:\/\/|\/api\/|localhost)/);
  });
});
