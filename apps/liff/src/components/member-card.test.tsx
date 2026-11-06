// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemberCardView } from './member-card.js';

afterEach(cleanup);

describe('会員証の段（G5-3）', () => {
  it('今のランクと、次の段まであとどれだけかを出す', () => {
    render(<MemberCardView card={{ name: 'シルバー', since: '2026-09-01', downgradeDueAt: null, next: { name: 'ゴールド', remaining: 2, metric: 'visits', progress: 0.6 }, memberNumber: '0012-3456', benefits: ['マイル 1.2 倍'] }} />);
    expect(screen.getByText('シルバー')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'ゴールドまで' }).getAttribute('aria-valuenow')).toBe('60');
    expect(screen.getByText('No. 0012-3456')).toBeTruthy();
    expect(screen.getByText('特典：マイル 1.2 倍')).toBeTruthy();
    expect(screen.getByText('ゴールドまで あと 2 回の利用')).toBeTruthy();
    expect(screen.queryByText(/下がる前/)).toBeNull();
  });
  it('下がる予定のある人には、その日までに条件を満たすと今のランクのままと伝える', () => {
    render(<MemberCardView card={{ name: 'シルバー', since: '2026-09-01', downgradeDueAt: '2026-12-31T00:00:00Z', next: null }} />);
    expect(screen.getByText('12/31 までに条件を満たすと、シルバーのままです。')).toBeTruthy();
    expect(screen.getByText('最上位のランクです')).toBeTruthy();
  });
});
