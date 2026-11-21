import { z } from "zod";

/** Schema of `todo.json`: the task that the card shows. */
export const Todo = z.object({
  text: z.string(),
  done: z.boolean(),
});

/** Parsed `todo.json`. */
export type Todo = z.infer<typeof Todo>;

const EMPTY: Todo = { text: "", done: false };

/**
 * Reads the task file. Gives an empty task when the file does not exist.
 *
 * @example
 * const todo = await loadTodo("todo.json");
 */
export async function loadTodo(path: string): Promise<Todo> {
  const file = Bun.file(path);
  return (await file.exists()) ? Todo.parse(await file.json()) : EMPTY;
}

const EDITS: Record<string, (todo: Todo, args: readonly string[]) => Todo> = {
  done: (todo) => ({ ...todo, done: true }),
  undo: (todo) => ({ ...todo, done: false }),
  clear: () => EMPTY,
};

/**
 * Gives the task after a `bun todo` command.
 * `done`, `undo`, and `clear` change the state. Other words become the new task text.
 *
 * @example
 * editTodo({ text: "a", done: false }, ["done"]); // { text: "a", done: true }
 * editTodo({ text: "a", done: true }, ["ship", "it"]); // { text: "ship it", done: false }
 */
export function editTodo(todo: Todo, args: readonly string[]): Todo {
  const edit =
    EDITS[args.join(" ")] ?? ((_todo, words) => ({ text: words.join(" "), done: false }));
  return edit(todo, args);
}
