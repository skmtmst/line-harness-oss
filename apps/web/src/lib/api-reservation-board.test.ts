import {afterEach,expect,it,vi} from 'vitest'
import {allBoardPages,reservationBoardApi} from './api-reservation-board'
vi.mock('./api',()=>({fetchApi:vi.fn()}))
afterEach(()=>vi.restoreAllMocks())
it('印刷は全ページを読み、別店舗の予約を混ぜない',async()=>{
 const page=vi.spyOn(reservationBoardApi,'page').mockResolvedValueOnce({success:true,data:{entries:[{id:'1',scopeId:'s'},{id:'other',scopeId:'other'}],total:3}} as never).mockResolvedValueOnce({success:true,data:{entries:[{id:'3',scopeId:'s'}],total:3}} as never)
 expect((await allBoardPages('seats','a','from','to','s')).map(e=>e.id)).toEqual(['1','3']);expect(page).toHaveBeenNthCalledWith(2,'seats','a','from','to',2,'s')
})
it('件数が残るのに空のページが返ったら、途中の印刷を止める',async()=>{
 vi.spyOn(reservationBoardApi,'page').mockResolvedValue({success:true,data:{entries:[],total:3}} as never);await expect(allBoardPages('seats','a','from','to')).rejects.toThrow('途中で止まりました')
})
