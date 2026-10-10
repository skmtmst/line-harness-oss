// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const fx=vi.hoisted(()=>({ detail:vi.fn() }))
vi.mock('next/navigation',()=>({ useSearchParams:()=>new URLSearchParams('id=candidate') }))
vi.mock('@/components/shell/page-chrome',()=>({ usePageTitle:vi.fn(),usePageCrumbs:vi.fn() }))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return { ...actual,api:{ ...actual.api,identityCandidates:{ list:async()=>({ success:true,data:{ items:[{ id:'candidate' }],total:1 } }),getFriendDuplicate:fx.detail } } } })
import Compare from './compare'
afterEach(cleanup)
it('候補一覧成功・詳細失敗で空白にせず理由と詳細の再取得を出す（WEB185）',async()=>{
  fx.detail.mockRejectedValue(new Error('down'))
  render(<Compare />)
  await screen.findByText('候補の詳細を読み込めませんでした')
  expect(screen.queryByText('確認する候補はありません')).toBeNull()
  fireEvent.click(screen.getByRole('button',{ name:'もう一度読み込む' }))
  await screen.findByText('候補の詳細を読み込めませんでした')
  expect(fx.detail.mock.calls.length).toBeGreaterThan(1)
})
