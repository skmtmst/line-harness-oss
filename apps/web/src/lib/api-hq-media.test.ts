import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import type { MessageTemplateMediaDefinition } from '@line-crm/shared'
const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({fetchApi:request}))
import { hqMediaApi, hqAudioContent, hqRichVideoDefinition } from './api-hq-media'
const media: MessageTemplateMediaDefinition = {id:'id',kind:'audio',filename:'音声.m4a',mimeType:'audio/mp4',sizeBytes:3,width:null,height:null,durationMs:3001,r2Key:'hq-templates/tenant/uploads/id.m4a',publicUrl:'https://worker.test/images/hq-templates/tenant/uploads/id.m4a',versionId:'id',versionNo:1,contentHash:'a'.repeat(64)}
beforeEach(()=>{request.mockReset();request.mockResolvedValue({success:true,data:media})})
afterEach(()=>vi.unstubAllGlobals())
test('accountless upload uses authenticated session APIs, then a credential-free direct PUT',async()=>{
  const file=new File(['abc'],'音声.m4a',{type:'audio/x-m4a'})
  const session={id:'session',uploadUrl:'https://r2.test/signed',requiredHeaders:{'Content-Type':'audio/mp4','x-amz-meta-upload-session-id':'session'},expiresAt:'later'}
  request.mockResolvedValueOnce({success:true,data:session})
  const put=vi.fn().mockResolvedValue(new Response(null,{headers:{ETag:'"uploaded"'}}));vi.stubGlobal('fetch',put)
  expect(await hqMediaApi.upload(file,'audio')).toEqual(media)
  expect(request).toHaveBeenNthCalledWith(1,'/api/hq/templates/media/upload-sessions',{method:'POST',body:JSON.stringify({filename:'音声.m4a',mimeType:'audio/mp4',sizeBytes:3})})
  expect(put).toHaveBeenCalledWith(session.uploadUrl,{method:'PUT',headers:session.requiredHeaders,body:file,credentials:'omit'})
  expect(request).toHaveBeenNthCalledWith(2,'/api/hq/templates/media/upload-sessions/session/complete',{method:'POST',body:JSON.stringify({etag:'"uploaded"'})})
})
test('rejects wrong extension, >200MB and >1MB previews before API requests',async()=>{
  expect(()=>hqMediaApi.createSession(new File(['x'],'wrong.mp3'),'audio')).toThrow()
  const big=new File(['x'],'big.mp4');Object.defineProperty(big,'size',{value:200*1024*1024+1});expect(()=>hqMediaApi.createSession(big,'video')).toThrow()
  const preview=new File(['x'],'preview.png',{type:'image/png'});Object.defineProperty(preview,'size',{value:1024*1024+1});expect(()=>hqMediaApi.uploadRichVideoPreview(preview)).toThrow()
  expect(request).not.toHaveBeenCalled()
})
test('missing ETag never claims completion; cancel/delete use the authenticated transport',async()=>{
  request.mockResolvedValueOnce({success:true,data:{id:'session',uploadUrl:'https://r2.test/signed',requiredHeaders:{}}})
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null)))
  await expect(hqMediaApi.upload(new File(['x'],'sound.m4a'),'audio')).rejects.toThrow('アップロード')
  expect(request).toHaveBeenCalledOnce()
  await hqMediaApi.cancelSession('session');expect(request).toHaveBeenLastCalledWith('/api/hq/templates/media/upload-sessions/session',{method:'DELETE'})
  await hqMediaApi.deleteMedia(media.r2Key);expect(request).toHaveBeenLastCalledWith(`/api/hq/templates/media?r2Key=${encodeURIComponent(media.r2Key)}`,{method:'DELETE'})
})
test('audio converts server milliseconds to composer seconds while retaining the owned key',()=>{
  expect(hqAudioContent(media)).toEqual({state:{audio:{originalContentUrl:media.publicUrl,duration:3.001,hqMediaKey:media.r2Key}}})
  expect(()=>hqAudioContent({...media,durationMs:null})).toThrow()
})
test('video definition uses the existing store imagemap shape, keeping both original and five-size preview receipts',()=>{
  const video={...media,kind:'video' as const,filename:'video.mp4',mimeType:'video/mp4'}
  const preview={media:[{...media,kind:'image' as const}],payload:{imageUrl:'https://worker.test/images/preview.png',baseUrl:'https://worker.test/images/preview',baseSize:{width:1040,height:520}}}
  const definition=hqRichVideoDefinition('動画',video,preview,'ご案内',{label:'開く',linkUri:'https://example.com'})
  expect(definition.template.messageType).toBe('imagemap');expect(definition.media).toEqual([video,...preview.media])
  expect(JSON.parse(definition.template.messageContent)).toMatchObject({altText:'ご案内',actions:[],video:{previewImageUrl:preview.payload.imageUrl,area:{x:0,y:0,width:1040,height:520}}})
})
