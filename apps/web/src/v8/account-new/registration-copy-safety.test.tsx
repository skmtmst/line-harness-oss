// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import Step1Precheck from './step1-precheck'
import { toV06CheckRows } from './check-rows'
import type { LineAccountConnectData } from '@/lib/api'
afterEach(cleanup)
it('接続手順の説明は4ステップと案内する', () => {
  render(<Step1Precheck badge="Q1" draftRestored={false} onCloseDraftNotice={()=>{}} precheckAt="q1" onJumpTo={()=>{}} precheck={{q1:'',q2:'',q4:''} as never} onAnswer={()=>{}} rows={[]} guide={null} acks={{}} onToggleAck={()=>{}} />)
  expect(screen.getByText(/アカウント接続：4つのステップ/)).toBeTruthy()
})
it('Webhookをオンにする手順の場所を正しく案内する', () => {
  const connection = {steps:[1,2,3,4,5].map(order=>({order,state:order===3?'failed':'passed',message:''})), verification:{tokenOk:true,loginOk:true,sameProvider:true,webhook:{active:false}}} as unknown as LineAccountConnectData
  const row=toV06CheckRows(connection,{running:false,cursor:5}).find(row=>row.key==='webhook')!
  expect(row.phase).toBe('error')
  expect(row.detail).toContain('下の案内')
  expect(row.detail).not.toContain('上の案内')
})
