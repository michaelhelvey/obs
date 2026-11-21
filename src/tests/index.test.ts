import { describe, expect, it } from "bun:test";
import { inflateSync } from "node:zlib";
import { CamConfig, obsColor } from "../config.ts";
import { attach, layout, offsets } from "../geometry.ts";
import { roundedRectAlpha, roundedRectMask } from "../mask.ts";
import { editTodo } from "../todo.ts";

const square = { width: 100, height: 100 };

describe("roundedRectAlpha", () => {
  it.each([
    { x: 0, y: 0, alpha: 0, where: "cut corner" },
    { x: 99, y: 99, alpha: 0, where: "opposite cut corner" },
    { x: 50, y: 0, alpha: 1, where: "top edge middle" },
    { x: 50, y: 50, alpha: 1, where: "center" },
    { x: 0, y: 50, alpha: 1, where: "left edge middle" },
  ])("is $alpha at the $where", ({ x, y, alpha }) => {
    expect(roundedRectAlpha(square, 20, x, y)).toBe(alpha);
  });

  it("makes a circle when the radius is half the size", () => {
    const onDiagonal = Math.round(50 - 50 / Math.SQRT2);
    expect(roundedRectAlpha(square, 50, onDiagonal - 2, onDiagonal - 2)).toBe(0);
    expect(roundedRectAlpha(square, 50, onDiagonal + 2, onDiagonal + 2)).toBe(1);
  });
});

describe("roundedRectMask", () => {
  it("encodes a PNG whose decoded alpha matches the shape", () => {
    const png = roundedRectMask({ width: 4, height: 3 }, 1);
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([4, 3]);

    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    const alphaAt = (x: number, y: number) => raw[y * (4 * 4 + 1) + 1 + x * 4 + 3];
    expect(alphaAt(0, 0)).toBeLessThan(255);
    expect(alphaAt(1, 1)).toBe(255);
  });
});

describe("layout", () => {
  const source = { width: 1920, height: 1080 };

  it("crops a square aspect to a centered square on top of the user crop", () => {
    const config = CamConfig.parse({
      shape: { aspect: "square", radius: 120 },
      crop: { left: 100 },
    });
    const l = layout(source, config);
    expect(l.cam).toEqual({ width: 1080, height: 1080 });
    expect(l.crop.left - 100).toBe(l.crop.right);
    expect(l.radius).toBe(120);
  });

  it.each([
    { aspect: "square", width: 1080, what: "a circle" },
    { aspect: "source", width: 1920, what: "a pill" },
  ] as const)("makes $what with a full radius", ({ aspect, width }) => {
    const l = layout(source, CamConfig.parse({ shape: { aspect, radius: "full" } }));
    expect(l.cam.width).toBe(width);
    expect(l.radius).toBe(540);
  });

  it("grows the border by its width on each side", () => {
    const config = CamConfig.parse({
      shape: { radius: 50 },
      border: { width: 8, color: "#000000" },
    });
    const l = layout(source, config);
    expect(l.border).toEqual({ width: 1936, height: 1096 });
    expect(l.borderRadius).toBe(58);
  });

  it("rejects a crop that removes the whole source", () => {
    expect(() => layout(source, CamConfig.parse({ crop: { left: 1000, right: 1000 } }))).toThrow();
  });
});

describe("attach", () => {
  const cam = { positionX: 1000, positionY: 2000, scaleX: 0.5, scaleY: 0.25 };
  const config = CamConfig.parse({
    border: { width: 8, color: "#ffffff" },
    card: { height: 400, gap: 20 },
  });

  it("puts the border 8 source pixels outside the camera", () => {
    expect(attach(cam, offsets(config).border)).toEqual({
      ...cam,
      positionX: 996,
      positionY: 1998,
    });
  });

  it("puts the bottom of the card one gap above the top of the border", () => {
    const card = attach(cam, offsets(config).card);
    const cardBottom = card.positionY + config.card.height * card.scaleY;
    const borderTop = attach(cam, offsets(config).border).positionY;
    expect(borderTop - cardBottom).toBe(config.card.gap * cam.scaleY);
    expect(card.positionX).toBe(996);
  });
});

describe("editTodo", () => {
  const todo = { text: "write a compiler", done: false };

  it.each([
    { args: ["done"], expected: { text: "write a compiler", done: true } },
    { args: ["undo"], expected: todo },
    { args: ["clear"], expected: { text: "", done: false } },
    { args: ["emit", "machine", "code"], expected: { text: "emit machine code", done: false } },
  ])("$args gives $expected", ({ args, expected }) => {
    expect(editTodo({ ...todo, done: true }, args)).toEqual(expected);
  });
});

describe("obsColor", () => {
  it.each([
    { hex: "#ff0000", abgr: 0xff0000ff },
    { hex: "#00ff0080", abgr: 0x8000ff00 },
    { hex: "#0000ff", abgr: 0xffff0000 },
  ])("converts $hex to ABGR", ({ hex, abgr }) => {
    expect(obsColor(hex)).toBe(abgr);
  });
});
