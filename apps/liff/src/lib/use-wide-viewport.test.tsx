// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useWideViewport } from './use-wide-viewport.js';

/**
 * 幅 414px 以上かどうかの仕掛け（★V8 の 414 幅の板用）。
 * 問い合わせが無いときは 375 扱い（false）のままにする。
 */

function stubMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function Probe() {
  const wide = useWideViewport();
  return <div data-testid="probe" data-wide={String(wide)} />;
}

describe('useWideViewport', () => {
  afterEach(() => cleanup());
  it('414px 以上なら true', () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId('probe').getAttribute('data-wide')).toBe('true');
  });

  it('375px なら false', () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId('probe').getAttribute('data-wide')).toBe('false');
  });

  it('問い合わせが無ければ false のまま', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    render(<Probe />);
    expect(screen.getByTestId('probe').getAttribute('data-wide')).toBe('false');
  });
});
