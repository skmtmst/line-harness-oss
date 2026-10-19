import Button from './button/index';
import Icon from './icon';
import styles from './live-player-controls.module.css';

export default function LivePlayerControls({ mode, muted, onToggleMute }: {
  mode: 'live' | 'preview' | 'replay'; muted: boolean; onToggleMute: () => void;
}) {
  const soundLabel = muted ? '音声をオンにする' : '音声をオフにする';
  return <div className={styles.stack} data-liff-player-controls>
    <span className={styles.status} data-mode={mode} data-liff-player-status>{mode === 'live' ? '● ライブ' : mode === 'preview' ? 'PREVIEW' : 'REPLAY'}</span>
    <Button variant="nightSound" className={styles.sound} onClick={onToggleMute} aria-label={soundLabel}>
      <Icon name="volume-x" className="h-3.5 w-3.5" />{soundLabel}
    </Button>
  </div>;
}
