import { describe, expect, it } from 'vitest'
import {
  activeGeneration,
  aspectBadge,
  generationConditionRows,
  groupPresets,
  imageMatchesQuery,
  inputFromGeneration,
  parseJstDateTime,
  presetKeysForShape,
  relativeUpdated,
  remainingPercent,
  shortDateTime,
  tileCaption,
  usageRefusal,
  usageStatusText,
  validateGenerationInput,
  type BannerGeneration,
  type BannerImage,
  type BannerPreset,
  type BannerUsage,
} from './hq-banners'

const presets: BannerPreset[] = [
  { key: 'line_rich_message', group: 'line', label: 'リッチメッセージ', note: '', aspectRatio: '1:1', apiSize: '1024x1024', targetWidth: 1040, targetHeight: 1040 },
  { key: 'line_rich_menu_large', group: 'line', label: 'リッチメニュー（大）', note: '', aspectRatio: '3:2', apiSize: '1536x1024', targetWidth: 2500, targetHeight: 1686 },
  { key: 'line_rich_menu_small', group: 'line', label: 'リッチメニュー（小）', note: '', aspectRatio: '3:1', apiSize: '1536x1024', targetWidth: 2500, targetHeight: 843 },
  { key: 'sns_story', group: 'sns', label: 'ストーリー', note: '', aspectRatio: '9:16', apiSize: '1024x1536', targetWidth: 1080, targetHeight: 1920 },
  { key: 'sns_x_post', group: 'sns', label: 'X 投稿', note: '', aspectRatio: '16:9', apiSize: '1536x1024', targetWidth: 1200, targetHeight: 675 },
]

const usage: BannerUsage = {
  month: { used: 42, limit: 150, remaining: 108 },
  today: { used: 8, limit: 30, remaining: 22 },
  paused: false,
  pausedReason: null,
}

const generation: BannerGeneration = {
  id: 'g1',
  projectId: 'p1',
  status: 'done',
  mode: 'banner',
  presetKey: 'line_rich_message',
  aspectRatio: '1:1',
  apiSize: '1024x1024',
  quality: 'medium',
  textLines: ['2周年 春の感謝祭', '8/10〜8/23'],
  mainColor: '#D7263D',
  subColor: null,
  personOption: 'without',
  customPrompt: '桜の花びら',
  freePrompt: null,
  finalPrompt: '...',
  engine: 'openai',
  modelName: 'gpt-image-2',
  requestedCount: 2,
  doneCount: 2,
  failedCount: 0,
  unitsPerImage: 1,
  errorMessage: null,
  createdBy: null,
  createdAt: '2026-09-12T21:40:00.000',
  startedAt: null,
  finishedAt: null,
}

const image: BannerImage = {
  id: 'i1',
  projectId: 'p1',
  generationId: 'g1',
  sequence: 1,
  source: 'generated',
  parentImageId: null,
  isFavorite: false,
  createdBy: null,
  createdAt: '2026-09-12T21:40:00.000',
  media: { id: 'm1', filename: 'banner.jpg', mimeType: 'image/jpeg', sizeBytes: 421_000, width: 1024, height: 1024, url: 'https://example.test/x.jpg' },
  generation,
  deliveredAccountIds: [],
}

describe('生成条件の手元の検査', () => {
  const base = { mode: 'banner' as const, presetKey: 'line_rich_message', textLines: ['A'], mainColor: null, subColor: null, personOption: 'without' as const, customPrompt: '', freePrompt: '', count: 1 }

  it('用途・テキスト・枚数がそろえば通る', () => {
    expect(validateGenerationInput(base, 4)).toBeNull()
  })

  it.each([
    [{ ...base, presetKey: '' }, '用途'],
    [{ ...base, count: 5 }, '枚数'],
    [{ ...base, textLines: [' ', ''] }, 'テキスト'],
    [{ ...base, textLines: ['あ'.repeat(41)] }, '40文字'],
    [{ ...base, mainColor: 'red' }, 'メインカラー'],
    [{ ...base, mode: 'free' as const, freePrompt: '' }, '説明'],
  ])('だめなときは理由を返す: %o', (input, fragment) => {
    expect(validateGenerationInput(input, 4)).toContain(fragment)
  })

  it('自由入力ではテキストが無くてもよい', () => {
    expect(validateGenerationInput({ ...base, mode: 'free', textLines: [], freePrompt: '餃子の写真風' }, 4)).toBeNull()
  })
})

describe('用途の見出し', () => {
  it('LINE と SNS に分ける', () => {
    expect(groupPresets(presets).map(({ group, label }) => ({ group, label }))).toEqual([
      { group: 'line', label: 'LINE' },
      { group: 'sns', label: 'SNS' },
    ])
  })
})

describe('利用量の見せかた', () => {
  it('残りが足りないときは API と同じ言い方で断る', () => {
    expect(usageRefusal(usage, 2)).toBeNull()
    expect(usageRefusal({ ...usage, today: { used: 29, limit: 30, remaining: 1 } }, 2)).toContain('今日の生成上限')
    expect(usageRefusal({ ...usage, month: { used: 150, limit: 150, remaining: 0 } }, 1)).toContain('今月の生成上限')
    expect(usageRefusal({ ...usage, paused: true, pausedReason: '失敗が続いたため一時停止しています' }, 1)).toContain('失敗が続いた')
  })

  it('下部追従バーの文と、残りの割合', () => {
    expect(usageStatusText(usage, 2)).toBe('今月の残り 108枚・今日の残り 22枚。この生成で 2枚使います')
    expect(usageStatusText(null, 2)).toContain('確認して')
    expect(remainingPercent(usage)).toBe(72)
    expect(remainingPercent(null)).toBeNull()
  })
})

describe('日時', () => {
  it('DBの日本時間の壁時計を、時差を足して読む', () => {
    expect(parseJstDateTime('2026-09-12T21:40:00.000').toISOString()).toBe('2026-09-12T12:40:00.000Z')
    expect(parseJstDateTime('2026-09-12T12:40:00Z').toISOString()).toBe('2026-09-12T12:40:00.000Z')
  })

  it('「9/12 21:40」と、日で丸めた相対表示', () => {
    const now = new Date('2026-09-12T13:00:00Z') // 日本時間 22:00
    expect(shortDateTime('2026-09-12T21:40:00.000', now)).toBe('9/12 21:40')
    expect(relativeUpdated('2026-09-12T21:57:00.000', now)).toBe('3分前')
    expect(relativeUpdated('2026-09-11T21:40:00.000', now)).toBe('昨日')
    expect(relativeUpdated('2026-09-05T10:00:00.000', now)).toBe('9/5')
  })
})

describe('画像の表示', () => {
  it('縦横比の札と、キャプション（品質は出さない）', () => {
    expect(aspectBadge(image)).toBe('1:1')
    expect(aspectBadge({ ...image, generation: null, media: { ...image.media, width: 1536, height: 1024 } })).toBe('3:2')
    const caption = tileCaption(image, presets)
    expect(caption).toContain('リッチメッセージ')
    expect(caption).not.toMatch(/スタンダード|medium|ライト|高精細/)
    expect(tileCaption({ ...image, source: 'upload', generation: null }, presets)).toContain('取り込み')
  })

  it('生成時の条件を項目に並べ、同じ設定をパネルへ戻せる', () => {
    const rows = generationConditionRows(image, presets)
    expect(rows.map((r) => r.label)).toEqual(['用途', 'テキスト', '色', '人物', '追加の指示', '作成'])
    expect(rows[1].value).toBe('1. 2周年 春の感謝祭\n2. 8/10〜8/23')
    expect(rows[2].value).toBe('メイン #D7263D')
    expect(inputFromGeneration(generation)).toMatchObject({ mode: 'banner', presetKey: 'line_rich_message', textLines: ['2周年 春の感謝祭', '8/10〜8/23'], mainColor: '#D7263D', count: 1 })
  })

  it('検索はテキスト・指示・プロジェクト名に当たる', () => {
    expect(imageMatchesQuery(image, '感謝祭')).toBe(true)
    expect(imageMatchesQuery(image, '桜')).toBe(true)
    expect(imageMatchesQuery(image, '定期便', '定期便のご案内')).toBe(true)
    expect(imageMatchesQuery(image, 'ラーメン')).toBe(false)
  })

  it('用途の形の絞り込みは、リッチメニューをほかの横長と分ける', () => {
    expect(presetKeysForShape(presets, 'square')).toEqual(['line_rich_message'])
    expect(presetKeysForShape(presets, 'rich_menu')).toEqual(['line_rich_menu_large', 'line_rich_menu_small'])
    expect(presetKeysForShape(presets, 'landscape')).toEqual(['sns_x_post'])
    expect(presetKeysForShape(presets, 'portrait')).toEqual(['sns_story'])
  })

  it('動いている生成だけを拾う', () => {
    expect(activeGeneration([generation])).toBeNull()
    expect(activeGeneration([{ ...generation, status: 'running' }])?.id).toBe('g1')
  })
})
