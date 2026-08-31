import { describe, expect, it } from 'vitest'
import {
  canSubmit,
  EMPTY_DRAFT,
  failureOf,
  toCreateInput,
  validateDraft,
} from './column-form'

const draft = (over: Partial<typeof EMPTY_DRAFT> = {}) => ({
  ...EMPTY_DRAFT,
  title: '鹿肉の選び方',
  articleUrl: 'https://example.com/columns/venison-guide',
  ...over,
})

describe('入力の確かめ', () => {
  it('題名と記事URLが要る', () => {
    expect(validateDraft(draft()).length).toBe(0)
    expect(validateDraft(draft({ title: '' })).map((e) => e.field)).toContain('title')
    expect(validateDraft(draft({ articleUrl: '' })).map((e) => e.field)).toContain('articleUrl')
  })

  it('HTTPSでないURLを通さない', () => {
    // httpや相対URLは、押したときにLINE側で開けない。
    for (const url of ['http://example.com/a', '/columns/a', 'example.com/a']) {
      expect(validateDraft(draft({ articleUrl: url })).map((e) => e.field)).toContain('articleUrl')
    }
  })

  it('画像URLは空でもよいが、入れるならHTTPS', () => {
    expect(validateDraft(draft({ imageUrl: '' })).length).toBe(0)
    expect(validateDraft(draft({ imageUrl: 'http://cdn.example.com/a.jpg' })).map((e) => e.field))
      .toContain('imageUrl')
  })

  it('長すぎる分類・概要を止める', () => {
    expect(validateDraft(draft({ category: 'あ'.repeat(41) })).map((e) => e.field)).toContain('category')
    expect(validateDraft(draft({ excerpt: 'あ'.repeat(201) })).map((e) => e.field)).toContain('excerpt')
  })
})

describe('送る形', () => {
  it('公開日時が空でも今日を補わない', () => {
    /*
     * 補うと、書いただけのものが公開済みとして扱われる。
     * 空は「下書きのまま」。
     */
    expect(toCreateInput(draft()).publishedAt).toBeNull()
  })

  it('契約に無い項目を送らない', () => {
    // body / slug / externalId / lineAccountId を含めると400になる。
    const sent = toCreateInput(draft({ category: '食事', excerpt: 'ご紹介します。' }))
    expect(Object.keys(sent).sort()).toEqual(
      ['articleUrl', 'category', 'excerpt', 'imageUrl', 'publishedAt', 'title'],
    )
  })

  it('空の任意項目は送らない', () => {
    const sent = toCreateInput(draft())
    expect('category' in sent).toBe(false)
    expect('excerpt' in sent).toBe(false)
  })

  it('前後の空白を落とす', () => {
    expect(toCreateInput(draft({ title: '  鹿肉の選び方  ' })).title).toBe('鹿肉の選び方')
  })
})

describe('失敗の言い換え', () => {
  it('Workerの合図を画面の言葉にする', () => {
    expect(failureOf({ status: 400, code: 'article_url_invalid' }).message).toContain('HTTPSの記事URL')
    expect(failureOf({ status: 413, code: 'payload_too_large' }).message).toContain('本文は入力せず')
  })

  it('権限不足と入力の誤りと保存失敗を混ぜない', () => {
    // 読む人が次にすることが違う。
    expect(failureOf({ status: 403 }).kind).toBe('forbidden')
    expect(failureOf({ status: 400, code: 'title_invalid' }).kind).toBe('input')
    expect(failureOf({ status: 409 }).kind).toBe('conflict')
    expect(failureOf({ status: 500, code: 'column_create_failed' }).kind).toBe('failure')
  })

  it('知らない合図をそのまま出さない', () => {
    for (const code of ['nope_unknown_code', undefined]) {
      expect(failureOf({ status: 500, code }).message).not.toMatch(/[a-z_]{4,}/)
      expect(failureOf({ status: 400, code }).message).not.toMatch(/[a-z_]{4,}/)
    }
  })

  it('409でどのアカウントと重なったかを言わない', () => {
    // 契約も返さない。別のアカウントに何があるかを画面で推測しない。
    const text = failureOf({ status: 409 }).message
    expect(text).not.toContain('アカウント')
    expect(text).toContain('一覧を読み直してください')
  })
})

describe('送ってよいか', () => {
  it('入力の誤りが1つでもあれば送らない', () => {
    expect(canSubmit({ draft: draft(), busy: false })).toBe(true)
    expect(canSubmit({ draft: draft({ articleUrl: 'http://a' }), busy: false })).toBe(false)
    expect(canSubmit({ draft: draft(), busy: true })).toBe(false)
  })
})
