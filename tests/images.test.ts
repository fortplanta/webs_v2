import { describe, it, expect } from 'vitest';
import { chooseEncoding, encodeAttempts, formatBytes, imageTypeOf, looksLikeImage, MAX_FILE_BYTES, MAX_SIDE, planImage, TARGET_BYTES } from '../src/renderer/images';
import { addImageCard, imageCardLayout, imageCardLook, IMAGE_CAPTION_H, IMAGE_PAD, isImageCard, restyleImageCards } from '../src/renderer/imageCard';
import { removeBox, updateBox, type El } from '../src/renderer/sceneEdit';
import { captionLabel } from '../src/renderer/boxes';
import { hitTest } from '../src/renderer/hit';
import { revealView } from '../src/renderer/viewport';
import { WebStore } from '../src/backend/db';

const MB = 1024 * 1024;

describe('planImage', () => {
  const png = (bytes: number, width: number, height: number) => planImage({ type: 'image/png', bytes, width, height });
  it('leaves modest images exactly as they are', () => {
    expect(png(300 * 1024, 800, 600)).toEqual({ action: 'as-is' });
    expect(png(MAX_FILE_BYTES, MAX_SIDE, 100)).toEqual({ action: 'as-is' }); // exactly at both limits
  });
  it('shrinks files over the cap, keeping the planned scale at 1 if the pixels are already small', () => {
    expect(png(17 * MB, 1500, 1000)).toEqual({ action: 'resize', scale: 1 });
  });
  it('shrinks very large pixel dimensions even when the file is small', () => {
    expect(png(1.6 * MB, 5000, 3500)).toEqual({ action: 'resize', scale: MAX_SIDE / 5000 });
    expect(png(1 * MB, 1000, MAX_SIDE + 1)).toMatchObject({ action: 'resize' });
  });
  it('handles both at once', () => {
    expect(png(40 * MB, 8000, 6000)).toEqual({ action: 'resize', scale: MAX_SIDE / 8000 });
  });
  it('keeps SVGs as they are if they fit, rejects them if they do not (never rasterizes them)', () => {
    expect(planImage({ type: 'image/svg+xml', bytes: 50_000, width: 9000, height: 9000 })).toEqual({ action: 'as-is' });
    expect(planImage({ type: 'image/svg+xml', bytes: 5 * MB, width: 100, height: 100 })).toMatchObject({ action: 'reject' });
  });
  it('rejects unsupported types and unreadable sizes with a reason', () => {
    expect(planImage({ type: 'image/heic', bytes: 1000, width: 10, height: 10 })).toMatchObject({ action: 'reject', reason: expect.stringContaining('image/heic') });
    expect(planImage({ type: '', bytes: 1000, width: 10, height: 10 })).toMatchObject({ action: 'reject' });
    expect(png(1000, 0, 0)).toMatchObject({ action: 'reject' });
  });
});

describe('encoding strategy', () => {
  it('tries quality first, then smaller sizes, always relative to the planned scale', () => {
    const a = encodeAttempts(0.5);
    expect(a[0]).toEqual({ scale: 0.5, quality: 0.9 });
    expect(a.map(x => x.scale)).toEqual([...a.map(x => x.scale)].sort((p, q) => q - p)); // never grows
    expect(a.at(-1)!.scale).toBeLessThan(0.5 * 0.5);
  });
  it('picks the first result under target, else the smallest that fits the cap, else nothing', () => {
    expect(chooseEncoding([{ bytes: TARGET_BYTES + 1 }, { bytes: TARGET_BYTES - 1 }, { bytes: 10 }])).toEqual({ bytes: TARGET_BYTES - 1 });
    expect(chooseEncoding([{ bytes: MAX_FILE_BYTES - 5 }, { bytes: MAX_FILE_BYTES - 50 }])).toEqual({ bytes: MAX_FILE_BYTES - 50 });
    expect(chooseEncoding([{ bytes: MAX_FILE_BYTES + 1 }])).toBeNull();
    expect(chooseEncoding([])).toBeNull();
  });
  it('formats sizes and recognises images by type or extension', () => {
    expect(formatBytes(17.17 * MB)).toBe('17.2 MB'); expect(formatBytes(2048)).toBe('2 KB');
    expect(imageTypeOf({ type: '', name: 'Photo.JPG' })).toBe('image/jpeg');
    expect(imageTypeOf({ type: 'image/png', name: 'x' })).toBe('image/png');
    expect(looksLikeImage({ type: '', name: 'notes.txt' })).toBe(false);
    expect(looksLikeImage({ type: 'image/heic', name: 'x.heic' })).toBe(true); // an image, so we can explain why it's rejected
  });
});

describe('image card', () => {
  const build = (sk: unknown[]): El[] => (sk as El[]).map(({ label: _l, ...b }) => ({ version: 1, ...b }));
  const makeImage = (raw: El): El => ({ version: 1, angle: 0, ...raw });
  const data = { fileId: 'abc', caption: '', name: 'cat.png', width: 800, height: 400 };

  it('sizes the picture to the display max and wraps it with padding plus a caption strip', () => {
    expect(imageCardLayout(800, 400)).toEqual({ imageWidth: 320, imageHeight: 160, width: 320 + 2 * IMAGE_PAD, height: 160 + 2 * IMAGE_PAD + IMAGE_CAPTION_H });
    expect(imageCardLayout(100, 50)).toMatchObject({ imageWidth: 100, imageHeight: 50 }); // never upscaled
  });

  it('builds a tagged card plus its picture, both in one group so they move/rotate/resize together', () => {
    const { elements, cardId, imageId } = addImageCard([], { id: 'm-1', x: 10, y: 20, data }, build, makeImage);
    const card = elements.find(e => e.id === cardId)!, img = elements.find(e => e.id === imageId)!;
    expect(card).toMatchObject({ type: 'rectangle', x: 10, y: 20, customData: { kind: 'image-card', fileId: 'abc', name: 'cat.png' } });
    expect(img).toMatchObject({ type: 'image', fileId: 'abc', x: 10 + IMAGE_PAD, y: 20 + IMAGE_PAD, customData: { kind: 'image-card-content', card: 'm-1' } });
    expect(card.groupIds).toEqual(img.groupIds);
    expect(card.groupIds).toHaveLength(1);
    // the picture sits inside the card's padding, above the caption strip
    expect(img.x + img.width).toBe(card.x + card.width - IMAGE_PAD);
    expect(img.y + img.height).toBeLessThanOrEqual(card.y + card.height - IMAGE_CAPTION_H);
    expect(elements.indexOf(img)).toBeGreaterThan(elements.indexOf(card)); // picture draws on top
    expect(isImageCard(card)).toBe(true); expect(isImageCard(img)).toBe(false);
  });

  it('is targetable as a component and restylable from one place', () => {
    const { elements } = addImageCard([{ id: 'f', type: 'rectangle', version: 1, customData: { kind: 'fragment' } }], { id: 'm-1', x: 0, y: 0, data }, build, makeImage);
    expect(elements.filter(isImageCard).map(e => e.id)).toEqual(['m-1']);
    const restyled = restyleImageCards(elements.map(e => (isImageCard(e) ? { ...e, backgroundColor: '#ff0000' } : e)));
    expect(restyled.find(e => e.id === 'm-1')).toMatchObject({ backgroundColor: imageCardLook().backgroundColor, version: 2 });
    expect(restyled.find(e => e.id === 'f')).toBe(elements.find(e => e.id === 'f')); // fragments untouched
  });

  it('captions inherit the card group; deleting the card takes the picture and caption with it', () => {
    const { elements } = addImageCard([], { id: 'm-1', x: 0, y: 0, data }, build, makeImage);
    const withCaption = updateBox(elements, 'm-1', { label: captionLabel('A cat') }, (sk) => {
      const r = (sk as El[])[0]; return [{ ...r, version: 1 }, { type: 'text', id: 'tmp-t', containerId: r.id, text: (r.label as any).text, x: 0, y: 0, width: 5, height: 5, version: 1 }];
    });
    const label = withCaption.find(e => e.type === 'text')!;
    expect(label.groupIds).toEqual(elements[0].groupIds);
    const gone = removeBox(withCaption, 'm-1');
    expect(gone.filter(e => e.isDeleted).map(e => e.id).sort()).toEqual(['m-1', 'm-1-image', label.id].sort());
  });

  it('is found by double-click even when rotated, and not outside its rotated outline', () => {
    const { elements } = addImageCard([], { id: 'm-1', x: 0, y: 0, data: { ...data, width: 320, height: 40 } }, build, makeImage); // wide, short card
    const card = elements[0];
    const rotated = elements.map(e => ({ ...e, angle: Math.PI / 2 })); // 90° about each element's own center
    const cx = card.x + card.width / 2, cy = card.y + card.height / 2;
    expect(hitTest(elements, cx + card.width / 2 - 5, cy, 1)).toEqual({ id: 'm-1', kind: 'image' });
    expect(hitTest(rotated, cx + card.width / 2 - 5, cy, 1)).toBeNull(); // that point is outside once turned upright
    expect(hitTest(rotated, cx, cy + card.width / 2 - 5, 1)).toEqual({ id: 'm-1', kind: 'image' }); // now the long side is vertical
  });
});

describe('image files are stored with the web', () => {
  const dataURL = (mime: string, bytes: number[]) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  const model: any = { query: 'q', phase: 'done', status: '', error: null, kb: [], context: null, clusters: [{ title: 'A', slots: [{ type: 'concept', title: 't', body: 'b' }] }], edges: [] };

  it('round-trips pixels, is idempotent per id, and is returned with the web', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'w', query: 'q', model });
    s.saveFile('w', { id: 'f1', mimeType: 'image/png', dataURL: dataURL('image/png', [1, 2, 3, 255]), created: 5 });
    s.saveFile('w', { id: 'f1', mimeType: 'image/png', dataURL: dataURL('image/png', [9, 9, 9]), created: 6 }); // same id: ignored
    s.saveFile('other', { id: 'f1', mimeType: 'image/webp', dataURL: dataURL('image/webp', [7]), created: 1 });
    const web = s.get('w')!;
    expect(web.files).toEqual([{ id: 'f1', mimeType: 'image/png', created: 5, dataURL: dataURL('image/png', [1, 2, 3, 255]) }]);
  });
  it('rejects non-image and malformed data, and removes files with the web', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'w', query: 'q', model });
    expect(() => s.saveFile('w', { id: 'x', mimeType: 'text/html', dataURL: dataURL('text/html', [60]), created: 1 })).toThrow(/Unsupported/);
    expect(() => s.saveFile('w', { id: 'x', mimeType: 'image/png', dataURL: 'data:image/png;base64,@@@', created: 1 })).toThrow(/base64/);
    expect(() => s.saveFile('w', { id: 'x', mimeType: 'image/png', dataURL: 'https://x.com/a.png', created: 1 })).toThrow();
    s.saveFile('w', { id: 'f', mimeType: 'image/png', dataURL: dataURL('image/png', [1]), created: 1 });
    s.delete('w');
    expect(s.files('w')).toEqual([]);
  });
});

describe('revealView', () => {
  const view = { scrollX: 0, scrollY: 0, zoom: 1, width: 1000, height: 600 };
  it('does nothing when the new content is already fully visible', () => {
    expect(revealView(view, { x: 100, y: 100, width: 300, height: 200 })).toBeNull();
  });
  it('re-centers off-screen content without zooming in', () => {
    const v = revealView(view, { x: 2000, y: 1000, width: 300, height: 200 })!;
    expect(v.zoom).toBe(1); // small content: keep the zoom
    expect(2150 * v.zoom + v.scrollX * v.zoom).toBeCloseTo(500); // its center lands mid-viewport (x)
    expect(1100 * v.zoom + v.scrollY * v.zoom).toBeCloseTo(300); // (y)
  });
  it('zooms out only as far as needed to fit wide content, never in', () => {
    const v = revealView(view, { x: 0, y: 0, width: 3000, height: 300 })!;
    expect(v.zoom).toBeCloseTo((1000 * 0.85) / 3000);
    const zoomedOut = revealView({ ...view, zoom: 0.2 }, { x: 5000, y: 0, width: 300, height: 200 })!;
    expect(zoomedOut.zoom).toBe(0.2);
  });
});
