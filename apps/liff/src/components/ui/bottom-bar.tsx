import type { ReactNode } from 'react';
import styles from './bottom-bar.module.css';

/** 進む操作・選んだ内容・戻る操作を画面の下に固定する。 */
export default function BottomBar({ children, appearance }: { children: ReactNode; appearance?: 'form' | 'restaurant' | 'stamp' }) {
  return <div data-liff-bottom-bar className={`${styles.bar} ${appearance === 'restaurant' ? styles.restaurant : appearance === 'stamp' ? styles.stamp : ''}`}>
    <div className={styles.content}>{children}</div>
  </div>;
}
