import type { ReactNode } from 'react';

type ChildrenProps = {
  children: ReactNode;
};

export function StepList({ children }: ChildrenProps) {
  return <ol className="manual-steps">{children}</ol>;
}

export function Step({ children }: ChildrenProps) {
  return <li className="manual-step">{children}</li>;
}

export function Warning({ children }: ChildrenProps) {
  return (
    <aside className="callout callout--warning" aria-label="注意">
      <div className="callout__title">⚠️ 注意</div>
      <div className="callout__body">{children}</div>
    </aside>
  );
}

export function Tip({ children }: ChildrenProps) {
  return (
    <aside className="callout callout--tip" aria-label="補足">
      <div className="callout__title">💡 補足</div>
      <div className="callout__body">{children}</div>
    </aside>
  );
}

type ManualFigureProps = {
  src: string;
  alt: string;
  caption: string;
};

export function ManualFigure({ src, alt, caption }: ManualFigureProps) {
  return (
    <figure className="manual-figure">
      {/* Public manuals use fixed editorial assets, so static export does not need an image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function Troubleshooting({ children }: ChildrenProps) {
  return (
    <section className="troubleshooting">
      <p className="troubleshooting__eyebrow">TROUBLESHOOTING</p>
      <h2>うまくいかないときは</h2>
      <div>{children}</div>
    </section>
  );
}
