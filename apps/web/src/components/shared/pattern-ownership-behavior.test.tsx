import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReadOnlyNotice, { READ_ONLY_MESSAGE } from './read-only-notice'
import ListState from './list-state'
import PageSizeSelect, { PAGE_SIZES } from './page-size-select'
import { ListPageBody } from '@/components/templates/list-page'

describe('共通部品へ寄せた後も案内と操作を保つ', () => {
  it('閲覧権限の条件は型に渡し、個別の許可理由は帯に残せる', () => {
    const editable = renderToStaticMarkup(<ListPageBody><p>一覧</p></ListPageBody>)
    expect(editable).not.toContain(READ_ONLY_MESSAGE)
    const readonly = renderToStaticMarkup(<ListPageBody readOnly><p>一覧</p></ListPageBody>)
    expect(readonly.split(READ_ONLY_MESSAGE)).toHaveLength(2)
    const custom = renderToStaticMarkup(<ReadOnlyNotice>停止の解除は許可された人に頼んでください。</ReadOnlyNotice>)
    expect(custom).toContain('停止の解除は許可された人に頼んでください。')
    expect(custom).toContain('role="status"')
    expect(custom).not.toContain(READ_ONLY_MESSAGE)
  })

  it('取得失敗で画面固有の再試行を既定の再試行と二重に出さない', () => {
    const html = renderToStaticMarkup(<ListState kind="error" title="記録を読み込めませんでした" action={<button type="button">この条件で読み直す</button>} />)
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).toContain('この条件で読み直す')
    expect(html).not.toContain('もう一度読み込む')
    expect(renderToStaticMarkup(<ListState kind="error" />)).toContain('もう一度読み込む')
    expect(renderToStaticMarkup(<ListState kind="error" action={null} />)).not.toContain('もう一度読み込む')
    const supplementary = renderToStaticMarkup(<ListState kind="error" onRetry={() => {}} action={<button type="button">一覧へ戻る</button>} />)
    expect(supplementary).toContain('もう一度読み込む')
    expect(supplementary).toContain('一覧へ戻る')
  })

  it('件数の選択肢はどの入口でも10・20・50件', () => {
    expect(PAGE_SIZES).toEqual([10, 20, 50])
    const html = renderToStaticMarkup(<PageSizeSelect value={20} onChange={() => {}} />)
    expect(html).toContain('20件表示')
    expect(html).not.toContain('100件表示')
  })
})
