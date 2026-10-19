import { expect, test, vi } from 'vitest'
import type { MessageTemplateDefinition } from '@line-crm/shared'
vi.mock('@/components/broadcasts/broadcast-form', () => ({ videoPreviewProblem: () => null }))
import { bubbleFromTemplate, fromApiBubble, hqBubbleProblem, toApiBubble } from './bubbles'
import { contentTemplateToBubble, bubbleLegacyMessage, assetBubbleError } from '@/lib/broadcast-template'
const published = { questions: [{ text: '質問', format: 'free', required: true }], answerActions: [{ actionType: 'tag', config: { op: 'add', tagIds: ['t1'] }, onFailure: 'continue' }] }
test('統括の公開リサーチを選択・保存・読み直し・送信できる', () => {
  const definition = { template: { id: 'source1', name: '調査' }, asset: { kind: 'research', payload: published } } as unknown as MessageTemplateDefinition
  const read = bubbleFromTemplate('hq1', definition, 'version1')
  expect('bubble' in read).toBe(true); if (!('bubble' in read)) return
  expect(hqBubbleProblem(read.bubble)).toBeNull()
  const bubble = toApiBubble(read.bubble, 'b1')!; expect(bubble.type).toBe('research')
  expect(fromApiBubble(bubble)?.content.answerActions).toEqual(published.answerActions)
  expect(bubbleLegacyMessage(bubble).messageContent).toContain('page=research&researchId=hq1')
})
test('店からの引用は編集途中の下書きではなく公開した質問を送る', () => {
  const asset = { id: 'r1', kind: 'research' as const, name: '調査', lineAccountId: 'a1', payload: { questions: [] }, publishedPayload: published, publishedVersion: 1, createdAt: '', updatedAt: '' }
  expect(bubbleLegacyMessage(contentTemplateToBubble(asset)).messageType).toBe('flex')
  expect(assetBubbleError(contentTemplateToBubble({ ...asset, publishedVersion: 0 }))).toContain('選択')
})
