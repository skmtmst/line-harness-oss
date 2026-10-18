import { afterEach,expect,it,vi } from 'vitest';
import { friendsMethods } from './api/features/friends';
afterEach(()=>vi.unstubAllGlobals());
it('passes the opt-in cursor and account scope through the public API client',async()=>{
 const payload={success:true,data:{items:[],total:0,page:1,limit:20,nextCursor:'next'}};
 const send=vi.fn<typeof fetch>(async()=>Response.json(payload));vi.stubGlobal('fetch',send);
 const result=await friendsMethods.friends.list({accountId:'account-a',limit:20,pagination:'cursor',cursor:'fixed-cursor'});
 const url=new URL(String(send.mock.calls[0][0]));
 expect(url.searchParams.get('lineAccountId')).toBe('account-a');expect(url.searchParams.get('pagination')).toBe('cursor');
 expect(url.searchParams.get('cursor')).toBe('fixed-cursor');expect(url.searchParams.has('offset')).toBe(false);expect(result.data?.nextCursor).toBe('next');
});
