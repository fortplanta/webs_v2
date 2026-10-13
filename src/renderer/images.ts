// Image intake. Excalidraw's own importer rejects anything over 4 MiB and drops images in at full
// pixel size; every image goes through here instead. Policy:
//   - leave small, reasonably-sized images exactly as they are (no needless quality loss);
//   - otherwise shrink to a canvas-appropriate resolution and re-encode as WebP, aiming well under
//     the cap, because a multi-megabyte image bloats the database, IPC and scene for no visible gain.

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Excalidraw's hard limit
export const TARGET_BYTES = 2.5 * 1024 * 1024; // what we aim for when re-encoding
export const MAX_SIDE = 2048; // longest side, px. Cards are shown at ≤320px, so this is ample for zooming in

export const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/svg+xml'] as const;

export interface ImageMeta { type: string; bytes: number; width: number; height: number }

export type ImagePlan =
  | { action: 'as-is' }
  | { action: 'resize'; scale: number }
  | { action: 'reject'; reason: string };

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Decide what to do with an image, from metadata alone. */
export function planImage({ type, bytes, width, height }: ImageMeta): ImagePlan {
  if (!(SUPPORTED_TYPES as readonly string[]).includes(type)) {
    return { action: 'reject', reason: `${type || 'This file type'} isn't a supported image. Use PNG, JPEG, WebP, GIF, AVIF, BMP or SVG.` };
  }
  if (type === 'image/svg+xml') {
    // Vector: re-encoding would rasterize it. Keep it, but it must fit.
    return bytes <= MAX_FILE_BYTES ? { action: 'as-is' } : { action: 'reject', reason: `This SVG is ${formatBytes(bytes)}; the limit is ${formatBytes(MAX_FILE_BYTES)}. Export it as PNG or WebP first.` };
  }
  if (!(width > 0 && height > 0)) return { action: 'reject', reason: "Couldn't read this image's size." };
  const longSide = Math.max(width, height);
  if (bytes <= MAX_FILE_BYTES && longSide <= MAX_SIDE) return { action: 'as-is' };
  return { action: 'resize', scale: longSide > MAX_SIDE ? MAX_SIDE / longSide : 1 };
}

/**
 * Successive (scale, quality) attempts after the planned scale: quality first, then smaller.
 * Each is tried until one lands at or under TARGET_BYTES.
 */
export function encodeAttempts(plannedScale: number): Array<{ scale: number; quality: number }> {
  const s = plannedScale;
  return [
    { scale: s, quality: 0.9 }, { scale: s, quality: 0.8 }, { scale: s, quality: 0.7 },
    { scale: s * 0.8, quality: 0.8 }, { scale: s * 0.8, quality: 0.7 },
    { scale: s * 0.6, quality: 0.7 }, { scale: s * 0.45, quality: 0.7 }, { scale: s * 0.3, quality: 0.65 },
  ];
}

/** Pick the first result at/under the target, else the smallest one if it fits the hard cap. */
export function chooseEncoding<T extends { bytes: number }>(results: T[]): T | null {
  const good = results.find(r => r.bytes <= TARGET_BYTES);
  if (good) return good;
  const smallest = [...results].sort((a, b) => a.bytes - b.bytes)[0];
  return smallest && smallest.bytes <= MAX_FILE_BYTES ? smallest : null;
}

export interface PreparedImage {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  name: string;
  /** Present when the image was shrunk. */
  resizedFrom?: { bytes: number; width: number; height: number };
}

export class ImageImportError extends Error {}

const EXT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };

/** The file's image type, from its MIME type or (some drops/pastes omit it) its extension; '' if not an image we know. */
export function imageTypeOf(file: { type: string; name: string }): string {
  if (file.type.startsWith('image/')) return file.type;
  return EXT_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

export const looksLikeImage = (file: { type: string; name: string }) => imageTypeOf(file) !== '' || file.type.startsWith('image/');

// ── browser-only below ───────────────────────────────────────────────────────

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageImportError("Couldn't read this image. It may be damaged or in a format the app can't decode (HEIC isn't supported — export it as JPEG or PNG).");
  }
}

async function svgSize(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth || 300, height: img.naturalHeight || 150 };
  } catch {
    throw new ImageImportError("Couldn't read this SVG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeWebp(bitmap: ImageBitmap, scale: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve({ blob: b, width, height }) : reject(new ImageImportError('Encoding failed.'))), 'image/webp', quality));
}

/** Read, validate and (if needed) shrink an image so it's ready to place on the canvas. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const type = imageTypeOf(file) || file.type;
  if (type === 'image/svg+xml') {
    const { width, height } = await svgSize(file);
    const plan = planImage({ type, bytes: file.size, width, height });
    if (plan.action === 'reject') throw new ImageImportError(plan.reason);
    return { blob: file, mimeType: type, width, height, name: file.name };
  }

  const first = planImage({ type, bytes: file.size, width: 1, height: 1 }); // type check before decoding
  if (first.action === 'reject') throw new ImageImportError(first.reason);

  const bitmap = await decode(file);
  try {
    const plan = planImage({ type, bytes: file.size, width: bitmap.width, height: bitmap.height });
    if (plan.action === 'reject') throw new ImageImportError(plan.reason);
    if (plan.action === 'as-is') return { blob: file, mimeType: type, width: bitmap.width, height: bitmap.height, name: file.name };

    const tried: Array<{ bytes: number; blob: Blob; width: number; height: number }> = [];
    for (const a of encodeAttempts(plan.scale)) {
      const enc = await encodeWebp(bitmap, a.scale, a.quality);
      tried.push({ ...enc, bytes: enc.blob.size });
      if (enc.blob.size <= TARGET_BYTES) break;
    }
    const best = chooseEncoding(tried);
    if (!best) throw new ImageImportError(`Couldn't shrink this image under ${formatBytes(MAX_FILE_BYTES)}.`);
    return {
      blob: best.blob, mimeType: 'image/webp', width: best.width, height: best.height, name: file.name,
      resizedFrom: { bytes: file.size, width: bitmap.width, height: bitmap.height },
    };
  } finally {
    bitmap.close();
  }
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new ImageImportError("Couldn't read the image data."));
    r.readAsDataURL(blob);
  });
}

/** Excalidraw identifies files by the SHA-1 of their content, so identical images share one entry. */
export async function contentId(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function describeResize(name: string, from: { bytes: number; width: number; height: number }, to: { bytes: number; width: number; height: number }): string {
  return `Resized ${name}: ${formatBytes(from.bytes)} → ${formatBytes(to.bytes)} (${from.width}×${from.height} → ${to.width}×${to.height}).`;
}


/** A data: URL as a Blob, without fetch() (this app's content-security policy only lets fetch reach its own origin). */
export function dataUrlToBlob(dataURL: string): Blob {
  const comma = dataURL.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataURL)?.[1] ?? 'application/octet-stream';
  const bin = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
