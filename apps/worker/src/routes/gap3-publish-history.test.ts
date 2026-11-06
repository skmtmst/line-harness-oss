import {expect,it,vi} from 'vitest';
import {publishedVersionStatement} from '@line-crm/db/src/template-publish-statement.js';
import {gapFixture} from '../test-utils/gap1.js';
it('GAP3-PUBLISH-01: 分割先で複数メッセージを公開履歴へ同じ順で残す',async()=>{
 const d=gapFixture();const external=vi.spyOn(globalThis,'fetch');
 try {
 const bubbles=JSON.stringify([{id:'one',type:'text',content:{text:'最初'}},{id:'two',type:'text',content:{text:'次'}}]);
 d.raw.prepare("INSERT INTO templates(id,name,message_type,message_content,line_account_id,published_version,message_bubbles_json) VALUES('template','見本','text','最初','a',1,?)").run(bubbles);
 await d.db.batch([d.db.prepare("UPDATE templates SET published_version=2 WHERE id='template'"),publishedVersionStatement(d.db,'template',2,{},'2026-10-16T00:00:00Z')]);
 expect(d.raw.prepare("SELECT message_bubbles_json FROM template_versions WHERE template_id='template' AND version_number=2").get()).toEqual({message_bubbles_json:bubbles});
 expect(external).not.toHaveBeenCalled();
 } finally {external.mockRestore();d.raw.close();}
});
