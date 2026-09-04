import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('V6オートメーションの発生元配線', () => {
  it('フォーム回答は保存済み回答IDを一意な発生元IDにする', () => {
    const text = source('routes/forms.ts');
    expect(text).toContain(`eventType: 'form_submitted'`);
    expect(text).toContain(`sourceEventId: submission.id`);
  });

  it('リンククリックは保存済みクリックIDを一意な発生元IDにする', () => {
    const text = source('routes/tracked-links.ts');
    expect(text).toContain(`eventType: 'link_clicked'`);
    expect(text).toContain(`sourceEventId: click.id`);
  });

  it('予約は確定経路だけが予約IDで発火する', () => {
    const salon = source('routes/booking.ts');
    const event = source('routes/events.ts');
    expect(salon.match(/eventType: 'calendar_booked'/g)).toHaveLength(2);
    expect(event.match(/eventType: 'calendar_booked'/g)).toHaveLength(2);
    expect(salon).toContain(`sourceEventId: bookingId`);
    expect(salon).toContain(`sourceEventId: id`);
    expect(event).toContain(`sourceEventId: booking.id`);
  });

  it('5分Cronが日時起動と待機・再試行の再開を同じ実行器へ接続する', () => {
    const text = source('index.ts');
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
