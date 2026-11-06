/** 画面試験は人工応答だけ。差し替え漏れから検証・本番の口を呼ばない。 */
const originalFetch=globalThis.fetch
if(originalFetch)globalThis.fetch=async(input,init)=>{
  const raw=input instanceof Request?input.url:String(input)
  const url=new URL(raw,'http://localhost')
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname) && ['http:','https:'].includes(url.protocol)) {
    throw new Error('試験の外部通信は禁止です。人工応答を設定してください。')
  }
  return originalFetch(input,init)
}
