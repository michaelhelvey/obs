import type OBSWebSocket from "obs-websocket-js";
import { z } from "zod";
import { obsColor, type CamConfig } from "./config.ts";
import { attach, layout, offsets, type Crop, type Layout, type Offset } from "./geometry.ts";
import { writeMask, type Size } from "./mask.ts";

/** Names of the OBS objects that this tool owns. */
export const NAMES = {
  crop: "obs-bs crop",
  mask: "obs-bs mask",
  border: "obs-bs border",
  card: "obs-bs card",
} as const;

const MASK_DIR = new URL("../masks", import.meta.url).pathname;

const CamTransform = z.object(
  {
    alignment: z.literal(5),
    rotation: z.literal(0),
    boundsType: z.literal("OBS_BOUNDS_NONE"),
    cropLeft: z.literal(0),
    cropTop: z.literal(0),
    cropRight: z.literal(0),
    cropBottom: z.literal(0),
    positionX: z.number(),
    positionY: z.number(),
    scaleX: z.number(),
    scaleY: z.number(),
    sourceWidth: z.number(),
    sourceHeight: z.number(),
  },
  {
    error: () =>
      "camera item must have top-left alignment, no rotation, no bounds, and no item crop (use cam.json crop)",
  },
);

const CropSettings = z.object({
  left: z.number().default(0),
  top: z.number().default(0),
  right: z.number().default(0),
  bottom: z.number().default(0),
});

const SceneList = z.array(z.object({ sceneName: z.string() }));
const SceneItemList = z.array(z.object({ sourceName: z.string(), sceneItemId: z.number() }));

/** A scene that shows the camera source. */
export interface CamItem {
  sceneName: string;
  sceneItemId: number;
}

/**
 * Finds every scene item that shows `source`.
 *
 * @example
 * const items = await findCamItems(obs, "Video Capture Device");
 */
export async function findCamItems(obs: OBSWebSocket, source: string): Promise<CamItem[]> {
  const scenes = SceneList.parse((await obs.call("GetSceneList")).scenes);
  const lists = await Promise.all(
    scenes.map(async ({ sceneName }) => {
      const sceneItems = SceneItemList.parse(
        (await obs.call("GetSceneItemList", { sceneName })).sceneItems,
      );
      return sceneItems
        .filter((item) => item.sourceName === source)
        .map((item) => ({ sceneName, sceneItemId: item.sceneItemId }));
    }),
  );
  return lists.flat();
}

async function currentCrop(obs: OBSWebSocket, source: string): Promise<Crop> {
  const filter = await obs
    .call("GetSourceFilter", { sourceName: source, filterName: NAMES.crop })
    .catch(() => undefined);
  return CropSettings.parse(filter?.filterSettings ?? {});
}

async function camTransform(obs: OBSWebSocket, item: CamItem) {
  const { sceneItemTransform } = await obs.call("GetSceneItemTransform", item);
  return CamTransform.parse(sceneItemTransform);
}

async function rawSourceSize(obs: OBSWebSocket, source: string, item: CamItem): Promise<Size> {
  const [t, crop] = await Promise.all([camTransform(obs, item), currentCrop(obs, source)]);
  return {
    width: t.sourceWidth + crop.left + crop.right,
    height: t.sourceHeight + crop.top + crop.bottom,
  };
}

type FilterSettings = Record<string, string | number | boolean>;

async function upsertFilter(
  obs: OBSWebSocket,
  sourceName: string,
  filter: { name: string; kind: string; index: number; settings: FilterSettings },
): Promise<void> {
  const ref = { sourceName, filterName: filter.name };
  const exists = await obs.call("GetSourceFilter", ref).then(
    () => true,
    () => false,
  );
  await (exists
    ? obs.call("SetSourceFilterSettings", {
        ...ref,
        filterSettings: filter.settings,
        overlay: true,
      })
    : obs.call("CreateSourceFilter", {
        ...ref,
        filterKind: filter.kind,
        filterSettings: filter.settings,
      }));
  await obs.call("SetSourceFilterIndex", { ...ref, filterIndex: filter.index });
}

async function maskFilter(
  obs: OBSWebSocket,
  sourceName: string,
  size: Size,
  radius: number,
  index: number,
) {
  const imagePath = await writeMask(MASK_DIR, size, radius);
  await upsertFilter(obs, sourceName, {
    name: NAMES.mask,
    kind: "mask_filter_v2",
    index,
    settings: { type: "mask_alpha_filter.effect", image_path: imagePath, stretch: true },
  });
}

async function removeInput(obs: OBSWebSocket, inputName: string): Promise<void> {
  await obs.call("RemoveInput", { inputName }).catch(() => undefined);
}

async function upsertInput(
  obs: OBSWebSocket,
  input: { name: string; kind: string; settings: FilterSettings },
  sceneName: string,
): Promise<void> {
  const exists = await obs.call("GetInputSettings", { inputName: input.name }).then(
    () => true,
    () => false,
  );
  await (exists
    ? obs.call("SetInputSettings", { inputName: input.name, inputSettings: input.settings })
    : obs.call("CreateInput", {
        sceneName,
        inputName: input.name,
        inputKind: input.kind,
        inputSettings: input.settings,
      }));
}

/** A source that this tool attaches to the camera in each scene. */
export interface Decoration {
  name: string;
  offset: Offset;
  above: boolean;
}

async function decorationItemId(obs: OBSWebSocket, sceneName: string, sourceName: string) {
  const found = await obs
    .call("GetSceneItemId", { sceneName, sourceName })
    .catch(() => obs.call("CreateSceneItem", { sceneName, sourceName }));
  return found.sceneItemId;
}

/**
 * Moves a decoration in one scene to its offset from the camera, and above or below the camera.
 *
 * @example
 * await syncDecoration(obs, { sceneName: "Talking", sceneItemId: 1 }, decoration);
 */
export async function syncDecoration(
  obs: OBSWebSocket,
  item: CamItem,
  decoration: Decoration,
): Promise<void> {
  const id = await decorationItemId(obs, item.sceneName, decoration.name);
  const ref = { sceneName: item.sceneName, sceneItemId: id };
  const [t, camIndex, ownIndex] = await Promise.all([
    camTransform(obs, item),
    obs.call("GetSceneItemIndex", item),
    obs.call("GetSceneItemIndex", ref),
  ]);
  await obs.call("SetSceneItemTransform", {
    ...ref,
    sceneItemTransform: { ...attach(t, decoration.offset), alignment: 5, rotation: 0 },
  });
  const wrongSide = decoration.above === ownIndex.sceneItemIndex < camIndex.sceneItemIndex;
  await (wrongSide
    ? obs.call("SetSceneItemIndex", { ...ref, sceneItemIndex: camIndex.sceneItemIndex })
    : Promise.resolve());
}

async function applyBorder(obs: OBSWebSocket, config: CamConfig, l: Layout, sceneName: string) {
  const settings = {
    color: obsColor(config.border.color),
    width: l.border.width,
    height: l.border.height,
  };
  await upsertInput(obs, { name: NAMES.border, kind: "color_source_v3", settings }, sceneName);
  await maskFilter(obs, NAMES.border, l.border, l.borderRadius, 0);
  return [{ name: NAMES.border, offset: offsets(config).border, above: false }];
}

async function removeBorder(obs: OBSWebSocket) {
  await removeInput(obs, NAMES.border);
  return [];
}

async function applyCard(obs: OBSWebSocket, config: CamConfig, l: Layout, sceneName: string) {
  const settings = {
    url: `http://127.0.0.1:${config.card.port}/`,
    width: l.border.width,
    height: config.card.height,
    fps: 60,
    css: "",
  };
  await upsertInput(obs, { name: NAMES.card, kind: "browser_source", settings }, sceneName);
  return { name: NAMES.card, offset: offsets(config).card, above: true };
}

/** What `apply` did: the camera items and the decorations attached to them. */
export interface Applied {
  layout: Layout;
  items: CamItem[];
  decorations: Decoration[];
}

/**
 * Applies `config` to OBS: crops and masks the camera, then attaches the border and the card
 * to the camera in each scene.
 *
 * @example
 * const { items } = await apply(obs, await loadConfig("cam.json"));
 */
export async function apply(obs: OBSWebSocket, config: CamConfig): Promise<Applied> {
  const items = await findCamItems(obs, config.source);
  const [first] = items;
  if (!first) throw new Error(`no scene shows the source "${config.source}"`);

  const l = layout(await rawSourceSize(obs, config.source, first), config);
  await upsertFilter(obs, config.source, {
    name: NAMES.crop,
    kind: "crop_filter",
    index: 0,
    settings: { ...l.crop, relative: true },
  });
  await maskFilter(obs, config.source, l.cam, l.radius, 1);

  const decorations = await applyDecorations(obs, config, l, first.sceneName);
  await syncDecorations(obs, items, decorations);
  return { layout: l, items, decorations };
}

async function applyDecorations(
  obs: OBSWebSocket,
  config: CamConfig,
  l: Layout,
  sceneName: string,
): Promise<Decoration[]> {
  const border = config.border.width > 0;
  return [
    ...(await (border ? applyBorder(obs, config, l, sceneName) : removeBorder(obs))),
    await applyCard(obs, config, l, sceneName),
  ];
}

/**
 * Syncs every decoration with every camera item, one at a time, because concurrent
 * index changes in one scene can race.
 *
 * @example
 * await syncDecorations(obs, applied.items, applied.decorations);
 */
export async function syncDecorations(
  obs: OBSWebSocket,
  items: CamItem[],
  decorations: Decoration[],
): Promise<void> {
  const jobs = items.flatMap((item) => decorations.map((decoration) => ({ item, decoration })));
  await jobs.reduce(
    (previous, { item, decoration }) => previous.then(() => syncDecoration(obs, item, decoration)),
    Promise.resolve(),
  );
}

/**
 * Removes every filter and source that this tool made.
 *
 * @example
 * await reset(obs, "Video Capture Device");
 */
export async function reset(obs: OBSWebSocket, source: string): Promise<void> {
  const remove = (filterName: string) =>
    obs.call("RemoveSourceFilter", { sourceName: source, filterName }).catch(() => undefined);
  await Promise.all([
    remove(NAMES.crop),
    remove(NAMES.mask),
    removeInput(obs, NAMES.border),
    removeInput(obs, NAMES.card),
  ]);
}
