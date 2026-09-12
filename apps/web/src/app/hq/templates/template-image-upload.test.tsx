// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { hqTemplatesApi } from '@/lib/hq-templates-api'
import type { MessageTemplateDefinition, RichMenuDefinition } from '@/lib/hq-templates-api'
import { freshDefinition, withUploadedImage } from '@/lib/hq-template-authoring'
import TemplateDefinitionEditor from './template-definition-editor'
const media = { id:'image',kind:'image' as const,filename:'a.png',mimeType:'image/png',sizeBytes:32,width:2500,height:1686,durationMs:null,r2Key:'hq-templates/tenant/uploads/a.png',publicUrl:'https://worker.test/images/hq-templates/tenant/uploads/a.png',versionId:'image',versionNo:1,contentHash:'a'.repeat(64) }
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { uploadImage: vi.fn() } }))

afterEach(()=>{cleanup();vi.restoreAllMocks()})
describe('HQ image authoring',()=>{
  it('new image selection uses authenticated upload and reflects only its completed receipt',async()=>{
    let finish!:(v:typeof media)=>void;const upload=vi.spyOn(hqTemplatesApi,'uploadImage').mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
    const value=freshDefinition('template') as MessageTemplateDefinition;value.template.messageType='image';const onChange=vi.fn(),onBusyChange=vi.fn();
    render(<TemplateDefinitionEditor type="template" value={value} disabled={false} onChange={onChange} onBusyChange={onBusyChange} />)
    const file=new File(['fixture'],'a.png',{type:'image/png'});fireEvent.change(screen.getByLabelText('メッセージ画像を選ぶ'),{target:{files:[file]}})
    expect(upload).toHaveBeenCalledWith(file,'message');expect(onBusyChange).toHaveBeenCalledWith(true);expect(onChange).not.toHaveBeenCalled();expect((screen.getByLabelText('メッセージ画像を選ぶ') as HTMLInputElement).disabled).toBe(true)
    finish(media);await waitFor(()=>expect(onChange).toHaveBeenCalledWith(withUploadedImage(value,media)));expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })
  it('upload failure keeps the original definition and allows retry',async()=>{
    vi.spyOn(hqTemplatesApi,'uploadImage').mockRejectedValue(new Error('画像を登録できませんでした。'));const onChange=vi.fn();render(<TemplateDefinitionEditor type="rich_menu" value={freshDefinition('rich_menu')} disabled={false} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('リッチメニュー画像を選ぶ'),{target:{files:[new File(['fixture'],'a.png',{type:'image/png'})]}})
    await screen.findByRole('alert');expect(onChange).not.toHaveBeenCalled();expect((screen.getByLabelText('リッチメニュー画像を選ぶ') as HTMLInputElement).disabled).toBe(false)
  })
  it('rich menu upload changes only the first page image and checks dimensions',async()=>{
    vi.spyOn(hqTemplatesApi,'uploadImage').mockResolvedValue(media);const value=freshDefinition('rich_menu') as RichMenuDefinition;value.richMenu.pages.push({...value.richMenu.pages[0],id:'second',imageR2Key:'keep'});const onChange=vi.fn();
    render(<TemplateDefinitionEditor type="rich_menu" value={value} disabled={false} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('リッチメニュー画像を選ぶ'),{target:{files:[new File(['fixture'],'a.png',{type:'image/png'})]}})
    await waitFor(()=>expect(onChange).toHaveBeenCalled());const next=onChange.mock.calls[0][0];expect(next.richMenu.pages[0].imageR2Key).toBe(media.r2Key);expect(next.richMenu.pages[1]).toEqual(value.richMenu.pages[1]);expect(value.richMenu.pages[0].imageR2Key).toBe('')
  })
  it('late upload cannot modify another screen after navigation',async()=>{
    let finish!:(v:typeof media)=>void;vi.spyOn(hqTemplatesApi,'uploadImage').mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const onChange=vi.fn(),busy=vi.fn();
    const {unmount}=render(<TemplateDefinitionEditor type="rich_menu" value={freshDefinition('rich_menu')} disabled={false} onChange={onChange} onBusyChange={busy} />)
    fireEvent.change(screen.getByLabelText('リッチメニュー画像を選ぶ'),{target:{files:[new File(['fixture'],'a.png',{type:'image/png'})]}});unmount();finish(media);await Promise.resolve();expect(onChange).not.toHaveBeenCalled();expect(busy).toHaveBeenLastCalledWith(false)
  })
  it('combined image budget is enforced before changing the editor value',()=>{
    const value=freshDefinition('template') as MessageTemplateDefinition;value.media=[{...media,id:'old',sizeBytes:16*1024*1024}];expect(()=>withUploadedImage(value,media)).toThrow('16 MiB');expect(value.media).toHaveLength(1)
  })
})
