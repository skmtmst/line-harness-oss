'use client'
import { notifySaved } from '@/components/shared/toast'
import { createPageReturnHref } from '@/components/shared/create-page'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { validateImagemapMessage, type Folder, type MessageTemplateMediaDefinition } from '@line-crm/shared'
import { api } from '@/lib/api'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { useStaffRole } from '@/lib/staff-role'
import { useFeatureAccess } from '@/lib/use-feature-access'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle, usePageCrumbs } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import { AttachmentRow } from '@/components/shared/file-drop'
import MediaSlot from '@/components/shared/media-slot'
import FolderSelect, { folderById, hostFolderCreate } from '@/components/shared/folder-select'
import HelpTip from '@/components/shared/help-tip'
import LinePreview from '@/components/shared/line-preview'
import Select from '@/components/shared/select'
import { SettingCheckbox } from '@/components/shared/checkbox'
import { TextField } from '@/components/shared/text-field'
import { TemplateEditFrame } from './frame'
import type { TemplateEditHost } from './host'
import { RICH_VIDEO_BUTTON_LABELS, richVideoContent, richVideoDraftIssue, videoPreviewFile, type RichVideoDraft, type RichVideoIssue } from './rich-video-core'
import styles from './edit.module.css'
import videoStyles from './rich-video.module.css'
import { Field } from '@/components/shared/form-controls'
import { permissionDeniedMessage } from '@/components/shared/api-error-message'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'

const emptyDraft: RichVideoDraft = {name:'',folderId:'',originalContentUrl:'',previewImageUrl:'',height:1040,buttonEnabled:true,actionLabel:'詳しく見る',actionUrl:'',altText:''}

export default function TemplateRichVideoEditor({ id = null, visual = false, host }: { id?: string | null; visual?: boolean; host?: TemplateEditHost }) {
  const saveErrors = useSaveFormErrors()
  const router = useRouter()
  const { selectedAccountId, accounts } = useAccount()
  const role = useStaffRole()
  const hqHost = Boolean(host && !host.composer)
  const scopeAccountId = hqHost ? null : selectedAccountId
  const featureAccess = useFeatureAccess('templates')
  const canMutate = host ? !host.readOnly : featureAccess
  usePageTitle(host?.composer ? null : id ? 'リッチビデオを編集' : 'リッチビデオを作る', !host?.composer)
  usePageCrumbs([{label:'ホーム',href:'/'},{label:'テンプレート',href:'/templates'}], !host)
  const [draft,setDraft] = useState<RichVideoDraft>(() => visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft)
  const [folders,setFolders] = useState<Folder[]>([])
  const [error,setError] = useState('')
  const [issue,setIssue] = useState<RichVideoIssue | null>(null)
  const [localBusy,setBusy] = useState(false)
  const busy = localBusy || Boolean(host?.busy)
  const media = useRef<MessageTemplateMediaDefinition[]>([])
  const baseUrl = useRef('')
  const [loading,setLoading] = useState(Boolean(id))
  const [loadFailed,setLoadFailed] = useState(false)
  const [previewOpen,setPreviewOpen] = useState(false)
  const [needsImage,setNeedsImage] = useState(false)
  const [fileName,setFileName] = useState('')
  const [binding,setBinding] = useState<string | null>(null)
  const [savedId,setSavedId] = useState(id)
  const snapshotOf = (value: RichVideoDraft) => JSON.stringify(hqHost ? {...value,folderId:host!.folder} : value)
  const snapshot = snapshotOf(draft)
  const [clean,setClean] = useState(snapshot)
  const { leaveTarget,confirmLeave,cancelLeave,disarm,guarded } = useUnsavedGuard({dirty:snapshot !== clean,busy})
  const generation = useRef(0)
  const saveLock = useRef(false)
  const patch = (next: Partial<RichVideoDraft>) => {setIssue(null);setDraft(current=>({...current,...next}))}

  useEffect(()=> {
    setFolders([])
    if (host || !scopeAccountId) return
    let cancelled = false
    void api.folders.list('template',scopeAccountId).then(res=>{if(!cancelled && res.success)setFolders(res.data)}).catch(()=>undefined)
    return ()=>{cancelled=true}
  },[scopeAccountId,Boolean(host)])
  // アカウントを替えた後の動画・画像のアップロード結果を受け取らない。
  useEffect(()=>{generation.current++;if(!id){setDraft(visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft);setSavedId(null);setFileName('');setNeedsImage(false);setBusy(false);setClean(snapshotOf(visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft));setIssue(null);setError('')}},[scopeAccountId,id,visual])
  useEffect(()=> {
    const current = ++generation.current
    if (!id) {
      const initial = host?.initialContent
      if (initial?.kind === 'rich_video' || (initial?.kind === 'message' && initial.messageType === 'imagemap')) {
        try { const p = JSON.parse(initial.messageContent); if (p.video) { baseUrl.current = p.baseUrl; media.current = initial.kind === 'rich_video' ? [...initial.media] : []; const next: RichVideoDraft = {name:initial.name,folderId:'',originalContentUrl:p.video.originalContentUrl,previewImageUrl:p.video.previewImageUrl,height:p.baseSize.height,buttonEnabled:Boolean(p.video.externalLink),actionLabel:p.video.externalLink?.label??'詳しく見る',actionUrl:p.video.externalLink?.linkUri??'',altText:p.altText??''};setDraft(next);setClean(snapshotOf(next));setLoading(false);return ()=>{generation.current++} } } catch (saveFailure) {
          const fieldFailure = saveErrors.capture(saveFailure)
 { if (!fieldFailure)
 setError('動画の中身を読み込めませんでした。') } }
      }
      setDraft(visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft)
      media.current = []; baseUrl.current = ''; setBinding(null); setSavedId(null); setLoading(false)
      return ()=>{generation.current++}
    }
    setLoading(true); setLoadFailed(false)
    void api.templates.get(id).then(res=> {
      if(current !== generation.current)return
      if(!res.success)throw new Error('読み込めませんでした')
      const p=JSON.parse(res.data.messageContent)
      if(res.data.messageType !== 'imagemap' || !p.video || validateImagemapMessage(p))throw new Error('リッチビデオではありません')
      const next: RichVideoDraft={name:res.data.name,folderId:res.data.folderId??'',originalContentUrl:p.video.originalContentUrl,previewImageUrl:p.video.previewImageUrl,height:p.baseSize.height,buttonEnabled:Boolean(p.video.externalLink),actionLabel:p.video.externalLink?.label??'詳しく見る',actionUrl:p.video.externalLink?.linkUri??'',altText:p.altText??''}
      setDraft(next);setClean(snapshotOf(next));setBinding(res.data.accountId??null);setSavedId(id)
    }).catch(()=>{if(current===generation.current){setLoadFailed(true);setError('読み込めませんでした。一覧から開き直してください。')}}).finally(()=>{if(current===generation.current)setLoading(false)})
    return ()=>{generation.current++}
  },[id,visual,scopeAccountId])


  const upload = async (file: File, image = false) => {
    if(!canMutate || (!hqHost && !selectedAccountId) || busy)return
    if(image ? !['image/jpeg','image/png'].includes(file.type) || file.size>1024*1024 : file.type!=='video/mp4' || file.size>200*1024*1024){setIssue({field:image?'preview':'video',message:image?'プレビュー画像はJPEG・PNG、1MBまでです。':'動画はMP4・200MBまでです。'});return}
    const current = generation.current
    setBusy(true);setError('')

    try {
      if (hqHost) {
        if (!host?.uploadRichVideo || !host.uploadRichVideoPreview) throw new Error('統括の動画取り込みを確認してください。')
        const uploadPreview = async (preview: File) => {
          const uploaded = await host.uploadRichVideoPreview!(preview)
          if (current !== generation.current) return
          media.current = [...media.current.filter(item => item.kind === 'video'), ...uploaded.media]
          baseUrl.current = String(uploaded.payload.baseUrl)
          patch({previewImageUrl:String(uploaded.payload.imageUrl),height:Number((uploaded.payload.baseSize as {height:number}).height)})
          setNeedsImage(false)
        }
        if (image) { await uploadPreview(file); return }
        const video = await host.uploadRichVideo(file)
        if (current !== generation.current) return
        media.current = [video]; baseUrl.current = ''
        patch({originalContentUrl:video.publicUrl ?? '',previewImageUrl:''});setFileName(file.name)
        try {
          const preview = await videoPreviewFile(file)
          if (current === generation.current) await uploadPreview(preview.file)
        } catch { if (current === generation.current) setNeedsImage(true) }
        return
      }
      const res=await api.broadcastMessageAssets.upload(file,selectedAccountId!)
      if(current!==generation.current)return
      if(!res.success)throw new Error(res.error||'アップロードできませんでした')
      if(image){patch({previewImageUrl:res.data.url});setNeedsImage(false);return}
      patch({originalContentUrl:res.data.url,previewImageUrl:''});setNeedsImage(false);setFileName(file.name)
      try {
        const preview = await videoPreviewFile(file)
        if(current!==generation.current)return
        const uploaded = await api.broadcastMessageAssets.upload(preview.file,selectedAccountId!)
        if(current!==generation.current)return
        if(!uploaded.success)throw new Error('画像を追加してください')
        patch({previewImageUrl:uploaded.data.url,height:preview.height})
      } catch (saveFailure) {
        saveErrors.capture(saveFailure);
if(current===generation.current)setNeedsImage(true)}
    } catch(cause){
      const fieldFailure = saveErrors.capture(cause);
if(current===generation.current){ if (!fieldFailure)
setError(cause instanceof Error?cause.message:'アップロードできませんでした。選び直してください。') }}
    finally{if(current===generation.current)setBusy(false)}
  }
  const mismatch = Boolean(id && binding !== selectedAccountId)
  const save = async (alsoSave = false, distribute = true) => {
    if(saveLock.current || !canMutate || busy || loading || loadFailed || mismatch || (!hqHost && !selectedAccountId))return
    const validation = richVideoDraftIssue(draft)
    if(validation){
      setError('');setIssue(validation)
      requestAnimationFrame(()=>{const element=document.getElementById(`rv-${validation.field}`);element?.focus();element?.scrollIntoView?.({block:'center',behavior:'smooth'})})
      return
    }
    const current = generation.current
    if (hqHost && host) {
      const content = {...richVideoContent(draft),baseUrl:baseUrl.current}
      if (!media.current.some(item => item.kind === 'video' && item.publicUrl === draft.originalContentUrl) || !media.current.some(item => item.publicUrl === draft.previewImageUrl) || validateImagemapMessage(content)) {
        setError('統括の動画とプレビュー画像を取り込み直してください。');return
      }
      saveLock.current = true;setBusy(true);setError('')
      try {
        const saved = await host.onSave({kind:'rich_video',name:draft.name.trim(),messageContent:JSON.stringify(content),media:[...media.current]},distribute)
        if (current === generation.current && saved !== false) {setClean(snapshot);disarm()}
      } catch (cause) { if (current === generation.current && !saveErrors.capture(cause)) setError(japaneseDetailOf(cause) || '保存できませんでした。もう一度お試しください。') }
      finally {saveLock.current=false;if(current===generation.current)setBusy(false)}
      return
    }
    if (host?.composer && !alsoSave) {
      const initial = host.initialContent
      let content: ReturnType<typeof richVideoContent> | null = null
      if (initial?.kind === 'message') {
        try { content = JSON.parse(initial.messageContent) } catch (saveFailure) {
          saveErrors.capture(saveFailure) /* 保存済みの画像の組を読めない。 */ }
      }
      if (initial?.kind !== 'message' || !content?.video || content.video.originalContentUrl !== draft.originalContentUrl || content.video.previewImageUrl !== draft.previewImageUrl || content.baseSize.height !== draft.height) {
        setError('新しいリッチビデオを入れるには「テンプレートとしても保存する」にチェックを入れてください。');return
      }
      saveLock.current = true;setBusy(true);setError('')
      try {
        const inserted = await host.onSave({...initial,name:draft.name.trim(),messageContent:JSON.stringify({...content,altText:draft.altText.trim(),video:richVideoContent(draft).video})},false)
        if (current === generation.current && inserted !== false) disarm()
      } catch (saveFailure) {
        const fieldFailure = saveErrors.capture(saveFailure);
 if(current===generation.current){ if (!fieldFailure)
setError('この吹き出しに入れられませんでした。もう一度お試しください。') } }
      finally {saveLock.current=false;if(current===generation.current)setBusy(false)}
      return
    }
    saveLock.current=true;setBusy(true);setError('')
    try{
      const data = {category:'general',name:draft.name.trim(),folderId:draft.folderId||null,messageType:'imagemap',messageContent:JSON.stringify(richVideoContent(draft))}
      const res = savedId ? await api.templates.update(savedId,data) : await api.templates.create({...data,accountId:selectedAccountId!})
      if(current !== generation.current)return
      if(!res.success)throw new Error(res.error||'保存できませんでした')
      setSavedId(res.data.id)
      if (host?.composer) {
        const saved = await api.templates.get(res.data.id)
        if(current !== generation.current)return
        if (!saved.success) throw new Error('保存した動画を確認できませんでした。もう一度お試しください。')
        const inserted = await host.onSave({kind:'message',name:draft.name.trim(),messageType:'imagemap',messageContent:saved.data.messageContent}, alsoSave)
        if (inserted === false) return
      }
      setClean(snapshot);
      if (host) disarm()
      else { notifySaved(); if (!id) { disarm(); router.push(createPageReturnHref('/templates', res.data.id)) } }
    }catch(cause){
      const fieldFailure = saveErrors.capture(cause);
if(current===generation.current){ if (!fieldFailure)
setError(cause instanceof Error?cause.message:'保存できませんでした。もう一度お試しください。') }}
    finally{saveLock.current=false;if(current===generation.current)setBusy(false)}
  }
  const fieldError=(field:RichVideoIssue['field'])=>issue?.field===field?<p id={`rv-${field}-error`} className={styles.error}>{issue.message}</p>:null
  const accountName=accounts.find(a=>a.id===selectedAccountId)?.name??'公式アカウント'
  const phone=<LinePreview note="リッチビデオの見え方" caption="配信日 10:00" accountName={accountName}>
    <div className={styles.assetRow}><span className={styles.assetAvatar} aria-hidden="true">{accountName.slice(0,1)}</span><div className={videoStyles.bubble}>
      <div className={videoStyles.video}>{draft.previewImageUrl ? <video src={draft.originalContentUrl} poster={draft.previewImageUrl} controls playsInline aria-label="動画のプレビュー"/> : <span className={videoStyles.play}><Play size={20} aria-hidden="true"/></span>}</div>
      {draft.buttonEnabled?<span className={videoStyles.action}>{draft.actionLabel}</span>:null}
    </div></div>
  </LinePreview>
  const side=<><div className={styles.previewToggle}><Button onClick={()=>setPreviewOpen(true)}>LINEでの見え方を見る</Button></div><section className={styles.sideCard}><h2 className={styles.sideTitle}>リッチメッセージとの違い</h2><p className={styles.sideText}>リッチビデオはトークで自動で流れる動画です。画像を面に分けて押した所ごとに動かしたいときは、リッチメッセージを使います。</p></section><h2 className={styles.previewHead}>届き方</h2><div className={styles.phone}>{phone}</div></>
  return <SaveErrorScope errors={saveErrors}><>
    <TemplateEditFrame composerHost={host ? { ...host, busy: busy || loading || Boolean(host.busy), onCancel: () => guarded(host.onCancel) } : undefined} onComposerInsert={(alsoSave)=>void save(alsoSave)} boardId={hqHost?'Ni0V8':'oIFk7'} title={id?'リッチビデオを編集':'リッチビデオを作る'} description={host?.description ?? 'トーク画面で自動で流れる動画。見終わったらボタンで案内'} side={side}
      band={!canMutate && role ? <p className={styles.readonly} role="status">閲覧のみで見ています。変える操作はオーナーか管理者に頼んでください。</p>:undefined}
      footerActions={canMutate?<>{hqHost && host ? <Button disabled={busy} onClick={()=>guarded(host.onCancel)}>キャンセル</Button> : <Button href="/templates">キャンセル</Button>}{hqHost?<Button onClick={()=>void save(false,false)} disabled={busy||loading||loadFailed}>下書きを保存</Button>:null}<Button variant="primary" onClick={()=>void save()} disabled={busy||loading||loadFailed||mismatch||(!hqHost&&!selectedAccountId)} busy={busy} busyLabel="保存中…">{hqHost?host?.primaryLabel??'保存して配る':'保存する'}</Button></>:undefined}>
      {host?.notice}
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      {mismatch?<p className={styles.readonly} role="status">このテンプレートのLINEアカウントに切り替えてから保存してください。</p>:null}
      {loading?<p role="status">読み込み中…</p>:null}
      <Card padding="none" layout="vertical" className={styles.card}><h2 className={styles.cardTitle}>名前とフォルダ</h2><div className={styles.pair}><div className={`${styles.field} ${styles.grow}`}><Field label="テンプレート名" htmlFor="rv-name"><SaveErrorField names={["name","draft.name"]}><TextField id="rv-name" invalid={issue?.field==='name'} aria-describedby={issue?.field==='name'?'rv-name-error':undefined} value={draft.name} onChange={e=>patch({name:e.target.value})} disabled={!canMutate||busy||loading||loadFailed}/></SaveErrorField>{fieldError('name')}</Field></div><div className={`${styles.field} ${styles.folderField}`}><Field label="フォルダ" htmlFor="rv-folder">{canMutate?<SaveErrorField names={["folderId","draft.folderId","folder_id","draft.folder_id"]}><FolderSelect size="full" id="rv-folder" aria-label="フォルダ" value={hqHost?host!.folder:draft.folderId} onChange={hqHost?host!.onFolderChange:value=>patch({folderId:value})} folders={hqHost?host!.folders:folders.map(folderById)} onCreate={hqHost?hostFolderCreate(host!):undefined} disabled={busy||loading||loadFailed}/></SaveErrorField>:<span>{hqHost?host!.folders.find(f=>f.value===host!.folder)?.label??'未分類':folders.find(f=>f.id===draft.folderId)?.name??'未分類'}</span>}</Field></div></div></Card>
      <Card padding="none" layout="vertical" className={styles.card}><div className={styles.cardHead}><h2 className={styles.cardTitle}>動画</h2><p className={styles.cardNote}>縦長・横長・正方形のどれでも。トーク画面では自動で流れます</p></div>
        <div id="rv-video" tabIndex={-1}>{canMutate && !loadFailed ? <SaveErrorField names={["originalContentUrl","draft.originalContentUrl","original_content_url","draft.original_content_url"]}><MediaSlot kind="video" title="動画を追加" value={draft.originalContentUrl||null} valueName={fileName||undefined} accept="video/mp4" maxBytes={200 * 1024 * 1024} limitText="1ファイル200メガバイト以内・MP4・縦長 / 横長 / 正方形" busy={busy} error={issue?.field==='video'?issue.message:undefined} disabled={loading||mismatch} onFile={file=>void upload(file)} onRemove={()=>{patch({originalContentUrl:'',previewImageUrl:''});setFileName('');setNeedsImage(false);media.current=[];baseUrl.current=''}}/></SaveErrorField>:null}</div>
        {fileName?<AttachmentRow name={fileName} meta={draft.previewImageUrl?'プレビュー画像も作りました':'プレビュー画像を追加してください'}/>:null}
        {(needsImage || issue?.field==='preview')?<div id="rv-preview" tabIndex={-1} className={videoStyles.previewSlot}>{needsImage && canMutate?<SaveErrorField names={["previewImageUrl","draft.previewImageUrl","preview_image_url","draft.preview_image_url"]}><MediaSlot size="compact" title="プレビュー画像を追加" previewAlt="動画のプレビュー画像" value={draft.previewImageUrl||null} accept="image/png,image/jpeg" maxBytes={1 * 1024 * 1024} error={issue?.field==='preview'?issue.message:undefined} disabled={busy||mismatch} onFile={file=>void upload(file,true)}/></SaveErrorField>:fieldError('preview')}<p className={styles.cardNote}>動画から画像を作れませんでした。動画と同じ縦横比の JPEG・PNG（1MBまで）を入れてください。</p></div>:null}
      </Card>
      <Card padding="none" layout="vertical" className={styles.card}><div className={styles.toggleRow}><h2 className={styles.cardTitle}>見終わったあとのボタン</h2><HelpTip label="見終わったあとのボタンの説明">動画の再生が終わったあとに、リンクを開くボタンを出します。</HelpTip><span className={styles.spacer}/><span className={styles.toggleLabelSmall}>{draft.buttonEnabled?'出す':'出さない'}</span>{canMutate?<SaveErrorField names={["buttonEnabled","draft.buttonEnabled","button_enabled","draft.button_enabled"]}><SettingCheckbox checked={draft.buttonEnabled} label="見終わったあとのボタンを出す" onChange={value=>patch({buttonEnabled:value})} disabled={busy||loading||loadFailed}/></SaveErrorField>:null}</div>
        {draft.buttonEnabled?<div className={styles.pair}><div className={`${styles.field} ${styles.folderField}`}><Field label="ボタンの文字" htmlFor="rv-label">{canMutate?<SaveErrorField names={["actionLabel","draft.actionLabel","action_label","draft.action_label"]}><Select size="full" id="rv-label" aria-label="ボタンの文字" value={draft.actionLabel} onChange={value=>patch({actionLabel:value})} options={RICH_VIDEO_BUTTON_LABELS.map(label=>({value:label,label}))} disabled={busy||loading||loadFailed}/></SaveErrorField>:<span>{draft.actionLabel}</span>}</Field></div><div className={`${styles.field} ${styles.grow}`}><Field label="リンク先URL" htmlFor="rv-actionUrl"><SaveErrorField names={["actionUrl","draft.actionUrl","action_url","draft.action_url"]}><TextField id="rv-actionUrl" type="url" invalid={issue?.field==='actionUrl'} aria-describedby={issue?.field==='actionUrl'?'rv-actionUrl-error':undefined} value={draft.actionUrl} onChange={e=>patch({actionUrl:e.target.value})} placeholder="https://…" disabled={!canMutate||busy||loading||loadFailed}/></SaveErrorField>
{fieldError('actionUrl')}</Field></div></div>:null}
      </Card>
      <Card padding="none" layout="vertical" className={styles.card}><div className={styles.toggleRow}><h2 className={styles.cardTitle}>通知に出る文（代わりの文）</h2><HelpTip label="通知に出る文の説明">通知やトーク一覧に、動画の代わりに出る文です。</HelpTip></div><SaveErrorField names={["altText","draft.altText","alt_text","draft.alt_text"]}><TextField id="rv-altText" invalid={issue?.field==='altText'} aria-describedby={issue?.field==='altText'?'rv-altText-error':undefined} aria-label="通知に出る文" value={draft.altText} onChange={e=>patch({altText:e.target.value})} maxLength={1500} disabled={!canMutate||busy||loading||loadFailed}/></SaveErrorField>{fieldError('altText')}</Card>
    </TemplateEditFrame>
    <Dialog open={previewOpen} title="LINEでの見え方" cancelLabel="閉じる" onCancel={()=>setPreviewOpen(false)}><div className={styles.previewDialog}>{phone}</div></Dialog>
    <UnsavedLeaveDialog open={leaveTarget !== null} subject="リッチビデオの変更" onConfirm={confirmLeave} onCancel={cancelLeave}/>
  </></SaveErrorScope>
}
