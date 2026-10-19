// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StampConditions from './StampConditions.js';
afterEach(cleanup);
  it('初回・受け取り・金額・曜日と時間の倍率・ランク・重ねた上限を知らせる', () => {
    render(<StampConditions settings={{ mode: 'amount', amountUnit: 1000, firstVisitBonus: 3, receiptBonus: 2, maxPerVisit: 10, maxStackedStamps: 20, stackingOrder: 'multipliers_then_bonus', expiryMonths: null, timezone: 'Asia/Tokyo', multipliers: [{ name: '朝の倍率', multiplier: 2, weekdays: [1, 3], startMinute: 540, endMinute: 720 }, { name: '停止', active: false, multiplier: 9 }], rankMultipliers: [{ tagName: 'VIP', name: '常連', multiplier: 3 }], rewards: [] }} />);
    expect(screen.getByText('お会計1,000円ごとに1個')).toBeTruthy();
    expect(screen.getByText('初回の来店は3個追加')).toBeTruthy();
    expect(screen.getByText('カードを受け取ると2個')).toBeTruthy();
    expect(screen.getByText('朝の倍率：2倍（月・水曜日・09:00〜12:00）')).toBeTruthy();
    expect(screen.getByText('常連の方は3倍')).toBeTruthy();
    expect(screen.queryByText(/停止：/)).toBeNull();
    expect(screen.getByText('倍率をかけてから初回ボーナスを足します')).toBeTruthy();
    expect(screen.getByText(/重ねたあとは20個まで/)).toBeTruthy();
  });
