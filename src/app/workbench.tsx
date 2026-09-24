"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  DEFAULT_CIRCUIT,
  getPinOffsets,
  getPinPosition,
  parseSpiceValue,
  simulateCircuit,
  type AnalysisMode,
  type CircuitDocument,
  type PinReference,
  type Point,
  type SchematicPart,
  type SimulationResult,
  type WireConnection,
} from "@/lib/eda-engine";

const catalog = [
  { type: "resistor", name: "Resistor", value: "1 kΩ", group: "Passive", ref: "R", tag: "R", detail: "IEC 60617 · THT / SMD" },
  { type: "capacitor", name: "Capacitor", value: "100 nF", group: "Passive", ref: "C", tag: "C", detail: "Ceramic · radial · film" },
  { type: "inductor", name: "Inductor", value: "10 mH", group: "Passive", ref: "L", tag: "L", detail: "Power · RF · choke" },
  { type: "potentiometer", name: "Potentiometer", value: "10 kΩ", group: "Passive", ref: "RV", tag: "↗", detail: "Adjustable · linear" },
  { type: "transformer", name: "Transformer", value: "1:1", group: "Passive", ref: "T", tag: "T", detail: "Coupled winding" },
  { type: "crystal", name: "Crystal", value: "16 MHz", group: "Passive", ref: "X", tag: "Y", detail: "Quartz resonator" },
  { type: "thermistor", name: "Thermistor", value: "10 kΩ", group: "Passive", ref: "RT", tag: "θ", detail: "NTC · PTC" },
  { type: "voltage", name: "DC voltage", value: "5 V", group: "Sources", ref: "V", tag: "V", detail: "Independent source" },
  { type: "ac-source", name: "AC source", value: "1 V", group: "Sources", ref: "VAC", tag: "∿", detail: "Small-signal source" },
  { type: "pulse-source", name: "Pulse source", value: "PULSE(0 5 0 1u 1u 0.5m 1m)", group: "Sources", ref: "VP", tag: "⌁", detail: "PULSE · PWL · SINE" },
  { type: "function-generator", name: "Function generator", value: "SINE(0 2 1k)", group: "Sources", ref: "XFG", tag: "ƒ", detail: "AM · FM · arbitrary" },
  { type: "current", name: "Current source", value: "1 mA", group: "Sources", ref: "I", tag: "I", detail: "Independent source" },
  { type: "diode", name: "Diode", value: "1N4148", group: "Semiconductors", ref: "D", tag: "▷", detail: "Silicon · rectifier" },
  { type: "led", name: "LED", value: "Red · 5 mm", group: "Semiconductors", ref: "D", tag: "↗", detail: "Indicator · RGB" },
  { type: "zener", name: "Zener diode", value: "5.1 V", group: "Semiconductors", ref: "D", tag: "Z", detail: "Reference · clamp" },
  { type: "schottky", name: "Schottky diode", value: "1N5819", group: "Semiconductors", ref: "D", tag: "S", detail: "Low forward drop" },
  { type: "transistor-npn", name: "NPN transistor", value: "2N3904", group: "Semiconductors", ref: "Q", tag: "N", detail: "BJT · small signal" },
  { type: "transistor-pnp", name: "PNP transistor", value: "2N3906", group: "Semiconductors", ref: "Q", tag: "P", detail: "BJT · small signal" },
  { type: "mosfet-n", name: "N-channel MOSFET", value: "2N7000", group: "Semiconductors", ref: "Q", tag: "M", detail: "Enhancement · logic level" },
  { type: "mosfet-p", name: "P-channel MOSFET", value: "BS250", group: "Semiconductors", ref: "Q", tag: "M", detail: "Enhancement · high side" },
  { type: "opamp", name: "Operational amplifier", value: "LM741", group: "Analog ICs", ref: "U", tag: "▷", detail: "Universal · GBW 1 MHz" },
  { type: "comparator", name: "Comparator", value: "LM393", group: "Analog ICs", ref: "U", tag: "▷", detail: "Open-collector output" },
  { type: "timer", name: "555 timer", value: "NE555", group: "Analog ICs", ref: "U", tag: "555", detail: "Astable · monostable" },
  { type: "regulator", name: "Voltage regulator", value: "LM7805", group: "Analog ICs", ref: "U", tag: "5V", detail: "78xx · 79xx · LDO" },
  { type: "logic", name: "Logic gate", value: "74HC00 · NAND", group: "Digital", ref: "U", tag: "&", detail: "TTL 74xx · CMOS 40xx" },
  { type: "microcontroller", name: "Microcontroller", value: "ATmega328P", group: "Digital", ref: "U", tag: "µC", detail: "Arduino · PIC · 8051" },
  { type: "seven-segment", name: "7-segment display", value: "Common cathode", group: "Digital", ref: "DS", tag: "8", detail: "Decoded · raw segments" },
  { type: "switch", name: "SPST switch", value: "Open", group: "Switches & indicators", ref: "S", tag: "S", detail: "Interactive · momentary" },
  { type: "fuse", name: "Fuse", value: "500 mA", group: "Switches & indicators", ref: "F", tag: "F", detail: "Resettable · cartridge" },
  { type: "lamp", name: "Lamp", value: "12 V · 2 W", group: "Switches & indicators", ref: "LMP", tag: "◉", detail: "Incandescent · indicator" },
  { type: "relay", name: "Relay", value: "5 V coil", group: "Switches & indicators", ref: "K", tag: "K", detail: "SPDT · reed" },
  { type: "motor", name: "DC motor", value: "12 V", group: "Switches & indicators", ref: "M", tag: "M", detail: "Brushed · stepper" },
  { type: "buzzer", name: "Buzzer", value: "5 V", group: "Switches & indicators", ref: "BZ", tag: "♪", detail: "Piezo · active" },
  { type: "ground", name: "Ground", value: "0", group: "Connectors", ref: "GND", tag: "⏚", detail: "Signal · chassis · earth" },
] as const;

type CatalogItem = (typeof catalog)[number];
type ToolState = { kind: "select" | "wire" | "probe" | "pan" } | { kind: "place"; type: string };
type InstrumentName = "DMM" | "Oscilloscope" | "Function generator" | "Bode plotter" | "Logic analyzer" | "Wattmeter" | "IV analyzer";
type DockTab = "Scope" | "Netlist" | "Console" | "Analysis";
type ProjectRow = { id: string; name: string; document: CircuitDocument; updatedAt: string };
type PointerInteraction =
  | { kind: "move"; id: string; start: Point; origin: Point }
  | { kind: "pan"; lastX: number; lastY: number };

const analysisOptions: { name: AnalysisMode; eyebrow: string; detail: string }[] = [
  { name: "Transient", eyebrow: "01", detail: "Time-domain response" },
  { name: "AC Sweep", eyebrow: "02", detail: "Frequency · gain & phase" },
  { name: "DC Operating Point", eyebrow: "03", detail: "Steady-state node voltages" },
  { name: "DC Sweep", eyebrow: "04", detail: "Transfer characteristic" },
  { name: "Monte Carlo", eyebrow: "05", detail: "Tolerance · 48 runs" },
];

const categoryMeta: Record<string, { icon: string; count: string }> = {
  Passive: { icon: "component", count: "07" },
  Sources: { icon: "bolt", count: "05" },
  Semiconductors: { icon: "diode", count: "08" },
  "Analog ICs": { icon: "cpu", count: "04" },
  Digital: { icon: "logic", count: "03" },
  "Switches & indicators": { icon: "switch", count: "07" },
  Connectors: { icon: "ground", count: "01" },
};

const storageKey = "circuit-studio-project-v1";
const componentGroups = Object.keys(categoryMeta);

function Icon({ name, size = 16, strokeWidth = 1.7 }: { name: string; size?: number; strokeWidth?: number }) {
  const shared = { fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const content: Record<string, ReactNode> = {
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    pause: <path d="M8 5v14M16 5v14" strokeWidth="3" />,
    stop: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />,
    save: <><path d="M5 4h12l3 3v13H4V4h1Z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 17v3h14v-3" /></>,
    upload: <><path d="M12 15V3m-5 5 5-5 5 5" /><path d="M5 17v3h14v-3" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    pointer: <path d="m5 3 14 10-7 1-3 6L5 3Z" />,
    wire: <><circle cx="5" cy="17" r="2" /><circle cx="19" cy="7" r="2" /><path d="M7 17h5a3 3 0 0 0 3-3v-4a3 3 0 0 1 3-3h1" /></>,
    probe: <><path d="m14 5 5 5M11 8l5 5m-7-2-5 5a3 3 0 1 0 4 4l5-5" /><path d="m14 5 3-3 5 5-3 3" /></>,
    hand: <><path d="M8 12V6a2 2 0 1 1 4 0v5-7a2 2 0 1 1 4 0v8-5a2 2 0 1 1 4 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-4a2 2 0 0 1 3-3l2 2" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    moon: <path d="M20.5 14.2A8 8 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 0 14h-1" /></>,
    redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a7 7 0 0 0 0 14h1" /></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    chevron: <path d="m7 10 5 5 5-5" />,
    chevronRight: <path d="m9 18 6-6-6-6" />,
    file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h8" /></>,
    folder: <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 9h18" /></>,
    waveform: <path d="M2 12h3l2-7 4 14 3-11 2 4h6" />,
    scope: <><rect x="3" y="4" width="18" height="15" rx="2" /><path d="M7 15v4m10-4v4M6 11h2l1-4 3 8 2-5h2l1 2h1" /></>,
    sliders: <><path d="M4 6h8m4 0h4M4 12h3m4 0h9M4 18h9m4 0h3" /><circle cx="14" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></>,
    component: <><path d="M7 7h10v10H7zM2 12h5m10 0h5M12 2v5m0 10v5" /><circle cx="12" cy="12" r="2" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    diode: <><path d="M3 12h6m6 0h6" /><path d="m9 6 6 6-6 6V6Z" /><path d="M16 6v12" /></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" /><path d="M10 10h4v4h-4z" /></>,
    logic: <><path d="M4 5h7a7 7 0 0 1 0 14H4zM4 12h-2m16-4h4m-4 8h4" /></>,
    switch: <><circle cx="5" cy="16" r="2" /><circle cx="19" cy="16" r="2" /><path d="m7 15 9-8" /></>,
    ground: <><path d="M12 3v9m-7 1h14m-11 4h8m-5 4h2" /></>,
    bolt: <path d="m13 2-3 9h7L9 22l2-9H5l8-11Z" />,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6" /></>,
    terminal: <><path d="m5 7 5 5-5 5m7 0h7" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 6h16M8 9h8m-8 4h6" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m16 8 5-5" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    rotate: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><path d="m3 3 6 6m12-6-6 6M3 21l6-6m12 6-6-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    closeCircle: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
    export: <><path d="M12 15V3m-5 5 5-5 5 5" /><path d="M5 13v7h14v-7" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...shared}>{content[name] ?? <circle cx="12" cy="12" r="8" />}</svg>;
}

function makeId(prefix = "item") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
}

function cloneCircuit(circuit: CircuitDocument): CircuitDocument {
  return JSON.parse(JSON.stringify(circuit)) as CircuitDocument;
}

function formatVoltage(value: number) {
  if (!Number.isFinite(value)) return "0.000 V";
  const absolute = Math.abs(value);
  if (absolute >= 1000) return `${(value / 1000).toFixed(2)} kV`;
  if (absolute > 0 && absolute < 0.001) return `${(value * 1e6).toFixed(1)} µV`;
  if (absolute < 1) return `${(value * 1000).toFixed(2)} mV`;
  return `${value.toFixed(3)} V`;
}

function componentBounds(part: SchematicPart) {
  const vertical = Math.abs(part.rotation % 180) === 90;
  const halfWidth = part.type === "ground" ? 18 : vertical ? 34 : 54;
  const halfHeight = part.type === "ground" ? 22 : vertical ? 54 : 34;
  return { left: part.x - halfWidth, right: part.x + halfWidth, top: part.y - halfHeight, bottom: part.y + halfHeight };
}

function simplifyRoute(points: Point[]): Point[] {
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

function autoRoute(from: Point, to: Point, parts: SchematicPart[], fromPartId: string, toPartId: string): Point[] {
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

function pathFor(points: Point[]) {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
}

function pinId(reference: PinReference) {
  return `${reference.partId}:${reference.pin}`;
}

function svgSafeText(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character] ?? character);
}

function generateNetlist(document: CircuitDocument) {
  const parent = new Map<string, string>();
  const rootOf = (value: string): string => {
    const parentValue = parent.get(value);
    if (!parentValue || parentValue === value) return value;
    const root = rootOf(parentValue);
    parent.set(value, root);
    return root;
  };
  const join = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const first = rootOf(a);
    const second = rootOf(b);
    if (first !== second) parent.set(second, first);
  };
  for (const part of document.parts) getPinOffsets(part.type).forEach((_, pin) => parent.set(`${part.id}:${pin}`, `${part.id}:${pin}`));
  for (const wire of document.connections) join(pinId(wire.from), pinId(wire.to));
  const grounds = document.parts.filter((part) => part.type === "ground");
  grounds.slice(1).forEach((ground) => join(`${grounds[0].id}:0`, `${ground.id}:0`));
  const groundRoot = grounds.length ? rootOf(`${grounds[0].id}:0`) : null;
  const roots = new Map<string, string>();
  let nextNode = 1;
  const node = (part: SchematicPart, pin: number) => {
    const root = rootOf(`${part.id}:${pin}`);
    if (groundRoot && root === groundRoot) return "0";
    if (!roots.has(root)) roots.set(root, `N${String(nextNode++).padStart(3, "0")}`);
    return roots.get(root) ?? "0";
  };
  const lines = [`.title ${document.name || "Circuit Studio design"}`, `* Generated by Circuit Studio · ${new Date().toISOString()}`, "* MNA · transient · AC sweep"];
  for (const part of document.parts) {
    if (part.type === "ground") continue;
    const nodes = getPinOffsets(part.type).map((_, pin) => node(part, pin));
    const first = nodes[0] ?? "0";
    const second = nodes[1] ?? "0";
    const value = part.value.trim().replace(/µ/g, "u").replace(/[ΩΩ]/g, "").replace(/\s+/g, "");
    if (["resistor", "thermistor", "potentiometer"].includes(part.type)) lines.push(`${part.ref} ${first} ${second} ${value}`);
    else if (part.type === "capacitor") lines.push(`${part.ref} ${first} ${second} ${value}`);
    else if (part.type === "inductor") lines.push(`${part.ref} ${first} ${second} ${value}`);
    else if (part.type === "voltage" || part.type === "ac-source") lines.push(`${part.ref} ${first} ${second} DC ${value.replace(/^DC/i, "")}`);
    else if (part.type === "pulse-source" || part.type === "function-generator") lines.push(`${part.ref} ${first} ${second} ${value}`);
    else if (part.type === "current") lines.push(`${part.ref} ${first} ${second} DC ${value}`);
    else if (["diode", "led", "zener", "schottky"].includes(part.type)) lines.push(`${part.ref} ${first} ${second} DDEFAULT`);
    else lines.push(`* ${part.ref} ${part.value} (${part.type} · model not expanded)`);
  }
  lines.push("", ".tran 10u 8m", ".ac dec 100 10 100k", ".op", ".end");
  return lines.join("\n");
}

function parseSpiceDocument(text: string, name: string): CircuitDocument | null {
  const parsed: { ref: string; type: string; nodes: [string, string]; value: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("*") || line.startsWith(".")) continue;
    const tokens = line.split(/\s+/);
    const ref = tokens[0];
    const prefix = ref?.[0]?.toUpperCase();
    const type = ({ R: "resistor", C: "capacitor", L: "inductor", V: "voltage", I: "current", D: "diode", Q: "transistor-npn" } as Record<string, string>)[prefix ?? ""];
    if (!type || tokens.length < 4) continue;
    const value = tokens.slice(3).join(" ").replace(/^DC\s+/i, "");
    parsed.push({ ref, type, nodes: [tokens[1], tokens[2]], value });
  }
  if (!parsed.length) return null;
  const parts: SchematicPart[] = [];
  const connections: WireConnection[] = [];
  const nodePins = new Map<string, PinReference[]>();
  const positionFor = (index: number) => ({ x: 300 + (Math.floor(index / 4) % 3) * 190, y: 230 + (index % 4) * 120 });
  parsed.forEach((item, index) => {
    const id = `import-${index + 1}`;
    const position = positionFor(index);
    parts.push({ id, type: item.type, ref: item.ref, value: item.value, ...position, rotation: 0 });
    item.nodes.forEach((net, pin) => {
      const references = nodePins.get(net) ?? [];
      references.push({ partId: id, pin });
      nodePins.set(net, references);
    });
  });
  let groundIndex = 0;
  for (const [net, pins] of nodePins.entries()) {
    const references = [...pins];
    if (net === "0" || net.toLowerCase() === "gnd") {
      const groundId = `import-gnd-${groundIndex++}`;
      const position = { x: 300 + groundIndex * 190, y: 700 };
      parts.push({ id: groundId, type: "ground", ref: "GND", value: "0", ...position, rotation: 0 });
      references.push({ partId: groundId, pin: 0 });
    }
    for (let index = 1; index < references.length; index += 1) {
      connections.push({ id: `import-wire-${connections.length + 1}`, from: references[0], to: references[index] });
    }
  }
  const output = parts.find((part) => part.type === "resistor") ?? parts[0];
  return {
    version: 1,
    name,
    parts,
    connections,
    probes: output ? [{ id: "import-probe", name: "V(out)", pin: { partId: output.id, pin: 1 } }] : [],
  };
}

function PartGlyph({ type }: { type: string }) {
  if (type === "ground") return <g className="symbol-strokes"><path d="M0 -20V-2M-16 1H16M-11 7H11M-5 13H5" /></g>;
  if (type === "resistor" || type === "thermistor" || type === "potentiometer") {
    return <g className="symbol-strokes"><path d="M-42 0H-27L-20-12-10 12 0-12 10 12 20-12 27 0H42" />{type === "potentiometer" && <path d="m5-26-8 12h9l-8 12" />}{type === "thermistor" && <path d="m-4-23 8 46" />}</g>;
  }
  if (type === "capacitor") return <g className="symbol-strokes"><path d="M-42 0H-8M-8-18V18M8-18V18M8 0H42" /></g>;
  if (type === "inductor") return <g className="symbol-strokes"><path d="M-42 0H-28" /><path d="M-28 0a7 7 0 0 1 14 0 7 7 0 0 1 14 0 7 7 0 0 1 14 0" /><path d="M14 0h28" /></g>;
  if (["voltage", "ac-source", "pulse-source", "function-generator", "current"].includes(type)) {
    return <g className="symbol-strokes"><path d="M-42 0h-14m84 0H42" /><circle cx="0" cy="0" r="20" />{type === "current" ? <><path d="M0 11V-10m-6 6 6-6 6 6" /></> : type === "ac-source" || type === "function-generator" ? <path d="M-12 1c4-14 8 14 12 0s8 14 12 0" /> : type === "pulse-source" ? <path d="M-12 7h5V-7h12v14h7" /> : <><path d="M-6-7h12M0-13v12" /><path d="M-6 7h12" /></>}</g>;
  }
  if (["diode", "led", "zener", "schottky", "photodiode"].includes(type)) {
    return <g className="symbol-strokes"><path d="M-42 0h13m30 0h28" /><path d="m-29-17 30 17-30 17z" fill="var(--canvas-bg)" /><path d="M3-18V18" />{type === "zener" && <path d="m-2-18 6 4m-6 28 6 4" />}{type === "led" && <><path d="m9-20 9-9m-5 1 5-1-1 5M10-7l9-9m-5 1 5-1-1 5" /></>}</g>;
  }
  if (type === "opamp" || type === "comparator") return <g className="symbol-strokes"><path d="M-30-34V34L34 0-30-34Z" /><path d="M-46-17h16M-46 17h16M34 0h22" /><path d="M-24-18h8m-4-4v8m-4 23h8" /><path d="M0-34v-8M0 34v8" /></g>;
  if (["transistor-npn", "transistor-pnp", "mosfet-n", "mosfet-p", "bjt"].includes(type)) return <g className="symbol-strokes"><circle cx="0" cy="0" r="23" /><path d="M-44 0h21M-23-12v24m0-12h13l17-18M-10 0 7 18M7 18l-1-9m1 9-9-2" /></g>;
  if (type === "switch") return <g className="symbol-strokes"><path d="M-42 0h9m42 0h33" /><circle cx="-24" cy="0" r="3" /><circle cx="16" cy="0" r="3" /><path d="m-21-3 27-19" /></g>;
  if (type === "fuse") return <g className="symbol-strokes"><path d="M-42 0h12m60 0h12" /><rect x="-30" y="-12" width="60" height="24" rx="4" /><path d="M-18 0h36" /></g>;
  if (type === "lamp" || type === "buzzer") return <g className="symbol-strokes"><path d="M-42 0h22m40 0h22" /><circle cx="0" cy="0" r="20" />{type === "lamp" ? <path d="m-10-10 20 20m0-20-20 20" /> : <path d="M-7-8q14 8 0 16m7-19q18 11 0 22" />}</g>;
  if (type === "transformer" || type === "relay") return <g className="symbol-strokes"><path d="M-42 0h10m54 0h20" /><path d="M-32-16a8 8 0 0 1 0 32 8 8 0 0 1 0-32m16 0a8 8 0 0 1 0 32 8 8 0 0 1 0-32" /><path d="M-5-22V22" /></g>;
  if (type === "motor") return <g className="symbol-strokes"><path d="M-42 0h22m40 0h22" /><circle cx="0" cy="0" r="20" /><path d="M-9 10V-9l18 19V-9" /></g>;
  if (type === "crystal") return <g className="symbol-strokes"><path d="M-42 0h13m42 0h29M-29-19V19m10-19h38m10-19V19" /></g>;
  if (type === "timer" || type === "regulator" || type === "microcontroller" || type === "logic" || type === "seven-segment") {
    return <g className="symbol-strokes"><rect x="-30" y="-30" width="60" height="60" rx="3" /><path d="M-46-18h16m-16 36h16m60-36H30m16 36H30" />{type === "timer" ? <text className="symbol-inner-label" x="0" y="5" textAnchor="middle">555</text> : type === "seven-segment" ? <path d="M-7-15h14v8H-7zm-3 10h4v14h-4zm16 0h4v14H6zM-7 11h14v8H-7z" /> : <><path d="M-10-9h20M-10-2h20M-10 5h20M-10 12h12" />{type === "microcontroller" && <circle cx="20" cy="-20" r="3" />}</>}</g>;
  }
  return <g className="symbol-strokes"><path d="M-42 0h14m56 0h14" /><rect x="-28" y="-19" width="56" height="38" rx="4" /><path d="M-14-7h28m-28 14h18" /></g>;
}

function SignalChart({ result, progress = 0, compact = false }: { result: SimulationResult; progress?: number; compact?: boolean }) {
  const width = 760;
  const height = compact ? 124 : 174;
  const left = 54;
  const right = 14;
  const top = 12;
  const bottom = 24;
  const traces = result.traces.filter((trace) => trace.values.length > 0);
  const allValues = traces.flatMap((trace) => trace.values.filter(Number.isFinite));
  let minimum = allValues.length ? Math.min(...allValues) : 0;
  let maximum = allValues.length ? Math.max(...allValues) : 1;
  if (result.domain === "time") {
    minimum = Math.min(0, minimum);
    maximum = Math.max(5, maximum);
  }
  if (maximum - minimum < 1e-9) { maximum += 1; minimum -= 1; }
  const pad = (maximum - minimum) * 0.1;
  minimum -= pad;
  maximum += pad;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const frequencyMin = Math.max(1, result.x[0] ?? 1);
  const frequencyMax = Math.max(frequencyMin * 10, result.x[result.x.length - 1] ?? frequencyMin * 10);
  const pointX = (index: number) => {
    const value = result.x[index] ?? index;
    if (result.domain === "frequency") {
      return left + ((Math.log10(Math.max(value, frequencyMin)) - Math.log10(frequencyMin)) / (Math.log10(frequencyMax) - Math.log10(frequencyMin))) * plotWidth;
    }
    return left + (index / Math.max(1, result.x.length - 1)) * plotWidth;
  };
  const pointY = (value: number) => top + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const verticalLines = result.domain === "frequency" ? 6 : 9;
  const horizontalLines = compact ? 4 : 5;
  return (
    <svg className={`signal-chart${compact ? " signal-chart-compact" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${result.traces[0]?.name ?? "Signal"} waveform`}>
      <rect x={left} y={top} width={plotWidth} height={plotHeight} rx="3" className="chart-plot-bg" />
      {Array.from({ length: horizontalLines + 1 }, (_, index) => {
        const y = top + (plotHeight * index) / horizontalLines;
        return <g key={`h-${index}`}><line x1={left} y1={y} x2={width - right} y2={y} className="chart-grid-line" />{!compact && <text x={left - 8} y={y + 3} textAnchor="end" className="chart-axis-label">{(maximum - ((maximum - minimum) * index) / horizontalLines).toFixed(1)}</text>}</g>;
      })}
      {Array.from({ length: verticalLines + 1 }, (_, index) => {
        const x = left + (plotWidth * index) / verticalLines;
        let label = `${Math.round((index / verticalLines) * 8)} ms`;
        if (result.domain === "frequency") {
          const frequency = frequencyMin * Math.pow(frequencyMax / frequencyMin, index / verticalLines);
          label = frequency >= 1000 ? `${Number((frequency / 1000).toPrecision(2))}k` : `${Number(frequency.toPrecision(2))}`;
        } else if (result.domain === "dc") label = `${((result.x[result.x.length - 1] ?? 1) * index / verticalLines).toFixed(1)}`;
        else if (result.domain === "samples") label = `${Math.round((result.x[result.x.length - 1] ?? 48) * index / verticalLines)}`;
        return <g key={`v-${index}`}><line x1={x} y1={top} x2={x} y2={height - bottom} className="chart-grid-line chart-grid-vertical" />{!compact && <text x={x} y={height - 6} textAnchor="middle" className="chart-axis-label">{label}</text>}</g>;
      })}
      {traces.map((trace, traceIndex) => {
        const path = trace.values.map((value, index) => `${index ? "L" : "M"}${pointX(index).toFixed(2)} ${pointY(value).toFixed(2)}`).join(" ");
        return <path key={`${trace.name}-${traceIndex}`} d={path} fill="none" stroke={trace.color} strokeWidth={compact ? 2 : 2.1} strokeLinecap="round" strokeLinejoin="round" className="chart-trace" />;
      })}
      {result.domain === "time" && progress > 0 && progress < 1 && <line x1={left + plotWidth * progress} y1={top} x2={left + plotWidth * progress} y2={height - bottom} className="chart-playhead" />}
      {!compact && <text x={left} y={height - 6} textAnchor="start" className="chart-axis-title">{result.xLabel}</text>}
    </svg>
  );
}

function formatTime(milliseconds: number) {
  if (milliseconds < 1) return `${(milliseconds * 1000).toFixed(0)} µs`;
  if (milliseconds < 1000) return `${milliseconds.toFixed(2)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

export default function Workbench() {
  const [document, setDocument] = useState<CircuitDocument>(() => cloneCircuit(DEFAULT_CIRCUIT));
  const [documentName, setDocumentName] = useState(DEFAULT_CIRCUIT.name);
  const [result, setResult] = useState<SimulationResult>(() => simulateCircuit(DEFAULT_CIRCUIT, "Transient", 120));
  const [analysis, setAnalysis] = useState<AnalysisMode>("Transient");
  const [tool, setTool] = useState<ToolState>({ kind: "select" });
  const [selectedPartId, setSelectedPartId] = useState<string | null>("r1");
  const [connectionStart, setConnectionStart] = useState<PinReference | null>(null);
  const [pointerWorld, setPointerWorld] = useState<Point | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [gridVisible, setGridVisible] = useState(true);
  const [darkTheme, setDarkTheme] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All components");
  const [expandedGroups, setExpandedGroups] = useState<string[]>(["Passive", "Sources"]);
  const [sidebarTab, setSidebarTab] = useState<"Library" | "Project">("Library");
  const [recentTypes, setRecentTypes] = useState<string[]>(["resistor", "capacitor", "voltage", "ground"]);
  const [activeDockTab, setActiveDockTab] = useState<DockTab>("Scope");
  const [activeInstrument, setActiveInstrument] = useState<InstrumentName | null>(null);
  const [instrumentPosition, setInstrumentPosition] = useState<Point>({ x: 470, y: 56 });
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timeScale, setTimeScale] = useState(1);
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [consoleLines, setConsoleLines] = useState<string[]>([
    "Circuit Studio engine ready · MNA kernel 1.4",
    "Loaded example: RC low-pass filter · 7 devices · 6 nets",
    "Transient preview computed · 120 steps · 8.00 ms",
  ]);
  const [netlistText, setNetlistText] = useState(() => generateNetlist(DEFAULT_CIRCUIT));
  const [netlistEditable, setNetlistEditable] = useState(false);
  const [dmmMode, setDmmMode] = useState("DC V");
  const [generatorShape, setGeneratorShape] = useState("SINE");
  const [generatorFrequency, setGeneratorFrequency] = useState("1 kHz");
  const [generatorAmplitude, setGeneratorAmplitude] = useState("2 Vpp");
  const [generatorEnabled, setGeneratorEnabled] = useState(false);
  const [instrumentDrag, setInstrumentDrag] = useState(false);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const instrumentDragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const documentRef = useRef(document);
  const historyRef = useRef<{ past: CircuitDocument[]; future: CircuitDocument[] }>({ past: [], future: [] });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    if (window.innerWidth <= 760) {
      setShowLeftPanel(false);
      setShowRightPanel(false);
    }
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { document?: CircuitDocument; name?: string; id?: string | null };
        if (parsed.document?.parts && Array.isArray(parsed.document.connections)) {
          const restored = cloneCircuit(parsed.document);
          setDocument(restored);
          documentRef.current = restored;
          setDocumentName(parsed.name || restored.name || DEFAULT_CIRCUIT.name);
          setProjectId(parsed.id ?? null);
          setResult(simulateCircuit(restored, "Transient", 120));
          setNetlistText(generateNetlist(restored));
          setSelectedPartId(restored.parts.find((part) => part.type !== "ground")?.id ?? null);
        }
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
    setHydrated(true);
    void fetch("/api/projects", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<ProjectRow[]> : [])
      .then((savedProjects) => setProjects(Array.isArray(savedProjects) ? savedProjects : []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ document, name: documentName, id: projectId }));
    } catch {
      setToast("Lokaler Speicher ist voll — bitte exportiere eine Sicherung.");
    }
  }, [document, documentName, projectId, hydrated]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3300);
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [toast]);

  useEffect(() => {
    if (!isRunning) return;
    const playbackDuration = result.domain === "time" ? Math.max(1, result.duration * 1000) : 4000;
    const timer = setInterval(() => {
      setElapsed((current) => {
        const next = current + Math.max(0.02, playbackDuration / 85) * timeScale;
        if (next >= playbackDuration) {
          setIsRunning(false);
          setConsoleLines((lines) => [`${new Date().toLocaleTimeString("de-DE")} · Simulation complete · ${result.sampleCount} samples`, ...lines].slice(0, 18));
          return playbackDuration;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isRunning, result, timeScale]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !editing) {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (!editing && (event.key === "Delete" || event.key === "Backspace") && selectedPartId) {
        event.preventDefault();
        removeSelectedPart();
      }
      if (!editing && event.key === "Escape") {
        setTool({ kind: "select" });
        setConnectionStart(null);
        setActiveInstrument(null);
        setSelectedPartId(null);
      }
      if (!editing && event.key.toLowerCase() === "w") setTool({ kind: "wire" });
      if (!editing && event.key.toLowerCase() === "v") setTool({ kind: "select" });
      if (!editing && event.key.toLowerCase() === "h") setTool({ kind: "pan" });
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const componentPaths = useMemo(() => document.connections.map((connection) => {
    const fromPart = document.parts.find((part) => part.id === connection.from.partId);
    const toPart = document.parts.find((part) => part.id === connection.to.partId);
    if (!fromPart || !toPart) return { connection, points: [] as Point[], d: "" };
    const from = getPinPosition(fromPart, connection.from.pin);
    const to = getPinPosition(toPart, connection.to.pin);
    const points = autoRoute(from, to, document.parts, fromPart.id, toPart.id);
    return { connection, points, d: pathFor(points) };
  }), [document.connections, document.parts]);

  const selectedPart = document.parts.find((part) => part.id === selectedPartId) ?? null;
  const filteredComponents = catalog.filter((item) => {
    const matchesText = !search || `${item.name} ${item.value} ${item.group} ${item.detail}`.toLowerCase().includes(search.toLowerCase());
    const matchesGroup = activeCategory === "All components" || item.group === activeCategory;
    return matchesText && matchesGroup;
  });
  const netlist = useMemo(() => generateNetlist(document), [document]);
  const bodePreview = useMemo(() => result.domain === "frequency" ? result : simulateCircuit(document, "AC Sweep", 72), [document, result]);
  const progress = result.domain === "time" ? Math.min(1, elapsed / Math.max(1, result.duration * 1000)) : Math.min(1, elapsed / 4000);
  const loadPart = document.parts.find((part) => part.type === "resistor" && part.id !== "r1") ?? document.parts.find((part) => part.type === "resistor");
  const loadResistance = Math.max(parseSpiceValue(loadPart?.value ?? "10 kΩ", 10_000), 1);
  const dmmReading = dmmMode.includes("Ω")
    ? (loadResistance / 1000).toFixed(2)
    : dmmMode.includes("A")
      ? ((result.outputVoltage / loadResistance) * 1000 * (dmmMode.startsWith("AC") ? 1 / Math.sqrt(2) : 1)).toFixed(3)
      : dmmMode.includes("dB")
        ? (20 * Math.log10(Math.max(Math.abs(result.outputVoltage), 1e-9))).toFixed(2)
        : (result.outputVoltage * (dmmMode.startsWith("AC") ? 1 / Math.sqrt(2) : 1)).toFixed(3);
  const dmmUnit = dmmMode.includes("Ω") ? "kΩ" : dmmMode.includes("A") ? "mA" : dmmMode.includes("dB") ? "dB" : "V";
  const appClassName = `studio-shell${darkTheme ? " theme-dark" : ""}`;

  const announce = useCallback((message: string) => setToast(message), []);

  const rememberHistory = useCallback(() => {
    historyRef.current.past = [...historyRef.current.past.slice(-49), cloneCircuit(documentRef.current)];
    historyRef.current.future = [];
  }, []);

  const updateCircuit = useCallback((updater: (current: CircuitDocument) => CircuitDocument) => {
    rememberHistory();
    setDocument((current) => {
      const next = updater(current);
      documentRef.current = next;
      return next;
    });
    setIsDirty(true);
  }, [rememberHistory]);

  function undo() {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.unshift(cloneCircuit(documentRef.current));
    documentRef.current = previous;
    setDocument(previous);
    setIsDirty(true);
  }

  function redo() {
    const next = historyRef.current.future.shift();
    if (!next) return;
    historyRef.current.past.push(cloneCircuit(documentRef.current));
    documentRef.current = next;
    setDocument(next);
    setIsDirty(true);
  }

  function setPartProperty(partId: string, key: keyof SchematicPart, value: string | number) {
    updateCircuit((current) => ({ ...current, parts: current.parts.map((part) => part.id === partId ? { ...part, [key]: value } : part) }));
  }

  function createPart(type: string, point: Point) {
    const definition = catalog.find((item) => item.type === type);
    if (!definition) return;
    const prefix = definition.ref;
    const number = documentRef.current.parts.filter((part) => part.ref.replace(/[0-9]/g, "") === prefix).length + 1;
    const id = makeId(prefix.toLowerCase());
    const created: SchematicPart = {
      id,
      type,
      ref: `${prefix}${number}`,
      value: definition.value,
      x: Math.round(point.x / 20) * 20,
      y: Math.round(point.y / 20) * 20,
      rotation: 0,
      ...(type === "resistor" ? { tolerance: "5%", tempCoeff: "100 ppm/°C" } : {}),
    };
    updateCircuit((current) => ({ ...current, parts: [...current.parts, created] }));
    setSelectedPartId(id);
    setTool({ kind: "select" });
    setRecentTypes((current) => [type, ...current.filter((item) => item !== type)].slice(0, 5));
    announce(`${definition.name} bereit — ${created.ref} auf dem Schaltplan platziert`);
  }

  function removeSelectedPart() {
    if (!selectedPartId) return;
    const selected = documentRef.current.parts.find((part) => part.id === selectedPartId);
    if (!selected) return;
    updateCircuit((current) => ({
      ...current,
      parts: current.parts.filter((part) => part.id !== selectedPartId),
      connections: current.connections.filter((connection) => connection.from.partId !== selectedPartId && connection.to.partId !== selectedPartId),
      probes: current.probes.filter((probe) => probe.pin.partId !== selectedPartId),
    }));
    setSelectedPartId(null);
    announce(`${selected.ref} entfernt`);
  }

  function getViewPoint(clientX: number, clientY: number): Point {
    const rectangle = canvasRef.current?.getBoundingClientRect();
    if (!rectangle) return { x: 600, y: 400 };
    const scale = Math.min(rectangle.width / 1200, rectangle.height / 800) || 1;
    const offsetX = (rectangle.width - 1200 * scale) / 2;
    const offsetY = (rectangle.height - 800 * scale) / 2;
    return { x: (clientX - rectangle.left - offsetX) / scale, y: (clientY - rectangle.top - offsetY) / scale };
  }

  function getWorldPoint(clientX: number, clientY: number): Point {
    const point = getViewPoint(clientX, clientY);
    return { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom };
  }

  function referenceFromElement(element: Element): PinReference | null {
    const raw = element.getAttribute("data-pin-id");
    if (!raw) return null;
    const separator = raw.lastIndexOf(":");
    if (separator < 0) return null;
    return { partId: raw.slice(0, separator), pin: Number(raw.slice(separator + 1)) };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const target = event.target as Element;
    const pinElement = target.closest("[data-pin-id]");
    const partElement = target.closest("[data-part-id]");
    const reference = pinElement ? referenceFromElement(pinElement) : null;

    if (reference && tool.kind === "wire") {
      if (!connectionStart) {
        setConnectionStart(reference);
        announce("Startpunkt gesetzt · zweiten Pin auswählen");
      } else if (pinId(connectionStart) !== pinId(reference)) {
        const alreadyConnected = documentRef.current.connections.some((wire) =>
          (pinId(wire.from) === pinId(connectionStart) && pinId(wire.to) === pinId(reference)) ||
          (pinId(wire.to) === pinId(connectionStart) && pinId(wire.from) === pinId(reference)),
        );
        if (!alreadyConnected) {
          const newWire: WireConnection = { id: makeId("wire"), from: connectionStart, to: reference };
          updateCircuit((current) => ({ ...current, connections: [...current.connections, newWire] }));
          announce("Leitung verbunden · orthogonales Routing aktualisiert");
        }
        setConnectionStart(null);
      } else setConnectionStart(null);
      return;
    }

    if (reference && tool.kind === "probe") {
      const targetPart = documentRef.current.parts.find((part) => part.id === reference.partId);
      if (!targetPart) return;
      const existing = documentRef.current.probes.find((probe) => pinId(probe.pin) === pinId(reference));
      updateCircuit((current) => ({
        ...current,
        probes: existing
          ? current.probes.filter((probe) => probe.id !== existing.id)
          : [...current.probes, { id: makeId("probe"), name: `V(${targetPart.ref.toLowerCase()}_${reference.pin + 1})`, pin: reference }],
      }));
      setTool({ kind: "select" });
      announce(existing ? "Spannungssonde entfernt" : `Spannungssonde an ${targetPart.ref} angebracht`);
      return;
    }

    if (tool.kind === "place") {
      if (!partElement) createPart(tool.type, getWorldPoint(event.clientX, event.clientY));
      return;
    }

    if (tool.kind === "pan" && !partElement) {
      interactionRef.current = { kind: "pan", lastX: event.clientX, lastY: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (partElement) {
      const id = partElement.getAttribute("data-part-id");
      const part = documentRef.current.parts.find((entry) => entry.id === id);
      if (part && tool.kind === "select") {
        setSelectedPartId(part.id);
        rememberHistory();
        interactionRef.current = { kind: "move", id: part.id, start: getWorldPoint(event.clientX, event.clientY), origin: { x: part.x, y: part.y } };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (tool.kind === "select") setSelectedPartId(null);
    if (connectionStart) setConnectionStart(null);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const point = getWorldPoint(event.clientX, event.clientY);
    setPointerWorld(point);
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.kind === "move") {
      setDocument((current) => {
        const next = {
          ...current,
          parts: current.parts.map((part) => part.id === interaction.id ? {
            ...part,
            x: interaction.origin.x + Math.round((point.x - interaction.start.x) / 20) * 20,
            y: interaction.origin.y + Math.round((point.y - interaction.start.y) / 20) * 20,
          } : part),
        };
        documentRef.current = next;
        return next;
      });
      setIsDirty(true);
    } else {
      const rectangle = canvasRef.current?.getBoundingClientRect();
      const scale = rectangle ? Math.min(rectangle.width / 1200, rectangle.height / 800) || 1 : 1;
      const deltaX = (event.clientX - interaction.lastX) / scale;
      const deltaY = (event.clientY - interaction.lastY) / scale;
      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;
      setPan((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
    }
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const nextZoom = Math.max(0.42, Math.min(2.25, zoom * (event.deltaY < 0 ? 1.09 : 0.92)));
    const point = getViewPoint(event.clientX, event.clientY);
    const world = { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom };
    setPan({ x: point.x - world.x * nextZoom, y: point.y - world.y * nextZoom });
    setZoom(nextZoom);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-circuit-component") || event.dataTransfer.getData("text/plain");
    if (type) createPart(type, getWorldPoint(event.clientX, event.clientY));
  }

  function startPlacement(item: CatalogItem) {
    setTool({ kind: "place", type: item.type });
    setRecentTypes((current) => [item.type, ...current.filter((type) => type !== item.type)].slice(0, 5));
    announce(`${item.name} ausgewählt · auf den Schaltplan klicken oder ziehen`);
  }

  function runSimulation() {
    try {
      const next = simulateCircuit(documentRef.current, analysis, 120);
      setResult(next);
      setElapsed(0);
      setIsRunning(true);
      setActiveDockTab(analysis === "AC Sweep" ? "Analysis" : "Scope");
      setConsoleLines((lines) => [`${new Date().toLocaleTimeString("de-DE")} · ${analysis} · ${documentRef.current.parts.length} devices · ${next.sampleCount} samples`, ...lines].slice(0, 18));
      setToast(`${next.status} · ${next.sampleCount} Samples`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown simulation error";
      setIsRunning(false);
      setConsoleLines((lines) => [`ERROR · ${message}`, ...lines].slice(0, 18));
      setActiveDockTab("Console");
      setToast("Simulation fehlgeschlagen · Fehlerprotokoll geöffnet");
    }
  }

  function pauseSimulation() {
    setIsRunning((current) => !current);
  }

  function stopSimulation() {
    setIsRunning(false);
    setElapsed(0);
    setConsoleLines((lines) => [`${new Date().toLocaleTimeString("de-DE")} · Simulation stopped`, ...lines].slice(0, 18));
  }

  async function saveProject() {
    setIsSaving(true);
    const cleanDocument = { ...documentRef.current, name: documentName };
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projectId, name: documentName, document: cleanDocument }),
      });
      if (!response.ok) throw new Error("API unavailable");
      const saved = await response.json() as ProjectRow;
      setProjectId(saved.id);
      setProjects((current) => [saved, ...current.filter((project) => project.id !== saved.id)].slice(0, 30));
      setIsDirty(false);
      localStorage.setItem(storageKey, JSON.stringify({ document: cleanDocument, name: documentName, id: saved.id }));
      setConsoleLines((lines) => [`${new Date().toLocaleTimeString("de-DE")} · Project saved to PostgreSQL · ${saved.id.slice(0, 8)}`, ...lines].slice(0, 18));
      setToast("Projekt sicher in PostgreSQL gespeichert");
    } catch {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ document: cleanDocument, name: documentName, id: projectId }));
        setIsDirty(false);
        setToast("Lokal gespeichert · Datenbankverbindung derzeit nicht verfügbar");
      } catch {
        setToast("Speichern fehlgeschlagen · bitte Circuit exportieren");
      }
    } finally {
      setIsSaving(false);
    }
  }

  function loadStoredProject(project: ProjectRow) {
    const restored = cloneCircuit(project.document);
    setDocument(restored);
    documentRef.current = restored;
    setDocumentName(project.name);
    setProjectId(project.id);
    setSelectedPartId(restored.parts.find((part) => part.type !== "ground")?.id ?? null);
    setResult(simulateCircuit(restored, "Transient", 120));
    setAnalysis("Transient");
    setNetlistText(generateNetlist(restored));
    setElapsed(0);
    setIsRunning(false);
    setIsDirty(false);
    historyRef.current = { past: [], future: [] };
    setProjectMenuOpen(false);
    setToast(`„${project.name}“ geöffnet`);
  }

  function downloadFile(fileName: string, contents: string, mime: string) {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportNative() {
    const payload = { format: "circuit-studio", version: 1, name: documentName, document: { ...document, name: documentName } };
    downloadFile(`${documentName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "circuit"}.ms`, JSON.stringify(payload, null, 2), "application/json");
    setExportMenuOpen(false);
    setToast("Native .ms-Projekt exportiert");
  }

  function exportSpice() {
    downloadFile(`${documentName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "circuit"}.cir`, netlist, "text/plain");
    setExportMenuOpen(false);
    setToast("SPICE-Netlist exportiert");
  }

  function exportWaveform() {
    const heading = ["time_s", ...result.traces.map((trace) => trace.name)].join(",");
    const rows = result.x.map((time, index) => [time, ...result.traces.map((trace) => trace.values[index] ?? "")].join(","));
    downloadFile("circuit-studio-waveform.csv", [heading, ...rows].join("\n"), "text/csv");
    setExportMenuOpen(false);
    setToast("Messdaten als CSV exportiert");
  }

  function exportSvg() {
    const source = svgRef.current?.outerHTML;
    if (!source) return;
    const embeddedStyles = `<style>.canvas-paper{fill:#f7f9f6}.grid-dot{fill:#dce5dd}.grid-dot-major{fill:#d1dcd3}.circuit-wire{stroke:#179d70;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}.wire-live{stroke:#52cd75}.symbol-strokes{fill:none;stroke:#18271f;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}.symbol-strokes path[fill="var(--canvas-bg)"]{fill:#f7f9f6}.symbol-inner-label{fill:#18271f;stroke:none;font:650 11px monospace}.part-reference{fill:#18271f;font:690 12px Inter,Arial,sans-serif}.part-value{fill:#738079;font:10px Inter,Arial,sans-serif}.pin-anchor{fill:#f7f9f6;stroke:#179d70;stroke-width:1.3}.wire-junction{fill:#179d70;stroke:#f7f9f6;stroke-width:1}.probe-marker circle{fill:#eff8ef;stroke:#6db878;stroke-width:1.5}.probe-marker path{fill:#34824d}.probe-marker text{fill:#3e7352;font:640 9px Inter,Arial,sans-serif}.selection-outline{fill:rgba(102,164,71,.04);stroke:#82bd57;stroke-width:1;stroke-dasharray:4 4}</style>`;
    const svg = source.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace("<defs>", `<defs>${embeddedStyles}`);
    downloadFile(`${documentName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "circuit"}.svg`, svg, "image/svg+xml");
    setExportMenuOpen(false);
    setToast("Vektor-Schaltplan als SVG exportiert");
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as { document?: CircuitDocument; name?: string; parts?: SchematicPart[]; connections?: WireConnection[] };
      const candidate = parsed.document ?? (parsed.parts && parsed.connections ? parsed as CircuitDocument : null);
      if (!candidate?.parts || !Array.isArray(candidate.connections)) throw new Error("not native");
      const imported = cloneCircuit(candidate);
      imported.name = parsed.name ?? imported.name ?? file.name.replace(/\.[^.]+$/, "");
      setDocument(imported);
      documentRef.current = imported;
      setDocumentName(imported.name);
      setProjectId(null);
      setSelectedPartId(imported.parts.find((part) => part.type !== "ground")?.id ?? null);
      setResult(simulateCircuit(imported, "Transient", 120));
      setNetlistText(generateNetlist(imported));
      historyRef.current = { past: [], future: [] };
      setIsDirty(true);
      setToast(`${file.name} importiert`);
    } catch {
      const spice = parseSpiceDocument(text, file.name.replace(/\.[^.]+$/, ""));
      if (!spice) {
        setToast("Datei konnte nicht gelesen werden · .ms, JSON oder SPICE-Netlist verwenden");
      } else {
        setDocument(spice);
        documentRef.current = spice;
        setDocumentName(spice.name);
        setProjectId(null);
        setSelectedPartId(spice.parts[0]?.id ?? null);
        setNetlistText(generateNetlist(spice));
        setResult(simulateCircuit(spice, "Transient", 120));
        setIsDirty(true);
        setToast(`SPICE-Netlist importiert · ${spice.parts.length} Komponenten erkannt`);
      }
    } finally {
      event.target.value = "";
    }
  }

  function placeImportFile() {
    fileInputRef.current?.click();
  }

  function toggleGroup(group: string) {
    setExpandedGroups((current) => current.includes(group) ? current.filter((item) => item !== group) : [...current, group]);
  }

  function openInstrument(name: InstrumentName) {
    setActiveInstrument(name);
    setInstrumentPosition((current) => current.x < 0 ? { x: 460, y: 60 } : current);
  }

  function instrumentTitlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    instrumentDragRef.current = { x: instrumentPosition.x, y: instrumentPosition.y, startX: event.clientX, startY: event.clientY };
    setInstrumentDrag(true);
  }

  function instrumentTitlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = instrumentDragRef.current;
    if (!drag) return;
    setInstrumentPosition({ x: Math.max(8, drag.x + event.clientX - drag.startX), y: Math.max(8, drag.y + event.clientY - drag.startY) });
  }

  function instrumentTitlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    instrumentDragRef.current = null;
    setInstrumentDrag(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function applyGenerator() {
    const source = documentRef.current.parts.find((part) => ["voltage", "function-generator", "pulse-source"].includes(part.type));
    if (!source) {
      setToast("Füge zuerst eine Spannungsquelle aus der Bibliothek hinzu");
      return;
    }
    const frequency = parseSpiceValue(generatorFrequency, 1e3);
    const amplitude = parseSpiceValue(generatorAmplitude, 2);
    const waveform = generatorShape === "PULSE" ? `PULSE(0 ${amplitude} 0 1u 1u ${1 / (2 * frequency)} ${1 / frequency})` : `SINE(0 ${amplitude / 2} ${frequency})`;
    updateCircuit((current) => ({
      ...current,
      parts: current.parts.map((part) => part.id === source.id ? { ...part, type: "function-generator", value: waveform } : part),
    }));
    setGeneratorEnabled(true);
    setAnalysis("Transient");
    setToast(`Generator output · ${generatorShape} · ${frequency} Hz`);
  }

  function createNewProject() {
    const blank: CircuitDocument = { version: 1, name: "Untitled circuit", parts: [], connections: [], probes: [] };
    setDocument(blank);
    documentRef.current = blank;
    setDocumentName("Untitled circuit");
    setProjectId(null);
    setSelectedPartId(null);
    setResult(simulateCircuit(blank, "Transient", 120));
    setNetlistText(generateNetlist(blank));
    historyRef.current = { past: [], future: [] };
    setIsRunning(false);
    setElapsed(0);
    setIsDirty(true);
    setProjectMenuOpen(false);
    setToast("Leeres Schaltplanprojekt erstellt");
  }

  function applyNetlistDraft() {
    const imported = parseSpiceDocument(netlistText, documentName);
    if (!imported) {
      setToast("Keine unterstützten SPICE-Bauteile erkannt");
      return;
    }
    setDocument(imported);
    documentRef.current = imported;
    setSelectedPartId(imported.parts.find((part) => part.type !== "ground")?.id ?? null);
    setResult(simulateCircuit(imported, "Transient", 120));
    setNetlistText(generateNetlist(imported));
    setNetlistEditable(false);
    historyRef.current = { past: [], future: [] };
    setIsDirty(true);
    setToast(`Netlist übernommen · ${imported.parts.length} Bauteile`);
  }

  function rotateSelected() {
    if (!selectedPart) return;
    setPartProperty(selectedPart.id, "rotation", (selectedPart.rotation + 90) % 360);
  }

  const style = { "--zoom-label": `${Math.round(zoom * 100)}%` } as CSSProperties;

  return (
    <main className={appClassName} style={style}>
      <header className="appbar">
        <div className="brand-project">
          <div className="brand-mark"><svg viewBox="0 0 30 30" aria-hidden="true"><path d="M6 15h5m8 0h5M15 6v5m0 8v5" /><circle cx="15" cy="15" r="4" /><circle cx="6" cy="15" r="2" /><circle cx="24" cy="15" r="2" /><circle cx="15" cy="6" r="2" /><circle cx="15" cy="24" r="2" /></svg></div>
          <div className="brand-copy"><span className="brand-name">circuit<span>studio</span></span><span className="brand-edition">EDA WORKSPACE <i>·</i> 01</span></div>
          <div className="header-divider" />
          <div className="project-name-wrap">
            <input className="project-name-input" value={documentName} onChange={(event) => { setDocumentName(event.target.value); setIsDirty(true); }} aria-label="Projektname" />
            <span className="project-save-state"><span className={`save-dot${isDirty ? " dirty" : ""}`} />{isDirty ? "Nicht gespeichert" : "Alle Änderungen gespeichert"}</span>
          </div>
          <button className={`icon-button project-menu-trigger${projectMenuOpen ? " active" : ""}`} onClick={() => setProjectMenuOpen((open) => !open)} title="Gespeicherte Projekte öffnen"><Icon name="chevron" size={14} /></button>
          {projectMenuOpen && <div className="project-popover popover-panel"><div className="popover-title"><span>PROJEKTE</span><button className="icon-button small" onClick={() => setProjectMenuOpen(false)}><Icon name="close" size={14} /></button></div>{projects.length ? projects.map((project) => <button key={project.id} className="project-list-item" onClick={() => loadStoredProject(project)}><Icon name="file" size={15} /><span><strong>{project.name}</strong><small>{new Date(project.updatedAt).toLocaleDateString("de-DE")}</small></span></button>) : <div className="empty-projects">Noch keine Cloud-Projekte.<br />Speichere, um hier weiterzuarbeiten.</div>}<button className="project-new-button" onClick={createNewProject}><Icon name="plus" size={14} /> Neues Projekt</button></div>}
        </div>

        <div className="simulation-controls">
          <div className="analysis-picker-wrap">
            <button className="analysis-picker-button" onClick={() => setAnalysisMenuOpen((open) => !open)} aria-expanded={analysisMenuOpen} title="Choose simulation analysis">
              <span className="analysis-picker-icon"><Icon name="chart" size={14} /></span>
              <span className="analysis-picker-copy"><strong>{analysis}</strong><small>ANALYSIS MODE</small></span>
              <Icon name="chevron" size={12} />
            </button>
            {analysisMenuOpen && <div className="analysis-popover">{analysisOptions.map((option) => <button key={option.name} className={`analysis-option${analysis === option.name ? " active" : ""}`} onClick={() => { setAnalysis(option.name); setAnalysisMenuOpen(false); }}><span className="analysis-option-index">{option.eyebrow}</span><span><strong>{option.name}</strong><small>{option.detail}</small></span>{analysis === option.name && <Icon name="check" size={14} />}</button>)}<div className="analysis-popover-foot"><Icon name="spark" size={12} />Deterministic MNA solver · adaptive timestep</div></div>}
          </div>
          <div className="sim-control-divider" />
          <div className="sim-status"><span className={`sim-led${isRunning ? " live" : ""}`} />{isRunning ? "SIMULATING" : "READY"}</div>
          <div className="sim-control-divider" />
          <button className={`sim-button run-button${isRunning ? " running" : ""}`} onClick={isRunning ? pauseSimulation : runSimulation} title={isRunning ? "Pause simulation" : "Run simulation"}>
            <Icon name={isRunning ? "pause" : "play"} size={15} />{isRunning ? "Pause" : "Run"}
          </button>
          <button className="sim-button sim-icon-button" onClick={stopSimulation} title="Stop simulation"><Icon name="stop" size={13} /></button>
          <div className="simulation-readout"><Icon name="clock" size={13} /><span>{formatTime(elapsed)}</span></div>
          <label className="time-scale-control" title="Simulation playback speed"><span>×</span><input type="range" min="0.25" max="4" step="0.25" value={timeScale} onChange={(event) => setTimeScale(Number(event.target.value))} aria-label="Simulation time scale" /><b>{timeScale.toFixed(2).replace(/0$/, "")}×</b></label>
        </div>

        <div className="appbar-actions">
          <button className="header-action import-action" onClick={placeImportFile} title="SPICE- oder .ms-Datei importieren"><Icon name="upload" size={15} /><span>Import</span></button>
          <div className="export-wrap">
            <button className="header-action export-action" onClick={() => setExportMenuOpen((open) => !open)} title="Export"><Icon name="export" size={15} /><span>Export</span><Icon name="chevron" size={12} /></button>
            {exportMenuOpen && <div className="export-popover popover-panel"><div className="popover-title"><span>EXPORT DESIGN</span><button className="icon-button small" onClick={() => setExportMenuOpen(false)}><Icon name="close" size={14} /></button></div><button className="export-option" onClick={exportSpice}><span className="export-file-icon">.cir</span><span><strong>SPICE Netlist</strong><small>Ngspice · LTspice compatible</small></span></button><button className="export-option" onClick={exportNative}><span className="export-file-icon">.ms</span><span><strong>Native project</strong><small>Components · wires · probes</small></span></button><button className="export-option" onClick={exportSvg}><span className="export-file-icon"><Icon name="component" size={15} /></span><span><strong>Vector schematic</strong><small>SVG · infinitely scalable</small></span></button><button className="export-option" onClick={exportWaveform}><span className="export-file-icon">.csv</span><span><strong>Waveform data</strong><small>{result.sampleCount} simulation samples</small></span></button><button className="export-option" onClick={() => { setExportMenuOpen(false); window.print(); }}><span className="export-file-icon"><Icon name="file" size={15} /></span><span><strong>Print / save as PDF</strong><small>Browser print dialog</small></span></button><div className="export-note">Gerber output is available in a PCB layout workspace.</div></div>}
          </div>
          <button className={`save-button${isSaving ? " saving" : ""}`} onClick={() => void saveProject()} disabled={isSaving}><Icon name={isSaving ? "clock" : "save"} size={15} /><span>{isSaving ? "Saving…" : "Save"}</span><kbd>⌘ S</kbd></button>
          <button className="icon-button theme-toggle" onClick={() => setDarkTheme((current) => !current)} title={darkTheme ? "Light appearance" : "Dark appearance"}><Icon name={darkTheme ? "sun" : "moon"} size={16} /></button>
          <div className="avatar">CS</div>
        </div>
        <input ref={fileInputRef} type="file" accept=".ms,.json,.cir,.sp,.spice,.net,.txt" className="hidden-file-input" onChange={(event) => void importFile(event)} />
      </header>

      <section className="workbench" style={{ gridTemplateColumns: `${showLeftPanel ? "258px" : "0px"} minmax(0, 1fr) ${showRightPanel ? "286px" : "0px"}` }}>
        <aside className={`library-sidebar${showLeftPanel ? "" : " sidebar-collapsed"}`}>
          <div className="sidebar-tabs"><button className={sidebarTab === "Library" ? "selected" : ""} onClick={() => setSidebarTab("Library")}><Icon name="component" size={14} />Library</button><button className={sidebarTab === "Project" ? "selected" : ""} onClick={() => setSidebarTab("Project")}><Icon name="layers" size={14} />Project</button><button className="sidebar-collapse" onClick={() => setShowLeftPanel(false)} title="Seitenleiste schließen"><Icon name="chevronRight" size={14} /></button></div>
          {sidebarTab === "Library" ? <>
            <div className="sidebar-section-heading"><div><span className="eyebrow">DESIGN LIBRARY</span><strong>Components</strong></div><button className="icon-button small" title="Bibliothekseinstellungen"><Icon name="sliders" size={14} /></button></div>
            <label className="library-search"><Icon name="search" size={15} /><input placeholder="Search components…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>/</kbd></label>
            <div className="category-chips"><button className={activeCategory === "All components" ? "active" : ""} onClick={() => setActiveCategory("All components")}>All <span>35</span></button><button className={activeCategory === "Passive" ? "active" : ""} onClick={() => setActiveCategory("Passive")}>Passive</button><button className={activeCategory === "Semiconductors" ? "active" : ""} onClick={() => setActiveCategory("Semiconductors")}>Semis</button></div>
            {!search && activeCategory === "All components" && <div className="quick-access"><div className="section-label">QUICK ACCESS <button className="text-button" onClick={() => setActiveCategory("All components")}>See all</button></div><div className="quick-grid">{recentTypes.slice(0, 4).map((type) => { const item = catalog.find((part) => part.type === type); if (!item) return null; return <button className="quick-part" key={type} onClick={() => startPlacement(item)} title={`Place ${item.name}`}><span className={`part-mini-icon mini-${item.type}`}>{item.tag}</span><span>{item.name}</span></button>; })}</div></div>}
            <div className="library-list">
              {search || activeCategory !== "All components" ? filteredComponents.map((item) => <ComponentListItem key={item.type} item={item} onSelect={() => startPlacement(item)} />) : componentGroups.map((group) => {
                const open = expandedGroups.includes(group);
                const items = filteredComponents.filter((item) => item.group === group);
                return <div className="component-group" key={group}>
                  <button className={`group-heading${open ? " open" : ""}`} onClick={() => toggleGroup(group)}><Icon name={open ? "chevron" : "chevronRight"} size={12} /><span className={`group-symbol group-${categoryMeta[group].icon}`}><Icon name={categoryMeta[group].icon} size={13} /></span><span>{group}</span><small>{categoryMeta[group].count}</small></button>
                  {open && <div className="group-items">{items.map((item) => <ComponentListItem key={item.type} item={item} onSelect={() => startPlacement(item)} />)}</div>}
                </div>;
              })}
              {filteredComponents.length === 0 && <div className="empty-search"><Icon name="search" size={20} /><span>No components found</span><small>Try a different name or category.</small></div>}
            </div>
            <div className="library-footnote"><span className="online-dot" />2,480 models indexed <span>·</span> SPICE library</div>
          </> : <div className="project-tree-panel"><div className="sidebar-section-heading"><div><span className="eyebrow">CURRENT DESIGN</span><strong>Project tree</strong></div><button className="icon-button small" onClick={() => setProjectMenuOpen(true)} title="Saved projects"><Icon name="folder" size={14} /></button></div><div className="tree-project-name"><Icon name="file" size={15} /><strong>{documentName}</strong><span className="tree-badge">.ms</span></div><div className="tree-section-label">SCHEMATICS <span>01</span></div><button className="tree-row active"><span className="tree-indicator" /><Icon name="component" size={14} /><span>Sheet 1 — Main circuit</span><span>⌘1</span></button><div className="tree-section-label">COMPONENTS <span>{document.parts.length}</span></div><div className="tree-component-list">{document.parts.map((part) => <button key={part.id} className={`tree-row${selectedPartId === part.id ? " active" : ""}`} onClick={() => setSelectedPartId(part.id)}><span className="tree-component-symbol">{catalog.find((item) => item.type === part.type)?.tag ?? "•"}</span><span>{part.ref}</span><small>{part.value}</small></button>)}</div><div className="tree-section-label">NETS <span>{new Set(document.connections.map((wire) => pinId(wire.from))).size}</span></div><button className="tree-row"><span className="net-color" /><span>0 · GND</span><small>Global ground</small></button><button className="tree-row"><span className="net-color signal" /><span>V(out)</span><small>{formatVoltage(result.outputVoltage)}</small></button><button className="tree-add-row" onClick={placeImportFile}><Icon name="plus" size={13} />Import a SPICE netlist</button></div>}
        </aside>

        <section className="editor-column">
          <div className="canvas-toolbar">
            <div className="canvas-breadcrumb"><span>PROJECT</span><Icon name="chevronRight" size={12} /><strong>Sheet 1</strong><span className="sheet-indicator" /></div>
            <div className="toolbar-separator" />
            <div className="tool-group" role="toolbar" aria-label="Schaltplanwerkzeuge">
              <button className={`tool-button${tool.kind === "select" ? " active" : ""}`} onClick={() => { setTool({ kind: "select" }); setConnectionStart(null); }} title="Select · V"><Icon name="pointer" size={15} /></button>
              <button className={`tool-button${tool.kind === "wire" ? " active" : ""}`} onClick={() => { setTool({ kind: "wire" }); setConnectionStart(null); }} title="Wire · W"><Icon name="wire" size={15} /></button>
              <button className={`tool-button${tool.kind === "probe" ? " active" : ""}`} onClick={() => setTool({ kind: "probe" })} title="Voltage probe"><Icon name="probe" size={15} /></button>
              <button className={`tool-button${tool.kind === "pan" ? " active" : ""}`} onClick={() => setTool({ kind: "pan" })} title="Pan canvas · H"><Icon name="hand" size={15} /></button>
            </div>
            <div className="toolbar-separator" />
            <button className="tool-button grid-button" onClick={() => setGridVisible((current) => !current)} title="Toggle dynamic grid"><Icon name="grid" size={15} /><span>Grid</span><span className={`switch-dot${gridVisible ? " on" : ""}`} /></button>
            <button className="tool-button undo-button" onClick={undo} title="Undo · ⌘Z" disabled={!historyRef.current.past.length}><Icon name="undo" size={15} /></button>
            <button className="tool-button" onClick={redo} title="Redo · ⇧⌘Z" disabled={!historyRef.current.future.length}><Icon name="redo" size={15} /></button>
            <div className="toolbar-spacer" />
            <div className="toolbar-zoom"><button className="icon-button small" onClick={() => setZoom((current) => Math.max(0.42, current * 0.85))} title="Zoom out"><Icon name="minus" size={14} /></button><button className="zoom-value" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</button><button className="icon-button small" onClick={() => setZoom((current) => Math.min(2.25, current * 1.15))} title="Zoom in"><Icon name="plus" size={14} /></button></div>
            <button className={`reopen-panel${showLeftPanel ? " panel-open" : ""}`} onClick={() => setShowLeftPanel((open) => !open)} title={showLeftPanel ? "Close component library" : "Open component library"}><Icon name="component" size={15} /></button>
            <button className={`reopen-panel${showRightPanel ? " panel-open" : ""}`} onClick={() => setShowRightPanel((open) => !open)} title={showRightPanel ? "Close inspector" : "Open inspector"}><Icon name="sliders" size={15} /></button>
          </div>

          <div className={`canvas-stage${tool.kind === "pan" ? " cursor-pan" : tool.kind === "wire" ? " cursor-wire" : tool.kind === "probe" ? " cursor-probe" : tool.kind === "place" ? " cursor-place" : ""}`} ref={canvasRef} onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
            <svg ref={svgRef} className={`schematic-canvas${gridVisible ? " grid-on" : ""}`} viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet" onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerUp} onPointerCancel={handleCanvasPointerUp} onWheel={handleWheel} onContextMenu={(event) => event.preventDefault()}>
              <defs>
                <pattern id="canvas-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" className="grid-dot" /></pattern>
                <pattern id="canvas-major-grid" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.25" className="grid-dot-major" /></pattern>
                <filter id="wire-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              <rect width="1200" height="800" className="canvas-paper" />
              <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                {gridVisible && <><rect x="-600" y="-500" width="2600" height="1800" fill="url(#canvas-grid)" pointerEvents="none" /><rect x="-600" y="-500" width="2600" height="1800" fill="url(#canvas-major-grid)" pointerEvents="none" /></>}
                {componentPaths.map(({ connection, points, d }) => <g key={connection.id}>
                  <path d={d} className={`wire-hit-area${tool.kind === "wire" ? " wire-editable" : ""}`} fill="none" />
                  <path d={d} className={`circuit-wire${isRunning ? " wire-live" : ""}`} fill="none" filter={isRunning ? "url(#wire-glow)" : undefined} />
                  {points.length > 1 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" className="wire-junction" />}
                </g>)}
                {connectionStart && pointerWorld && tool.kind === "wire" && <path d={pathFor(autoRoute(getPinPosition(document.parts.find((part) => part.id === connectionStart.partId) ?? document.parts[0], connectionStart.pin), pointerWorld, document.parts, connectionStart.partId, ""))} className="wire-preview" fill="none" />}
                {document.parts.map((part) => {
                  const selected = part.id === selectedPartId;
                  const offsets = getPinOffsets(part.type);
                  const hasProbe = document.probes.find((probe) => probe.pin.partId === part.id);
                  return <g key={part.id} transform={`translate(${part.x} ${part.y})`} data-part-id={part.id} className={`schematic-part${selected ? " selected" : ""}${isRunning && part.type === "led" ? " part-live" : ""}`}>
                    {selected && <rect x="-61" y="-52" width="122" height="104" rx="8" className="selection-outline" />}
                    <g transform={`rotate(${part.rotation})`}><PartGlyph type={part.type} />{offsets.map((_, index) => <circle key={index} cx={offsets[index].x} cy={offsets[index].y} r={tool.kind === "wire" || tool.kind === "probe" || selected ? 5.2 : 3.1} className={`pin-anchor${selected || tool.kind === "wire" || tool.kind === "probe" ? " pin-active" : ""}${connectionStart?.partId === part.id && connectionStart.pin === index ? " pin-start" : ""}`} data-pin-id={`${part.id}:${index}`} />)}</g>
                    <text className="part-reference" x="0" y={part.type === "ground" ? 34 : -32} textAnchor="middle">{part.ref}</text>
                    <text className="part-value" x="0" y={part.type === "ground" ? 46 : 45} textAnchor="middle">{part.value}</text>
                    {hasProbe && <g className="probe-marker" transform="translate(38 -40)"><circle r="12" /><path d="M-4 1 0-5l4 6h-3v4h-2V1Z" /><text x="16" y="4">{hasProbe.name}</text></g>}
                  </g>;
                })}
              </g>
            </svg>
            <div className="canvas-hud canvas-hud-left"><span className="live-dot" />SHEET 1 <span className="hud-divider" />{document.parts.length} COMPONENTS <span className="hud-divider" />{document.connections.length} WIRES</div>
            <div className="canvas-hud canvas-hud-right"><span>{pointerWorld ? `${Math.round(pointerWorld.x)} · ${Math.round(pointerWorld.y)}` : "x  —   y  —"}</span><span className="hud-divider" />GRID 20</div>
            <div className="canvas-watermark"><div className="watermark-mark"><Icon name="component" size={20} /></div><span>DESIGN SPACE</span><small>Drag components here or use the library</small></div>
            {tool.kind === "place" && <div className="tool-hint"><Icon name="component" size={14} />Click to place {catalog.find((item) => item.type === tool.type)?.name ?? "component"}<button onClick={() => setTool({ kind: "select" })}>ESC</button></div>}
            {tool.kind === "wire" && <div className="tool-hint"><Icon name="wire" size={14} />{connectionStart ? "Select the destination pin" : "Select a source pin to start wiring"}<button onClick={() => { setTool({ kind: "select" }); setConnectionStart(null); }}>ESC</button></div>}
            {tool.kind === "probe" && <div className="tool-hint"><Icon name="probe" size={14} />Select a pin to place a voltage probe<button onClick={() => setTool({ kind: "select" })}>ESC</button></div>}
            <div className="canvas-mini-toolbar"><button className="mini-tool-pill" onClick={() => setTool({ kind: "wire" })}><Icon name="wire" size={14} /><span>Wire</span><kbd>W</kbd></button><button className="mini-tool-pill" onClick={() => setTool({ kind: "probe" })}><Icon name="probe" size={14} /><span>Probe</span></button><button className="mini-tool-pill" onClick={() => openInstrument("Oscilloscope")}><Icon name="scope" size={14} /><span>Scope</span></button></div>
            {activeInstrument && <div className={`floating-instrument instrument-${activeInstrument.toLowerCase().replaceAll(" ", "-")}`} style={{ left: instrumentPosition.x, top: instrumentPosition.y }}>
              <div className={`instrument-titlebar${instrumentDrag ? " dragging" : ""}`} onPointerDown={instrumentTitlePointerDown} onPointerMove={instrumentTitlePointerMove} onPointerUp={instrumentTitlePointerUp} onPointerCancel={instrumentTitlePointerUp}>
                <div className="instrument-title-icon"><Icon name={activeInstrument === "DMM" ? "target" : activeInstrument === "Oscilloscope" ? "scope" : activeInstrument === "Function generator" ? "waveform" : activeInstrument === "Bode plotter" ? "chart" : activeInstrument === "Logic analyzer" ? "logic" : activeInstrument === "Wattmeter" ? "bolt" : "diode"} size={15} /></div><div><strong>{activeInstrument}</strong><small>VIRTUAL INSTRUMENT · CH A</small></div><div className="instrument-window-actions"><button className="icon-button small" title="Dock to bottom" onClick={() => { setActiveDockTab("Scope"); setActiveInstrument(null); }}><Icon name="expand" size={13} /></button><button className="icon-button small" title="Close" onClick={() => setActiveInstrument(null)}><Icon name="close" size={14} /></button></div>
              </div>
              <div className="instrument-body">
                {activeInstrument === "DMM" && <div className="dmm-panel"><div className="dmm-screen"><div className="dmm-topline"><span>AUTO RANGE</span><span>{dmmMode.startsWith("AC") ? "AC" : "DC"}</span></div><strong>{dmmReading}</strong><span className="dmm-unit">{dmmUnit}</span></div><div className="dmm-controls"><select value={dmmMode} onChange={(event) => setDmmMode(event.target.value)} aria-label="DMM mode"><option>DC V</option><option>AC V</option><option>DC A</option><option>AC A</option><option>Ω</option><option>dB</option></select><button className="instrument-button" onClick={() => setDmmMode((mode) => mode === "DC V" ? "Ω" : "DC V")}>AUTO / RANGE</button></div><div className="dmm-footer"><span><i className="instrument-green-led" />OL SAFE</span><span>CAT III 600 V</span></div></div>}
                {activeInstrument === "Oscilloscope" && <div className="scope-panel"><div className="scope-readouts"><span><b className="channel-a">A</b> {formatVoltage(result.outputVoltage)} <small>DC</small></span><span>10.0 <small>ms / div</small></span><span>TRIG’D <i className="instrument-green-led" /></span></div><SignalChart result={result} progress={progress} compact /><div className="scope-controls"><label>TIME / DIV <select defaultValue="10 ms"><option>1 ms</option><option>10 ms</option><option>100 ms</option></select></label><label>TRIGGER <select defaultValue="Edge ↑"><option>Edge ↑</option><option>Edge ↓</option><option>Auto</option></select></label><button className="instrument-button" onClick={() => setActiveDockTab("Scope")}>OPEN 4-CH SCOPE</button></div></div>}
                {activeInstrument === "Function generator" && <div className="generator-panel"><div className="generator-output"><span className={`generator-led${generatorEnabled ? " active" : ""}`} />OUTPUT {generatorEnabled ? "ON" : "STANDBY"}<b>50 Ω</b></div><label className="instrument-field">WAVEFORM<select value={generatorShape} onChange={(event) => setGeneratorShape(event.target.value)}><option>SINE</option><option>PULSE</option></select></label><div className="generator-fields"><label className="instrument-field">FREQUENCY<input value={generatorFrequency} onChange={(event) => setGeneratorFrequency(event.target.value)} /></label><label className="instrument-field">AMPLITUDE<input value={generatorAmplitude} onChange={(event) => setGeneratorAmplitude(event.target.value)} /></label></div><button className={`instrument-primary${generatorEnabled ? " is-on" : ""}`} onClick={applyGenerator}>{generatorEnabled ? "UPDATE OUTPUT" : "ENABLE OUTPUT"}<Icon name="play" size={13} /></button><span className="instrument-footnote">Output is coupled to the first voltage source.</span></div>}
                {activeInstrument === "Bode plotter" && <div className="bode-panel"><div className="instrument-metric-row"><div><span>GAIN @ 1 kHz</span><strong>{(result.traces[0]?.values[Math.min(30, result.traces[0]?.values.length - 1)] ?? -3).toFixed(1)} <small>dB</small></strong></div><div><span>PHASE MARGIN</span><strong>— <small>°</small></strong></div></div><SignalChart result={bodePreview} compact /><button className="instrument-primary" onClick={() => { setAnalysis("AC Sweep"); const bode = simulateCircuit(documentRef.current, "AC Sweep", 120); setResult(bode); setActiveDockTab("Analysis"); }}>RUN AC SWEEP <Icon name="play" size={13} /></button></div>}
                {activeInstrument === "Logic analyzer" && <div className="logic-panel"><div className="logic-header"><span>CHANNEL</span><span>HEX · 8 BIT</span><strong>7F</strong></div>{Array.from({ length: 8 }, (_, index) => <div className="logic-channel" key={index}><b>D{index}</b><div className="logic-signal"><span style={{ transform: `translateY(${((index + Math.floor(elapsed / 10)) % 2) * 5}px)` }} /></div><small>{index < 7 ? "1" : "0"}</small></div>)}<div className="logic-footer"><span>1.00 MHz</span><span>EDGE TRIGGER · D0</span><button className="instrument-button" onClick={() => setIsRunning((running) => !running)}>{isRunning ? "STOP" : "ARM"}</button></div></div>}
                {activeInstrument === "Wattmeter" && <div className="wattmeter-panel"><div className="power-reading"><span>ACTIVE POWER</span><strong>{((result.outputVoltage * result.outputVoltage) / 10_000 * 1000).toFixed(2)}<small>mW</small></strong></div><div className="power-metrics"><div><span>APPARENT</span><b>{((result.outputVoltage * result.outputVoltage) / 10_000 * 1000).toFixed(2)} mVA</b></div><div><span>POWER FACTOR</span><b>0.998</b></div><div><span>RMS CURRENT</span><b>{(result.outputVoltage / 10_000 * 1000).toFixed(3)} mA</b></div></div><div className="wattmeter-wave"><SignalChart result={result} compact /></div></div>}
                {activeInstrument === "IV analyzer" && <div className="iv-panel"><div className="instrument-metric-row"><div><span>DEVICE</span><strong>Diode <small>1N4148</small></strong></div><div><span>SWEEP RANGE</span><strong>−1…0.8 <small>V</small></strong></div></div><svg viewBox="0 0 360 108" className="iv-chart"><path d="M30 8v82h320M30 48h320M110 8v82M190 8v82M270 8v82" className="iv-grid" /><path d="M32 48h210q20 0 26-18t10-16 8-3 9-2 12-2 12-1 14-1 17-1" className="iv-curve" fill="none" /><text x="6" y="15">I (mA)</text><text x="326" y="104">V (V)</text></svg><button className="instrument-primary" onClick={() => setToast("IV sweep complete · 81 points captured")}>RUN DEVICE SWEEP <Icon name="play" size={13} /></button></div>}
              </div>
            </div>}
          </div>

          <section className="bottom-dock">
            <div className="dock-header"><div className="dock-tabs">{(["Scope", "Netlist", "Console", "Analysis"] as DockTab[]).map((tab) => <button key={tab} className={`dock-tab${activeDockTab === tab ? " active" : ""}`} onClick={() => setActiveDockTab(tab)}>{tab === "Scope" ? <Icon name="waveform" size={14} /> : tab === "Netlist" ? <Icon name="terminal" size={14} /> : tab === "Console" ? <Icon name="terminal" size={14} /> : <Icon name="chart" size={14} />}{tab}{tab === "Console" && <span className="console-count">{consoleLines.length}</span>}</button>)}</div><div className="dock-right"><span className="dock-engine"><i className="online-dot" /> MNA ENGINE</span><span className="dock-divider" /><span className="dock-result">{result.status}</span><button className="icon-button small" onClick={() => openInstrument("Oscilloscope")} title="Open scope"><Icon name="expand" size={13} /></button></div></div>
            <div className="dock-content">
              {activeDockTab === "Scope" && <div className="scope-dock-content"><div className="scope-channel-legend"><div><i style={{ background: result.traces[0]?.color ?? "#87e84b" }} />{result.traces[0]?.name ?? "V(out)"}<small>CH 1 · DC 5 V</small></div><div className="scope-stat"><span>VOLTAGE</span><strong>{formatVoltage(result.outputVoltage)}</strong></div><div className="scope-stat"><span>TIMEBASE</span><strong>{result.domain === "time" ? "8.0 ms" : result.domain === "frequency" ? "10 Hz – 100 kHz" : "DC"}</strong></div></div><div className="scope-chart-wrap"><SignalChart result={result} progress={progress} /></div><div className="scope-dock-actions"><button className="channel-chip"><i style={{ background: result.traces[0]?.color ?? "#87e84b" }} />CH1 <span>5V</span></button><button className="channel-chip channel-muted" onClick={() => openInstrument("Oscilloscope")}><Icon name="plus" size={12} />CH2</button><button className="dock-measurement" onClick={() => openInstrument("DMM")}><Icon name="target" size={13} /> DMM <b>{formatVoltage(result.outputVoltage)}</b></button></div></div>}
              {activeDockTab === "Netlist" && <div className="netlist-dock-content"><div className="netlist-topline"><div><span className="terminal-prompt">$</span> circuit.sp <span className="netlist-meta">· {document.parts.length} devices · {document.connections.length} connections</span></div><div><button className="dock-small-button" onClick={() => netlistEditable ? applyNetlistDraft() : setNetlistEditable(true)}>{netlistEditable ? "Apply deck" : "Edit netlist"}</button><button className="dock-small-button" onClick={exportSpice}><Icon name="download" size={12} />Export .cir</button></div></div><textarea className="netlist-editor" spellCheck={false} value={netlistEditable ? netlistText : netlist} readOnly={!netlistEditable} onChange={(event) => setNetlistText(event.target.value)} /></div>}
              {activeDockTab === "Console" && <div className="console-dock-content"><div className="console-toolbar"><span><i className="online-dot" /> ENGINE OUTPUT</span><button onClick={() => setConsoleLines([])}>Clear</button></div><div className="console-lines">{consoleLines.map((line, index) => <div key={`${line}-${index}`} className={line.startsWith("ERROR") ? "console-error" : ""}><span>{String(consoleLines.length - index).padStart(2, "0")}</span><code>{line}</code></div>)}{!consoleLines.length && <div className="console-empty">Console cleared · run an analysis to see output.</div>}</div></div>}
              {activeDockTab === "Analysis" && <div className="analysis-dock-content"><div className="analysis-summary"><div className="analysis-summary-icon"><Icon name="chart" size={18} /></div><div><strong>{analysis === "AC Sweep" ? "Frequency response" : analysis === "DC Sweep" ? "Transfer characteristic" : analysis}</strong><span>{result.status} · {result.sampleCount} points</span></div><span className="analysis-summary-value">{formatVoltage(result.outputVoltage)}</span></div><div className="analysis-chart-wrap"><SignalChart result={result} progress={progress} /></div><div className="analysis-mode-row">{analysisOptions.map((option) => <button key={option.name} className={analysis === option.name ? "active" : ""} onClick={() => setAnalysis(option.name)}><span>{option.eyebrow}</span>{option.name}</button>)}</div></div>}
            </div>
          </section>
          <footer className="statusbar"><div><span className="online-dot" />All systems nominal <span className="status-divider" />Autosave on</div><div><span>{tool.kind === "wire" ? connectionStart ? "Select destination pin" : "Select source pin" : tool.kind === "place" ? "Click canvas to place component" : "Ready"}</span><span className="status-divider" /><span>SNAP 20 px</span><span className="status-divider" /><span>XY {pointerWorld ? `${Math.round(pointerWorld.x)}, ${Math.round(pointerWorld.y)}` : "—, —"}</span></div><div><span>SPICE 3f5 compatible</span><span className="status-divider" /><span>{Math.round(zoom * 100)}%</span></div></footer>
        </section>

        <aside className={`inspector-sidebar${showRightPanel ? "" : " sidebar-collapsed"}`}>
          <div className="inspector-header"><div><span className="eyebrow">PROPERTIES</span><strong>{selectedPart ? "Inspector" : "Design settings"}</strong></div><button className="icon-button small" onClick={() => setShowRightPanel(false)} title="Close inspector"><Icon name="close" size={15} /></button></div>
          {selectedPart ? <>
            <div className="inspected-component"><div className={`inspector-component-icon icon-${selectedPart.type}`}><span>{catalog.find((item) => item.type === selectedPart.type)?.tag ?? "•"}</span></div><div><strong>{catalog.find((item) => item.type === selectedPart.type)?.name ?? selectedPart.type}</strong><span>{catalog.find((item) => item.type === selectedPart.type)?.group ?? "Component"}</span></div><button className="icon-button small" onClick={rotateSelected} title="Rotate 90°"><Icon name="rotate" size={14} /></button></div>
            <div className="inspector-section"><div className="inspector-section-title">IDENTIFICATION <span>01</span></div><label className="inspector-field"><span>Reference</span><input value={selectedPart.ref} onChange={(event) => setPartProperty(selectedPart.id, "ref", event.target.value)} /></label><label className="inspector-field"><span>Value</span><div className="input-with-unit"><input value={selectedPart.value} onChange={(event) => setPartProperty(selectedPart.id, "value", event.target.value)} /><span>{selectedPart.type === "resistor" || selectedPart.type === "potentiometer" ? "Ω" : selectedPart.type === "capacitor" ? "F" : selectedPart.type === "inductor" ? "H" : ""}</span></div></label><div className="inspector-readonly"><span>Footprint</span><span>{selectedPart.type === "ground" ? "—" : selectedPart.type === "resistor" ? "R_0603 · THT" : "Generic · 2 pin"}</span></div><div className="inspector-readonly"><span>Rotation</span><span>{selectedPart.rotation}°</span></div></div>
            {selectedPart.type === "resistor" || selectedPart.type === "capacitor" || selectedPart.type === "inductor" ? <div className="inspector-section"><div className="inspector-section-title">TOLERANCE & VARIATION <span>02</span></div><label className="inspector-field"><span>Tolerance</span><div className="input-with-unit"><input value={selectedPart.tolerance ?? (selectedPart.type === "resistor" ? "5%" : "10%")} onChange={(event) => setPartProperty(selectedPart.id, "tolerance", event.target.value)} /><span>±</span></div></label><label className="inspector-field"><span>Temp. coefficient</span><input value={selectedPart.tempCoeff ?? "—"} onChange={(event) => setPartProperty(selectedPart.id, "tempCoeff", event.target.value)} /></label><div className="tolerance-hint"><Icon name="spark" size={13} />Used by Monte Carlo analysis</div></div> : null}
            <div className="inspector-section model-section"><button className="inspector-section-title model-toggle" onClick={() => setShowAdvanced((open) => !open)}>SPICE MODEL <span>{showAdvanced ? "−" : "+"}</span></button>{showAdvanced && <pre className="spice-model">{selectedPart.type === "resistor" ? `${selectedPart.ref} N001 0 ${selectedPart.value.replace(/[Ω\s]/g, "")}` : selectedPart.type === "diode" || selectedPart.type === "led" ? `.model ${selectedPart.ref} D(IS=2.52n N=1.75)` : `* ${selectedPart.ref} ${selectedPart.value}\n* Generic model · editable`}</pre>}<button className="model-edit-link" onClick={() => { setActiveDockTab("Netlist"); setNetlistEditable(true); }}>Open in netlist editor <Icon name="chevronRight" size={12} /></button></div>
            <div className="inspector-footer-actions"><button className="icon-button small" title="Duplicate" onClick={() => { const original = selectedPart; const duplicate = { ...original, id: makeId(original.ref.toLowerCase()), ref: `${original.ref.replace(/[0-9]/g, "")}${document.parts.filter((part) => part.ref.startsWith(original.ref.replace(/[0-9]/g, ""))).length + 1}`, x: original.x + 80, y: original.y + 60 }; updateCircuit((current) => ({ ...current, parts: [...current.parts, duplicate] })); setSelectedPartId(duplicate.id); }}><Icon name="copy" size={14} />Duplicate</button><button className="icon-button small delete-action" onClick={removeSelectedPart} title="Delete component"><Icon name="trash" size={14} />Delete</button></div>
          </> : <>
            <div className="design-summary-card"><div className="design-summary-top"><div className="design-summary-icon"><Icon name="component" size={17} /></div><div><strong>RC low-pass filter</strong><span>Passive · 1st order</span></div><span className="ready-pill"><i />READY</span></div><div className="design-summary-stats"><div><strong>{document.parts.length}</strong><span>PARTS</span></div><div><strong>{document.connections.length}</strong><span>WIRES</span></div><div><strong>{document.probes.length}</strong><span>PROBES</span></div></div></div>
            <div className="inspector-section"><div className="inspector-section-title">ANALYSIS SETUP <span>01</span></div><label className="inspector-field"><span>Analysis mode</span><select value={analysis} onChange={(event) => setAnalysis(event.target.value as AnalysisMode)}>{analysisOptions.map((option) => <option key={option.name}>{option.name}</option>)}</select></label><label className="inspector-field"><span>Temperature</span><div className="input-with-unit"><input defaultValue="27" /><span>°C</span></div></label><label className="inspector-field"><span>Max timestep</span><div className="input-with-unit"><input defaultValue="10" /><span>µs</span></div></label><label className="inspector-checkbox"><input type="checkbox" defaultChecked /><span>Adaptive timestep control</span></label></div>
            <div className="inspector-section"><div className="inspector-section-title">MEASUREMENTS <span>{document.probes.length}</span></div>{document.probes.map((probe) => <div className="inspector-probe" key={probe.id}><span className="probe-icon"><Icon name="probe" size={13} /></span><span>{probe.name}<small>{document.parts.find((part) => part.id === probe.pin.partId)?.ref ?? "—"} · pin {probe.pin.pin + 1}</small></span><b>{formatVoltage(result.outputVoltage)}</b></div>)}<button className="add-probe-button" onClick={() => setTool({ kind: "probe" })}><Icon name="plus" size={13} />Add voltage probe</button></div>
          </>}
          <div className="instrument-shortcuts"><div className="inspector-section-title">INSTRUMENTS <button className="text-button" onClick={() => openInstrument("Oscilloscope")}>Open all</button></div><div className="instrument-shortcut-grid">{(["DMM", "Oscilloscope", "Function generator", "Bode plotter", "Logic analyzer", "Wattmeter", "IV analyzer"] as InstrumentName[]).map((instrument) => <button key={instrument} onClick={() => openInstrument(instrument)}><span className={`shortcut-icon shortcut-${instrument.toLowerCase().replaceAll(" ", "-")}`}><Icon name={instrument === "DMM" ? "target" : instrument === "Oscilloscope" ? "scope" : instrument === "Function generator" ? "waveform" : instrument === "Bode plotter" ? "chart" : instrument === "Logic analyzer" ? "logic" : instrument === "Wattmeter" ? "bolt" : "diode"} size={14} /></span>{instrument}</button>)}</div></div>
          <div className="sidebar-version"><span>CS</span><div><strong>Circuit Studio</strong><small>EDA ENGINE · BUILD 0.9.4</small></div><button className="icon-button small" title="Settings"><Icon name="more" size={16} /></button></div>
        </aside>
      </section>
      {toast && <div className="toast-message"><span className="toast-icon"><Icon name="check" size={14} /></span>{toast}</div>}
    </main>
  );
}

function ComponentListItem({ item, onSelect }: { item: CatalogItem; onSelect: () => void }) {
  return <button className="component-row" onClick={onSelect} draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-circuit-component", item.type); event.dataTransfer.setData("text/plain", item.type); event.dataTransfer.effectAllowed = "copy"; }} title={`${item.detail} · click to place, or drag onto the canvas`}>
    <span className={`component-symbol component-symbol-${item.type}`}>{item.tag}</span><span className="component-row-label"><strong>{item.name}</strong><small>{item.detail}</small></span><span className="component-row-add"><Icon name="plus" size={14} /></span>
  </button>;
}
