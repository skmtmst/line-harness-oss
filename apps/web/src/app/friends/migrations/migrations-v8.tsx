'use client'

/*
 * ★V8 CSV で書き出す・取り込む（Pencil `T9gblG`、状態 `SXCb3`）。
 *
 * 手順と API は v7 と同じ `useFriendMigrations`。違いは見せ方——
 * 「← 友だち一覧 › データ管理 › CSVで書き出す・取り込む」と
 * 「データ管理 ▾」を頭に置き、書き出しと取り込みを同じ重さの2枚で
 * 並べ、確認の内訳（追加・更新・変更なし・競合・エラー）を
 * 反映の前に出す。
 */
import { Info } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { FriendsDataMenuV8, FriendsManageNavV8 } from '@/app/friends/friends-nav-v8'
import { formatDateTime, formatNumber } from '@/lib/format'
import {
  formatImportBytes,
  JOB_STATUS_LABELS,
  MANAGE_FORBIDDEN,
  useFriendMigrations,
} from './use-friend-migrations'
import styles from '@/app/friends/friends-v8.module.css'

export default function FriendMigrationsV8() {
  usePageTitle('CSVで書き出す・取り込む')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち', href: '/friends' }])
  const m = useFriendMigrations()

  if (m.status === 'loading') return <ListState kind="loading" title="書き出し・取り込みを読み込んでいます" />
  if (m.status === 'forbidden') return <ListState kind="forbidden" title="書き出し・取り込みを見る権限がありません" description="見るには権限が要ります。オーナーか管理者の方に確認してください。" />
  if (m.status === 'error') return <ListState kind="error" title="書き出し・取り込みを表示できませんでした" description="履歴は消えていません。" action={<Button onClick={() => void m.load()}>もう一度試す</Button>} />

  const reflectable = m.summary ? m.summary.add + m.summary.update : 0

  return (
    <div className={styles.board} data-design-node="T9gblG">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>CSVで書き出す・取り込む</h2>
          <p className={styles.headDescription}>
            友だち情報をCSVで書き出し、確かめてから取り込みます。
          </p>
        </div>
        <div className={styles.headAction}>
          {/* 同じ人まとめの画面と同じ「データ管理 ▾」。行き先は正本のまま。 */}
          <FriendsDataMenuV8 />
        </div>
      </div>

      <FriendsManageNavV8 current="CSVで書き出す・取り込む" />

      <p className={styles.infoBand}>
        <Info size={14} aria-hidden="true" style={{ flex: '0 0 auto' }} />
        <span>
          書き出しても友だちの情報は変わりません。取り込みは、まず確認だけをします
          （追加・更新・変更なし・競合・エラーの内訳）。
        </span>
      </p>

      {/* 書き出しと取り込みは同じ重さの2枚。操作はそれぞれ中央寄せ。 */}
      <div className={styles.duoCards}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>CSVで書き出す</h3>
          <div className={styles.fieldStack}>
            <label className={styles.fieldLabel}>
              アカウント
              <Select
                aria-label="書き出すLINEアカウント"
                size="full"
                value={m.accountId}
                onChange={m.setAccountId}
                options={[
                  { value: '', label: 'アカウントを選択' },
                  ...m.accounts.map((account) => ({ value: account.id, label: account.name })),
                ]}
              />
            </label>
            <fieldset className={styles.fieldStack} style={{ gap: 8 }}>
              <legend className={styles.fieldLabel}>
                書き出す項目
                <HelpTip label="書き出す項目の説明">基本はLINEユーザーID・LINE表示名・本名・システム表示名・登録日の5列です。この5列はそのまま取り込めます。</HelpTip>
              </legend>
              {([
                ['basic', '基本（LINEユーザーID・表示名・本名・登録日）', false],
                ['tags_fields', 'タグ・友だち情報', true],
                ['support', '対応状況・対応マーク・担当者', true],
              ] as const).map(([value, label, unavailable]) => (
                <Checkbox
                  key={value}
                  checked={m.columns.includes(value)}
                  onCheckedChange={() => m.toggleColumn(value)}
                  disabled={unavailable}
                  description={unavailable ? 'まだ書き出せません' : undefined}
                >
                  {label}
                </Checkbox>
              ))}
            </fieldset>
            <p className={styles.sectionDesc} style={{ margin: 0 }}>
              文字コード：UTF-8（Shift_JISの書き出しはまだ使えません）
            </p>
          </div>
          <div className={styles.cardCenter}>
            <Button
              variant="primary"
              disabled={m.busy}
              busy={m.busy && !m.summary}
              onClick={() => void m.createExport()}
            >
              書き出しを作る
            </Button>
          </div>
          {m.exportResult ? (
            <p className={styles.sectionDesc} style={{ textAlign: 'center' }}>
              <a
                className={styles.linkAction}
                href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}${m.exportResult.downloadUrl}`}
              >
                CSVをダウンロード（{m.exportResult.rowCount ?? '—'}件）
              </a>
            </p>
          ) : null}
          {m.manageLocked ? <p className={styles.sectionDesc}>{MANAGE_FORBIDDEN}</p> : null}
          <p className={styles.stateDesc} style={{ textAlign: 'left' }}>
            件数が多いときは、できあがったらお知らせします。ダウンロードできる期間は7日です。
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>CSVを取り込む</h3>
          <FileDropzone
            title="ここにCSVを置く"
            hint="このシステムから書き出したUTF-8のCSV・5MBまで"
            accept=".csv,text/csv"
            onFiles={(files) => void m.onPickFile(files[0] ?? null)}
          />
          {m.file ? (
            <div style={{ marginTop: 8 }}>
              <AttachmentRow
                name={m.file.name}
                meta={`${formatNumber(m.rows.length)}行・${formatImportBytes(m.file.size)}`}
                onRemove={() => void m.onPickFile(null)}
              />
            </div>
          ) : null}
          <p className={styles.stateDesc} style={{ textAlign: 'left', marginTop: 8 }}>
            同じファイルをもう一度入れても、二重には反映しません。
          </p>
          <div className={styles.cardCenter}>
            <Button
              variant="primary"
              disabled={m.busy || !m.file}
              onClick={() => void m.previewImport()}
            >
              まず確認だけする
            </Button>
          </div>
          {m.manageLocked ? <p className={styles.sectionDesc}>{MANAGE_FORBIDDEN}</p> : null}

          {/* 確認の内訳：反映の前に出す。競合・エラーがあると反映は押せない。 */}
          {m.summary ? (
            <div className={styles.importPanel}>
              <p className={styles.stateDesc} style={{ margin: 0, fontWeight: 700, color: 'var(--color-ink)' }}>
                確認の結果：{m.file?.name}　まだ友だち情報は変えていません
              </p>
              <div className={styles.kpis} style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                <div className={styles.kpi}><span className={styles.kpiLabel}>追加</span><p className={styles.kpiValue}>{formatNumber(m.summary.add)}<span className={styles.kpiUnit}>人</span></p></div>
                <div className={styles.kpi}><span className={styles.kpiLabel}>更新</span><p className={styles.kpiValue}>{formatNumber(m.summary.update)}<span className={styles.kpiUnit}>人</span></p></div>
                <div className={styles.kpi}><span className={styles.kpiLabel}>変更なし</span><p className={styles.kpiValue}>{formatNumber(m.summary.unchanged)}<span className={styles.kpiUnit}>人</span></p></div>
                <div className={styles.kpi}><span className={styles.kpiLabel}>競合</span><p className={styles.kpiValue}>{formatNumber(m.summary.conflict)}<span className={styles.kpiUnit}>人</span></p><p className={styles.kpiDetail}>同じIDで値が違う</p></div>
                <div className={styles.kpi}><span className={styles.kpiLabel}>エラー</span><p className={styles.kpiValue}>{formatNumber(m.summary.error)}<span className={styles.kpiUnit}>行</span></p><p className={styles.kpiDetail}>直して再確認</p></div>
              </div>
              <div className={styles.cardCenter}>
                {m.importId ? (
                  <>
                    <Button type="button" variant="secondary" onClick={m.cancelImport} disabled={m.busy}>
                      取り込みをやめる
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={m.summary.conflict + m.summary.error > 0 || m.busy}
                      busy={m.busy}
                      busyLabel="反映中…"
                      onClick={() => void m.executeImport()}
                    >
                      確認した内容を反映（{formatNumber(reflectable)}人）
                    </Button>
                  </>
                ) : null}
              </div>
              {m.summary.conflict + m.summary.error > 0 ? (
                <p className={styles.sectionDesc} style={{ textAlign: 'center', margin: 0 }}>
                  競合・エラーのある行を直して、もう一度「確認だけする」からやり直してください。
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {m.message ? (
        <p role="status" className={styles.infoBand}>
          <Info size={14} aria-hidden="true" style={{ flex: '0 0 auto' }} />
          <span>{m.message}</span>
        </p>
      ) : null}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          書き出し・取り込みの履歴
          <HelpTip label="状態の札の意味">反映ずみは反映が終わったもの、確認までは確認待ち、期限切れは確認の期限が過ぎたものです。</HelpTip>
        </h3>
        {m.jobs.length === 0 ? (
          <div className={styles.stateCard} style={{ border: 0 }}>
            <p className={styles.stateTitle}>履歴はまだありません</p>
            <p className={styles.stateDesc}>書き出しまたは取り込みを実行すると、ここに残ります。</p>
          </div>
        ) : (
          <div className={styles.tableWrap} style={{ border: 0 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>種類</th>
                  <th>件数</th>
                  <th>した人</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {m.jobs.map((job) => (
                  <tr key={`${job.kind}-${job.id}`}>
                    <td>{formatDateTime(job.created_at)}</td>
                    <td>{job.kind === 'export' ? '書き出し' : '取り込み'}</td>
                    <td className="num">{job.row_count ?? job.total_count ?? '—'}</td>
                    <td>{job.created_by_name}</td>
                    <td>
                      <StatusBadge tone={job.status === 'completed' ? 'success' : 'neutral'}>
                        {JOB_STATUS_LABELS[job.status] ?? '確認中'}
                      </StatusBadge>
                      {job.kind === 'export' && job.status === 'completed' && (!job.expires_at || job.expires_at > new Date().toISOString()) ? (
                        <a
                          className={styles.linkAction}
                          style={{ display: 'block', marginTop: 4 }}
                          href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/friends/exports/${job.id}/download`}
                        >
                          CSVをダウンロード
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {m.jobs.length > 0 ? (
          <p className={styles.sectionDesc} style={{ marginTop: 8 }}>
            履歴 {formatNumber(m.jobs.length)} 件
          </p>
        ) : null}
      </section>
    </div>
  )
}
