// @vitest-environment happy-dom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AccountWithStats } from '@/contexts/account-context'
import AccountBrowser from './account-browser-v8'
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
afterEach(cleanup)
const accounts = Array.from({length: 23}, (_, i): AccountWithStats => ({id:`a${i}`,name:`店舗${String(i).padStart(2,'0')}`,channelId:`channel${i}`,basicId:`@shop${i}`,isActive:true,country:null,role:i === 11 ? 'viewer' : 'owner',displayOrder:i,connection:{status:i === 11 ? 'warn' : 'ok',checkedAt:null},stats:{friendCount:i,messagesThisMonth:i*2,activeScenarios:0,staffCount:1}}))
describe('V8 統括のアカウントを探す', () => {
 it('2ページ目のアカウントへ入る時は表示した行のIDを渡す', () => {
  const select = vi.fn()
  render(<AccountBrowser accounts={accounts} onSelect={select} onSettings={vi.fn()} />)
  expect(screen.queryByText('店舗10')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'2ページ目へ'}))
  fireEvent.click(screen.getAllByRole('button',{name:'このアカウントへ入る'})[0])
  expect(select).toHaveBeenCalledWith('a10')
  expect(screen.getByText(/11〜20件/)).toBeTruthy()
 })
 it('LINE ID検索でページを戻し、閲覧者の設定ボタンを無効にする', () => {
  const settings = vi.fn()
  render(<AccountBrowser accounts={accounts} onSelect={vi.fn()} onSettings={settings} />)
  fireEvent.click(screen.getByRole('button',{name:'3ページ目へ'}))
  fireEvent.change(screen.getByRole('searchbox',{name:'アカウントを検索'}),{target:{value:'@shop11'}})
  expect(screen.getByText('店舗11')).toBeTruthy()
  expect(screen.getByRole('button',{name:'設定'}).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'設定'}))
  expect(settings).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('searchbox',{name:'アカウントを検索'}),{target:{value:''}})
  expect(screen.getByText('店舗00')).toBeTruthy()
  expect(screen.getByRole('button',{name:'1ページ目へ'}).getAttribute('aria-current')).toBe('page')
 })
 it('接続状態の絞り込みと表へ切り替えても同じアカウントを表示する', () => {
  render(<AccountBrowser accounts={accounts} onSelect={vi.fn()} onSettings={vi.fn()} />)
  fireEvent.click(screen.getByRole('button',{name:/^要確認/}))
  fireEvent.click(screen.getByRole('button',{name:'表'}))
  expect(screen.getAllByRole('row')).toHaveLength(2)
  expect(screen.getByText('店舗11')).toBeTruthy()
  expect(screen.queryByText('店舗00')).toBeNull()
 })
})
