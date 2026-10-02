// @vitest-environment happy-dom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import OperatorHistory from '@/components/hq/operator-history'
const fixtures=vi.hoisted(() => ({history:vi.fn()}))
vi.mock('@/lib/api', () => ({api:{operatorHistory:fixtures.history}}))
vi.mock('@/lib/use-admin-theme', () => ({useAdminTheme:() => 'v8'}))
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)
it('記録の読込失敗を空の記録と区別し、読み直した操作を日本時間で表示する', async () => {
 fixtures.history.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({success:true,data:[{id:'log',action:'tenant.status.change',createdAt:'2026-10-02T00:05:00Z',operatorName:'運営担当',reason:'確認のため'}]})
 render(<OperatorHistory />)
 await screen.findByText('操作の記録を読み込めませんでした')
 expect(screen.queryByText('運営による変更の記録はありません。')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'もう一度読み込む'}))
 await screen.findByText('運営が契約の状態を変更しました')
 expect(screen.getByText(/2026\/10\/02.*09:05/)).toBeTruthy()
 expect(fixtures.history).toHaveBeenCalledTimes(2)
})
