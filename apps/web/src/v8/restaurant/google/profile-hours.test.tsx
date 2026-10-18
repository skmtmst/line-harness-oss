// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { HoursEditor, type HoursMode } from './profile-hours'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), proposeHours: vi.fn(), sendChange: vi.fn(), role: 'owner' }))
vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: mocks }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => mocks.role, canManageRole: (role: string) => role === 'owner' }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
const weekly = Object.fromEntries(['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map((day) => [day, [{ open: '11:00', close: '22:00' }]]))
const data = { store: { name: '対象店舗' }, aiAvailable: true, closed: false, timeZone: 'Asia/Tokyo', today: { date: '2026-10-11', weekday: 'SUNDAY' }, profile: { title: '対象店舗', regularHours: weekly, specialHours: [{ date: '2026-10-12', closed: false, periods: [{ open: '11:00', close: '17:00' }] }] } }
const go = vi.fn()
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'owner'
  mocks.profile.mockResolvedValue(data)
  mocks.proposeHours.mockResolvedValue({ change: { id: 'proposal-1' } })
})
afterEach(cleanup)
async function open(mode: HoursMode = 'text', initialDate = '2026-10-12') {
  render(<HoursEditor accountId="account-1" mode={mode} initialDate={initialDate} go={go} />)
  await screen.findByRole('heading', { name: '営業時間を変更' })
}
async function select(label: string, time: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('button', { name: time, exact: true }))
}

describe('Google営業時間の3方式を現在の共通部品で使う', () => {
  it('文章を変更案にし、質問なら入力を残し、確認へ進むまでGoogleへ送らない', async () => {
    mocks.proposeHours.mockResolvedValueOnce({ question: '何日の営業時間を変えますか？' }).mockResolvedValueOnce({ change: { id: 'proposal-1' } })
    await open()
    fireEvent.change(screen.getByRole('textbox', { name: '文章で入力' }), { target: { value: '  明日は20時に閉店  ' } })
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await screen.findByText('何日の営業時間を変えますか？')
    expect(screen.getByRole('textbox', { name: '文章で入力' })).toHaveProperty('value', '  明日は20時に閉店  ')
    expect(go).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith({ tab: 'profile', view: 'confirm', id: 'proposal-1' }))
    expect(mocks.proposeHours).toHaveBeenCalledWith('account-1', { source: 'text', text: '明日は20時に閉店' })
    expect(mocks.sendChange).not.toHaveBeenCalled()
  })
  it('文章の変更案作成に失敗しても入力を保ち、同じ描画での連打は1要求になる', async () => {
    let fail!: (error: unknown) => void
    mocks.proposeHours.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    await open()
    fireEvent.click(screen.getByRole('button', { name: '今日を休みにして' }))
    const button = screen.getByRole('button', { name: '変更案を確認する' })
    act(() => { button.click(); button.click() })
    expect(mocks.proposeHours).toHaveBeenCalledTimes(1)
    await act(async () => { fail(new ApiError(500, '変更案の作成に失敗しました')) })
    await screen.findByText('変更案の作成に失敗しました')
    expect(screen.getByRole('textbox', { name: '文章で入力' })).toHaveProperty('value', '今日を休みにして')
    expect(screen.getByRole('button', { name: '変更案を確認する' })).toHaveProperty('disabled', false)
  })
  it('カレンダーの指定日だけ休業にし、通常の営業時間を変更しない', async () => {
    await open('calendar')
    fireEvent.click(screen.getByRole('checkbox', { name: 'この日は休業にする' }))
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await waitFor(() => expect(go).toHaveBeenCalled())
    expect(mocks.proposeHours).toHaveBeenCalledWith('account-1', { source: 'calendar', days: [{ date: '2026-10-12', closed: true, periods: [], special: true }] })
    expect(weekly.MONDAY).toEqual([{ open: '11:00', close: '22:00' }])
  })
  it('特別営業時間を外す案を取り消せ、通常の時間へ戻す案を確認に送れる', async () => {
    await open('calendar')
    fireEvent.click(screen.getByRole('button', { name: '特別営業時間を外す（通常の営業時間に戻す）' }))
    fireEvent.click(screen.getByRole('button', { name: '外すのをやめる' }))
    expect(screen.getByRole('button', { name: '変更案を確認する' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '特別営業時間を外す（通常の営業時間に戻す）' }))
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await waitFor(() => expect(mocks.proposeHours).toHaveBeenCalledWith('account-1', { source: 'calendar', days: [{ date: '2026-10-12', closed: false, periods: weekly.MONDAY, remove: true }] }))
  })
  it('日付を選び直しても他の日の変更を保ち、複数日を1つの変更案にまとめる', async () => {
    mocks.profile.mockResolvedValue({ ...data, profile: { ...data.profile, specialHours: [...data.profile.specialHours, { date: '2026-10-13', closed: false, periods: [{ open: '12:00', close: '17:00' }] }] } })
    await open('calendar')
    fireEvent.click(screen.getByRole('checkbox', { name: 'この日は休業にする' }))
    fireEvent.click(within(screen.getByLabelText('登録済みの特別営業時間')).getAllByRole('button')[1])
    fireEvent.click(screen.getByRole('checkbox', { name: 'この日は休業にする' }))
    expect(screen.getByRole('heading', { name: '変更する日（2日）' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await waitFor(() => expect(mocks.proposeHours).toHaveBeenCalledWith('account-1', { source: 'calendar', days: [
      { date: '2026-10-12', closed: true, periods: [], special: true },
      { date: '2026-10-13', closed: true, periods: [], special: true },
    ] }))
  })
  it('営業日の空の枠と同じ開始/終了は送らず、15分刻みの24:00を保存できる', async () => {
    await open('calendar')
    fireEvent.click(screen.getByRole('button', { name: '枠1を削除' }))
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await screen.findByText('営業する日は枠を1つ以上入れてください')
    expect(mocks.proposeHours).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '枠を追加（1日3枠まで）' }))
    await select('枠1の終了', '11:00')
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    expect(mocks.proposeHours).not.toHaveBeenCalled()
    await select('枠1の終了', '24:00')
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await waitFor(() => expect(mocks.proposeHours).toHaveBeenCalledWith('account-1', expect.objectContaining({ source: 'calendar', days: [expect.objectContaining({ periods: [{ open: '11:00', close: '00:00' }] })] })))
  })
  it('毎週の変更は曜日ごとの時間を送り、重なる枠は止め、最後の翌日跨ぎは許す', async () => {
    await open('weekly')
    await select('月曜 枠1の終了', '23:00')
    const monday = screen.getByRole('region', { name: '月曜の営業時間' })
    fireEvent.click(within(monday).getByRole('button', { name: '枠を追加（1日3枠まで）' }))
    await select('月曜 枠2の開始', '21:00')
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    expect(mocks.proposeHours).not.toHaveBeenCalled()
    await select('月曜 枠2の開始', '23:00')
    await select('月曜 枠2の終了', '02:00')
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    await waitFor(() => expect(mocks.proposeHours).toHaveBeenCalledWith('account-1', { source: 'weekly', weekly: { ...weekly, MONDAY: [{ open: '11:00', close: '23:00' }, { open: '23:00', close: '02:00' }] } }))
  })
  it('枠は3つまで、最後以外の翌日跨ぎを止め、クリアで元の週間設定に戻る', async () => {
    await open('weekly')
    const monday = screen.getByRole('region', { name: '月曜の営業時間' })
    const add = within(monday).getByRole('button', { name: '枠を追加（1日3枠まで）' })
    fireEvent.click(add); fireEvent.click(add)
    expect(add).toHaveProperty('disabled', true)
    await select('月曜 枠1の終了', '02:00')
    fireEvent.click(screen.getByRole('button', { name: '変更案を確認する' }))
    expect(mocks.proposeHours).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '入力をクリア' }))
    expect(screen.getByRole('button', { name: '変更案を確認する' })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: '月曜 枠2の終了' })).toBeNull()
  })
  it('方式を切り替える前に書きかけを確認し、続けると残り、破棄した時だけ移る', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: '今日を休みにして' }))
    fireEvent.click(screen.getByRole('tab', { name: '毎週の営業時間' }))
    await screen.findByRole('dialog')
    expect(go).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('textbox', { name: '文章で入力' })).toHaveProperty('value', '今日を休みにして')
    fireEvent.click(screen.getByRole('tab', { name: '毎週の営業時間' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存せずに移る' }))
    expect(go).toHaveBeenCalledWith({ tab: 'profile', view: 'hours', mode: 'weekly' })
  })
  it('AI無し・休業・閲覧のみでは変更を止める', async () => {
    mocks.profile.mockResolvedValue({ ...data, aiAvailable: false })
    await open()
    expect(screen.getByRole('textbox', { name: '文章で入力' })).toHaveProperty('disabled', true)
    cleanup(); mocks.profile.mockResolvedValue({ ...data, closed: true }); await open('weekly')
    expect(screen.getByRole('checkbox', { name: '月曜を定休日にする' })).toHaveProperty('disabled', true)
    cleanup(); mocks.role = 'viewer'; mocks.profile.mockResolvedValue(data); await open('weekly')
    expect(screen.queryByRole('button', { name: '変更案を確認する' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: '月曜を定休日にする' })).toHaveProperty('disabled', true)
    expect(mocks.proposeHours).not.toHaveBeenCalled()
  })
})
