import { watch } from "node:fs";
import OBSWebSocket, { EventSubscription } from "obs-websocket-js";
import { apply, reset, syncDecorations, type Applied } from "./cam.ts";
import { cardView, startCardServer } from "./card/server.ts";
import { loadConfig, type CamConfig } from "./config.ts";
import { editTodo, loadTodo } from "./todo.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const CONFIG_PATH = `${ROOT}cam.json`;
const TODO_PATH = `${ROOT}todo.json`;
const OBS_URL = process.env.OBS_URL ?? "ws://127.0.0.1:4455";

async function connect(): Promise<OBSWebSocket> {
  const obs = new OBSWebSocket();
  await obs.connect(OBS_URL, undefined, {
    eventSubscriptions: EventSubscription.All | EventSubscription.SceneItemTransformChanged,
  });
  return obs;
}

async function runApply(obs: OBSWebSocket): Promise<{ config: CamConfig; applied: Applied }> {
  const config = await loadConfig(CONFIG_PATH);
  const applied = await apply(obs, config);
  console.log(`applied to ${applied.items.map((i) => i.sceneName).join(", ")}`);
  return { config, applied };
}

async function runWatch(): Promise<void> {
  const obs = await connect();
  let state = await runApply(obs);
  const card = startCardServer(state.config.card.port);
  const publish = async () =>
    card.publish(cardView(state.config, state.applied.layout, await loadTodo(TODO_PATH)));
  await publish();

  let queue = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job).catch((error: unknown) => console.error(String(error)));
  };

  const onFile: Record<string, () => Promise<void>> = {
    "cam.json": async () => {
      state = await runApply(obs);
      await publish();
    },
    "todo.json": publish,
  };
  watch(ROOT, (_event, filename) => {
    const job = onFile[filename ?? ""];
    if (job) enqueue(job);
  });

  obs.on("SceneItemTransformChanged", (event) => {
    const { items, decorations } = state.applied;
    const item = items.find(
      (i) => i.sceneName === event.sceneName && i.sceneItemId === event.sceneItemId,
    );
    if (!item) return;
    enqueue(() => syncDecorations(obs, [item], decorations));
  });

  console.log(`card on http://127.0.0.1:${state.config.card.port}/`);
  console.log("watching cam.json, todo.json, and camera moves. ctrl-c to stop.");
  await new Promise(() => {});
}

async function withObs(job: (obs: OBSWebSocket) => Promise<unknown>): Promise<void> {
  const obs = await connect();
  await job(obs);
  await obs.disconnect();
}

async function runTodo(args: string[]): Promise<void> {
  const todo =
    args.length === 0 ? await loadTodo(TODO_PATH) : editTodo(await loadTodo(TODO_PATH), args);
  await Bun.write(TODO_PATH, `${JSON.stringify(todo, null, 2)}\n`);
  console.log(todo.done ? `✓ ${todo.text}` : todo.text || "(no task)");
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  apply: () => withObs(runApply),
  watch: runWatch,
  reset: () => withObs(async (obs) => reset(obs, (await loadConfig(CONFIG_PATH)).source)),
  todo: runTodo,
};

const [name = "watch", ...args] = process.argv.slice(2);
const command = commands[name];
if (!command) throw new Error(`usage: bun cam [${Object.keys(commands).join("|")}]`);
await command(args);
