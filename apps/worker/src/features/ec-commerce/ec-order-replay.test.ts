import { afterEach, beforeEach, expect, test } from 'vitest';
import { upsertEcEventReadModels } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
let fixture:SqliteD1;
beforeEach(()=>{fixture=createTestD1();});
afterEach(()=>fixture.raw.close());
test('R-EC01: 確定A→取消B→処理済みA再送で注文と明細を戻さない',async()=>{
 const event=(id:string,type:string,time:string,label:string)=>({eventId:id,sourceKey:'eccube:a',externalEventId:id,eventType:type,lineAccountId:'a',customerId:'c',occurredAt:time,order:{number:'order',total:100,items:[{name:label,quantity:1}]}});
 const a=event('A','ec.order.confirmed','2026-10-10T00:00:00Z','旧商品');const b=event('B','ec.order.cancelled','2026-10-10T01:00:00Z','最新商品');
 for(const item of [a,b]) fixture.raw.prepare("INSERT INTO ec_events(id,source,external_event_id,event_type,line_account_id,payload,status,received_at,updated_at) VALUES(?,?,?,?,?,?,'processed','2026-10-10','2026-10-10')").run(item.eventId,item.sourceKey,item.eventId,item.eventType,'a',JSON.stringify({occurred_at:item.occurredAt}));
 await upsertEcEventReadModels(fixture.db,a);await upsertEcEventReadModels(fixture.db,b);await upsertEcEventReadModels(fixture.db,a);
 expect(fixture.raw.prepare('SELECT normalized_status,provider_status,last_event_id,version FROM ec_orders').get()).toEqual({normalized_status:'cancelled',provider_status:'ec.order.cancelled',last_event_id:'B',version:2});
 expect(fixture.raw.prepare('SELECT product_name FROM ec_order_lines').all()).toEqual([{product_name:'最新商品'}]);
});
