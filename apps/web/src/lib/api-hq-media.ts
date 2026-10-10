import { fetchApi } from './api'
import type { HqAudioContent, HqMediaUploadSession, HqRichVideoPayload, MessageTemplateDefinition, MessageTemplateMediaDefinition, TemplateImagemapUpload } from '@line-crm/shared'

const base = '/api/hq/templates/media'
const data = async <T>(path: string, init: RequestInit) => {
  const result = await fetchApi<{success:boolean;data?:T}>(path, init)
  if (!result.success || !result.data) throw new Error('ファイルを取り込めませんでした。再確認してください。')
  return result.data
}
export const hqMediaApi = {
  createSession: (file: File, kind: 'video' | 'audio') => {
    const mimeType = kind === 'audio' ? 'audio/mp4' : 'video/mp4'
    if (file.size < 1 || file.size > 200 * 1024 * 1024 || !file.name.toLowerCase().endsWith(kind === 'audio' ? '.m4a' : '.mp4')) throw new Error('動画はMP4・音声はM4Aを200MB以内で選んでください。')
    return data<HqMediaUploadSession>(`${base}/upload-sessions`, {method:'POST',body:JSON.stringify({filename:file.name,mimeType,sizeBytes:file.size})})
  },
  completeSession: (id: string, etag: string) => data<MessageTemplateMediaDefinition>(`${base}/upload-sessions/${encodeURIComponent(id)}/complete`, {method:'POST',body:JSON.stringify({etag})}),
  cancelSession: (id: string) => data<{deleted:boolean}>(`${base}/upload-sessions/${encodeURIComponent(id)}`, {method:'DELETE'}),
  /** Browser PUT goes directly to R2, avoiding the Worker request/memory limit. */
  upload: async (file: File, kind: 'video' | 'audio') => {
    const session = await hqMediaApi.createSession(file, kind)
    const response = await fetch(session.uploadUrl, {method:'PUT',headers:session.requiredHeaders,body:file,credentials:'omit'})
    const etag = response.headers.get('ETag')
    if (!response.ok || !etag) throw new Error('アップロードを確認できません。完了の再確認かファイルの選び直しをしてください。')
    return hqMediaApi.completeSession(session.id, etag)
  },
  uploadRichVideoPreview: (file: File) => {
    if (!['image/png','image/jpeg'].includes(file.type) || file.size < 1 || file.size > 1024 * 1024) throw new Error('プレビュー画像はPNG・JPEGを1MB以内で選んでください。')
    return data<TemplateImagemapUpload>(`${base}?purpose=rich_video_preview&filename=${encodeURIComponent(file.name)}`, {method:'POST',headers:{'Content-Type':file.type},body:file})
  },
  deleteMedia: (r2Key: string) => data<{deleted:boolean}>(`${base}?r2Key=${encodeURIComponent(r2Key)}`, {method:'DELETE'}),
}
export function hqAudioContent(media: MessageTemplateMediaDefinition): HqAudioContent {
  if (media.kind !== 'audio' || !media.publicUrl || !media.durationMs) throw new Error('音声のURLと長さを確認してください。')
  return {state:{audio:{originalContentUrl:media.publicUrl,duration:media.durationMs / 1000,hqMediaKey:media.r2Key}}}
}
/** Existing save/preflight/distribute APIs consume this same store rich-video shape. */
export function hqRichVideoDefinition(name: string, video: MessageTemplateMediaDefinition, preview: TemplateImagemapUpload, altText: string, externalLink?: {label:string;linkUri:string}): MessageTemplateDefinition {
  const baseSize = preview.payload.baseSize as HqRichVideoPayload['baseSize']
  if (video.kind !== 'video' || !video.publicUrl || !preview.payload.imageUrl || !baseSize) throw new Error('動画とプレビュー画像を確認してください。')
  const payload: HqRichVideoPayload = {altText,baseUrl:String(preview.payload.baseUrl),baseSize,actions:[],video:{originalContentUrl:video.publicUrl,previewImageUrl:String(preview.payload.imageUrl),area:{x:0,y:0,width:1040,height:baseSize.height},...(externalLink ? {externalLink} : {})}}
  return {schemaVersion:1,template:{id:'hq-authored-message',name,category:'general',messageType:'imagemap',messageContent:JSON.stringify(payload),carouselActionsJson:null,carouselTapLimitMode:'none',carouselTapLimitText:null,questionJson:null,questionStatus:'draft'},media:[video,...preview.media]}
}
