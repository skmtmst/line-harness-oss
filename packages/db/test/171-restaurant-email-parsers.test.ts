import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '../migrations');

describe('171 飲食店予約メール解析', () => {
  it('媒体マスタと予約追加列、日次サマリーを作る', () => {
    const db = new Database(':memory:');
    for (const file of [
      '168_restaurant_test_foundation.sql',
      '169_restaurant_email_intake.sql',
      '170_restaurant_inbound_emails.sql',
      '171_restaurant_email_parsers.sql',
    ]) {
      db.exec(readFileSync(join(migrations, file), 'utf8'));
    }

    const media = db.prepare(`SELECT code, parser_key FROM rt_media ORDER BY code`).all();
    expect(media).toEqual([
      { code: 'gurunavi', parser_key: 'gurunavi' },
      { code: 'hotpepper', parser_key: 'hotpepper' },
      { code: 'retty', parser_key: 'retty' },
      { code: 'tabelog', parser_key: 'tabelog' },
    ]);
    const reservationColumns = db.prepare(`PRAGMA table_info(rt_reservations)`).all() as Array<{ name: string }>;
    expect(reservationColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'media_id', 'hold_expires_at', 'cancel_reason', 'stay_minutes', 'media_store_code',
      'table_label', 'inbound_email_id', 'parser_key', 'parser_version',
    ]));
    expect(db.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'rt_email_digests'`).get()).toEqual({ name: 'rt_email_digests' });
    expect(db.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_rt_reservations_external'`).get()).toEqual({
      name: 'idx_rt_reservations_external',
    });
  });
});
