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

export const IconExplore = () => icon(<><path d="M4 12 12 4" /><path d="M6.5 4H12v5.5" /></>);
export const IconBranch = () => icon(<><circle cx="4" cy="3.5" r="1.4" /><circle cx="4" cy="12.5" r="1.4" /><circle cx="12" cy="6" r="1.4" /><path d="M4 5v6M4 9c0-2 2-3 6.600-3" /></>);
export const IconLink = () => icon(<><path d="M6.500 9.500a2.500 2.500 0 0 0 3.500 0l2-2a2.500 2.500 0 0 0-3.500-3.500l-.7.700" /><path d="M9.500 6.500a2.500 2.500 0 0 0-3.500 0l-2 2a2.500 2.500 0 0 0 3.500 3.500l.7-.7" /></>);
export const IconCut = () => icon(<><circle cx="4" cy="4" r="1.600" /><circle cx="4" cy="12" r="1.600" /><path d="M5.300 5 13 11.500M5.300 11 13 4.500" /></>);
export const IconLens = () => icon(<><circle cx="7" cy="7" r="4" /><path d="m10 10 3.500 3.500" /></>);
export const IconMore = () => icon(<><circle cx="3.500" cy="8" r=".8" fill="currentColor" /><circle cx="8" cy="8" r=".8" fill="currentColor" /><circle cx="12.500" cy="8" r=".8" fill="currentColor" /></>);
export const IconEdit = () => icon(<path d="m10.500 3 2.500 2.500L6 12.500 3 13l.5-3L10.500 3Z" />);
