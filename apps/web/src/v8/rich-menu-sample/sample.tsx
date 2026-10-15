'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Image as ImageIcon, Info } from 'lucide-react'
import Link from '@/components/shared/list-navigation'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { RowMenu } from '@/components/shared/row-actions'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import { usePreparingDialog, PREPARING_TITLE, PREPARING_WORD } from '@/components/shared/preparing-dialog'
import HelpTip from '@/components/shared/help-tip'
import { DetailPage, DetailColumns } from '@/components/templates'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { ACCOUNT_STYLES, styleSetupApi, type AccountStyle, type StyleWarning } from '@/lib/api-style-setup'
import { FEATURES, featureName, sampleMenuFor, styleLabel } from '@/v8/onboarding/model'
import { SampleMenuTiles } from '@/v8/onboarding/sample-menu'
import styles from './sample.module.css'

/*
 * 見本のリッチメニュー（★V8 修正案の列 VHp7p `cAaGY`。決まり B-311・B-313 追記）。
 *
 * スタイルを選んだときに入った見本のリッチメニューを、ボタンごとに「押したら何が開くか・使えるか」で見せる。
 * 中身が決まっていない機能のボタンは、上の帯・表の札「中身が未設定」・右のお客さまの見え方
 * （押したときは準備中の案内）で知らせ、［決まりを入れる］でその設定の画面へ案内する。
 * 画像を変える・保存・押したときの変更は、組4の口ができるまで準備中の窓（B-314）。
 */

const AREAS = ['A', 'B', 'C', 'D', 'E', 'F']

export default function RichMenuSampleV8() {
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canEdit = role === null || canManageRole(role)
  const preparing = usePreparingDialog()
  const wanted = params.get('style')
  const [style, setStyle] = useState<AccountStyle | null>(ACCOUNT_STYLES.includes(wanted as AccountStyle) ? wanted as AccountStyle : null)
  const [name, setName] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<StyleWarning[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [asideOpen, setAsideOpen] = useState(false)

  /* スタイルが URL に無ければ、今のアカウントのスタイルを読む。 */
  useEffect(() => {
    if (!selectedAccountId || style) return
    let cancelled = false
    void styleSetupApi.get(selectedAccountId).then((res) => { if (!cancelled && res.success) setStyle(res.data.style) }).catch(() => { if (!cancelled) setStyle('restaurant') })
    return () => { cancelled = true }
  }, [selectedAccountId, style])

  useEffect(() => {
    if (!selectedAccountId || !style) return
    let cancelled = false
    void styleSetupApi.starterSet(selectedAccountId, style).then((res) => {
      if (cancelled || !res.success) return
      setName(res.data.definition.items.find((item) => item.kind === 'rich_menu')?.name ?? null)
    }).catch(() => { /* 名前が読めなくても見本の形で出す */ })
    void styleSetupApi.warnings(selectedAccountId).then((res) => { if (!cancelled && res.success) setWarnings(res.data.items ?? []) }).catch(() => { /* 帯を出さない */ })
    return () => { cancelled = true }
  }, [selectedAccountId, style])

  const menu = sampleMenuFor(style ?? 'restaurant')
  const warned = useMemo(() => new Set(warnings.map((warning) => warning.feature)), [warnings])
  const firstWarned = menu.tiles.findIndex((tile) => warned.has(tile.feature))
  const shown = selected ?? (firstWarned >= 0 ? firstWarned : 0)
  const shownTile = menu.tiles[shown]
  const hrefOf = (feature: string) => warnings.find((warning) => warning.feature === feature)?.href ?? FEATURES[feature]?.settingHref ?? '/rich-menus'
  const title = name ?? `${styleLabel(style ?? 'restaurant')}の見本`

  const aside = (
    <div className={styles.aside}>
      <div className={styles.asideHead}><h3 className={styles.asideTitle}>お客さまの見え方</h3><StatusBadge tone="neutral" dot>見本</StatusBadge></div>
      <SampleMenuTiles style={style ?? 'restaurant'} size="preview" selected={shown} warned={[...warned]} onSelect={setSelected} label="お客さまの見え方（押すと、押したときの見え方を出します）" />
      {shownTile ? (
        <section className={styles.tap} aria-live="polite">
          <p className={styles.tapLabel}>{`押したとき（${AREAS[shown]} ${shownTile.label}）`}</p>
          {warned.has(shownTile.feature) ? (
            <>
              <p className={styles.tapTitle}>{PREPARING_TITLE}</p>
              <p className={styles.tapNote}>もうしばらくお待ちください。ほかのメニューはお使いいただけます。</p>
            </>
          ) : (
            <>
              <p className={styles.tapTitle}>{FEATURES[shownTile.feature]?.opens ?? 'ページを開く'}</p>
              <p className={styles.tapNote}>お客さまの LINE で、このページが開きます。</p>
            </>
          )}
        </section>
      ) : null}
    </div>
  )

  return (
    <DetailPage
      boardId="cAaGY"
      title={title}
      leading={<Link href="/rich-menus" className={styles.parent}>リッチメニュー ›</Link>}
      help="スタイルを選んだときに入った見本のリッチメニューです。見本のまま使えます。"
      actions={canEdit ? <>
        <Button onClick={() => preparing.open('画像を変える')}><ImageIcon aria-hidden="true" className={styles.buttonIcon} />画像を変える</Button>
        <Button variant="primary" onClick={() => preparing.open('見本のリッチメニューの保存')}>保存する</Button>
      </> : null}
    >
      <DetailColumns presentation="card" aside={aside} asideLabel="お客さまの見え方" expanded={asideOpen} onExpandedChange={setAsideOpen}>
        {[...warned].filter((feature) => menu.tiles.some((tile) => tile.feature === feature)).map((feature) => (
          <Notice key={feature} tone="warn" appearance="soft" action={canEdit ? <Button href={hrefOf(feature)}>決まりを入れる</Button> : undefined}>
            {`「${menu.tiles.find((tile) => tile.feature === feature)!.label}」のボタンの中身が決まっていません。お客さまが押すと「${PREPARING_WORD}です」と出ます。`}
          </Notice>
        ))}
        <section className={styles.section} aria-labelledby="rm-sample-buttons">
          <div className={styles.sectionHead}><h3 id="rm-sample-buttons" className={styles.sectionTitle}>ボタンの動き</h3><HelpTip label="ボタンの動きの説明">リッチメニューの面（A〜F）ごとに、お客さまが押したら何が開くかと、今使えるかを出します。</HelpTip></div>
          <GridTable label="ボタンの動き" design={{ columns: 'var(--rms-col-area) var(--rms-col-button) minmax(0, 1fr) var(--rms-col-state) var(--rms-col-menu)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--polish-space-section)', rowHeight: 'var(--rms-row-h)', fontSize: 'var(--text-caption)' }}>
            <GridHeadRow>
              <GridCell role="columnheader">面</GridCell>
              <GridCell role="columnheader">ボタン</GridCell>
              <GridCell role="columnheader">押したら</GridCell>
              <GridCell role="columnheader">状態</GridCell>
              <GridCell role="columnheader">操作</GridCell>
            </GridHeadRow>
            {menu.tiles.map((tile, index) => {
              const open = warned.has(tile.feature)
              return (
                <GridRow key={tile.label}>
                  <GridCell>{AREAS[index]}</GridCell>
                  <GridCell><button type="button" className={styles.buttonName} onClick={() => setSelected(index)}>{tile.label}</button></GridCell>
                  <GridCell className={styles.opens}>
                    <span className={open ? styles.opensMain : undefined}>{FEATURES[tile.feature]?.opens ?? 'ページを開く'}</span>
                    {open ? <span className={styles.opensNote}>{`${featureName(tile.feature)}の決まりが未設定`}</span> : null}
                  </GridCell>
                  <GridCell><StatusBadge tone={open ? 'warning' : 'success'} dot>{open ? '中身が未設定' : '使える'}</StatusBadge></GridCell>
                  <GridCell>
                    {canEdit ? <RowMenu appearance="box" size="row" label={`${tile.label}の操作`} items={[
                      { id: 'change', label: '押したときを変える', onSelect: () => preparing.open('押したときの変更') },
                      ...(open ? [{ id: 'configure', label: '決まりを入れる', href: hrefOf(tile.feature) }] : []),
                    ]} /> : null}
                  </GridCell>
                </GridRow>
              )
            })}
          </GridTable>
          <p className={styles.help}><Info aria-hidden="true" className={styles.helpIcon} />見本で入ったボタンです。押したときの動きは行の「…」から変えられます。</p>
        </section>
      </DetailColumns>
      {preparing.dialog}
    </DetailPage>
  )
}
