'use client'
import {useEffect,useRef,useState} from 'react'
import {DEFAULT_CUSTOMER_LOOK,customerPalette,customerLookError,type CustomerLook} from '@line-crm/shared'
import {SettingsPage} from '@/components/templates/settings-page'
import {SettingsNavV8} from '@/components/layout/settings-nav-v8'
import {usePageTitle,usePageCrumbs,useHideSettingsNav} from '@/components/shell/page-chrome'
import {useAccount} from '@/contexts/account-context'
import {useStaffRole,canManageRole} from '@/lib/staff-role'
import {api} from '@/lib/api'
import {japaneseDetailOf} from '@/components/shared/api-error-message'
import {useUnsavedGuard} from '@/lib/use-unsaved-guard'
import {UnsavedLeaveDialog} from '@/lib/unsaved-leave-dialog'
import {SaveErrorScope,useSaveFormErrors} from '@/components/shared/save-form-errors'
import Card from '@/components/shared/card'
import Button from '@/components/shared/button'
import ColorWell from '@/components/shared/color-well'
import {Field,FieldError} from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import SectionHeader from '@/components/shared/section-header'
import CustomerDesignPicker from '@/components/shared/customer-design-picker'
import CustomerLookPreview from '@/components/shared/customer-look-preview'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import ListState from '@/components/shared/list-state'
import {notifyToast} from '@/components/shared/toast'
export default function CustomerLookScreen() {
 usePageTitle('お客さまの画面のデザイン');usePageCrumbs([{label:'設定',href:'/settings'}]);useHideSettingsNav()
 const {selectedAccountId,selectedAccount}=useAccount();const role=useStaffRole();const canEdit=canManageRole(role)
 const [saved,setSaved]=useState<CustomerLook | null>(null),[draft,setDraft]=useState<CustomerLook>({...DEFAULT_CUSTOMER_LOOK})
 const [version,setVersion]=useState(0),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[error,setError]=useState(''),[saving,setSaving]=useState(false),[retry,setRetry]=useState(0)
 const saveErrors=useSaveFormErrors()
 const generation=useRef(0)
 useEffect(()=>{const request=++generation.current;setStatus('loading');setSaved(null);setError('');setSaving(false)
  if(!selectedAccountId)return
  api.accountSettings.getCustomerLook(selectedAccountId).then(result=>{if(request!==generation.current)return;if(!result.success)throw new Error(result.error);setSaved(result.data.look);setDraft(result.data.look);setVersion(result.data.version);setStatus('ready')}).catch(()=>{if(request===generation.current){setStatus('error');setError('デザインを読み込めませんでした')}})
  return()=>{generation.current++}
 },[selectedAccountId,retry])
 const dirty=!!saved && JSON.stringify(saved)!==JSON.stringify(draft)
 const guard=useUnsavedGuard({dirty,busy:saving})
 const patch=(next:Partial<CustomerLook>)=>{if(canEdit&&!saving)setDraft(current=>({...current,...next}))}
 const save=async()=>{
  if(!canEdit||saving||!selectedAccountId||!saved)return false
  const invalid=customerLookError(draft);if(invalid){setError(invalid);return false}
  const request=generation.current;setSaving(true);setError('')
  try {const result=await api.accountSettings.saveCustomerLook(selectedAccountId,draft,version);if(request!==generation.current)return false;
   if(!result.success||!result.data)throw new Error(result.error??'保存できませんでした');setSaved(result.data.look);setDraft(result.data.look);setVersion(result.data.version);guard.disarm();notifyToast('保存しました');return true
  }catch(failure){if(request===generation.current && !saveErrors.capture(failure))setError(japaneseDetailOf(failure)||'保存できませんでした');return false}
  finally{if(request===generation.current)setSaving(false)}
 }
 return <SaveErrorScope errors={saveErrors}><SettingsPage title="お客さまの画面のデザイン" layout="customer-look" navigation={<SettingsNavV8/>}
  preview={status==='ready'?<CustomerLookPreview look={draft} accountName={selectedAccount?.name??'公式アカウント'}/>:undefined}
  saveStatus={error?<FieldError id="customer-look-save-error">{error}</FieldError>:undefined}
  saveActions={canEdit&&status==='ready'?<><Button disabled={saving||!dirty} onClick={()=>guard.guarded(()=>{if(saved)setDraft(saved);setError('')})}>キャンセル</Button><Button variant="primary" disabled={!dirty} busy={saving} onClick={()=>void save()}>保存する</Button></>:undefined}>
   {!selectedAccountId?<ListState kind="empty" title="店を選んでください"/>:status==='loading'?<ListState kind="loading" title="デザインを読み込んでいます"/>:status==='error'?<ListState kind="error" title={error} action={<Button onClick={()=>setRetry(current=>current+1)}>もう一度読み込む</Button>}/>:<>
    {!canEdit?<ReadOnlyNotice/>:null}
    <Card padding="roomy" layout="vertical" gap="normal"><SectionHeader title="デザインの型" description="型を押すと、右の見本がすぐ変わります"/>
     <CustomerDesignPicker value={draft.preset} columns={2} readOnly={!canEdit||saving} onChange={preset=>patch({preset})}/>
     {draft.preset==='custom'?<><SectionHeader title="カスタムの色と書体"/>
      {canEdit&&!saving?<><Field label="主の色"><ColorWell label="主の色" value={draft.primaryColor??customerPalette(DEFAULT_CUSTOMER_LOOK).main} allowAlpha={false} allowClear={false} onChange={value=>value&&patch({primaryColor:value})}/></Field>
       <Field label="背景の色"><ColorWell label="背景の色" value={draft.backgroundColor??customerPalette(DEFAULT_CUSTOMER_LOOK).background} allowAlpha={false} allowClear={false} onChange={value=>value&&patch({backgroundColor:value})}/></Field>
       <Field label="見出しの書体"><Select aria-label="見出しの書体" value={draft.headingFont} onChange={headingFont=>patch({headingFont:headingFont as CustomerLook['headingFont']})} options={[{value:'default',label:'型に合わせる'},{value:'mincho',label:'明朝'},{value:'marugothic',label:'丸いゴシック'},{value:'sans',label:'ゴシック'}]}/></Field></>:<dl><dt>主の色</dt><dd>{draft.primaryColor??'型に合わせる'}</dd><dt>背景の色</dt><dd>{draft.backgroundColor??'型に合わせる'}</dd><dt>見出しの書体</dt><dd>{draft.headingFont}</dd></dl>}
     </>:null}
    </Card>
   </>}
 </SettingsPage><UnsavedLeaveDialog open={guard.leaveTarget !== null} busy={saving} subject="デザインの変更" onSave={save} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave}/></SaveErrorScope>
}
