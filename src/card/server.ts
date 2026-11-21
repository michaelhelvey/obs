import type { CamConfig } from "../config.ts";
import type { Layout } from "../geometry.ts";
import type { Todo } from "../todo.ts";

/** Everything that the card page draws. Sizes are in camera source pixels. */
export interface CardView {
  todo: Todo;
  label: string;
  accent: string;
  border: { width: number; color: string };
  radius: number;
}

/**
 * Makes the card view from the config, the camera layout, and the task.
 *
 * @example
 * const view = cardView(config, layout(source, config), todo);
 */
export function cardView(config: CamConfig, l: Layout, todo: Todo): CardView {
  return {
    todo,
    label: config.card.label,
    accent: config.card.accent,
    border: config.border,
    radius: l.borderRadius,
  };
}

const PAGE = new URL("./page.html", import.meta.url).pathname;
const encoder = new TextEncoder();

/**
 * Serves the card page and pushes each published view to every open page with server-sent events.
 *
 * @example
 * const card = startCardServer(4466);
 * card.publish(view);
 */
export function startCardServer(port: number): { publish: (view: CardView) => void } {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let latest: CardView | undefined;
  const frame = (view: CardView) => encoder.encode(`data: ${JSON.stringify(view)}\n\n`);

  const events = () => {
    let self: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        self = controller;
        clients.add(controller);
        if (latest) controller.enqueue(frame(latest));
      },
      cancel() {
        clients.delete(self);
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  };

  Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    routes: {
      "/": () => new Response(Bun.file(PAGE)),
      "/events": events,
    },
  });

  return {
    publish(view) {
      latest = view;
      for (const client of clients) client.enqueue(frame(view));
    },
  };
}
