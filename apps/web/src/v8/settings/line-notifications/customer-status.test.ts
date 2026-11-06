import { expect, it } from 'vitest'
import { customerNotificationIncomplete, customerNotificationStatus } from './customer-status'

it.each([null, '', ' ', '\n\t', '　'])('見出しが空でも配信状態を隠さず、未設定の注意を併記する: %j', title => {
  for (const isEnabled of [true, false]) {
    const setting = { title, isEnabled }
    expect(customerNotificationIncomplete(setting)).toBe(true)
    expect(customerNotificationStatus(setting)).toEqual({
      label: isEnabled ? '出している' : '停止中',
      tone: isEnabled ? 'good' : 'muted',
      warning: '要確認：文面が未設定',
    })
  }
})

it.each([true, false])('任意の前後文が空でも見出しがあれば配信状態を出す: %j', isEnabled => {
  const setting = { title: ' 発送しました ', introText: '', outroText: '', isEnabled }
  expect(customerNotificationIncomplete(setting)).toBe(false)
  expect(customerNotificationStatus(setting)).toEqual(isEnabled
    ? { label: '出している', tone: 'good', warning: null }
    : { label: '停止中', tone: 'muted', warning: null })
})
