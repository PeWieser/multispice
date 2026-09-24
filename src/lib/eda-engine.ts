export type AnalysisMode =
  | "Transient"
  | "AC Sweep"
  | "DC Operating Point"
  | "DC Sweep"
  | "Monte Carlo";

export interface Point {
  x: number;
  y: number;
}

export interface PinReference {
  partId: string;
  pin: number;
}

export interface SchematicPart {
  id: string;
  type: string;
  ref: string;
  value: string;
  x: number;
  y: number;
  rotation: number;
  tolerance?: string;
  tempCoeff?: string;
}

export interface WireConnection {
  id: string;
  from: PinReference;
  to: PinReference;
}

export interface Probe {
  id: string;
  name: string;
  pin: PinReference;
}

export interface CircuitDocument {
  version: number;
  name: string;
  parts: SchematicPart[];
  connections: WireConnection[];
  probes: Probe[];
}

export interface SimulationTrace {
  name: string;
  color: string;
  values: number[];
  phase?: number[];
}

export interface SimulationResult {
  domain: "time" | "frequency" | "dc" | "samples";
  xLabel: string;
  x: number[];
  traces: SimulationTrace[];
  duration: number;
  sampleCount: number;
  status: string;
  outputVoltage: number;
}

export const DEFAULT_CIRCUIT: CircuitDocument = {
  version: 1,
  name: "RC low-pass filter",
  parts: [
    { id: "v1", type: "voltage", ref: "V1", value: "5 V", x: 280, y: 360, rotation: 90 },
    { id: "r1", type: "resistor", ref: "R1", value: "1 kΩ", x: 450, y: 320, rotation: 0, tolerance: "5%", tempCoeff: "100 ppm/°C" },
    { id: "r2", type: "resistor", ref: "R2", value: "10 kΩ", x: 620, y: 400, rotation: 90, tolerance: "1%", tempCoeff: "50 ppm/°C" },
    { id: "c1", type: "capacitor", ref: "C1", value: "1 µF", x: 760, y: 400, rotation: 90, tolerance: "10%" },
    { id: "gnd1", type: "ground", ref: "GND", value: "0", x: 280, y: 540, rotation: 0 },
    { id: "gnd2", type: "ground", ref: "GND", value: "0", x: 620, y: 540, rotation: 0 },
    { id: "gnd3", type: "ground", ref: "GND", value: "0", x: 760, y: 540, rotation: 0 },
  ],
  connections: [
    { id: "w1", from: { partId: "v1", pin: 0 }, to: { partId: "r1", pin: 0 } },
    { id: "w2", from: { partId: "r1", pin: 1 }, to: { partId: "r2", pin: 0 } },
    { id: "w3", from: { partId: "r2", pin: 0 }, to: { partId: "c1", pin: 0 } },
    { id: "w4", from: { partId: "v1", pin: 1 }, to: { partId: "gnd1", pin: 0 } },
    { id: "w5", from: { partId: "r2", pin: 1 }, to: { partId: "gnd2", pin: 0 } },
    { id: "w6", from: { partId: "c1", pin: 1 }, to: { partId: "gnd3", pin: 0 } },
  ],
  probes: [{ id: "probe-out", name: "V(out)", pin: { partId: "r1", pin: 1 } }],
};

const TWO_TERMINAL_TYPES = new Set([
  "resistor", "capacitor", "inductor", "voltage", "current", "ac-source", "pulse-source",
  "function-generator", "diode", "led", "zener", "schottky", "potentiometer", "switch",
  "fuse", "lamp", "motor", "crystal", "transformer", "relay", "buzzer", "thermistor",
  "photodiode", "varactor", "scr", "triac", "jfet", "igbt",
]);

export function getPinOffsets(type: string): Point[] {
  if (type === "ground") return [{ x: 0, y: -20 }];
  if (["opamp", "comparator"].includes(type)) {
    return [
      { x: -56, y: -18 }, { x: -56, y: 18 }, { x: 56, y: 0 },
      { x: 0, y: -42 }, { x: 0, y: 42 },
    ];
  }
  if (["transistor-npn", "transistor-pnp", "mosfet-n", "mosfet-p", "bjt"].includes(type)) {
    return [{ x: -44, y: 0 }, { x: 0, y: -44 }, { x: 0, y: 44 }];
  }
  if (["logic", "timer", "regulator", "microcontroller", "seven-segment"].includes(type)) {
    return [{ x: -52, y: -22 }, { x: -52, y: 22 }, { x: 52, y: -22 }, { x: 52, y: 22 }];
  }
  if (TWO_TERMINAL_TYPES.has(type)) return [{ x: -42, y: 0 }, { x: 42, y: 0 }];
  return [{ x: -42, y: 0 }, { x: 42, y: 0 }];
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

function parseSourceValue(value: string, time: number): number {
  const functionMatch = value.match(/(SINE|SIN|PULSE)\s*\(([^)]*)\)/i);
  if (functionMatch) {
    const values = functionMatch[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => parseSpiceValue(part));
    if (/PULSE/i.test(functionMatch[1])) {
      const [low = 0, high = 5, delay = 0, rise = 0, fall = 0, width = 0.5e-3, period = 1e-3] = values;
      if (time < delay) return low;
      const local = Math.max(0, time - delay) % Math.max(period, 1e-12);
      if (rise > 0 && local < rise) return low + ((high - low) * local) / rise;
      if (local < rise + width) return high;
      if (fall > 0 && local < rise + width + fall) return high - ((high - low) * (local - rise - width)) / fall;
      return low;
    }
    const [offset = 0, amplitude = 1, frequency = 1e3, delay = 0, damping = 0, phase = 0] = values;
    if (time < delay) return offset;
    const angle = 2 * Math.PI * frequency * (time - delay) + (phase * Math.PI) / 180;
    return offset + amplitude * Math.sin(angle) * Math.exp(-Math.max(0, damping) * Math.max(0, time - delay));
  }
  return parseSpiceValue(value);
}

function isVoltageSource(type: string): boolean {
  return ["voltage", "ac-source", "pulse-source", "function-generator"].includes(type);
}

function isCurrentSource(type: string): boolean {
  return type === "current";
}

interface Topology {
  nodeCount: number;
  partNodes: Map<string, number[]>;
  nodeNames: string[];
}

function buildTopology(document: CircuitDocument): Topology {
  const parent = new Map<string, string>();
  const key = (reference: PinReference) => `${reference.partId}:${reference.pin}`;
  const find = (value: string): string => {
    const currentParent = parent.get(value);
    if (!currentParent || currentParent === value) return value;
    const root = find(currentParent);
    parent.set(value, root);
    return root;
  };
  const union = (left: string, right: string) => {
    if (!parent.has(left) || !parent.has(right)) return;
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (const part of document.parts) {
    getPinOffsets(part.type).forEach((_, pin) => parent.set(`${part.id}:${pin}`, `${part.id}:${pin}`));
  }
  for (const connection of document.connections) union(key(connection.from), key(connection.to));
  const groundParts = document.parts.filter((part) => part.type === "ground");
  if (groundParts.length > 1) {
    const firstGround = key({ partId: groundParts[0].id, pin: 0 });
    for (const ground of groundParts.slice(1)) union(firstGround, key({ partId: ground.id, pin: 0 }));
  }
  const groundKey = groundParts.length ? find(key({ partId: groundParts[0].id, pin: 0 })) : null;
  const roots: string[] = [];
  for (const pinKey of parent.keys()) {
    const root = find(pinKey);
    if (!roots.includes(root)) roots.push(root);
  }
  const indices = new Map<string, number>();
  if (groundKey) indices.set(groundKey, 0);
  for (const root of roots) {
    if (!indices.has(root)) indices.set(root, indices.size);
  }
  const nodeNames = Array.from({ length: indices.size }, (_, index) => index === 0 && groundKey ? "0" : `N${String(index).padStart(3, "0")}`);
  const partNodes = new Map<string, number[]>();
  for (const part of document.parts) {
    partNodes.set(part.id, getPinOffsets(part.type).map((_, pin) => indices.get(find(`${part.id}:${pin}`)) ?? 0));
  }
  return { nodeCount: indices.size, partNodes, nodeNames };
}

function nodeMatrixIndex(node: number): number {
  return node === 0 ? -1 : node - 1;
}

function stampConductance(matrix: number[][], a: number, b: number, conductance: number) {
  const ia = nodeMatrixIndex(a);
  const ib = nodeMatrixIndex(b);
  if (ia >= 0) matrix[ia][ia] += conductance;
  if (ib >= 0) matrix[ib][ib] += conductance;
  if (ia >= 0 && ib >= 0) {
    matrix[ia][ib] -= conductance;
    matrix[ib][ia] -= conductance;
  }
}

function stampCurrent(rhs: number[], a: number, b: number, current: number) {
  const ia = nodeMatrixIndex(a);
  const ib = nodeMatrixIndex(b);
  if (ia >= 0) rhs[ia] -= current;
  if (ib >= 0) rhs[ib] += current;
}

function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const values = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(values[row][column]) > Math.abs(values[pivot][column])) pivot = row;
    }
    if (Math.abs(values[pivot][column]) < 1e-20) continue;
    [values[column], values[pivot]] = [values[pivot], values[column]];
    const divisor = values[column][column];
    for (let item = column; item <= size; item += 1) values[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = values[row][column];
      if (!factor) continue;
      for (let item = column; item <= size; item += 1) values[row][item] -= factor * values[column][item];
    }
  }
  return values.map((row, index) => (Math.abs(row[index]) < 1e-20 ? 0 : row[size]));
}

function solveRealCircuit(
  document: CircuitDocument,
  topology: Topology,
  time: number,
  capacitorDt?: number,
  previousCapacitorVoltages: Map<string, number> = new Map(),
  sourceOverrides: Map<string, number> = new Map(),
): number[] {
  const voltageSources = document.parts.filter((part) => isVoltageSource(part.type));
  const nodeUnknowns = Math.max(0, topology.nodeCount - 1);
  const size = nodeUnknowns + voltageSources.length;
  if (!size) return [0];
  let guess = new Array<number>(size).fill(0);

  for (let iteration = 0; iteration < 48; iteration += 1) {
    const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    const rhs = new Array<number>(size).fill(0);
    for (let node = 1; node < topology.nodeCount; node += 1) stampConductance(matrix, node, 0, 1e-12);

    for (const part of document.parts) {
      const nodes = topology.partNodes.get(part.id) ?? [];
      const a = nodes[0] ?? 0;
      const b = nodes[1] ?? 0;
      const pa = nodeMatrixIndex(a);
      const pb = nodeMatrixIndex(b);
      if (["resistor", "thermistor", "potentiometer"].includes(part.type)) {
        const resistance = Math.max(Math.abs(parseSpiceValue(part.value, 1e3)), 1e-9);
        stampConductance(matrix, a, b, 1 / resistance);
      } else if (part.type === "capacitor" && capacitorDt) {
        const capacitance = Math.max(Math.abs(parseSpiceValue(part.value, 1e-6)), 1e-15);
        const conductance = capacitance / capacitorDt;
        const previous = previousCapacitorVoltages.get(part.id) ?? 0;
        stampConductance(matrix, a, b, conductance);
        stampCurrent(rhs, a, b, -conductance * previous);
      } else if (part.type === "inductor") {
        stampConductance(matrix, a, b, capacitorDt ? capacitorDt / Math.max(parseSpiceValue(part.value, 1e-3), 1e-12) : 1e9);
      } else if (isCurrentSource(part.type)) {
        stampCurrent(rhs, a, b, parseSourceValue(part.value, time));
      } else if (["diode", "led", "zener", "schottky", "photodiode", "varactor"].includes(part.type) && pa >= 0 && pb >= 0) {
        const voltage = (guess[pa] ?? 0) - (guess[pb] ?? 0);
        const thermalVoltage = part.type === "schottky" ? 0.035 : 0.02585;
        const saturation = part.type === "led" ? 1e-18 : 1e-12;
        const exponential = Math.exp(Math.max(-40, Math.min(40, voltage / thermalVoltage)));
        const conductance = saturation * exponential / thermalVoltage + 1e-12;
        const current = saturation * (exponential - 1);
        stampConductance(matrix, a, b, conductance);
        stampCurrent(rhs, a, b, current - conductance * voltage);
      }
    }

    voltageSources.forEach((part, sourceIndex) => {
      const nodes = topology.partNodes.get(part.id) ?? [0, 0];
      const a = nodeMatrixIndex(nodes[0] ?? 0);
      const b = nodeMatrixIndex(nodes[1] ?? 0);
      const branch = nodeUnknowns + sourceIndex;
      if (a >= 0) {
        matrix[a][branch] += 1;
        matrix[branch][a] += 1;
      }
      if (b >= 0) {
        matrix[b][branch] -= 1;
        matrix[branch][b] -= 1;
      }
      rhs[branch] = sourceOverrides.get(part.id) ?? parseSourceValue(part.value, time);
    });

    const next = solveLinear(matrix, rhs);
    let difference = 0;
    for (let index = 0; index < nodeUnknowns; index += 1) difference = Math.max(difference, Math.abs((next[index] ?? 0) - (guess[index] ?? 0)));
    if (difference < 1e-7) return next;
    const damping = iteration < 2 ? 0.72 : difference > 5 ? 0.48 : 0.82;
    guess = next.map((value, index) => (guess[index] ?? 0) + damping * (value - (guess[index] ?? 0)));
    if (iteration === 47) return next;
  }
  return guess;
}

function readNode(solution: number[], node: number): number {
  if (node === 0) return 0;
  return solution[node - 1] ?? 0;
}

interface Complex {
  real: number;
  imaginary: number;
}

const complex = (real = 0, imaginary = 0): Complex => ({ real, imaginary });
const cAdd = (a: Complex, b: Complex) => complex(a.real + b.real, a.imaginary + b.imaginary);
const cSub = (a: Complex, b: Complex) => complex(a.real - b.real, a.imaginary - b.imaginary);
const cMul = (a: Complex, b: Complex) => complex(a.real * b.real - a.imaginary * b.imaginary, a.real * b.imaginary + a.imaginary * b.real);
const cDiv = (a: Complex, b: Complex) => {
  const denominator = b.real * b.real + b.imaginary * b.imaginary || 1e-30;
  return complex((a.real * b.real + a.imaginary * b.imaginary) / denominator, (a.imaginary * b.real - a.real * b.imaginary) / denominator);
};

function solveComplex(matrix: Complex[][], rhs: Complex[]): Complex[] {
  const size = rhs.length;
  const values = matrix.map((row, index) => [...row.map((value) => ({ ...value })), { ...rhs[index] }]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      const magnitude = (value: Complex) => value.real * value.real + value.imaginary * value.imaginary;
      if (magnitude(values[row][column]) > magnitude(values[pivot][column])) pivot = row;
    }
    if (Math.hypot(values[pivot][column].real, values[pivot][column].imaginary) < 1e-22) continue;
    [values[column], values[pivot]] = [values[pivot], values[column]];
    const divisor = values[column][column];
    for (let item = column; item <= size; item += 1) values[column][item] = cDiv(values[column][item], divisor);
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = values[row][column];
      if (Math.hypot(factor.real, factor.imaginary) < 1e-28) continue;
      for (let item = column; item <= size; item += 1) values[row][item] = cSub(values[row][item], cMul(factor, values[column][item]));
    }
  }
  return values.map((row, index) => Math.hypot(row[index].real, row[index].imaginary) < 1e-22 ? complex() : row[size]);
}

function solveAcCircuit(document: CircuitDocument, topology: Topology, frequency: number): Complex[] {
  const voltageSources = document.parts.filter((part) => isVoltageSource(part.type));
  const nodeUnknowns = Math.max(0, topology.nodeCount - 1);
  const size = nodeUnknowns + voltageSources.length;
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => complex()));
  const rhs = Array.from({ length: size }, () => complex());
  const omega = 2 * Math.PI * frequency;
  const stampY = (a: number, b: number, admittance: Complex) => {
    const ia = nodeMatrixIndex(a);
    const ib = nodeMatrixIndex(b);
    if (ia >= 0) matrix[ia][ia] = cAdd(matrix[ia][ia], admittance);
    if (ib >= 0) matrix[ib][ib] = cAdd(matrix[ib][ib], admittance);
    if (ia >= 0 && ib >= 0) {
      matrix[ia][ib] = cSub(matrix[ia][ib], admittance);
      matrix[ib][ia] = cSub(matrix[ib][ia], admittance);
    }
  };
  for (let node = 1; node < topology.nodeCount; node += 1) stampY(node, 0, complex(1e-12));

  for (const part of document.parts) {
    const nodes = topology.partNodes.get(part.id) ?? [];
    const a = nodes[0] ?? 0;
    const b = nodes[1] ?? 0;
    if (["resistor", "thermistor", "potentiometer"].includes(part.type)) {
      stampY(a, b, complex(1 / Math.max(Math.abs(parseSpiceValue(part.value, 1e3)), 1e-9)));
    } else if (part.type === "capacitor") {
      stampY(a, b, complex(0, omega * Math.max(Math.abs(parseSpiceValue(part.value, 1e-6)), 1e-15)));
    } else if (part.type === "inductor") {
      stampY(a, b, complex(0, -1 / Math.max(omega * Math.abs(parseSpiceValue(part.value, 1e-3)), 1e-15)));
    } else if (isCurrentSource(part.type)) {
      const amplitude = parseSpiceValue(part.value, 1);
      const ia = nodeMatrixIndex(a);
      const ib = nodeMatrixIndex(b);
      if (ia >= 0) rhs[ia].real -= amplitude;
      if (ib >= 0) rhs[ib].real += amplitude;
    } else if (["diode", "led", "zener", "schottky"].includes(part.type)) {
      stampY(a, b, complex(1 / 30));
    }
  }
  voltageSources.forEach((part, sourceIndex) => {
    const nodes = topology.partNodes.get(part.id) ?? [0, 0];
    const a = nodeMatrixIndex(nodes[0] ?? 0);
    const b = nodeMatrixIndex(nodes[1] ?? 0);
    const branch = nodeUnknowns + sourceIndex;
    if (a >= 0) {
      matrix[a][branch] = cAdd(matrix[a][branch], complex(1));
      matrix[branch][a] = cAdd(matrix[branch][a], complex(1));
    }
    if (b >= 0) {
      matrix[b][branch] = cSub(matrix[b][branch], complex(1));
      matrix[branch][b] = cSub(matrix[branch][b], complex(1));
    }
    rhs[branch] = complex(part.type === "ac-source" ? parseSpiceValue(part.value, 1) : 1);
  });
  return solveComplex(matrix, rhs);
}

function traceNodes(document: CircuitDocument, topology: Topology) {
  const probes = document.probes.filter((probe) => topology.partNodes.has(probe.pin.partId));
  if (probes.length) {
    return probes.map((probe, index) => ({
      name: probe.name || `V(${topology.nodeNames[topology.partNodes.get(probe.pin.partId)?.[probe.pin.pin] ?? 0]})`,
      color: ["#87e84b", "#39b7a4", "#eea550", "#9d8cff"][index % 4],
      node: topology.partNodes.get(probe.pin.partId)?.[probe.pin.pin] ?? 0,
    }));
  }
  const candidate = document.parts.find((part) => part.type === "resistor");
  const node = candidate ? topology.partNodes.get(candidate.id)?.[1] ?? 0 : 0;
  return [{ name: `V(${topology.nodeNames[node] ?? "out"})`, color: "#87e84b", node }];
}

function buildTransient(document: CircuitDocument, topology: Topology, steps = 120): SimulationResult {
  const duration = 0.008;
  const dt = duration / steps;
  const selectedTraces = traceNodes(document, topology);
  const x: number[] = [0];
  const values = selectedTraces.map(() => [0]);
  const previousCapacitorVoltages = new Map<string, number>();
  let solution = new Array<number>(Math.max(1, topology.nodeCount - 1 + document.parts.filter((part) => isVoltageSource(part.type)).length)).fill(0);
  for (let step = 1; step <= steps; step += 1) {
    const time = step * dt;
    solution = solveRealCircuit(document, topology, time, dt, previousCapacitorVoltages);
    for (const part of document.parts.filter((item) => item.type === "capacitor")) {
      const nodes = topology.partNodes.get(part.id) ?? [0, 0];
      previousCapacitorVoltages.set(part.id, readNode(solution, nodes[0] ?? 0) - readNode(solution, nodes[1] ?? 0));
    }
    x.push(time);
    selectedTraces.forEach((trace, index) => values[index].push(readNode(solution, trace.node)));
  }
  return {
    domain: "time",
    xLabel: "Time (s)",
    x,
    traces: selectedTraces.map((trace, index) => ({ ...trace, values: values[index] })),
    duration,
    sampleCount: steps + 1,
    status: "Transient solution converged",
    outputVoltage: selectedTraces.length ? values[0][values[0].length - 1] : 0,
  };
}

function buildAcSweep(document: CircuitDocument, topology: Topology, points = 100): SimulationResult {
  const selectedTraces = traceNodes(document, topology);
  const x: number[] = [];
  const traces = selectedTraces.map((trace) => ({ ...trace, values: [] as number[], phase: [] as number[] }));
  const minimum = 10;
  const maximum = 100_000;
  for (let step = 0; step < points; step += 1) {
    const frequency = minimum * Math.pow(maximum / minimum, step / Math.max(points - 1, 1));
    const solution = solveAcCircuit(document, topology, frequency);
    x.push(frequency);
    selectedTraces.forEach((trace, index) => {
      const value = trace.node === 0 ? complex() : solution[trace.node - 1] ?? complex();
      const magnitude = Math.hypot(value.real, value.imaginary);
      traces[index].values.push(20 * Math.log10(Math.max(magnitude, 1e-12)));
      traces[index].phase?.push((Math.atan2(value.imaginary, value.real) * 180) / Math.PI);
    });
  }
  return {
    domain: "frequency", xLabel: "Frequency (Hz)", x, traces, duration: 0, sampleCount: points,
    status: "AC sweep completed", outputVoltage: Math.pow(10, (traces[0]?.values[0] ?? -120) / 20),
  };
}

export function simulateCircuit(
  document: CircuitDocument,
  mode: AnalysisMode = "Transient",
  pointCount = 120,
): SimulationResult {
  const topology = buildTopology(document);
  if (mode === "Transient") return buildTransient(document, topology, Math.max(24, Math.min(400, pointCount)));
  if (mode === "AC Sweep") return buildAcSweep(document, topology, Math.max(24, Math.min(400, pointCount)));

  const selectedTraces = traceNodes(document, topology);
  if (mode === "DC Operating Point") {
    const solution = solveRealCircuit(document, topology, 0);
    const traces = selectedTraces.map((trace) => ({ ...trace, values: [readNode(solution, trace.node), readNode(solution, trace.node)] }));
    return { domain: "dc", xLabel: "Operating point", x: [0, 1], traces, duration: 0, sampleCount: 1, status: "DC operating point converged", outputVoltage: traces[0]?.values[0] ?? 0 };
  }
  if (mode === "DC Sweep") {
    const source = document.parts.find((part) => isVoltageSource(part.type));
    const maximum = source ? Math.max(1, Math.abs(parseSourceValue(source.value, 0))) : 5;
    const steps = Math.max(24, Math.min(200, pointCount));
    const x: number[] = [];
    const values = selectedTraces.map(() => [] as number[]);
    for (let step = 0; step <= steps; step += 1) {
      const sweep = (maximum * step) / steps;
      const overrides = new Map<string, number>();
      if (source) overrides.set(source.id, sweep);
      const solution = solveRealCircuit(document, topology, 0, undefined, new Map(), overrides);
      x.push(sweep);
      selectedTraces.forEach((trace, index) => values[index].push(readNode(solution, trace.node)));
    }
    const traces = selectedTraces.map((trace, index) => ({ ...trace, values: values[index] }));
    return { domain: "dc", xLabel: "Source voltage (V)", x, traces, duration: 0, sampleCount: x.length, status: "DC sweep completed", outputVoltage: traces[0]?.values.at(-1) ?? 0 };
  }

  const x: number[] = [];
  const results = selectedTraces.map(() => [] as number[]);
  const resistors = document.parts.filter((part) => part.type === "resistor");
  const iterations = 48;
  for (let sample = 0; sample < iterations; sample += 1) {
    const varied = {
      ...document,
      parts: document.parts.map((part) => {
        if (!resistors.some((resistor) => resistor.id === part.id)) return part;
        const tolerance = Math.max(0, Math.min(0.5, parseSpiceValue(part.tolerance ?? "5%", 5) / 100));
        const random = 1 + (Math.random() * 2 - 1) * tolerance;
        return { ...part, value: String(parseSpiceValue(part.value, 1e3) * random) };
      }),
    };
    const solution = solveRealCircuit(varied, topology, 0);
    x.push(sample + 1);
    selectedTraces.forEach((trace, index) => results[index].push(readNode(solution, trace.node)));
  }
  const traces = selectedTraces.map((trace, index) => ({ ...trace, values: results[index] }));
  return { domain: "samples", x, xLabel: "Monte Carlo run", traces, duration: 0, sampleCount: iterations, status: "Monte Carlo analysis completed · 48 runs", outputVoltage: traces[0]?.values.at(-1) ?? 0 };
}
