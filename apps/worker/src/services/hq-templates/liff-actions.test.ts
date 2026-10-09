import { afterEach, describe, expect, it } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { resolveHqLiffActions } from './liff-actions.js';
import { listMessageReferences } from './message-card-references.js';
import { hqLiffActionLocator, liffActionFromUrl, type LiffAction } from '@line-crm/shared';

const resources: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const r of resources.splice(0)) r.raw.close(); });
const authority = { tenantId: 'tenant', actorId: 'owner', role: 'owner', readOnly: false, accountScoped: false } as const;
function fixture() {
  const sql = createTestD1({ foreignKeys: true }); resources.push(sql);
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES ('tenant','店'),('other','別');
    INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id) VALUES
      ('source','元','source','test','test','tenant','liff-source'),('target','先','target','test','test','tenant','liff-target'),('foreign','外','foreign','test','test','other','liff-foreign');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES ('source-menu','source','相談',30,0),('target-menu','target','相談',30,0),('foreign-menu','foreign','相談',30,0);
    INSERT INTO forms(id,name) VALUES ('source-form','質問'),('target-form','質問');
    INSERT INTO form_accounts(form_id,line_account_id) VALUES ('source-form','source'),('target-form','target');
    INSERT INTO visit_stamp_cards(id,tenant_id,name,settings_json) VALUES ('source-card','tenant','来店','{}'),('target-card','tenant','来店','{}'),('foreign-card','other','来店','{}');
    INSERT INTO visit_stamp_card_accounts(card_id,line_account_id) VALUES ('source-card','source'),('target-card','target'),('foreign-card','foreign');`);
  return sql;
}
const selected: LiffAction[] = [{ kind: 'booking' }, { kind: 'booking', menuId: 'source-menu' }, { kind: 'booking_history' }, { kind: 'form', formId: 'source-form' }, { kind: 'visit_stamp' }, { kind: 'visit_stamp', cardId: 'source-card' }];
describe('統括のLIFF解決と所属の検査', () => {
  it.each(selected)('店のLIFFと選択先へ置き換え、計画のガードを実行できる: %j', async action => {
    const f = fixture(), locator = hqLiffActionLocator(action);
    const plan = await resolveHqLiffActions(f.db, authority, 'target', new Map([[locator, action]]));
    const url = plan.targets[locator];
    expect(url).toContain('https://liff.line.me/liff-target/');
    const expected = action.kind === 'form' ? { kind: 'form', formId: 'target-form' }
      : action.kind === 'booking' && action.menuId ? { kind: 'booking', menuId: 'target-menu' }
      : action.kind === 'visit_stamp' && action.cardId ? { kind: 'visit_stamp', cardId: 'target-card' } : action;
    expect(liffActionFromUrl(url)).toEqual(expected);
    await f.db.batch(plan.statements.map(s => f.db.prepare(s.sql).bind(...s.bindings)));
  });
  it.each(selected)('LIFF未設定なら配れない: %j', async action => {
    const f = fixture(); f.raw.exec("UPDATE line_accounts SET liff_id=NULL WHERE id='target'");
    await expect(resolveHqLiffActions(f.db, authority, 'target', new Map([['url', action]]))).rejects.toMatchObject({ code: 'LIFF_UNAVAILABLE' });
  });
  it.each(['missing', 'duplicate', 'inactive', 'foreign'])('予約メニューの候補を決められなければ配れない: %s', async mode => {
    const f = fixture();
    if (mode === 'missing') f.raw.exec("DELETE FROM menus WHERE id='target-menu'");
    if (mode === 'duplicate') f.raw.exec("INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES ('duplicate','target','相談',30,0)");
    if (mode === 'inactive') f.raw.exec("UPDATE menus SET is_active=0 WHERE id='target-menu'");
    await expect(resolveHqLiffActions(f.db, authority, 'target', new Map([['url', { kind: 'booking', menuId: mode === 'foreign' ? 'foreign-menu' : 'source-menu' }]]))).rejects.toMatchObject({ code: 'REFERENCE_UNAVAILABLE' });
  });
  it('カードの店への所属と同名の曖昧さを検査する', async () => {
    const f = fixture(); f.raw.exec("DELETE FROM visit_stamp_card_accounts WHERE card_id='target-card'");
    await expect(resolveHqLiffActions(f.db, authority, 'target', new Map([['url', { kind: 'visit_stamp', cardId: 'source-card' }]]))).rejects.toThrow();
  });
  it.each(['liff', 'menu', 'card-owner', 'duplicate'])('事前検査後に設定・所属・候補が変われば原子的ガードが止める: %s', async mode => {
    const f = fixture();
    const plan = await resolveHqLiffActions(f.db, authority, 'target', new Map([['book', { kind: 'booking', menuId: 'source-menu' }], ['stamp', { kind: 'visit_stamp', cardId: 'source-card' }]]));
    if (mode === 'liff') f.raw.exec("UPDATE line_accounts SET liff_id='changed' WHERE id='target'");
    if (mode === 'menu') f.raw.exec("UPDATE menus SET name='変更' WHERE id='target-menu'");
    if (mode === 'card-owner') f.raw.exec("DELETE FROM visit_stamp_card_accounts WHERE card_id='target-card'");
    if (mode === 'duplicate') f.raw.exec("INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES ('duplicate','target','相談',30,0)");
    await expect(f.db.batch(plan.statements.map(s => f.db.prepare(s.sql).bind(...s.bindings)))).rejects.toThrow();
  });
  it('画面で選べる参照先にフォーム・メニュー・スタンプカードを返し、他の統括を除く', async () => {
    const f = fixture(); const refs = await listMessageReferences(f.db, authority);
    expect(refs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'booking', id: 'source-menu' }), expect.objectContaining({ kind: 'visit_stamp', id: 'target-card' }), expect.objectContaining({ kind: 'form', id: 'source-form' })]));
    expect(refs.some(r => r.id.startsWith('foreign'))).toBe(false);
  });
});
