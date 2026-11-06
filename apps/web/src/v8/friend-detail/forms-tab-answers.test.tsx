// @vitest-environment happy-dom
import React from 'react'
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import FormsTab from './forms-tab'
import type { FriendDetailState } from './use-friend-detail'
afterEach(cleanup)
test('住所・予約の回答は人が読める値になり、失われた古い回答は理由を表示する', () => {
  render(<FormsTab data={{ submissionsStatus:'ready', submissions:[{ id:'s',formName:'回答',createdAt:'2026-10-09',fields:[{name:'address',label:'住所'},{name:'booking',label:'予約'},{name:'old',label:'以前の回答'}],data:{ address:{postalCode:'1234567',prefecture:'東京都',city:'新宿区',addressLine1:'1-2'},booking:{menuId:'m',staffId:'s',startsAt:'2026-10-10T01:30:00Z'},old:'[object Object]' } }] } as unknown as FriendDetailState} />)
  expect(screen.getByText('〒123-4567 東京都新宿区1-2')).toBeTruthy()
  expect(screen.getByText('10/10 10:30')).toBeTruthy()
  expect(screen.getByText(/以前の保存で内容が失われています/)).toBeTruthy()
})
