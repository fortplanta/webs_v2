// How long a tether is. A card on a leash should be free to be pulled well out of its place, so the leash is
// generous: the card's distance to its anchor times SLACK, and never under MIN_TETHER (center to center).

export const MIN_TETHER = 640;
export const SLACK = 1.8;

export const leash = (distance: number): number => Math.round(Math.max(MIN_TETHER, distance * SLACK));
