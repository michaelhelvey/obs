# obs-bs

Scripts that control OBS through obs-websocket (`ws://127.0.0.1:4455`, no auth; set `OBS_URL` to
change).

## Camera shape and card

`cam.json` sets the shape, crop, and border of the camera source, and the task card above it.

- `bun cam watch`: applies `cam.json` and serves the card. Applies again when `cam.json` changes,
  updates the card when `todo.json` changes, and keeps the border and card attached to the camera
  when you move it. The card is empty when this does not run.
- `bun cam apply`: applies `cam.json` one time.
- `bun cam reset`: removes all filters and sources that this tool made (names start with `obs-bs`).

`shape.aspect` is `"source"` (keep the camera aspect) or `"square"` (crop the center to a square).
`shape.radius` is the corner radius in source pixels, or `"full"` for a circle (square) or pill
(source). Set `border.width` to `0` to remove the border. Colors are `#rrggbb` or `#rrggbbaa`.

`card` sets `label`, `accent`, `height` and `gap` (camera source pixels), and `port` of the card
server. The card page is `src/card/page.html`.

Do not crop the camera item in OBS (alt-drag). Use `crop` in `cam.json`.

## Task

- `bun todo <text>`: shows a new task.
- `bun todo done` / `bun todo undo`: marks the task done or not done.
- `bun todo clear`: hides the card.
- `bun todo`: prints the task.
