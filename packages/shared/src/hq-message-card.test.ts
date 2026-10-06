import { expect, test } from 'vitest'
import { composeHqMessageCard, parseHqMessageCard, type HqMessageCard } from './hq-message-card'
const card = (): HqMessageCard => ({ format: 'flex', title: '案内', body: '本文', buttons: [{ id: 'one', label: '開く', action: 'url', value: 'https://example.com' }] })
test.each([null, [], 1, 'card', { ...card(), buttons: [null] }, { ...card(), buttons: [...card().buttons, ...card().buttons] }, { ...card(), body: 'x'.repeat(2001) }, { ...card(), buttons: [{ ...card().buttons[0], value: 'javascript:alert(1)' }] }, { ...card(), buttons: [{ ...card().buttons[0], action: 'scenario', value: 'id&c=1' }] }])('rejects malformed or unsafe cards: %j', value => expect(() => parseHqMessageCard(value)).toThrow())
test('text limits count both title and body', () => {
  expect(composeHqMessageCard(parseHqMessageCard({ format: 'text', title: 'タイトル', body: '本文', buttons: [] }), 'id').messageContent).toBe('タイトル\n本文')
  expect(() => parseHqMessageCard({ format: 'text', title: '題', body: 'x'.repeat(5000), buttons: [] })).toThrow()
})
test('references rewrite only button targets, retaining identical-looking prose', () => {
  const value = card(); value.body = 'source'; value.buttons = [{ id: 'f', label: '回答', action: 'form', value: 'form' }, { id: 's', label: '開始', action: 'scenario', value: 'source' }]
  const composed = composeHqMessageCard(value, 'destination', undefined, { 'form:form': 'https://liff.line.me/liff?form=dest', 'scenario:source': 'dest-scenario' })
  expect(JSON.parse(composed.messageContent).body.contents[1].text).toBe('source')
  expect(JSON.parse(composed.messageContent).footer.contents[1].action.data).toBe('ctpl=destination&c=0&a=1')
  expect(JSON.parse(composed.carouselActionsJson!)[0][1][0].config.scenarioId).toBe('dest-scenario')
})
