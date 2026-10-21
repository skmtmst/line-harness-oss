import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'
import { formFromSettings } from '@/v8/auto-replies/edit/wizard-model'
import { buildWizardInput } from '@/v8/auto-replies/edit/wizard-input'
import type { AutoReplyDraftInput } from '@line-crm/shared'
const EDIT = readUiSource(new URL('../../v8/auto-replies/edit/wizard.tsx', import.meta.url), 'utf8')
const LIST = readUiSource(new URL('../../v8/auto-replies/list.tsx', import.meta.url), 'utf8')
const settings: AutoReplyDraftInput = {
  keyword:'予約',matchType:'contains',responseType:'text',responseContent:'承りました',templateId:null,lineAccountId:'account-a',
  activeFrom:null,activeUntil:null,cooldownMinutes:null,skipWhenOperatorActive:false,priority:2,messageKinds:null,friendConditions:null,
  actions:null,responseWeekdays:null,responseHolidayRule:null,oncePerFriend:false,keywords:null,respondToAll:false,name:'予約変更',
  keywordMatchMode:'any',folderId:'folder-a',internalMemo:'一次対応',replyDelaySeconds:30,unmatchedAction:{type:'notify_operator'},
}
describe('自動応答の設定の復元と保存',()=>{
  it('一覧は現行編集へ進み、版管理の設定を共通の変換で復元する',()=>{
    expect(LIST).toContain('/auto-replies/edit?id=')
    expect(EDIT).toContain('formFromSettings(version.settings)')
  })
  it('呼ぶ側が個別に項目を並べ直さない',()=>{
    expect(LIST).not.toContain('keywordMatchMode: r.keywordMatchMode')
    expect(EDIT).not.toContain('keywordMatchMode: res.data.keywordMatchMode')
  })
  it('メモ・所属・後続処理を実際の保存本文まで引き継ぐ',()=>{
    const form=formFromSettings(settings)
    const input=buildWizardInput({accounts:[],form,matchedAccountId:settings.lineAccountId,selectedAccountId:null,templates:[]})
    expect(input).toMatchObject({folderId:'folder-a',internalMemo:'一次対応',replyDelaySeconds:30,unmatchedAction:{type:'notify_operator'}})
  })
  it('曜日・複数キーワード・友だち条件を復元する',()=>{
    const form=formFromSettings({...settings,responseWeekdays:[5],keywords:[{keyword:'予約',matchType:'contains'},{keyword:'変更',matchType:'contains'}],friendConditions:{operator:'AND',rules:[{type:'tag_exists',value:'tag-a'}],groups:[]}})
    expect(form.weekdays).toEqual([5])
    expect(form.keywordRules.map(rule=>rule.keyword)).toEqual(['予約','変更'])
    expect(form.friendTarget).toBe('filtered')
  })
  it('フォルダ内のルールを開いても未分類へ移さない',()=>{
    expect(formFromSettings(settings).folderId).toBe('folder-a')
  })

})
