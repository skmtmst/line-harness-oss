import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { claimFormCapacitySlot, getFormSubmissionsByFriend, getFormSubmissionsByFriendCursor,
  getFormSubmitClaimsBySubmissionIds, getFormVersionContentsByIds } from '../src/forms.js';
let raw: Database.Database; let db: D1Database;
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(fileURLToPath(new URL('../bootstrap.sql', import.meta.url)), 'utf8'));
  db = asD1(raw);
  raw.exec(`INSERT INTO friends(id,line_user_id) VALUES('friend','Ufriend');
    INSERT INTO forms(id,name,fields) VALUES('form','Draft','[{"label":"Draft question"}]');
    INSERT INTO form_versions(id,form_id,version_number,source_content_revision,name,fields,save_to_metadata,published_at,created_at)
      VALUES('version','form',2,2,'Published','[{"label":"Published question"}]',0,'2026-10-08','2026-10-08');
    INSERT INTO form_submissions(id,form_id,friend_id,data,form_version_id) VALUES('answer','form','friend','{}','version');
    INSERT INTO form_submit_claims(line_account_id,form_id,friend_id,idempotency_key,request_hash,submission_id,owner,created_at,updated_at,expires_at)
      VALUES('account','form','friend','key','hash','answer','owner','2026-10-08','2026-10-08','2026-10-09');`);
});
afterEach(() => raw.close());
describe('監査2: フォームの回答時点と再開', () => {
  it('PKG17: 回答履歴と続きの読込は回答時の公開名・質問を使い、旧回答だけ現在定義を使う', async () => {
    raw.exec("INSERT INTO form_submissions(id,form_id,friend_id,data) VALUES('legacy','form','friend','{}')");
    for (const rows of [await getFormSubmissionsByFriend(db,'friend'), (await getFormSubmissionsByFriendCursor(db,'friend')).items]) {
      expect(rows.find(row=>row.id==='answer')).toMatchObject({ form_name: 'Published', form_fields: '[{"label":"Published question"}]' });
      expect(rows.find(row=>row.id==='legacy')).toMatchObject({ form_name: 'Draft', form_fields: '[{"label":"Draft question"}]' });
    }
  });
  it.each([1,10])('PKG18: 上限%sで確保済みの同じ回答を再開し、他の回答の枠を奪わない', async limit => {
    expect(await claimFormCapacitySlot(db,'form','choice','answer',limit)).toBe(true);
    expect(await claimFormCapacitySlot(db,'form','choice','answer',limit)).toBe(true);
    expect(raw.prepare('SELECT COUNT(*) n FROM form_capacity_claims').get()).toEqual({ n: 1 });
    if (limit===1) expect(await claimFormCapacitySlot(db,'form','choice','other',limit)).toBe(false);
  });
  it('PKG19: 200件の回答・公開版を100bind以内で読み、要求外の記録を混ぜない', async () => {
    const missing=Array.from({ length: 199 },(_,i)=>`missing${i}`);
    expect((await getFormVersionContentsByIds(db,['version',...missing])).size).toBe(1);
    expect((await getFormSubmitClaimsBySubmissionIds(db,['answer',...missing])).size).toBe(1);
    expect((await getFormSubmitClaimsBySubmissionIds(db,missing)).size).toBe(0);
  });
});
