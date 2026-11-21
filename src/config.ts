import { z } from "zod";

const crop = z.object({
  left: z.number().int().min(0).default(0),
  top: z.number().int().min(0).default(0),
  right: z.number().int().min(0).default(0),
  bottom: z.number().int().min(0).default(0),
});

const hexColor = z.string().regex(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i, "use #rrggbb or #rrggbbaa");

/** Schema of `cam.json`. */
export const CamConfig = z.object({
  source: z.string().default("Video Capture Device"),
  shape: z
    .object({
      aspect: z.enum(["source", "square"]).default("source"),
      radius: z.union([z.number().int().min(0), z.literal("full")]).default(96),
    })
    .default({ aspect: "source", radius: 96 }),
  crop: crop.default({ left: 0, top: 0, right: 0, bottom: 0 }),
  border: z
    .object({
      width: z.number().int().min(0),
      color: hexColor,
    })
    .default({ width: 0, color: "#ffffff" }),
  card: z
    .object({
      label: z.string().default("now"),
      accent: hexColor.default("#89b4fa"),
      height: z.number().int().min(1).default(520),
      gap: z.number().int().default(24),
      port: z.number().int().default(4466),
    })
    .prefault({}),
});

/** Parsed `cam.json`. */
export type CamConfig = z.infer<typeof CamConfig>;

/**
 * Reads and parses a camera config file.
 *
 * @example
 * const config = await loadConfig("cam.json");
 */
export async function loadConfig(path: string): Promise<CamConfig> {
  return CamConfig.parse(await Bun.file(path).json());
}

/**
 * Converts `#rrggbb` or `#rrggbbaa` to the ABGR integer that OBS uses for colors.
 *
 * @example
 * obsColor("#ff000080"); // 0x800000ff
 */
export function obsColor(hex: string): number {
  const rgba = parseInt(hex.slice(1).padEnd(8, "f"), 16);
  const byte = (shift: number) => (rgba >>> shift) & 0xff;
  return ((byte(0) << 24) | (byte(8) << 16) | (byte(16) << 8) | byte(24)) >>> 0;
}
