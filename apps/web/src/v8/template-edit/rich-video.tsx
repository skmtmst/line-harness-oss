'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { validateImagemapMessage, type Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle, usePageCrumbs } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import { AttachmentRow } from '@/components/shared/file-drop'
import MediaSlot from '@/components/shared/media-slot'
import FolderSelect, { folderById } from '@/components/shared/folder-select'
import HelpTip from '@/components/shared/help-tip'
import LinePreview from '@/components/shared/line-preview'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { TextField } from '@/components/shared/text-field'
import { TemplateEditFrame } from './frame'
import type { TemplateEditHost } from './host'
import { RICH_VIDEO_BUTTON_LABELS, richVideoContent, richVideoDraftIssue, videoPreviewFile, type RichVideoDraft, type RichVideoIssue } from './rich-video-core'
import styles from './edit.module.css'
import videoStyles from './rich-video.module.css'
import { Field } from '@/components/shared/form-controls'

const emptyDraft: RichVideoDraft = {name:'',folderId:'',originalContentUrl:'',previewImageUrl:'',height:1040,buttonEnabled:true,actionLabel:'詳しく見る',actionUrl:'',altText:''}

export default function TemplateRichVideoEditor({ id = null, visual = false, host }: { id?: string | null; visual?: boolean; host?: TemplateEditHost }) {
  const router = useRouter()
  const { selectedAccountId, accounts } = useAccount()
  const role = useStaffRole()
  const canMutate = canManageRole(role)
  usePageTitle(host?.composer ? null : id ? 'リッチビデオを編集' : 'リッチビデオを作る', !host?.composer)
  usePageCrumbs([{label:'ホーム',href:'/'},{label:'テンプレート',href:'/templates'}], !host)
  const [draft,setDraft] = useState<RichVideoDraft>(() => visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft)
  const [folders,setFolders] = useState<Folder[]>([])
  const [error,setError] = useState('')
  const [issue,setIssue] = useState<RichVideoIssue | null>(null)
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(Boolean(id))
  const [loadFailed,setLoadFailed] = useState(false)
  const [previewOpen,setPreviewOpen] = useState(false)
  const [needsImage,setNeedsImage] = useState(false)
  const [fileName,setFileName] = useState('')
  const [binding,setBinding] = useState<string | null>(null)
  const [savedId,setSavedId] = useState(id)
  const snapshot = JSON.stringify(draft)
  const [clean,setClean] = useState(snapshot)
  const { leaveTarget,confirmLeave,cancelLeave,disarm,guarded } = useUnsavedGuard({dirty:snapshot !== clean,busy})
  const generation = useRef(0)
  const saveLock = useRef(false)
  const patch = (next: Partial<RichVideoDraft>) => {setIssue(null);setDraft(current=>({...current,...next}))}

  useEffect(()=> {
    setFolders([])
    if (!selectedAccountId) return
    let cancelled = false
    void api.folders.list('template',selectedAccountId).then(res=>{if(!cancelled && res.success)setFolders(res.data)}).catch(()=>undefined)
    return ()=>{cancelled=true}
  },[selectedAccountId])
  // アカウントを替えた後の動画・画像のアップロード結果を受け取らない。
  useEffect(()=>{generation.current++;if(!id){setDraft(visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft);setSavedId(null);setFileName('');setNeedsImage(false);setBusy(false);setClean(JSON.stringify(visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft));setIssue(null);setError('')}},[selectedAccountId,id,visual])
  useEffect(()=> {
    const current = ++generation.current
    if (!id) {
      const initial = host?.initialContent
      if (initial?.kind === 'message' && initial.messageType === 'imagemap') {
        try { const p = JSON.parse(initial.messageContent); if (p.video) { const next: RichVideoDraft = {name:initial.name,folderId:'',originalContentUrl:p.video.originalContentUrl,previewImageUrl:p.video.previewImageUrl,height:p.baseSize.height,buttonEnabled:Boolean(p.video.externalLink),actionLabel:p.video.externalLink?.label??'詳しく見る',actionUrl:p.video.externalLink?.linkUri??'',altText:p.altText??''};setDraft(next);setClean(JSON.stringify(next));setLoading(false);return ()=>{generation.current++} } } catch { setError('動画の中身を読み込めませんでした。') }
      }
      setDraft(visual ? {...emptyDraft,name:'新メニュー紹介の動画',actionUrl:'https://nen-petfood.jp/new-menu',altText:'新メニューの動画が届きました'} : emptyDraft)
      setBinding(null); setSavedId(null); setLoading(false)
      return ()=>{generation.current++}
    }
    setLoading(true); setLoadFailed(false)
    void api.templates.get(id).then(res=> {
      if(current !== generation.current)return
      if(!res.success)throw new Error('読み込めませんでした')
      const p=JSON.parse(res.data.messageContent)
      if(res.data.messageType !== 'imagemap' || !p.video || validateImagemapMessage(p))throw new Error('リッチビデオではありません')
      const next: RichVideoDraft={name:res.data.name,folderId:res.data.folderId??'',originalContentUrl:p.video.originalContentUrl,previewImageUrl:p.video.previewImageUrl,height:p.baseSize.height,buttonEnabled:Boolean(p.video.externalLink),actionLabel:p.video.externalLink?.label??'詳しく見る',actionUrl:p.video.externalLink?.linkUri??'',altText:p.altText??''}
      setDraft(next);setClean(JSON.stringify(next));setBinding(res.data.accountId??null);setSavedId(id)
    }).catch(()=>{if(current===generation.current){setLoadFailed(true);setError('読み込めませんでした。一覧から開き直してください。')}}).finally(()=>{if(current===generation.current)setLoading(false)})
    return ()=>{generation.current++}
  },[id,visual,selectedAccountId])


  const upload = async (file: File, image = false) => {
    if(!canMutate || !selectedAccountId || busy)return
    if(image ? !['image/jpeg','image/png'].includes(file.type) || file.size>1024*1024 : file.type!=='video/mp4' || file.size>200*1024*1024){setIssue({field:image?'preview':'video',message:image?'プレビュー画像はJPEG・PNG、1MBまでです。':'動画はMP4・200MBまでです。'});return}
    const current = generation.current
    setBusy(true);setError('')

    try {
      const res=await api.broadcastMessageAssets.upload(file,selectedAccountId)
      if(current!==generation.current)return
      if(!res.success)throw new Error(res.error||'アップロードできませんでした')
      if(image){patch({previewImageUrl:res.data.url});setNeedsImage(false);return}
      patch({originalContentUrl:res.data.url,previewImageUrl:''});setNeedsImage(false);setFileName(file.name)
      try {
        const preview = await videoPreviewFile(file)
        if(current!==generation.current)return
        const uploaded = await api.broadcastMessageAssets.upload(preview.file,selectedAccountId)
        if(current!==generation.current)return
        if(!uploaded.success)throw new Error('画像を追加してください')
        patch({previewImageUrl:uploaded.data.url,height:preview.height})
      } catch {if(current===generation.current)setNeedsImage(true)}
    } catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:'アップロードできませんでした。選び直してください。')}
    finally{if(current===generation.current)setBusy(false)}
  }
  const mismatch = Boolean(id && binding !== selectedAccountId)
  const save = async (alsoSave = false) => {
    if(saveLock.current || !canMutate || busy || loading || loadFailed || mismatch || !selectedAccountId)return
    const validation = richVideoDraftIssue(draft)
    if(validation){
      setError('');setIssue(validation)
      requestAnimationFrame(()=>{const element=document.getElementById(`rv-${validation.field}`);element?.focus();element?.scrollIntoView?.({block:'center',behavior:'smooth'})})
      return
    }
    const current = generation.current
    if (host?.composer && !alsoSave) {
      const initial = host.initialContent
      let content: ReturnType<typeof richVideoContent> | null = null
      if (initial?.kind === 'message') {
        try { content = JSON.parse(initial.messageContent) } catch { /* 保存済みの画像の組を読めない。 */ }
      }
      if (initial?.kind !== 'message' || !content?.video || content.video.originalContentUrl !== draft.originalContentUrl || content.video.previewImageUrl !== draft.previewImageUrl || content.baseSize.height !== draft.height) {
        setError('新しいリッチビデオを入れるには「テンプレートとしても保存する」にチェックを入れてください。');return
      }
      saveLock.current = true;setBusy(true);setError('')
      try {
        const inserted = await host.onSave({...initial,name:draft.name.trim(),messageContent:JSON.stringify({...content,altText:draft.altText.trim(),video:richVideoContent(draft).video})},false)
        if (current === generation.current && inserted !== false) disarm()
      } catch { if(current===generation.current)setError('この吹き出しに入れられませんでした。もう一度お試しください。') }
      finally {saveLock.current=false;if(current===generation.current)setBusy(false)}
      return
    }
    saveLock.current=true;setBusy(true);setError('')
    try{
      const data = {category:'general',name:draft.name.trim(),folderId:draft.folderId||null,messageType:'imagemap',messageContent:JSON.stringify(richVideoContent(draft))}
      const res = savedId ? await api.templates.update(savedId,data) : await api.templates.create({...data,accountId:selectedAccountId})
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
      setClean(snapshot);disarm();if (!host) router.push('/templates')
    }catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:'保存できませんでした。もう一度お試しください。')}
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
  return <>
    <TemplateEditFrame composerHost={host ? { ...host, busy: busy || loading || Boolean(host.busy), onCancel: () => guarded(host.onCancel) } : undefined} onComposerInsert={(alsoSave)=>void save(alsoSave)} boardId="oIFk7" title={id?'リッチビデオを編集':'リッチビデオを作る'} description="トーク画面で自動で流れる動画。見終わったらボタンで案内" side={side}
      band={!canMutate && role ? <p className={styles.readonly} role="status">閲覧のみで見ています。変える操作は管理者に頼んでください。</p>:undefined}
      footerActions={canMutate?<><Button href="/templates">キャンセル</Button><Button variant="primary" onClick={()=>void save()} disabled={busy||loading||loadFailed||mismatch||!selectedAccountId} busy={busy} busyLabel="保存中…">保存する</Button></>:undefined}>
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      {mismatch?<p className={styles.readonly} role="status">このテンプレートのLINEアカウントに切り替えてから保存してください。</p>:null}
      {loading?<p role="status">読み込み中…</p>:null}
      <Card padding="none" layout="vertical" className={styles.card}><h2 className={styles.cardTitle}>名前とフォルダ</h2><div className={styles.pair}><div className={`${styles.field} ${styles.grow}`}><Field label="テンプレート名" htmlFor="rv-name"><TextField id="rv-name" invalid={issue?.field==='name'} aria-describedby={issue?.field==='name'?'rv-name-error':undefined} value={draft.name} onChange={e=>patch({name:e.target.value})} disabled={!canMutate||busy||loading||loadFailed}/>
{fieldError('name')}</Field></div><div className={`${styles.field} ${styles.folderField}`}><Field label="フォルダ" htmlFor="rv-folder">{canMutate?<FolderSelect size="full" id="rv-folder" aria-label="フォルダ" value={draft.folderId} onChange={value=>patch({folderId:value})} folders={folders.map(folderById)} disabled={busy||loading||loadFailed}/>:<span>{folders.find(f=>f.id===draft.folderId)?.name??'未分類'}</span>}</Field></div></div></Card>
      <Card padding="none" layout="vertical" className={styles.card}><div className={styles.cardHead}><h2 className={styles.cardTitle}>動画</h2><p className={styles.cardNote}>縦長・横長・正方形のどれでも。トーク画面では自動で流れます</p></div>
        <div id="rv-video" tabIndex={-1}>{canMutate && !loadFailed ? <MediaSlot kind="video" title="動画を追加" value={draft.originalContentUrl||null} valueName={fileName||undefined} accept="video/mp4" limitText="1ファイル200メガバイト以内・MP4・縦長 / 横長 / 正方形" busy={busy} error={issue?.field==='video'?issue.message:undefined} disabled={loading||mismatch} onFile={file=>void upload(file)} onRemove={()=>{patch({originalContentUrl:'',previewImageUrl:''});setFileName('');setNeedsImage(false)}}/>:null}</div>
        {fileName?<AttachmentRow name={fileName} meta={draft.previewImageUrl?'プレビュー画像も作りました':'プレビュー画像を追加してください'}/>:null}
        {(needsImage || issue?.field==='preview')?<div id="rv-preview" tabIndex={-1} className={videoStyles.previewSlot}>{needsImage && canMutate?<MediaSlot size="compact" title="プレビュー画像を追加" previewAlt="動画のプレビュー画像" value={draft.previewImageUrl||null} accept="image/png,image/jpeg" limitText="1MB 以内" error={issue?.field==='preview'?issue.message:undefined} disabled={busy||mismatch} onFile={file=>void upload(file,true)}/>:fieldError('preview')}<p className={styles.cardNote}>動画から画像を作れませんでした。動画と同じ縦横比の JPEG・PNG（1MBまで）を入れてください。</p></div>:null}
      </Card>
      <Card padding="none" layout="vertical" className={styles.card}><div className={styles.toggleRow}><h2 className={styles.cardTitle}>見終わったあとのボタン</h2><HelpTip label="見終わったあとのボタンの説明">動画の再生が終わったあとに、リンクを開くボタンを出します。</HelpTip><span className={styles.spacer}/><span className={styles.toggleLabelSmall}>{draft.buttonEnabled?'出す':'出さない'}</span>{canMutate?<Toggle checked={draft.buttonEnabled} label="見終わったあとのボタンを出す" onChange={value=>patch({buttonEnabled:value})} disabled={busy||loading||loadFailed}/>:null}</div>
        {draft.buttonEnabled?<div className={styles.pair}><div className={`${styles.field} ${styles.folderField}`}><Field label="ボタンの文字" htmlFor="rv-label">{canMutate?<Select size="full" id="rv-label" aria-label="ボタンの文字" value={draft.actionLabel} onChange={value=>patch({actionLabel:value})} options={RICH_VIDEO_BUTTON_LABELS.map(label=>({value:label,label}))} disabled={busy||loading||loadFailed}/>:<span>{draft.actionLabel}</span>}</Field></div><div className={`${styles.field} ${styles.grow}`}><Field label="リンク先URL" htmlFor="rv-actionUrl"><TextField id="rv-actionUrl" type="url" invalid={issue?.field==='actionUrl'} aria-describedby={issue?.field==='actionUrl'?'rv-actionUrl-error':undefined} value={draft.actionUrl} onChange={e=>patch({actionUrl:e.target.value})} placeholder="https://…" disabled={!canMutate||busy||loading||loadFailed}/>
{fieldError('actionUrl')}</Field></div></div>:null}
      </Card>
      <Card padding="none" layout="vertical" className={styles.card}><div className={styles.toggleRow}><h2 className={styles.cardTitle}>通知に出る文（代わりの文）</h2><HelpTip label="通知に出る文の説明">通知やトーク一覧に、動画の代わりに出る文です。</HelpTip></div><TextField id="rv-altText" invalid={issue?.field==='altText'} aria-describedby={issue?.field==='altText'?'rv-altText-error':undefined} aria-label="通知に出る文" value={draft.altText} onChange={e=>patch({altText:e.target.value})} maxLength={1500} disabled={!canMutate||busy||loading||loadFailed}/>{fieldError('altText')}</Card>
    </TemplateEditFrame>
    <Dialog open={previewOpen} title="LINEでの見え方" cancelLabel="閉じる" onCancel={()=>setPreviewOpen(false)}><div className={styles.previewDialog}>{phone}</div></Dialog>
    <UnsavedLeaveDialog open={leaveTarget !== null} subject="リッチビデオの変更" onConfirm={confirmLeave} onCancel={cancelLeave}/>
  </>
}
