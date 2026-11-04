import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { attachFormAccounts } from '../src/forms/reads.js';
import { mediaTenantGuard } from '../src/media/deletion-guard.js';

it('別統括の画像があるフォームを別の店に関連付けない', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id)
        VALUES('a','a','A','x','x','t1'),('b','b','B','x','x','t2');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind)
        VALUES('m','a','images/photo.png','photo.png','image/png',1,'image');
      INSERT INTO forms(id,name,fields,og_image_url,is_active) VALUES('f','架空','[]','https://cdn.test/images/photo.png',0);
      INSERT INTO form_accounts(form_id,line_account_id) VALUES('f','a');`);
    await expect(attachFormAccounts(asD1(raw),'f',['b'])).rejects.toThrow('media_cross_tenant_reference');
    expect(raw.prepare("SELECT line_account_id FROM form_accounts WHERE form_id='f'").all()).toEqual([{line_account_id:'a'}]);
    raw.prepare("UPDATE forms SET og_image_url=? WHERE id='f'").run('https://cdn.test/images%2Fphoto.png');
    await expect(attachFormAccounts(asD1(raw),'f',['b'])).rejects.toThrow('media_cross_tenant_reference');
    expect(raw.prepare("SELECT line_account_id FROM form_accounts WHERE form_id='f'").all()).toEqual([{line_account_id:'a'}]);
  } finally { raw.close(); }
});

it('統括所有バナーは同じ統括で使え、別統括では使えない', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id)
        VALUES('a','a','A','x','x','t1'),('b','b','B','x','x','t2');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind)
        VALUES('m',NULL,'images/banner.png','banner.png','image/png',1,'image');
      INSERT INTO banner_projects(id,tenant_id,name) VALUES('p','t1','架空');
      INSERT INTO banner_images(id,tenant_id,project_id,media_id) VALUES('banner','t1','p','m');`);
    const db=asD1(raw);
    await expect(db.batch(mediaTenantGuard(db,['m'],['a']))).resolves.toBeDefined();
    await expect(db.batch(mediaTenantGuard(db,['m'],['b']))).rejects.toThrow('media_cross_tenant_reference');
    await expect(db.batch(mediaTenantGuard(db,[JSON.stringify({imageUrl:'https://cdn.test/images%2Fbanner.png'})],['b']))).rejects.toThrow('media_cross_tenant_reference');
  } finally { raw.close(); }
});

it('フォームの内容が読み取り直後に変われば店の追加を戻す', async () => {
  const raw=new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t','A');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','A','x','x','t');
      INSERT INTO forms(id,name,fields,is_active) VALUES('f','架空','[]',0);`);
    const db=asD1(raw), batch=db.batch.bind(db);
    db.batch=async statements => { raw.prepare("UPDATE forms SET og_image_url='changed' WHERE id='f'").run(); return batch(statements); };
    await expect(attachFormAccounts(db,'f',['a'])).rejects.toThrow('media_cross_tenant_reference');
    expect(raw.prepare("SELECT * FROM form_accounts WHERE form_id='f'").all()).toEqual([]);
  } finally { raw.close(); }
});
