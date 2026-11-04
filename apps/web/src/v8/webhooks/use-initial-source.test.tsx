// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useInitialWebhookSource } from './use-initial-source'
const presets=[{value:'line'},{value:'booking'}]
afterEach(()=>{cleanup();window.history.replaceState(null,'','/')})
it('見本の指定を受け取り、作成の指示だけURLから消す',()=>{
 window.history.replaceState(null,'','/webhooks?tab=incoming&source=booking#settings')
 const view=renderHook(()=>useInitialWebhookSource('booking',presets))
 expect(view.result.current).toBe('booking')
 expect(window.location.pathname+window.location.search+window.location.hash).toBe('/webhooks?tab=incoming#settings')
})
it('見本にない受信元を初期選択にしない',()=>{
 window.history.replaceState(null,'','/webhooks?source=unknown')
 expect(renderHook(()=>useInitialWebhookSource('unknown',presets)).result.current).toBe('')
})
it('初期選択を保ち、URLが消えた後の再マウントでは作成を開き直さない',()=>{
 window.history.replaceState(null,'','/webhooks?source=booking')
 const view=renderHook(({source})=>useInitialWebhookSource(source,presets),{initialProps:{source:'booking'}})
 view.rerender({source:''});expect(view.result.current).toBe('booking');view.unmount()
 expect(renderHook(()=>useInitialWebhookSource('booking',presets)).result.current).toBe('')
})
