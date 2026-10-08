'use client'

/*
 * ★V8 会話の中の動画・ファイル（B-6・API-15）。
 * 口は動画を {originalContentUrl, previewImageUrl}、ファイルを {attachmentId, filename, size, url, expiresAt}
 * の JSON で残す。そのまま文字で出さず、動画は再生できる枠、ファイルは名前・大きさ・期限の札にする。
 * 読めない形のときは今までどおり文字で出す（親が null を見て決める）。
 */
import { Download, FileText } from 'lucide-react'
import { formatExpiry, formatSize, parseSentAttachment } from './attachments'
import styles from './inbox-chat.module.css'

export default function AttachmentMessage({ messageType, content }: { messageType: string; content: string }) {
  const view = parseSentAttachment(messageType, content)
  if (!view) return <span>{messageType === 'video' ? '[動画]' : '[ファイル]'}</span>
  if (view.kind === 'video') {
    return (
      <video
        className={styles.sentVideo}
        src={view.url}
        poster={view.previewUrl ?? undefined}
        controls
        preload="metadata"
        aria-label="送った動画"
      />
    )
  }
  const expiry = formatExpiry(view.expiresAt)
  const sub = [view.size !== null ? formatSize(view.size) : null, expiry ? `ダウンロード ${expiry}` : null].filter(Boolean).join('・')
  const body = (
    <>
      <FileText aria-hidden className={styles.sentFileIcon} />
      <span className={styles.sentFileText}>
        <span className={styles.sentFileName} title={view.name}>{view.name}</span>
        {sub ? <span className={styles.sentFileSub}>{sub}</span> : null}
      </span>
      {view.url ? <Download aria-hidden className={styles.sentFileIcon} /> : null}
    </>
  )
  return view.url ? (
    <a className={styles.sentFile} href={view.url} target="_blank" rel="noreferrer noopener" aria-label={`${view.name} を開く`}>{body}</a>
  ) : (
    <span className={styles.sentFile}>{body}</span>
  )
}
