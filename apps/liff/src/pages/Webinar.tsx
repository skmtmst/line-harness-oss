import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import liff from '@line/liff';
import { api, type WebinarState, type WebinarSakuraComment } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadingView from '../components/LoadingView.js';
import StatusView from '../components/ui/StatusView.js';
import Icon from '../components/ui/Icon.js';
import { liffDocumentTitle } from '../components/ui/LiffHeader.js';

// 疑似ライブプレーヤー。時刻の権威はサーバー:
//   期待位置 = state.offsetSeconds + (performance.now() - t0) / 1000
// 動画側がバッファ等で 5 秒以上ズレたら期待位置へ強制シーク。
// シークバー・一時停止 UI は出さない (controls なし)。

const DRIFT_TOLERANCE = 5;
// J821: 再生中だけ15秒ごとに送る。
const HEARTBEAT_MS = 15_000;

interface ChatItem {
  key: string;
  authorName: string;
  body: string;
  mine?: boolean;
}

function formatJp(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
}

/**
 * ウェビナー (7-webinar)。
 * 動画に集中できる暗い地はそのまま。途中で出るボタン (名前は管理画面で
 * 決める) と送信は濃い緑、残り時間は大きく出す。
 *
 * 時刻の同期・ハートビート・CTA の計測は変えない。見た目だけ ★V7 にする。
 */
export default function Webinar() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<WebinarState | null>(null);
  // 上の帯の無い画面なので、題はここで付ける（「<ウェビナー名> | musubo」）。
  useEffect(() => {
    document.title = liffDocumentTitle(state?.title || 'ウェビナー');
  }, [state?.title]);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** この端末では再生できない (HLS 非対応など)。読み直しても直らない。 */
  const [unplayable, setUnplayable] = useState(false);
  const [ended, setEnded] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  /** 動画が流れているか。流れるまでは動画の真ん中に再生の印を出す。 */
  const [playing, setPlaying] = useState(false);
  /** 開始までの残り秒。箱 (7-a) に分・秒で出す。 */
  const [remainSec, setRemainSec] = useState(0);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [ctaVisible, setCtaVisible] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const t0Ref = useRef(0);            // state 受信時の performance.now()
  const baseOffsetRef = useRef(0);    // state.offsetSeconds
  const commentIdxRef = useRef(0);    // 次に表示するサクラコメント index
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<WebinarState | null>(null);
  stateRef.current = state;

  const expectedPosition = useCallback(
    () => baseOffsetRef.current + (performance.now() - t0Ref.current) / 1000,
    [],
  );

  const load = useCallback(async () => {
    if (!slug) return;
    setError(null);
    setLoadFailed(false);
    try {
      const s = await api.webinarState(slug);
      if (s.live) {
        t0Ref.current = performance.now();
        baseOffsetRef.current = s.offsetSeconds;
        commentIdxRef.current = 0;
        setChat([]);
        setCtaVisible(false);
      }
      setState(s);
    } catch (err) {
      logFailure('webinar', err);
      const status = (err as { status?: number }).status;
      if (status === 403) setError('この配信は友だち追加後にご覧いただけます。');
      else setLoadFailed(true);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // 待機画面: 残り秒を数える + 開始時刻到達で自動リロード
  useEffect(() => {
    if (!state || state.live) return;
    if (state.nextSessionAt === null) return;
    const tick = () => {
      const remain = state.nextSessionAt! - Math.floor(Date.now() / 1000);
      if (remain <= 0) {
        void load();
        return;
      }
      setRemainSec(remain);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state, load]);

  // ライブ画面: プレーヤー初期化
  useEffect(() => {
    if (!state?.live) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    async function setup() {
      const v = video!;
      const src = state as Extract<WebinarState, { live: true }>;
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = src.playlistUrl;
      } else {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setUnplayable(true);
          return;
        }
        const instance = new Hls();
        instance.loadSource(src.playlistUrl);
        instance.attachMedia(v);
        hls = instance;
      }
      v.muted = true;
      // 音なしで始めるので、音声ONの案内は最初から出す。
      setNeedsTap(true);
      v.addEventListener('playing', () => setPlaying(true));
      v.addEventListener('pause', () => setPlaying(false));
      const seekAndPlay = () => {
        v.currentTime = expectedPosition();
        v.play().then(() => setNeedsTap(true)).catch(() => setNeedsTap(true));
      };
      if (v.readyState >= 1) seekAndPlay();
      else v.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    }
    void setup();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [state, expectedPosition]);

  // ライブ進行: ドリフト補正・サクラコメント・CTA・終了判定 (1秒 tick)
  useEffect(() => {
    if (!state?.live) return;
    const src = state;
    const timer = setInterval(() => {
      const video = videoRef.current;
      const pos = expectedPosition();
      if (pos >= src.durationSeconds) {
        setEnded(true);
        video?.pause();
        clearInterval(timer);
        return;
      }
      if (video && video.readyState >= 2 && Math.abs(video.currentTime - pos) >= DRIFT_TOLERANCE) {
        video.currentTime = pos;
      }
      // サクラコメント流し込み
      const comments = src.comments;
      const items: ChatItem[] = [];
      while (
        commentIdxRef.current < comments.length &&
        comments[commentIdxRef.current].atSeconds <= pos
      ) {
        const cm: WebinarSakuraComment = comments[commentIdxRef.current];
        items.push({
          key: `s-${commentIdxRef.current}`,
          authorName: cm.authorName,
          body: cm.body,
        });
        commentIdxRef.current += 1;
      }
      if (items.length > 0) setChat((prev) => [...prev.slice(-200), ...items]);
      if (src.cta && pos >= src.cta.showAtSeconds) setCtaVisible(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [state, expectedPosition]);

  // チャット自動スクロール
  useEffect(() => {
    chatBoxRef.current?.scrollTo({ top: chatBoxRef.current.scrollHeight });
  }, [chat]);

  // タブ復帰時の再同期
  useEffect(() => {
    const onVisible = () => {
      const video = videoRef.current;
      if (document.visibilityState === 'visible' && video && stateRef.current?.live && !ended) {
        video.currentTime = expectedPosition();
        void video.play().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [expectedPosition, ended]);

  // ハートビート (配信終了後は送らない。J821: 再生中だけ15秒ごと)。
  // 状態を区別する: 再生・一時停止・隠れた・読み込み待ち・位置の移動・速度。
  useEffect(() => {
    if (!state?.live || !slug || ended) return;
    const src = state;
    const timer = setInterval(() => {
      const video = videoRef.current;
      const playerState = !video
        ? 'playing'
        : document.visibilityState === 'hidden'
          ? 'hidden'
          : video.seeking
            ? 'seeking'
            : video.readyState < 3 && !video.paused
              ? 'buffering'
              : video.paused
                ? 'paused'
                : 'playing';
      const pos = Math.min(Math.floor(expectedPosition()), src.durationSeconds);
      void api.webinarHeartbeat(slug, src.sessionStartAt, pos, {
        playerState,
        playbackRate: video?.playbackRate ?? 1,
        clientAtMs: Date.now(),
      }).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [state, slug, expectedPosition, ended]);

  const sendComment = async () => {
    if (!state?.live || !slug) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    setChat((prev) => [
      ...prev,
      { key: `u-${Date.now()}`, authorName: 'あなた', body: text, mine: true },
    ]);
    try {
      await api.webinarComment(slug, state.sessionStartAt, Math.floor(expectedPosition()), text);
    } catch (err) {
      console.warn('comment post failed:', err);
    }
  };

  const clickCta = () => {
    if (!state?.live || !state.cta || !slug) return;
    void api.webinarCtaClick(slug, state.sessionStartAt).catch(() => undefined);
    const url = state.cta.url;
    if (liff.isInClient()) liff.openWindow({ url, external: true });
    else window.open(url, '_blank', 'noopener');
  };

  // ---- 白い地の共通の殻（⑤LINEらしい。夜の型はM2の型が入ってから） ----
  const shell = (content: ReactNode) => (
    <div className="min-h-screen bg-canvas text-ink" data-design-node="RpW2h">
      <div className="mx-auto w-full max-w-md px-4 pt-4 pb-12">{content}</div>
    </div>
  );

  // 読み込めなかった時 (7 の注記: 5-b と同じ文面。白地なので濃い字で出す)。
  if (loadFailed) {
    return shell(
      <StatusView
        icon="cloud-off"
        title="読み込めませんでした"
        body="電波のよいところで、もう一度お試しください。"
        action={{ label: 'もう一度読み込む', onClick: () => void load() }}
      />,
    );
  }
  // 友だち追加前 (7-e)。足す操作は LINE 側なのでボタンは出さない。
  if (error) {
    return shell(
      <StatusView
        icon="user-plus"
        title="友だち追加すると見られます"
        body="この配信は、LINEで友だち追加した方だけが見られます。友だち追加のあと、もう一度開いてください。"
      />,
    );
  }
  // この端末では再生できない。読み直しても直らないので再試行は出さない。
  if (unplayable) {
    return shell(
      <StatusView
        icon="info"
        title="この端末では再生できません"
        body="別の端末かブラウザで開いてください。"
      />,
    );
  }
  if (!state) {
    return shell(
      <div role="status" aria-live="polite" aria-busy="true" aria-label="読み込み中">
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse gap-3 rounded-xl bg-liff-chip p-4">
              <div className="h-12 w-12 shrink-0 rounded-lg bg-liff-line" />
              <div className="flex flex-1 flex-col justify-center gap-2">
                <div className="h-3 w-2/5 rounded bg-liff-line" />
                <div className="h-3 w-4/5 rounded bg-liff-line" />
              </div>
            </div>
          ))}
        </div>
      </div>,
    );
  }

  // ---- 待機画面 (7-a) ----
  if (!state.live) {
    if (state.nextSessionAt === null) {
      return shell(
        <StatusView
          icon="clock"
          title={state.title}
          body="次回の開催は未定です。"
        />,
      );
    }
    const h = Math.floor(remainSec / 3600);
    const m = Math.floor((remainSec % 3600) / 60);
    const s = remainSec % 60;
    const boxes =
      h > 0
        ? [
            { value: h, unit: '時間' },
            { value: m, unit: '分' },
            { value: s, unit: '秒' },
          ]
        : [
            { value: m, unit: '分' },
            { value: s, unit: '秒' },
          ];
    return shell(
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full bg-liff-chip text-ink-faint"
          aria-hidden="true"
        >
          <Icon name="clock" className="h-7 w-7" />
        </span>
        <p className="mt-4 text-sm text-ink-faint">次のライブ配信</p>
        <h1 className="mt-1 text-xl font-bold text-ink">{state.title}</h1>
        <p className="mt-3 text-sm font-bold text-ink">{formatJp(state.nextSessionAt)} 開始</p>
        <div
          className="mt-4 flex gap-2"
          role="timer"
          aria-label={`開始まであと${h > 0 ? `${h}時間` : ''}${m}分${s}秒`}
        >
          {boxes.map((box) => (
            <div
              key={box.unit}
              className="flex min-w-20 flex-col items-center rounded-xl bg-liff-chip px-4 py-3"
            >
              <span className="text-3xl font-bold text-ink tabular-nums">
                {String(box.value).padStart(2, '0')}
              </span>
              <span className="mt-1 text-xs text-ink-faint">{box.unit}</span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          時間になると、この画面のまま自動で始まります。
          <br />
          閉じずにお待ちください。
        </p>
      </div>,
    );
  }

  // ---- 終了 (7-d) ----
  if (ended) {
    return shell(
      <StatusView
        icon="circle-check"
        title="ご視聴ありがとうございました"
        body="配信は終了しました"
      />,
    );
  }

  // ---- ライブ中 (★V8 RpW2h) ----
  // 暗い地に、16:9 の動画・題と時間・会話・途中のボタン・書く欄を縦に並べる。
  // 絵の「128人が見ています」「講師：…」は、見ている人数・講師を返す口が API に
  // 無いため出さない (API が入ったら足す)。
  const startHm = new Date((state.sessionStartAt + 9 * 3600) * 1000).toISOString().slice(11, 16);
  const endHm = new Date((state.sessionStartAt + state.durationSeconds + 9 * 3600) * 1000)
    .toISOString()
    .slice(11, 16);
  return (
    <div className="flex h-screen flex-col bg-night-deep text-night-body" data-design-node="RpW2h">
      <div className="relative aspect-video w-full shrink-0 bg-night-panel">
        <video ref={videoRef} className="h-full w-full object-contain" playsInline />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          {!playing && <Icon name="play" className="h-9 w-9 text-white" />}
          <span className="rounded bg-liff-sun px-2 py-0.5 text-[11px] font-bold text-white">
            ● ライブ
          </span>
          {needsTap && (
            <button
              type="button"
              className="liff-hit pointer-events-auto inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white"
              onClick={() => {
                const v = videoRef.current;
                if (v) {
                  v.muted = false;
                  void v.play().catch(() => undefined);
                }
                setNeedsTap(false);
              }}
            >
              <Icon name="volume-x" className="h-3.5 w-3.5" />
              タップで音声ON
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 px-4 py-3">
        <h1 className="truncate text-base font-bold text-white" title={state.title}>
          {state.title}
        </h1>
        <p className="liff-num text-xs text-night-sub">
          {startHm}〜{endHm}
        </p>
      </div>

      <div ref={chatBoxRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-2 text-[13px]">
        {chat.map((item) => (
          <p key={item.key} className="text-night-body">
            {item.mine ? (
              <>
                <span className="text-night-mine">{item.authorName}</span>
                {`\u3000${item.body}`}
              </>
            ) : (
              `${item.authorName}\u3000${item.body}`
            )}
          </p>
        ))}
      </div>

      {ctaVisible && state.cta && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={clickCta}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-night-cta text-[15px] font-bold text-white"
          >
            {state.cta.label}
          </button>
        </div>
      )}

      <div
        className="flex items-center gap-2 px-4 pt-2.5"
        // 板 (RpW2h) どおり下に 30 空ける (端末の下の帯の分を含む)。
        style={{ paddingBottom: 'max(1.875rem, env(safe-area-inset-bottom))' }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void sendComment();
          }}
          placeholder="コメントを書く"
          maxLength={500}
          aria-label="コメントを書く"
          className="h-[42px] min-w-0 flex-1 rounded-full bg-night-panel px-4 text-[13px] text-white placeholder:text-night-dim"
        />
        <button
          type="button"
          onClick={() => void sendComment()}
          aria-label="送信"
          className="liff-hit flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-liff-primary text-white"
        >
          <Icon name="send" className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}
