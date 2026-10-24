// Where a peek window goes: centred over the window behind it, most of its
// size. Apart from service.ts so test/unit can run it in Node.

const SIZE = 0.82;

export function peekBounds(parent: { left: number; top: number; width: number; height: number }) {
  const width = Math.round(parent.width * SIZE);
  const height = Math.round(parent.height * SIZE);
  return {
    width,
    height,
    left: parent.left + Math.round((parent.width - width) / 2),
    top: parent.top + Math.round((parent.height - height) / 2),
  };
}
