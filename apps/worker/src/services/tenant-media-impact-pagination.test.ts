import { expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { captureMediaPurgeImpacts } from './tenant-media-impact.js';

test('影響の調査は多数の参照を小分けに読み、全件を一度ずつ数える', async () => {
  const fixture = createTestD1({ foreignKeys: false });
  try {
    fixture.raw.prepare("INSERT INTO tenants(id,name) VALUES('other','other')").run();
    fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('account','channel','account','x','x','other')").run();
    const insert = fixture.raw.prepare("INSERT INTO tracked_links(id,name,original_url,og_image_url,line_account_id) VALUES(?,?, 'https://example.invalid', 'https://example.invalid/images/media/picture.png', 'account')");
    for (let i=0; i<251; i++) insert.run(`link-${i}`, `link-${i}`);
    let largestRead = 0;
    const db = { ...fixture.db, prepare(sql: string) {
      const statement = fixture.db.prepare(sql);
      return { ...statement, bind(...args: unknown[]) {
        const bound = statement.bind(...args);
        return { ...bound, async all() {
          const result = await bound.all();
          largestRead = Math.max(largestRead, result.results.length);
          return result;
        } };
      } };
    } } as unknown as D1Database;
    await captureMediaPurgeImpacts(db, 'owner', [{ key: 'media/picture.png', mediaId: 'media', ownerAccount: 'owner-account', includeLive: true }], '2026-11-05');
    expect(largestRead).toBeLessThanOrEqual(100);
    expect(fixture.raw.prepare("SELECT usage_count FROM media_purge_impact_pending WHERE target_kind='tracked_link'").get()).toEqual({ usage_count: 251 });
  } finally { fixture.raw.close(); }
});

test('同じ行が100店舗以上に展開されても次ページで残りの店舗を拾う', async () => {
  const fixture = createTestD1({ foreignKeys: false });
  try {
    fixture.raw.prepare("INSERT INTO tenants(id,name) VALUES('other','other')").run();
    const insert=fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES(?,?,?,'x','x','other')");
    const accounts=Array.from({length:105},(_,i)=>`account-${String(i).padStart(3,'0')}`);
    for (const id of accounts) insert.run(id,id,id);
    fixture.raw.prepare("INSERT INTO events(id,name,line_account_id,account_ids,image_url) VALUES('event','event','owner-account',?,?)").run(JSON.stringify(accounts),'https://example.invalid/images/media/picture.png');
    await captureMediaPurgeImpacts(fixture.db,'owner',[{key:'media/picture.png',mediaId:'media',ownerAccount:'owner-account',includeLive:true}],'2026-11-05');
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM media_purge_impact_pending WHERE target_kind='event' AND target_line_account_id IS NOT NULL").get()).toEqual({n:105});
  } finally { fixture.raw.close(); }
});
