import { readImplementationSource } from '../test-utils/implementation-source.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readImplementationSource(join(ROOT, path));

describe('V6オートメーションの発生元配線', () => {
  it('フォーム回答は保存済み回答IDを一意な発生元IDにする', () => {
    const text = source('routes/forms.ts');
    expect(text).toContain(`eventType: 'form_submitted'`);
    expect(text).toContain(`sourceEventId: submission.id`);
  });

  it('リンククリックは保存済みクリックIDを一意な発生元IDにする', () => {
    const text = source('services/tracked-click-steps.ts');
    expect(text).toContain(`eventType:'link_clicked'`);
    expect(text).toContain(`sourceEventId:clickId`);
  });

  it('予約は確定経路だけが予約IDで発火する', () => {
    const salon = source('routes/booking.ts');
    const event = source('routes/events.ts');
    const confirmed = source('services/booking-confirmed-effects.ts');
    const payment = source('services/booking-payment-recovery.ts');
    // 新規・承認・代理登録と決済回収は、同じ確定処理の入口を通る。
    expect(salon.match(/await runConfirmedBookingSideEffects\(/g)).toHaveLength(3);
    expect(payment).toContain('await runConfirmedBookingSideEffects(');
    expect(confirmed.match(/dispatchAutomationEventWithLogging\(db,/g)).toHaveLength(1);
    expect(confirmed).toContain(`eventType: 'calendar_booked'`);
    expect(event.match(/eventType: 'calendar_booked'/g)).toHaveLength(3);
    expect(confirmed).toContain(`sourceEventId: bookingId`);
    expect(salon).toContain(`sourceEventId: id`);
    expect(event).toContain(`sourceEventId: booking.id`);
    expect(event).toContain(`sourceEventId: result.bookingId`);
  });

  it('5分Cronが日時起動と待機・再試行の再開を同じ実行器へ接続する', () => {
    const text = source('cron/scheduled.ts');
    expect(text).toContain('processScheduledAutomationTriggers(env.DB');
    expect(text).toContain('processDueAutomationRuns(env.DB');
    expect(text).toContain('createAutomationActionExecutors({');
    expect(text).toContain('processOverdueSupportMarkTriggers(env.DB');
  });

  it('担当割当と手動返信は保存後の不変IDで対応マークルールを評価する', () => {
    const text = source('routes/chats.ts');
    expect(text).toContain(`fireEvent(c.env.DB, 'staff_assigned'`);
    expect(text).toContain(`sourceEventId: correlationId`);
    expect(text).toContain(`fireEvent(c.env.DB, 'manual_reply_sent'`);
    expect(text).toContain(`sourceEventId: logId`);
  });
});
