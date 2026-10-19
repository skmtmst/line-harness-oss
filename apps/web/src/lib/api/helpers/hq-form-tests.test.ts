import { afterEach,beforeEach,expect,test,vi } from 'vitest'
vi.mock('../../api',()=>({fetchApi:vi.fn()}))
import { fetchApi } from '../../api'
import { hqFormTestsApi, readHqFormTest } from './hq-form-tests'
beforeEach(()=>vi.mocked(fetchApi).mockReset().mockResolvedValue({success:true,data:{}}))
afterEach(()=>vi.unstubAllGlobals())
test('issue pins revision, revoke escapes IDs, public preview omits admin credentials and uses header',async()=>{
  await hqFormTestsApi.issue('id/1',3)
  expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/id%2F1/test-token',{method:'POST',body:JSON.stringify({expectedRevision:3})})
  await hqFormTestsApi.revoke('id/1','token/1')
  expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/id%2F1/test-tokens/token%2F1',{method:'DELETE'})
  const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{dryRun:true}})))
  vi.stubGlobal('fetch',transport)
  await readHqFormTest('https://worker.test','id/1','secret')
  expect(transport).toHaveBeenLastCalledWith(new URL('https://worker.test/api/liff/hq-form-tests/id%2F1'),expect.objectContaining({method:'GET',credentials:'omit',headers:{Authorization:'Bearer secret'}}))
  transport.mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:{dryRun:true}})))
  await readHqFormTest('https://worker.test','id/1','secret',{name:'試し'})
  expect(transport).toHaveBeenLastCalledWith(new URL('https://worker.test/api/liff/hq-form-tests/id%2F1/submit'),expect.objectContaining({method:'POST',body:JSON.stringify({answers:{name:'試し'}})}))
  transport.mockResolvedValueOnce(new Response(JSON.stringify({success:false,error:'期限切れ'}),{status:404}))
  await expect(readHqFormTest('https://worker.test','id/1','expired')).rejects.toThrow('期限切れ')
})
