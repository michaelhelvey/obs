import type { CamConfig } from "./config.ts";
import type { Size } from "./mask.ts";

/** Pixels to cut from each edge of a source. */
export type Crop = CamConfig["crop"];

/** Everything that OBS needs to draw the shaped camera and its border. */
export interface Layout {
  crop: Crop;
  cam: Size;
  radius: number;
  border: Size;
  borderRadius: number;
}

function squareCrop(source: Size, crop: Crop): Crop {
  const width = source.width - crop.left - crop.right;
  const height = source.height - crop.top - crop.bottom;
  const excess = Math.abs(width - height);
  const first = Math.floor(excess / 2);
  const second = excess - first;
  if (width > height) return { ...crop, left: crop.left + first, right: crop.right + second };
  return { ...crop, top: crop.top + first, bottom: crop.bottom + second };
}

const ASPECT_CROP = {
  source: (_source: Size, crop: Crop) => crop,
  square: squareCrop,
} as const;

/**
 * Computes the crop, mask, and border sizes for a source of size `source`.
 * The `square` aspect crops the center of the source to a square.
 * The `full` radius is half of the short side: a circle for a square, a pill for a rectangle.
 *
 * @example
 * layout({ width: 1920, height: 1080 }, config).cam; // { width: 1080, height: 1080 } for a square
 */
export function layout(source: Size, config: CamConfig): Layout {
  const shape = config.shape;
  const crop = ASPECT_CROP[shape.aspect](source, config.crop);
  const cam = {
    width: source.width - crop.left - crop.right,
    height: source.height - crop.top - crop.bottom,
  };
  if (Math.min(cam.width, cam.height) <= 0) throw new Error("crop removes the whole source");
  const radius =
    shape.radius === "full" ? Math.ceil(Math.min(cam.width, cam.height) / 2) : shape.radius;
  const b = config.border.width;
  return {
    crop,
    cam,
    radius,
    border: { width: cam.width + 2 * b, height: cam.height + 2 * b },
    borderRadius: radius + b,
  };
}

/** The scene item transform fields that place an item. */
export interface Placement {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
}

/** Distance from the top-left corner of the camera, in camera source pixels. */
export interface Offset {
  x: number;
  y: number;
}

/**
 * Gives the offset of the border and the card from the camera.
 * The border extends past each camera edge. The card sits above the border with a gap.
 *
 * @example
 * offsets(config).card; // { x: -10, y: -554 } for border 10, gap 24, card height 520
 */
export function offsets(config: CamConfig): { border: Offset; card: Offset } {
  const b = config.border.width;
  return {
    border: { x: -b, y: -b },
    card: { x: -b, y: -b - config.card.gap - config.card.height },
  };
}

/**
 * Places an item at `offset` from the camera, with the same scale as the camera.
 * The camera must use top-left alignment and no rotation.
 *
 * @example
 * attach({ positionX: 100, positionY: 100, scaleX: 0.5, scaleY: 0.5 }, { x: -10, y: -10 });
 * // { positionX: 95, positionY: 95, scaleX: 0.5, scaleY: 0.5 }
 */
export function attach(cam: Placement, offset: Offset): Placement {
  return {
    positionX: cam.positionX + offset.x * cam.scaleX,
    positionY: cam.positionY + offset.y * cam.scaleY,
    scaleX: cam.scaleX,
    scaleY: cam.scaleY,
  };
}
