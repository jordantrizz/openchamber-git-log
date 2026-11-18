// DOM primitives shared by the rail panel. No host calls and no state: every
// node is built from the document.

export interface ElOptions {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  children?: (Node | string | null | undefined)[];
}

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title) node.title = options.title;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of options.children ?? []) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
};

export type ChipTone = 'accent' | 'info' | 'success' | 'warning' | 'error' | 'muted';

export const chip = (text: string, tone: ChipTone, title?: string): HTMLElement =>
  el('span', {
    className: `chip chip-${tone}`,
    text,
    ...(title === undefined ? {} : { title }),
  });

export const button = (label: string, onClick: () => void, variant = 'outline'): HTMLButtonElement => {
  const node = el('button', { className: `btn btn-${variant}`, text: label, attrs: { type: 'button' } });
  node.addEventListener('click', onClick);
  return node;
};

export const section = (
  title: string,
  note: string | null,
  children: (Node | string | null)[],
): HTMLElement =>
  el('section', {
    className: 'section',
    children: [
      el('div', {
        className: 'section-head',
        children: [
          el('h2', { className: 'section-title', text: title }),
          ...(note ? [el('span', { className: 'section-note', text: note })] : []),
        ],
      }),
      ...children,
    ],
  });

export const noticeNode = (notice: {
  tone: 'muted' | 'warning' | 'error';
  message: string;
  detail?: string;
}): HTMLElement =>
  el('div', {
    className: `notice notice-${notice.tone}`,
    attrs: { role: 'status' },
    children: [
      el('span', { className: 'notice-title', text: notice.message }),
      ...(notice.detail ? [el('span', { className: 'notice-detail', text: notice.detail })] : []),
    ],
  });
