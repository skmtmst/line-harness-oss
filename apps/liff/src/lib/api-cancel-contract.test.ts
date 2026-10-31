// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./liff-auth.js',()=>({getIdToken:()=> 'test-id-token',getLiffId:()=> 'test-liff'}));
import { api } from './api.js';
afterEach(()=>vi.unstubAllGlobals());
it('本人認証付きの見積もりを読み、表示金額への同意と予約の版を取消APIへ送る',async()=>{
 const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{feeNow:4200}}),{status:200}));vi.stubGlobal('fetch',request);
 expect(await api.cancellationQuote('booking')).toEqual({feeNow:4200});
 const read=new URL(request.mock.calls[0][0]);expect(read.pathname).toBe('/api/liff/booking/cancellation-quote');expect(read.searchParams.get('booking_id')).toBe('booking');expect(read.searchParams.get('liffId')).toBe('test-liff');
 expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer test-id-token');
 request.mockResolvedValueOnce(new Response(JSON.stringify({success:true,status:'cancelled',lock_version:4}),{status:200}));
 await api.cancelMyBooking('booking',3,{feeAccepted:true,expectedFeeAmount:4200});
 expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({lock_version:3,feeAccepted:true,expectedFeeAmount:4200});
});
