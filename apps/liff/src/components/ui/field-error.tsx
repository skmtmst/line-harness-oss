import type { ReactNode } from 'react';

export default function FieldError({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-[13px] leading-5 text-danger">{children}</p>;
}
