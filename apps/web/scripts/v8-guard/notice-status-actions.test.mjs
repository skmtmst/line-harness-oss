import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { connectGuardBrowser } from './browser-session.mjs'
import { collectNativeNoticeButtons, nativeNoticeButtons } from './notice-status-contract.mjs'
import scanOwnerRules from './owner-rules-browser.mjs'
import { compileNoticeFixture, noticeFixtureHtml } from './notice-status-fixture.mjs'

test('全画面のNotice内の操作は共通ボタンを使う', () => {
  assert.deepEqual(collectNativeNoticeButtons(fileURLToPath(new URL('../../src', import.meta.url))), [])
  for (const source of [
    '<Notice><button>もう一度</button></Notice>',
    '<ReadOnlyNotice><button>もう一度</button></ReadOnlyNotice>',
    'import { Notice as Banner } from "@/components/shared";<Banner><button/></Banner>',
    'import Banner from "@/components/shared/read-only-notice";<Banner><button/></Banner>',
    'React.createElement(Notice,{},React.createElement("button"))',
    'import {createElement as h} from "react";h(Notice,{},h("button"))',
    'import Banner from "@/components/shared/notice";const action=<button/>;<Banner action={action}/>',
    'function retry(){return <button/>};<Notice action={retry()}/>',
    'const retry=()=> <button/>;<Notice>{retry()}</Notice>',
  ]) assert.ok(nativeNoticeButtons(source).length > 0, source)
  assert.deepEqual(nativeNoticeButtons('const status=<button/>;<Notice>{job.status}<Button onClick={()=>{const unused=<button/>}}>もう一度</Button></Notice>'), [], 'プロパティ名や実行関数の未描画JSXを本文と誤認しない')
  assert.deepEqual(nativeNoticeButtons('<Notice><Button variant="text" size="inline">もう一度</Button></Notice>'), [])
})

test('札と本文の最初の文字をそろえ、共通文字操作のクリックと無効状態を保つ', async () => {
  const fixture = await compileNoticeFixture()
  const nativeFixture = await compileNoticeFixture({ nativeActions: true })
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const statusFailures = async () => (await page.evaluate(scanOwnerRules)).filter(item => ['notice-status-line', 'notice-dot-line'].includes(item.kind))
    for (const width of [1152, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.setContent(noticeFixtureHtml(fixture.css))
      await page.addScriptTag({ content: fixture.script })
      await page.locator('[data-case]').last().waitFor()
      assert.equal(await page.locator('[data-case]').count(), 25)
      assert.equal(await page.locator('[data-read-only-notice]').count(), 3, '実際の閲覧のみ部品を測る')
      assert.deepEqual(await statusFailures(), [])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      const retry = page.locator('[data-case="danger-true-action"] button[data-shared-button]')
      const before = await page.evaluate(() => window.fixtureClicks || 0)
      await retry.click()
      assert.equal(await page.evaluate(() => window.fixtureClicks), before + 1)
      assert.equal(await page.locator('[data-disabled] button').isDisabled(), true)
      const gap = await page.locator('[data-gap-check] [data-notice-message]').evaluate(message => {
        const button = message.querySelector('button'), walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
        let node, previous
        while ((node = walker.nextNode())) { if (button.contains(node)) break; if (node.textContent.trim()) previous = node }
        const range = document.createRange(); range.selectNodeContents(previous)
        const last = [...range.getClientRects()].at(-1)
        return button.getBoundingClientRect().left - last.right
      })
      assert.ok(gap >= 7.5, `本文と文字操作の間に共通の8px: ${gap}`)
      const placement = async () => page.evaluate(() => {
        const standalone = document.querySelector('[data-placement-standalone] [data-notice-message]')
        const button = standalone.querySelector('[data-shared-button]')
        const reference = document.querySelector('[data-placement-reference]')
        reference.style.width = `${standalone.getBoundingClientRect().width}px`
        const referenceButton = reference.querySelector('[data-shared-button]')
        const row = document.querySelector('[data-placement-flex] [data-friend-filter] [data-notice-message] > div')
        const firstAction = row.querySelector('[data-shared-button]')
        return {
          start: button.getBoundingClientRect().left - standalone.getBoundingClientRect().left - (referenceButton.getBoundingClientRect().left - reference.getBoundingClientRect().left),
          gap: firstAction.getBoundingClientRect().left - firstAction.previousElementSibling.getBoundingClientRect().right,
        }
      })
      const originalPlacement = await placement()
      assert.ok(Math.abs(originalPlacement.start) <= 0.5, `行頭のボタンは同じ幅の共通Buttonの比較位置から動かない: ${JSON.stringify(originalPlacement)}`)
      assert.ok(Math.abs(originalPlacement.gap - 8) <= 0.5, `実FriendFilterBandのflexは既存gap8pxのまま: ${JSON.stringify(originalPlacement)}`)
      const broadMargin = await page.addStyleTag({ content: '[data-design-part="notice"] [data-notice-message] [data-shared-button]{margin-inline-start:8px}' })
      const shiftedPlacement = await placement()
      assert.ok(Math.abs(shiftedPlacement.start) > 0.5, '広すぎる指定なら行頭の位置の対照が赤')
      assert.ok(Math.abs(shiftedPlacement.gap - 8) > 0.5, '広すぎる指定ならflexの間隔の対照が赤')
      await broadMargin.evaluate(el => el.remove())
      assert.deepEqual(await placement(), originalPlacement, '復元すると旧位置へ戻る')
      const raisedDot = await page.addStyleTag({ content: '[data-notice-dot]{transform:translateY(-4px)}' })
      assert.ok((await statusFailures()).some(item => item.kind === 'notice-dot-line'), '点だけの4px上ずれを検出する')
      await raisedDot.evaluate(el => el.remove())
      assert.deepEqual(await statusFailures(), [], '点の復元後は段落の余白を残して整列する')
      for (const offset of [2, 8]) {
        const fault = await page.addStyleTag({ content: `[data-notice-status-word]{position:relative;top:-${offset}px}` })
        assert.ok((await statusFailures()).length > 0, `${offset}px上ずれを実測で検出する`)
        await fault.evaluate(el => el.remove())
        assert.deepEqual(await statusFailures(), [], '復元後は整列する')
      }
      await page.setContent(noticeFixtureHtml(nativeFixture.css))
      await page.addScriptTag({ content: nativeFixture.script })
      await page.locator('[data-gap-check] button').waitFor()
      assert.ok((await page.evaluate(scanOwnerRules)).some(item => item.kind === 'notice-native-button'), '部品を経由した素buttonも実ページのDOMで検出する')
      await page.setContent(noticeFixtureHtml(fixture.css))
      await page.addScriptTag({ content: fixture.script })
      await page.locator('[data-gap-check] button').waitFor()
      assert.deepEqual((await page.evaluate(scanOwnerRules)).filter(item => item.kind.startsWith('notice-')), [], '共通部品へ復元すると通る')
    }
  } finally { await browser.close() }
})

test('compactと小さい段落で始まる帯は、内容に必要な高さと本文の上位置を保つ', async () => {
  const fixture = await compileNoticeFixture({ includeTypography: true })
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const offsets = () => page.locator('[data-kind-sample] [data-design-part="notice"]').evaluateAll(notices => notices.map(notice => {
      const css = getComputedStyle(notice), message = notice.querySelector('[data-notice-message]'), dot = notice.querySelector('[data-notice-dot]')
      const box = notice.getBoundingClientRect(), body = message.getBoundingClientRect()
      const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom), line = parseFloat(css.lineHeight)
      const contentHeight = Math.max((line + dot.getBoundingClientRect().height) / 2, notice.querySelector('[data-notice-status-word]') ? line : 0, body.height)
      const expectedHeight = Math.max(parseFloat(css.minHeight) || 0, contentHeight + padding)
      return { id: notice.closest('[data-kind-sample]').dataset.kindSample, height: box.height, expectedHeight, top: body.top - box.top, expectedTop: parseFloat(css.paddingTop) + (expectedHeight - padding - contentHeight) / 2, cut: message.scrollWidth > message.clientWidth, title: notice.title }
    }))
    const matchesContent = rows => rows.length === 10 && rows.every(row => Math.abs(row.height - row.expectedHeight) <= 0.5 && Math.abs(row.top - row.expectedTop) <= 0.5)
    for (const width of [1152, 1440]) {
      await page.setViewportSize({ width, height: 1800 })
      await page.setContent(noticeFixtureHtml(fixture.css)); await page.addScriptTag({ content: fixture.script })
      await page.locator('[data-kind-sample]').last().waitFor()
      assert.equal(matchesContent(await offsets()), true, JSON.stringify(await offsets()))
      for (const row of (await offsets()).filter(row => ['compact-info','compact-success'].includes(row.id))) {
        assert.equal(row.height, 36, row.id)
        assert.ok(row.cut && row.title, `${row.id}: 1行省略と全文を保つ`)
      }
      assert.deepEqual((await page.evaluate(scanOwnerRules)).filter(item => item.kind.startsWith('notice-')), [])
      const original = await page.locator('[data-kind-sample] [data-notice-dot]').evaluateAll(dots => dots.map(dot => {
        const line = dot.parentElement, saved = { dot: dot.style.cssText, line: line.style.cssText }
        line.style.height = 'var(--tpl-ro-band-lh)'; line.style.lineHeight = 'var(--tpl-ro-band-lh)'; dot.style.top = 'calc((var(--tpl-ro-band-lh) - var(--space-8)) / 2)'
        return saved
      }))
      assert.equal(matchesContent(await offsets()), false, '高さのある基準線の箱へ戻すと、小さい本文の高さか上位置が赤')
      await page.locator('[data-kind-sample] [data-notice-dot]').evaluateAll((dots, original) => dots.forEach((dot, i) => { dot.style.cssText = original[i].dot; dot.parentElement.style.cssText = original[i].line }), original)
      assert.equal(matchesContent(await offsets()), true, '復元後は内容に必要な高さと本文位置へ戻る')
    }
  } finally { await browser.close() }
})
