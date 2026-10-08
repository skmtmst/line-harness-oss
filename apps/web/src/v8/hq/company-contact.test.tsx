// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read:vi.fn(), save:vi.fn(), postal:vi.fn(), name:vi.fn(), role:'owner' as string|null }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => ({
  ...(await importOriginal()), api:{tenants:{companyContact:mocks.read,saveCompanyContact:mocks.save,me:mocks.name},postalCode:{search:mocks.postal}},
}))
vi.mock('@/lib/staff-role', () => ({useStaffRole:()=>mocks.role}))
vi.mock('@/components/shell/page-chrome', () => ({usePageCrumbs:()=>{},usePageTitle:()=>{}}))
vi.mock('next/navigation', () => ({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=>'/hq/settings',useSearchParams:()=>new URLSearchParams()}))
vi.mock('next/link', () => ({default:({children,href,...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={href} {...props}>{children}</a>}))

import CompanyContactCard from './company-contact'
import HqSettingsV8 from './settings'

const values = {legalCompanyName:'株式会社テスト',postalCode:'1500001',address:'東京都渋谷区神宮前1-2-3',building:null,
  phone:'03-1234-5678',contactName:'山田 太郎',contactEmail:'yamada@example.com',invoiceAddressee:null}
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label.replace(/[（ ）]/g,'\\$&')}`)) as HTMLInputElement
const submit = () => fireEvent.submit(screen.getByRole('form',{name:'会社と連絡先'}))
const loaded = () => waitFor(()=>expect(field('会社名（正式）').value).toBe(values.legalCompanyName))
const renderCard = async (canEdit=true) => {render(<CompanyContactCard canEdit={canEdit}/>);await loaded()}

beforeEach(()=>{
  vi.resetAllMocks();mocks.role='owner'
  mocks.read.mockResolvedValue({success:true,data:{...values,revision:4}})
  mocks.save.mockResolvedValue({success:true,data:{...values,revision:5}})
  mocks.name.mockResolvedValue({success:true,data:{name:'統括の名前'}})
})
afterEach(cleanup)

describe('会社と連絡先の画面の動き',()=>{
  it('編集した8欄と読み込んだ版を保存し、返された値と新しい版を次の保存に使う',async()=>{
    await renderCard()
    fireEvent.change(field('会社名（正式）'),{target:{value:'  新しい正式名  '}})
    fireEvent.change(field('建物名・部屋番号'),{target:{value:'ビル5階'}})
    fireEvent.change(field('請求書の宛名'),{target:{value:'経理部'}})
    mocks.save.mockResolvedValueOnce({success:true,data:{...values,legalCompanyName:'新しい正式名',building:'ビル5階',invoiceAddressee:'経理部',revision:5}})
    submit()
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('会社と連絡先を保存しました。'))
    expect(mocks.save).toHaveBeenCalledWith({...values,legalCompanyName:'新しい正式名',building:'ビル5階',invoiceAddressee:'経理部',expectedRevision:4})
    expect(field('会社名（正式）').value).toBe('新しい正式名')
    fireEvent.change(field('担当者名'),{target:{value:'次の担当者'}})
    submit()
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[1][0].expectedRevision).toBe(5)
  })
  it.each(['ネットワークに接続できません','ほかの人が変更しました。入力を控えて、最新版を読み直してください。','この操作には管理者権限が必要です'])('保存失敗：%sでも入力と版を残す',async error=>{
    await renderCard()
    fireEvent.change(field('担当者名'),{target:{value:'保存前の入力'}})
    mocks.save.mockRejectedValueOnce(new Error(error))
    submit()
    await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy())
    expect(field('担当者名').value).toBe('保存前の入力')
    expect(mocks.read).toHaveBeenCalledTimes(1)
    submit()
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0])
  })
  it('読み込み失敗は保存を止め、再取得が成功するまで空欄で上書きしない',async()=>{
    mocks.read.mockRejectedValueOnce(new Error('読み込めませんでした'))
    render(<CompanyContactCard canEdit/> )
    await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy())
    expect((screen.getByRole('button',{name:'会社と連絡先を保存する'}) as HTMLButtonElement).disabled).toBe(true)
    submit();expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'もう一度読み込む'}))
    await loaded()
    expect((screen.getByRole('button',{name:'会社と連絡先を保存する'}) as HTMLButtonElement).disabled).toBe(false)
  })
  it.each(['会社名（正式）','郵便番号','住所','電話番号','担当者名','担当者のメール'])('必須の%sが空なら送信しない',async label=>{
    await renderCard();fireEvent.change(field(label),{target:{value:' '}});submit()
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('入力してください'))
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('二重保存を防ぎ、通信中に入力を変更させない',async()=>{
    let finish!: (value:unknown)=>void
    mocks.save.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    await renderCard();submit()
    await waitFor(()=>expect(field('担当者名').disabled).toBe(true))
    submit();expect(mocks.save).toHaveBeenCalledTimes(1)
    finish({success:true,data:{...values,revision:5}})
    await waitFor(()=>expect(field('担当者名').disabled).toBe(false))
  })
  it.each(['staff','viewer',null])('役割%sには連絡先カードも読み口も出さない',async role=>{
    mocks.role=role;render(<HqSettingsV8/> )
    await waitFor(()=>expect(mocks.name).toHaveBeenCalled())
    expect(screen.queryByRole('form',{name:'会社と連絡先'})).toBeNull()
    expect(screen.queryByRole('button',{name:'会社と連絡先を保存する'})).toBeNull()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('閲覧のみには保存・検索ボタンを隠す',async()=>{
    await renderCard(false)
    expect(screen.queryByRole('button')).toBeNull()
    expect(field('担当者名').readOnly).toBe(true)
  })
  it('既存の郵便番号の口へ問い合わせ、空の住所に単一候補を入れる',async()=>{
    mocks.read.mockResolvedValue({success:true,data:{...values,address:null,revision:4}})
    mocks.postal.mockResolvedValue({success:true,data:{status:'matched',candidates:[{prefecture:'東京都',city:'渋谷区',town:'神宮前'}],readiness:{fullDataset:true}}})
    await renderCard();fireEvent.click(screen.getByRole('button',{name:'住所を探す'}))
    await waitFor(()=>expect(field('住所').value).toBe('東京都渋谷区神宮前'))
    expect(mocks.postal).toHaveBeenCalledWith('1500001')
  })
  it('手入力の住所は検索だけでは上書きせず、選んだ候補だけを入れる',async()=>{
    mocks.postal.mockResolvedValue({success:true,data:{status:'multiple',candidates:[{prefecture:'東京都',city:'千代田区',town:'千代田'},
      {prefecture:'東京都',city:'千代田区',town:'皇居外苑'}],readiness:{fullDataset:true}}})
    await renderCard();fireEvent.click(screen.getByRole('button',{name:'住所を探す'}))
    const choice=await screen.findByRole('button',{name:'東京都千代田区皇居外苑'})
    expect(field('住所').value).toBe(values.address)
    fireEvent.click(choice);expect(field('住所').value).toBe('東京都千代田区皇居外苑')
  })
  it.each(['郵便番号','住所'])('検索中に%sを変えると古い応答を捨てる',async label=>{
    let finish!:(value:unknown)=>void
    mocks.postal.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    await renderCard();fireEvent.click(screen.getByRole('button',{name:'住所を探す'}))
    fireEvent.change(field(label),{target:{value:'変更した入力'}})
    finish({success:true,data:{candidates:[{prefecture:'東京都',city:'千代田区',town:'千代田'}],readiness:{fullDataset:true}}})
    await waitFor(()=>expect((screen.getByRole('button',{name:'住所を探す'}) as HTMLButtonElement).disabled).toBe(false))
    expect(field(label).value).toBe('変更した入力')
    expect(screen.queryByRole('button',{name:'東京都千代田区千代田'})).toBeNull()
  })
  it('郵便番号データ未登録・検索失敗でも住所を保持して保存できる',async()=>{
    mocks.postal.mockResolvedValueOnce({success:true,data:{candidates:[],readiness:{fullDataset:false}}})
    await renderCard();fireEvent.click(screen.getByRole('button',{name:'住所を探す'}))
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('全データが未登録'))
    expect(field('住所').value).toBe(values.address)
    mocks.postal.mockRejectedValueOnce(new Error('検索失敗'))
    fireEvent.click(screen.getByRole('button',{name:'住所を探す'}))
    await waitFor(()=>expect(screen.getByRole('status').textContent).not.toContain('全データが未登録'))
    expect(field('住所').value).toBe(values.address)
    submit();await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1))
  })
})
