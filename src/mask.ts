import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodePng } from "./png.ts";

/** Size of a rectangle in pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * Gives the coverage (0 to 1) of the pixel at (x, y) by a rounded rectangle that fills `size`.
 * Edges are anti-aliased over one pixel.
 *
 * @example
 * roundedRectAlpha({ width: 100, height: 100 }, 20, 0, 0); // 0, the corner is cut
 * roundedRectAlpha({ width: 100, height: 100 }, 20, 50, 50); // 1
 */
export function roundedRectAlpha(size: Size, radius: number, x: number, y: number): number {
  const r = Math.min(radius, size.width / 2, size.height / 2);
  const qx = Math.abs(x + 0.5 - size.width / 2) - (size.width / 2 - r);
  const qy = Math.abs(y + 0.5 - size.height / 2) - (size.height / 2 - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return Math.min(Math.max(0.5 - (outside + inside - r), 0), 1);
}

/**
 * Makes a white PNG whose alpha channel is a rounded rectangle that fills `size`.
 *
 * @example
 * const png = roundedRectMask({ width: 1920, height: 1080 }, 120);
 */
export function roundedRectMask(size: Size, radius: number): Uint8Array {
  const rgba = new Uint8Array(size.width * size.height * 4).fill(255);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      rgba[(y * size.width + x) * 4 + 3] = Math.round(roundedRectAlpha(size, radius, x, y) * 255);
    }
  }
  return encodePng(size.width, size.height, rgba);
}

/**
 * Writes a rounded rectangle mask to `dir` and gives its absolute path.
 * The file name contains the parameters, so OBS loads a new file when they change.
 *
 * @example
 * const path = await writeMask("masks", { width: 1920, height: 1080 }, 120);
 */
export async function writeMask(dir: string, size: Size, radius: number): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = resolve(join(dir, `rounded-${size.width}x${size.height}-r${radius}.png`));
  if (!(await Bun.file(path).exists())) await Bun.write(path, roundedRectMask(size, radius));
  return path;
}
