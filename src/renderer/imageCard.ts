// The image card: a rectangle with the image inside it, grouped so they move, rotate and resize as
// one (and arrows can attach). It's a *component*, identified by `customData.kind`:
//
//   card   → kind: 'image-card'          (the rectangle; carries caption/name/size info)
//   image  → kind: 'image-card-content'  (the picture; `card` = the card's id)
//
// Canvas elements have no CSS classes, so `kind` is the hook: select cards with isImageCard(), and
// change how they all look in one place — imageCardLook() — then call restyleImageCards() to apply it
// to cards already on a canvas.

import { cssVar } from './theme';
import type { Build, El } from './sceneEdit';

export const IMAGE_CARD = 'image-card';
export const IMAGE_CARD_CONTENT = 'image-card-content';

export const IMAGE_PAD = 12;
export const IMAGE_CAPTION_H = 28; // reserved under the picture so adding a caption never resizes the card
export const IMAGE_DISPLAY_MAX = 320; // longest side of the picture as first placed

export interface ImageCardData {
  kind: typeof IMAGE_CARD;
  fileId: string;
  caption: string;
  name: string;
  /** Pixel size of the stored image. */
  width: number;
  height: number;
  resizedFrom?: { bytes: number; width: number; height: number };
  /** Where the picture came from (e.g. its Wikipedia article), if it was fetched. */
  link?: string;
}

export const isImageCard = (e: El): boolean => e?.customData?.kind === IMAGE_CARD && !e.isDeleted;
export const isImageCardContent = (e: El): boolean => e?.customData?.kind === IMAGE_CARD_CONTENT && !e.isDeleted;

/** The one place that decides how image cards look. */
export function imageCardLook() {
  return {
    backgroundColor: cssVar('--color-image-card-bg', '#ffffff'),
    strokeColor: cssVar('--color-image-card-border', '#cfcfcf'),
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: 3 },
  };
}

export function imageCardLayout(pixelWidth: number, pixelHeight: number, maxSide = IMAGE_DISPLAY_MAX) {
  const k = Math.min(1, maxSide / Math.max(pixelWidth, pixelHeight));
  const imageWidth = Math.max(1, Math.round(pixelWidth * k)), imageHeight = Math.max(1, Math.round(pixelHeight * k));
  return { imageWidth, imageHeight, width: imageWidth + 2 * IMAGE_PAD, height: imageHeight + 2 * IMAGE_PAD + IMAGE_CAPTION_H };
}

export interface NewImageCard {
  id: string;
  x: number;
  y: number;
  data: Omit<ImageCardData, 'kind'>;
  /** Longest side of the picture on the canvas (default: IMAGE_DISPLAY_MAX). */
  maxSide?: number;
}

export function addImageCard(elements: El[], spec: NewImageCard, build: Build, makeImage: (raw: El) => El): { elements: El[]; cardId: string; imageId: string; width: number; height: number } {
  const { id: cardId, x, y, data } = spec;
  const imageId = `${cardId}-image`;
  const group = `grp-${cardId}`;
  const lay = imageCardLayout(data.width, data.height, spec.maxSide);
  const look = imageCardLook();

  const card = build([{
    type: 'rectangle', id: cardId, x, y, width: lay.width, height: lay.height, fillStyle: 'solid', ...look,
    customData: { kind: IMAGE_CARD, ...data } satisfies ImageCardData,
  }]).find(e => e.id === cardId)!;
  const image = makeImage({
    type: 'image', id: imageId, x: x + IMAGE_PAD, y: y + IMAGE_PAD, width: lay.imageWidth, height: lay.imageHeight,
    fileId: data.fileId, status: 'saved', scale: [1, 1], strokeColor: 'transparent', backgroundColor: 'transparent',
    customData: { kind: IMAGE_CARD_CONTENT, card: cardId },
  });
  return {
    elements: [...elements, { ...card, groupIds: [group] }, { ...image, groupIds: [group] }],
    cardId, imageId, width: lay.width, height: lay.height,
  };
}

/** Re-apply imageCardLook() to every image card. */
export function restyleImageCards(elements: El[]): El[] {
  const look = imageCardLook();
  return elements.map(e =>
    isImageCard(e)
      ? { ...e, ...look, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() }
      : e,
  );
}
