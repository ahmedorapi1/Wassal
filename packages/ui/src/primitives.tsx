import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  PropsWithChildren,
} from 'react';

export function Surface({
  children,
  className = '',
  ...properties
}: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return (
    <section className={`wasel-surface ${className}`.trim()} {...properties}>
      {children}
    </section>
  );
}

export function Button({
  children,
  className = '',
  type = 'button',
  ...properties
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className={`wasel-button ${className}`.trim()}
      type={type}
      {...properties}
    >
      {children}
    </button>
  );
}
