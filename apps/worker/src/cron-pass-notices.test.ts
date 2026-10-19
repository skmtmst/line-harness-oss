import {expect,test,vi} from 'vitest';
const processPassNotices=vi.hoisted(()=>vi.fn(async()=>({processed:0,sent:false,testMode:true})));
vi.mock('./features/booking/booking-pass-notices.js',()=>({processPassNotices}));
const {default:worker}=await import('./index.js');
test('B2-19-CRON: 毎分の実scheduledハンドラが同じ時刻で模擬の知らせを処理する',async()=>{
 const scheduledTime=Date.parse('2026-10-16T01:00:00Z'),db={} as D1Database;
 const error=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{
  await worker.scheduled({cron:'* * * * *',scheduledTime} as ScheduledEvent,{DB:db} as import('./index.js').Env['Bindings'],{waitUntil:vi.fn()} as unknown as ExecutionContext);
  expect(processPassNotices).toHaveBeenCalledExactlyOnceWith(db,new Date(scheduledTime));
 }finally{error.mockRestore();}
});
