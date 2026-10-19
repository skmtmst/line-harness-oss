import { beforeEach,expect,test,vi } from 'vitest'
vi.mock('../../api',()=>({fetchApi:vi.fn()}))
import { fetchApi } from '../../api'
import { hqTagImportApi } from './hq-tag-import'
beforeEach(()=>vi.mocked(fetchApi).mockReset().mockResolvedValue({success:true,data:{}}))
test('same parsed CSV rows go to preview and execute and transport failures propagate',async()=>{
  const rows=[{line:2,name:'VIP',folderName:'顧客'}]
  await hqTagImportApi.preview(rows);expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/tags/import/preview',{method:'POST',body:JSON.stringify({rows})})
  await hqTagImportApi.execute(rows);expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/tags/import',{method:'POST',body:JSON.stringify({rows})})
  vi.mocked(fetchApi).mockRejectedValueOnce(new Error('登録失敗'));await expect(hqTagImportApi.execute(rows)).rejects.toThrow('登録失敗')
})
