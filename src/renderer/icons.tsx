// Small line icons (16px, current colour) for the top bar, toolbar and menus.
import type { ReactNode } from 'react';

const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const icon = (children: ReactNode) => <svg {...base} aria-hidden="true">{children}</svg>;

export const IconBack = () => icon(<path d="M9.5 3.5 5 8l4.5 4.5" />);
export const IconChevronDown = () => icon(<path d="M4 6.5 8 10.5l4-4" />);
export const IconChevronUp = () => icon(<path d="M4 9.5 8 5.5l4 4" />);
export const IconPlus = () => icon(<path d="M8 3.5v9M3.5 8h9" />);
export const IconCursor = () => icon(<path d="M3.5 2.5 12.5 7l-3.9 1.4L7 12.5 3.5 2.5Z" />);
export const IconImage = () => icon(<><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1" /><path d="m3 12 3.5-3 2.5 2 2-1.5 2.5 2" /></>);
export const IconInbox = () => icon(<><path d="M2.5 9.5 4 3.5h8l1.5 6v3h-11v-3Z" /><path d="M2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2" /></>);
export const IconGear = () => icon(<><circle cx="8" cy="8" r="2" /><path d="M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1" /></>);
export const IconCheck = () => icon(<path d="m3.5 8.5 3 3 6-7" />);
export const IconFit = () => icon(<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />);
export const IconMinus = () => icon(<path d="M3.5 8h9" />);
export const IconBook = () => icon(<><path d="M2.5 3.5c1.8-.6 3.700-.6 5.500.5v8.500c-1.800-1.100-3.700-1.100-5.500-.5v-8.500Z" /><path d="M13.500 3.500c-1.800-.6-3.700-.6-5.500.5v8.500c1.800-1.100 3.700-1.100 5.500-.5v-8.500Z" /></>);
