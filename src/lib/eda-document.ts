import type { CircuitDocument, PinReference, Point, SchematicPart, WireConnection } from "./eda-types";

export const TWO_TERMINAL_TYPES = new Set([
  "resistor", "capacitor", "inductor", "voltage", "current", "ac-source", "pulse-source",
  "function-generator", "diode", "led", "zener", "schottky", "switch", "fuse", "lamp",
  "motor", "crystal", "buzzer", "thermistor", "photodiode", "varactor", "vccs", "cccs",
]);

export function getPinOffsets(type: string): Point[] {
  switch (type) {
    case "ground":
      return [{ x: 0, y: -20 }];
    case "potentiometer":
      return [{ x: -42, y: 0 }, { x: 0, y: 30 }, { x: 42, y: 0 }];
    case "transformer":
    case "relay":
      return [{ x: -42, y: -22 }, { x: -42, y: 22 }, { x: 42, y: -22 }, { x: 42, y: 22 }];
    case "vcvs":
    case "vccs":
    case "ccvs":
    case "cccs":
      return [{ x: -40, y: -20 }, { x: -40, y: 20 }, { x: 40, y: -20 }, { x: 40, y: 20 }];
    case "opamp":
    case "comparator":
      return [
        { x: -56, y: -18 }, { x: -56, y: 18 }, { x: 56, y: 0 },
        { x: 0, y: -42 }, { x: 0, y: 42 },
      ];
    case "timer":
      return [
        { x: -56, y: -32 }, { x: -56, y: -12 }, { x: -56, y: 12 }, { x: 56, y: 0 },
        { x: -56, y: 32 }, { x: 0, y: -42 }, { x: 0, y: 42 },
      ];
    case "logic":
      return [
        { x: -56, y: -24 }, { x: -56, y: 0 }, { x: -56, y: 24 },
        { x: 56, y: 0 }, { x: 0, y: -42 }, { x: 0, y: 42 },
      ];
    case "microcontroller":
    case "seven-segment":
      return [
        { x: -56, y: -30 }, { x: -56, y: -10 }, { x: -56, y: 10 }, { x: -56, y: 30 },
        { x: 56, y: -20 }, { x: 56, y: 20 }, { x: 0, y: -42 }, { x: 0, y: 42 },
      ];
    case "transistor-npn":
    case "transistor-pnp":
    case "mosfet-n":
    case "mosfet-p":
    case "jfet":
    case "igbt":
      return [{ x: -44, y: 0 }, { x: 0, y: -44 }, { x: 0, y: 44 }];
    case "scr":
    case "triac":
      return [{ x: -42, y: 0 }, { x: 0, y: -42 }, { x: 0, y: 42 }];
    default:
      return [{ x: -42, y: 0 }, { x: 42, y: 0 }];
  }
}

export function rotatePoint(point: Point, degrees: number): Point {
  const angle = ((degrees % 360) * Math.PI) / 180;
  const cosine = Math.round(Math.cos(angle));
  const sine = Math.round(Math.sin(angle));
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function getPinPosition(part: SchematicPart, pin: number): Point {
  const offset = getPinOffsets(part.type)[pin] ?? { x: 0, y: 0 };
  const rotated = rotatePoint(offset, part.rotation);
  return { x: part.x + rotated.x, y: part.y + rotated.y };
}

export function parseSpiceValue(input: string, fallback = 0): number {
  const match = input.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)[ \t]*(meg|[tgkmunpfµμ])?/i);
  if (!match) return fallback;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return fallback;
  const suffix = (match[2] ?? "").toLowerCase();
  const multipliers: Record<string, number> = {
    t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, "µ": 1e-6, "μ": 1e-6,
    n: 1e-9, p: 1e-12, f: 1e-15,
  };
  return value * (multipliers[suffix] ?? 1);
}

export function componentBounds(part: SchematicPart) {
  const vertical = Math.abs(part.rotation % 180) === 90;
  const halfWidth = part.type === "ground" ? 18 : vertical ? 40 : 58;
  const halfHeight = part.type === "ground" ? 22 : vertical ? 58 : 40;
  return { left: part.x - halfWidth, right: part.x + halfWidth, top: part.y - halfHeight, bottom: part.y + halfHeight };
}

export function simplifyRoute(points: Point[]): Point[] {
  const compact: Point[] = [];
  for (const point of points) {
    const previous = compact[compact.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.01 && Math.abs(previous.y - point.y) < 0.01) continue;
    compact.push(point);
    while (compact.length >= 3) {
      const a = compact[compact.length - 3];
      const b = compact[compact.length - 2];
      const c = compact[compact.length - 1];
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) compact.splice(compact.length - 2, 1);
      else break;
    }
  }
  return compact;
}

export function autoRoute(from: Point, to: Point, parts: SchematicPart[], fromPartId: string, toPartId: string): Point[] {
  const step = 20;
  const start = { x: Math.round(from.x / step), y: Math.round(from.y / step) };
  const goal = { x: Math.round(to.x / step), y: Math.round(to.y / step) };
  const obstacles = parts
    .filter((part) => part.id !== fromPartId && part.id !== toPartId)
    .map((part) => componentBounds(part));
  const isBlocked = (x: number, y: number) => {
    const px = x * step;
    const py = y * step;
    return obstacles.some((bounds) => px > bounds.left - 12 && px < bounds.right + 12 && py > bounds.top - 12 && py < bounds.bottom + 12);
  };
  const key = (x: number, y: number) => `${x},${y}`;
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  const open = [{ ...start, g: 0, f: Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y) }];
  const costs = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, Point>([[startKey, start], [goalKey, goal]]);
  let found = false;
  let iterations = 0;
  while (open.length && iterations < 3200) {
    iterations += 1;
    let bestIndex = 0;
    for (let index = 1; index < open.length; index += 1) if (open[index].f < open[bestIndex].f) bestIndex = index;
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.x, current.y);
    if (currentKey === goalKey) { found = true; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < -8 || x > 68 || y < -8 || y > 48 || (isBlocked(x, y) && key(x, y) !== goalKey)) continue;
      const nextKey = key(x, y);
      const cost = current.g + 1;
      if (cost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(nextKey, cost);
      cameFrom.set(nextKey, currentKey);
      cells.set(nextKey, { x, y });
      open.push({ x, y, g: cost, f: cost + Math.abs(x - goal.x) + Math.abs(y - goal.y) });
    }
  }
  if (!found) {
    const horizontal = [from, { x: (from.x + to.x) / 2, y: from.y }, { x: (from.x + to.x) / 2, y: to.y }, to];
    const vertical = [from, { x: from.x, y: (from.y + to.y) / 2 }, { x: to.x, y: (from.y + to.y) / 2 }, to];
    return simplifyRoute(horizontal.length <= vertical.length ? horizontal : vertical);
  }
  const gridPath: Point[] = [];
  let currentKey = goalKey;
  gridPath.push(cells.get(currentKey) ?? goal);
  while (currentKey !== startKey) {
    currentKey = cameFrom.get(currentKey) ?? startKey;
    gridPath.push(cells.get(currentKey) ?? start);
  }
  gridPath.reverse();
  const scaled = gridPath.map((point) => ({ x: point.x * step, y: point.y * step }));
  const leadOut = [from, { x: from.x, y: scaled[0].y }, scaled[0]];
  const leadIn = [scaled[scaled.length - 1], { x: scaled[scaled.length - 1].x, y: to.y }, to];
  return simplifyRoute([...leadOut, ...scaled.slice(1, -1), ...leadIn]);
}

export function pathFor(points: Point[]) {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
}

export function pinId(reference: PinReference) {
  return `${reference.partId}:${reference.pin}`;
}
