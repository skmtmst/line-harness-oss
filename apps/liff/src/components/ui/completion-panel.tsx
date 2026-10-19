import type { ReactNode } from 'react';
import styles from './completion-panel.module.css';

/** 下の主操作と副操作の上に、完了の内容を中央寄せで置く。 */
export default function CompletionPanel({ children, designNode }: { children: ReactNode; designNode: string }) {
  return <div className={styles.panel} data-design-node={designNode}>{children}</div>;
}
