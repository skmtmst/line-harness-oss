import styles from './delivery-mode-diagram.module.css'

type Mode = 'absolute_time' | 'elapsed'

/** G-5 の図解。時間の長さは縮めて示し、日時の文字と2人の位置関係で方式を比べる。 */
export default function DeliveryModeDiagram({ mode, selected }: { mode: Mode; selected: boolean }) {
  const absolute = mode === 'absolute_time'
  const summary = absolute
    ? '4月1日12時に購読を始めたAと14時に始めたBの両方に、1通目は当日15時、2通目は翌日20時に届きます。'
    : '4月1日12時に購読を始めたAには当日15時と翌日20時、14時に始めたBには当日17時と翌日22時に届き、夜中に届くことがあります。'

  return (
    <span className={styles.diagram} data-selected={selected} role="img" aria-label={summary}>
      <span className={styles.heading} aria-hidden="true">具体例：同じ日の違う時刻に購読を始めた2人</span>
      <svg className={styles.timeline} viewBox="0 0 488 128" aria-hidden="true" focusable="false">
        {[{ who: 'A', start: '4/1 12:00', x: 140, y: 45 }, { who: 'B', start: '4/1 14:00', x: 170, y: 107 }].map((row, index) => {
          const first = absolute ? 255 : 240 + index * 30
          const second = absolute ? 425 : 410 + index * 30
          return (
            <g key={row.who}>
              <circle className={styles.person} cx="14" cy={row.y} r="14" />
              <text className={styles.personName} x="14" y={row.y + 4} textAnchor="middle">{row.who}</text>
              <rect className={styles.startBadge} x="32" y={row.y - 16} width="45" height="14" rx="4" />
              <text className={styles.startLabel} x="54.5" y={row.y - 6} textAnchor="middle">購読開始</text>
              <text className={styles.startDate} x="32" y={row.y + 9}>{row.start}</text>
              <line className={styles.track} x1={row.x} y1={row.y} x2="470" y2={row.y} />
              {!absolute ? <line className={styles.elapsedLine} x1={row.x} y1={row.y} x2={first - 30} y2={row.y} /> : null}
              <circle className={styles.startDot} cx={row.x} cy={row.y} r="4" />
              {[{ x: first, label: '1通目', date: `4/1 ${absolute || index === 0 ? '15:00' : '17:00'}`, after: '3時間後', width: 48 },
                { x: second, label: '2通目', date: `4/2 ${absolute || index === 0 ? '20:00' : '22:00'}`, after: '1日と8時間後', width: 74 }].map((message) => (
                <g key={message.label}>
                  {!absolute ? (
                    <>
                      <rect className={styles.bubble} x={message.x - message.width / 2} y={row.y - 36} width={message.width} height="18" rx="6" />
                      <text className={styles.bubbleText} x={message.x} y={row.y - 23} textAnchor="middle">{message.after}</text>
                    </>
                  ) : null}
                  <rect className={styles.message} x={message.x - 30} y={row.y - 15} width="60" height="30" rx="6" />
                  <text className={styles.messageTitle} x={message.x} y={row.y - 1} textAnchor="middle">{message.label}</text>
                  <text className={styles.messageDate} x={message.x} y={row.y + 10} textAnchor="middle">{message.date}</text>
                </g>
              ))}
            </g>
          )
        })}
        {absolute ? [{ x: 255, label: '当日の15時' }, { x: 425, label: '翌日の20時' }].map((bubble) => (
          <g key={bubble.label}>
            <rect className={styles.bubble} x={bubble.x - 32} y="0.5" width="64" height="18" rx="6" />
            <text className={styles.bubbleText} x={bubble.x} y="13" textAnchor="middle">{bubble.label}</text>
            <line className={styles.bubbleStem} x1={bubble.x} y1="19" x2={bubble.x} y2="30" />
            {/* 札の下端と次の札の上端の間だけ。札の外側には延ばさない。 */}
            <line className={styles.sameTime} x1={bubble.x} y1="60" x2={bubble.x} y2="92" strokeDasharray="3 3" />
          </g>
        )) : null}
      </svg>
      <span className={styles.caption} aria-hidden="true">
        {absolute ? '2人とも同じ時刻に届きます' : '始めた時刻に合わせてずれて届きます（夜中に届くことがあります）'}
      </span>
    </span>
  )
}
