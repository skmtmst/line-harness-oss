// @vitest-environment happy-dom
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import LinePreview, { LinePreviewFlex } from './line-preview'
import LiffPhoneFrame from './liff-phone-frame'
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })
it('Flex の内容をトーク枠の中に描き、時計は1つだけ出す', () => {
 document.documentElement.dataset.theme = 'v8'
 const content = JSON.stringify({type:'bubble',body:{type:'box',layout:'vertical',contents:[{type:'text',text:'ご来店ありがとうございます'}]}})
 const {container} = render(<LinePreview><LinePreviewFlex content={content}/></LinePreview>)
 expect(container.querySelector('[data-line-preview-part="talk"]')?.textContent).toContain('ご来店ありがとうございます')
 expect(screen.getAllByText('9:41')).toHaveLength(1)
})
it('LIFF 枠で実際の中身・店舗・進み具合・主の色を保つ', () => {
 const {container} = render(<LiffPhoneFrame accountName="店舗A" step={2} accent="#006644" footer={<span>次へ</span>}><p>担当者A</p></LiffPhoneFrame>)
 expect(screen.getByText('担当者A')).toBeTruthy()
 expect(screen.getByText('店舗A')).toBeTruthy()
 expect(container.querySelector('[aria-current="step"]')?.textContent).toBe('2 担当')
 expect(container.querySelector('[style]')?.getAttribute('style')).toContain('--fe-phone-main: #006644')
 expect(screen.getAllByText('9:41')).toHaveLength(1)
})
