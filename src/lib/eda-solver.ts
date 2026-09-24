import { getPinOffsets, parseSpiceValue } from "./eda-document";
import type {
  AnalysisMode,
  CircuitDocument,
  IntegrationMethod,
  SchematicPart,
  SimulationResult,
  SimulationSettings,
  SimulationTrace,
} from "./eda-types";
import { DEFAULT_SETTINGS } from "./eda-types";

const K_BOLTZMANN = 1.380649e-23;
const E_CHARGE = 1.602176634e-19;
const GMIN_FLOOR = 1e-12;
const VT_27C = 0.025852;

function thermalVoltage(celsius: number) {
  return (K_BOLTZMANN * (celsius + 273.15)) / E_CHARGE;
}

interface Complex {
  real: number;
  imaginary: number;
}

const cx = (real = 0, imaginary = 0): Complex => ({ real, imaginary });
const cxAdd = (a: Complex, b: Complex) => cx(a.real + b.real, a.imaginary + b.imaginary);
const cxSub = (a: Complex, b: Complex) => cx(a.real - b.real, a.imaginary - b.imaginary);
const cxMul = (a: Complex, b: Complex) => cx(a.real * b.real - a.imaginary * b.imaginary, a.real * b.imaginary + a.imaginary * b.real);
const cxDiv = (a: Complex, b: Complex) => {
  const denominator = b.real * b.real + b.imaginary * b.imaginary || 1e-30;
  return cx((a.real * b.real + a.imaginary * b.imaginary) / denominator, (a.imaginary * b.real - a.real * b.imaginary) / denominator);
};

/* ------------------------------------------------------------------ *
 * Device model library
 * ------------------------------------------------------------------ */

interface DeviceModelSpec {
  kind: "npn" | "pnp" | "nmos" | "pmos" | "njf" | "diode" | "led" | "zener" | "schottky";
  is?: number;
  n?: number;
  rs?: number;
  bf?: number;
  br?: number;
  kp?: number;
  idss?: number;
  vto?: number;
  lambda?: number;
  eg?: number;
  xti?: number;
}

const DEVICE_MODELS: Record<string, DeviceModelSpec> = {
  "2n3904": { kind: "npn", is: 6.734e-15, n: 1.259, bf: 416.4, br: 0.7371 },
  "2n3906": { kind: "pnp", is: 1.436e-14, n: 1.36, bf: 180.7, br: 4.298 },
  "2n2222": { kind: "npn", is: 1.1e-14, n: 1.2, bf: 220, br: 5 },
  bc547: { kind: "npn", is: 7.5e-15, n: 1.25, bf: 290, br: 6 },
  "2n7000": { kind: "nmos", kp: 0.16, vto: 2.5, lambda: 0.02 },
  bs250: { kind: "pmos", kp: 0.06, vto: -2.5, lambda: 0.02 },
  irf540: { kind: "nmos", kp: 0.9, vto: 4, lambda: 0.01 },
  "2n5459": { kind: "njf", idss: 4e-3, vto: -1.5, lambda: 0.02 },
  "1n4148": { kind: "diode", is: 2.52e-9, n: 1.752, rs: 0.568 },
  "1n4007": { kind: "diode", is: 7.02e-9, n: 1.8, rs: 0.034 },
  "1n5819": { kind: "schottky", is: 3.1e-6, n: 1.4, rs: 0.036 },
  "led-red": { kind: "led", is: 1.2e-18, n: 1.9, rs: 6, eg: 1.9 },
  "led-green": { kind: "led", is: 4e-19, n: 1.9, rs: 6, eg: 2.2 },
  "led-blue": { kind: "led", is: 1e-19, n: 1.9, rs: 6, eg: 2.7 },
};

function specFor(part: SchematicPart): DeviceModelSpec {
  const key = (part.model ?? part.value).trim().toLowerCase();
  const direct = DEVICE_MODELS[key];
  if (direct) return direct;
  if (part.type === "led") return DEVICE_MODELS["led-red"];
  if (part.type === "zener") return { kind: "zener", is: 1e-9, n: 1.6, rs: 1, eg: 5.1 };
  if (part.type === "schottky") return DEVICE_MODELS["1n5819"];
  if (part.type === "diode" || part.type === "photodiode") return DEVICE_MODELS["1n4148"];
  if (part.type === "varactor") return { kind: "diode", is: 1e-12, n: 1.4 };
  if (part.type === "transistor-pnp") return { kind: "pnp", is: 1e-14, n: 1.2, bf: 150, br: 5 };
  if (part.type === "mosfet-p") return { kind: "pmos", kp: 0.08, vto: -2.5, lambda: 0.02 };
  if (part.type === "jfet") return { kind: "njf", idss: 4e-3, vto: -1.5, lambda: 0.02 };
  if (part.type === "igbt") return { kind: "nmos", kp: 0.4, vto: 4, lambda: 0.01 };
  return { kind: "nmos", kp: 0.12, vto: 2, lambda: 0.02 };
}

function saturationCurrent(spec: DeviceModelSpec, vt: number) {
  const base = spec.is ?? 1e-14;
  const n = spec.n ?? 1;
  return base * Math.pow(vt / VT_27C, (spec.xti ?? 3) / n);
}

/* ------------------------------------------------------------------ *
 * Topology
 * ------------------------------------------------------------------ */

interface Branch {
  partId: string;
  kind: "v" | "l" | "vcvs" | "ccvs";
  row: number;
  posNode: number;
  negNode: number;
  value: number;
  controlPartId?: string;
  controlPos?: number;
  controlNeg?: number;
  inductance?: number;
  partner?: number;
}

interface Topology {
  nodeCount: number;
  partNodes: Map<string, number[]>;
  nodeNames: string[];
  branches: Branch[];
  branchByPart: Map<string, number>;
  nodeUnknowns: number;
  size: number;
}

const BRANCH_TYPES = new Set(["voltage", "ac-source", "pulse-source", "function-generator"]);

export function buildTopology(document: CircuitDocument): Topology {
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
  for (const part of document.parts) {
    getPinOffsets(part.type).forEach((_, pin) => parent.set(`${part.id}:${pin}`, `${part.id}:${pin}`));
  }
  for (const wire of document.connections) join(`${wire.from.partId}:${wire.from.pin}`, `${wire.to.partId}:${wire.to.pin}`);
  const grounds = document.parts.filter((part) => part.type === "ground");
  grounds.slice(1).forEach((ground) => join(`${grounds[0].id}:0`, `${ground.id}:0`));

  const roots: string[] = [];
  for (const key of parent.keys()) {
    const root = rootOf(key);
    if (!roots.includes(root)) roots.push(root);
  }
  const indices = new Map<string, number>();
  if (grounds.length) indices.set(rootOf(`${grounds[0].id}:0`), 0);
  for (const root of roots) if (!indices.has(root)) indices.set(root, indices.size);
  const nodeNames = Array.from({ length: indices.size }, (_, index) => (index === 0 && grounds.length ? "0" : `N${String(index).padStart(3, "0")}`));
  const partNodes = new Map<string, number[]>();
  for (const part of document.parts) {
    partNodes.set(part.id, getPinOffsets(part.type).map((_, pin) => indices.get(rootOf(`${part.id}:${pin}`)) ?? 0));
  }

  const branches: Branch[] = [];
  const branchByPart = new Map<string, number>();
  const nodeUnknowns = Math.max(0, indices.size - 1);
  const addBranch = (branch: Omit<Branch, "row">) => {
    branches.push({ ...branch, row: nodeUnknowns + branches.length });
    return branches.length - 1;
  };

  for (const part of document.parts) {
    if (part.type === "ground") continue;
    const nodes = partNodes.get(part.id) ?? [0, 0];
    if (BRANCH_TYPES.has(part.type)) {
      branchByPart.set(part.id, addBranch({ partId: part.id, kind: "v", posNode: nodes[0] ?? 0, negNode: nodes[1] ?? 0, value: parseSpiceValue(part.value, 1) }));
    } else if (part.type === "inductor") {
      branchByPart.set(part.id, addBranch({ partId: part.id, kind: "l", posNode: nodes[0] ?? 0, negNode: nodes[1] ?? 0, value: 0, inductance: Math.max(parseSpiceValue(part.value, 1e-3), 1e-15) }));
    } else if (part.type === "transformer") {
      const [l1, l2] = part.value.split(":").map((entry) => parseSpiceValue(entry, 1e-3));
      const first = addBranch({ partId: part.id, kind: "l", posNode: nodes[0] ?? 0, negNode: nodes[1] ?? 0, value: 0, inductance: Math.max(l1 || 1e-3, 1e-15) });
      const second = addBranch({ partId: part.id, kind: "l", posNode: nodes[2] ?? 0, negNode: nodes[3] ?? 0, value: 0, inductance: Math.max(l2 || 1e-3, 1e-15), partner: first });
      branches[first].partner = second;
      branchByPart.set(part.id, first);
    } else if (part.type === "vcvs") {
      branchByPart.set(part.id, addBranch({
        partId: part.id, kind: "vcvs", posNode: nodes[0] ?? 0, negNode: nodes[1] ?? 0,
        value: parseSpiceValue(part.value, 1), controlPos: nodes[2] ?? 0, controlNeg: nodes[3] ?? 0,
      }));
    } else if (part.type === "ccvs") {
      branchByPart.set(part.id, addBranch({
        partId: part.id, kind: "ccvs", posNode: nodes[0] ?? 0, negNode: nodes[1] ?? 0,
        value: parseSpiceValue(part.value, 1), controlPartId: part.model ?? part.ref,
      }));
    }
  }

  return { nodeCount: indices.size, partNodes, nodeNames, branches, branchByPart, nodeUnknowns, size: nodeUnknowns + branches.length };
}

/* ------------------------------------------------------------------ *
 * Linear algebra
 * ------------------------------------------------------------------ */

function solveDense(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const rows = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-24) continue;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item <= size; item += 1) rows[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (!factor) continue;
      for (let item = column; item <= size; item += 1) rows[row][item] -= factor * rows[column][item];
    }
  }
  return rows.map((row, index) => (Math.abs(row[index]) < 1e-24 ? 0 : row[size]));
}

function solveComplexDense(matrix: Complex[][], rhs: Complex[]): Complex[] {
  const size = rhs.length;
  const rows = matrix.map((row, index) => [...row.map((value) => ({ ...value })), { ...rhs[index] }]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    const magnitude = (value: Complex) => value.real * value.real + value.imaginary * value.imaginary;
    for (let row = column + 1; row < size; row += 1) {
      if (magnitude(rows[row][column]) > magnitude(rows[pivot][column])) pivot = row;
    }
    if (Math.hypot(rows[pivot][column].real, rows[pivot][column].imaginary) < 1e-26) continue;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item <= size; item += 1) rows[column][item] = cxDiv(rows[column][item], divisor);
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (Math.hypot(factor.real, factor.imaginary) < 1e-30) continue;
      for (let item = column; item <= size; item += 1) rows[row][item] = cxSub(rows[row][item], cxMul(factor, rows[column][item]));
    }
  }
  return rows.map((row, index) => (Math.hypot(row[index].real, row[index].imaginary) < 1e-26 ? cx() : row[size]));
}

function pnjlim(vnew: number, vold: number, vt: number, vcrit: number) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(Math.max(vnew / vt, 1e-12));
  }
  return vnew;
}

function fetlim(vnew: number, vold: number, vto: number) {
  const vtsthi = Math.abs(2 * (vold - vto)) + 2;
  const vtstlo = Math.max(vtsthi / 2, 2);
  const vtox = vto + 3.5;
  const delv = vnew - vold;
  if (vold >= vto) {
    if (vold >= vtox) {
      if (delv <= 0) {
        if (vnew >= vtox) {
          if (-delv > vtstlo) return vold - vtstlo;
        } else return Math.max(vnew, vto + 2);
      } else if (delv > vtsthi) return vold + vtsthi;
    } else if (delv <= 0) {
      if (vnew >= vtox) return Math.min(vnew, vto + 2);
      if (-delv > vtsthi) return vold - vtsthi;
    } else if (delv > vtsthi) return vold + vtsthi;
  } else if (delv <= 0) {
    if (-delv > vtsthi) return vold - vtsthi;
  } else if (delv > vtsthi) return vold + vtsthi;
  return vnew;
}

/* ------------------------------------------------------------------ *
 * System assembly
 * ------------------------------------------------------------------ */

interface DeviceModel {
  terminals: number[];
  Y: number[][];
  Ieq: number[];
}

interface PartState {
  brightness?: number;
  current?: number;
  voltage?: number;
  active?: boolean;
}

interface SolveContext {
  document: CircuitDocument;
  topology: Topology;
  settings: SimulationSettings;
  time: number;
  dt?: number;
  gmin: number;
  sourceScale: number;
  state: Map<string, number>;
  previous: Map<string, number>;
  limited: Map<string, number>;
  partStates: Map<string, PartState>;
  dcOnly: boolean;
  /** Disables junction limiting — used when linearizing a converged solution. */
  noLimit?: boolean;
}

function nodeVoltage(x: number[], node: number) {
  return node <= 0 ? 0 : x[node - 1] ?? 0;
}

function matrix2(g00: number, g01: number, g10: number, g11: number): number[][] {
  return [[g00, g01], [g10, g11]];
}

function stampModel(A: number[][], b: number[], nodes: number[], model: DeviceModel) {
  for (let i = 0; i < nodes.length; i += 1) {
    const row = nodes[i] - 1;
    if (row < 0) continue;
    for (let j = 0; j < nodes.length; j += 1) {
      const column = nodes[j] - 1;
      if (column >= 0) A[row][column] += model.Y[i][j];
    }
    b[row] -= model.Ieq[i];
  }
}

function diodeModel(voltage: number, spec: DeviceModelSpec, vt: number, gmin: number) {
  const n = spec.n ?? 1;
  const vte = n * vt;
  const is = saturationCurrent(spec, vt);
  const rs = spec.rs ?? 0;
  // Solve i = is·(exp(vj/vte) − 1) with vj = v − i·rs by damped fixed-point iteration.
  let vj = voltage;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const exponent = Math.exp(Math.min(Math.max(vj / vte, -80), 80));
    const current = is * (exponent - 1) + gmin * vj;
    const next = voltage - current * rs;
    if (Math.abs(next - vj) < 1e-13) { vj = next; break; }
    vj += 0.65 * (next - vj);
  }
  const exponent = Math.exp(Math.min(Math.max(vj / vte, -80), 80));
  const junction = is * exponent;
  const gJunction = junction / vte + gmin;
  const current = junction - is + gmin * vj;
  const g = gJunction / (1 + rs * gJunction);
  return { g, i: current };
}

function zenerCurrent(voltage: number, spec: DeviceModelSpec, vt: number) {
  const breakdown = spec.eg ?? 5.1;
  const ibv = 1e-4;
  const vtb = vt * 1.5;
  if (voltage <= -breakdown * 0.55) {
    const exponent = Math.exp(Math.min(Math.max(-(voltage + breakdown) / vtb, -80), 80));
    return { g: (ibv / vtb) * exponent, i: -ibv * (exponent - 1) };
  }
  return { g: 0, i: 0 };
}

function waveformValue(part: SchematicPart, time: number, dcOnly: boolean, scale = 1): number {
  const functionMatch = part.value.match(/(SINE|SIN|PULSE|PWL)\s*\(([^)]*)\)/i);
  if (functionMatch) {
    const values = functionMatch[2].split(/[\s,]+/).filter(Boolean).map((entry) => parseSpiceValue(entry));
    if (dcOnly) return (values[0] ?? 0) * scale;
    if (functionMatch[1].toUpperCase() === "PULSE") {
      const [low = 0, high = 5, delay = 0, rise = 1e-9, fall = 1e-9, width = 5e-4, period = 1e-3] = values;
      if (time < delay) return low;
      const local = Math.max(0, time - delay) % Math.max(period, 1e-15);
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
  return parseSpiceValue(part.value, 0) * scale;
}

function acAmplitude(part: SchematicPart) {
  const functionMatch = part.value.match(/(SINE|SIN)\s*\(([^)]*)\)/i);
  if (functionMatch) {
    const values = functionMatch[2].split(/[\s,]+/).filter(Boolean).map((entry) => parseSpiceValue(entry));
    return Math.max(Math.abs(values[1] ?? 1), 1e-6);
  }
  return Math.max(Math.abs(parseSpiceValue(part.value, 1)), 1e-6);
}

function resistanceAt(part: SchematicPart, celsius: number) {
  let value = parseSpiceValue(part.value, 1e3);
  const coefficient = (part.tempCoeff ?? "").match(/([+-]?[\d.]+)\s*ppm/i);
  if (coefficient) value *= 1 + Number(coefficient[1]) * 1e-6 * (celsius - 27);
  return Math.max(Math.abs(value), 1e-9);
}

function lampConductance(part: SchematicPart) {
  const power = Number(/([\d.]+)\s*w/i.exec(part.value)?.[1] ?? 2);
  const rating = parseSpiceValue(part.value, 12) || 12;
  return power / (rating * rating);
}

function logicGateName(part: SchematicPart) {
  const value = `${part.model ?? ""} ${part.value}`.toUpperCase();
  if (value.includes("NAND")) return "NAND";
  if (value.includes("NOR")) return "NOR";
  if (value.includes("XNOR")) return "XNOR";
  if (value.includes("XOR")) return "XOR";
  if (value.includes("AND")) return "AND";
  if (value.includes("OR")) return "OR";
  if (value.includes("NOT") || value.includes("INV")) return "NOT";
  if (value.includes("JK")) return "JK";
  if (value.includes("DFF") || value.includes("FLIP")) return "D";
  if (value.includes("TFF") || value.includes("TOGGLE")) return "T";
  return "BUF";
}

function evaluatePart(part: SchematicPart, nodes: number[], x: number[], context: SolveContext): DeviceModel | undefined {
  const { settings, dt, gmin, state, previous, limited, time, sourceScale, dcOnly } = context;
  const vt = thermalVoltage(settings.temperature);
  const spec = specFor(part);
  const twoTerminal = (g: number, ieq = 0): DeviceModel => ({
    terminals: [nodes[0], nodes[1]],
    Y: matrix2(g, -g, -g, g),
    Ieq: [ieq, -ieq],
  });

  switch (part.type) {
    case "resistor":
    case "thermistor":
      return twoTerminal(1 / resistanceAt(part, settings.temperature));
    case "lamp":
      return twoTerminal(lampConductance(part));
    case "fuse":
      return twoTerminal(part.closed === false ? 1e-9 : 100);
    case "buzzer":
      return twoTerminal(1 / Math.max(parseSpiceValue(part.value, 40), 1));
    case "motor":
      return twoTerminal(1 / Math.max(parseSpiceValue(part.value, 6), 0.2));
    case "crystal": {
      const capacitance = 20e-12;
      if (!dt) return twoTerminal(1e-12);
      return twoTerminal(capacitance / dt, -(capacitance / dt) * (previous.get(`${part.id}:v`) ?? 0));
    }
    case "switch":
      return twoTerminal(part.closed ? 100 : 1e-9);
    case "capacitor": {
      const capacitance = Math.max(Math.abs(parseSpiceValue(part.value, 1e-6)), 1e-18);
      if (!dt) return twoTerminal(1e-12);
      const previousVoltage = previous.get(`${part.id}:v`) ?? 0;
      const previousCurrent = previous.get(`${part.id}:i`) ?? 0;
      if (settings.method === "Backward Euler") return twoTerminal(capacitance / dt, -(capacitance / dt) * previousVoltage);
      if (settings.method === "Gear 2") {
        const g = (2 * capacitance) / (3 * dt);
        return twoTerminal(g, -(g * previousVoltage + (4 / 3) * previousCurrent));
      }
      const g = (2 * capacitance) / dt;
      return twoTerminal(g, -(g * previousVoltage + previousCurrent));
    }
    case "current":
      return twoTerminal(0, waveformValue(part, time, dcOnly, sourceScale));
    case "diode":
    case "led":
    case "photodiode":
    case "zener":
    case "schottky": {
      const key = `${part.id}:v`;
      const raw = nodeVoltage(x, nodes[0]) - nodeVoltage(x, nodes[1]);
      const old = previous.get(key) ?? limited.get(key) ?? 0;
      const limitedVoltage = context.noLimit ? raw : pnjlim(raw, old, vt * (spec.n ?? 1), 0.6);
      limited.set(key, limitedVoltage);
      const forward = diodeModel(limitedVoltage, spec, vt, gmin);
      const reverse = part.type === "zener" ? zenerCurrent(limitedVoltage, spec, vt) : { g: 0, i: 0 };
      const g = forward.g + reverse.g;
      const i = forward.i + reverse.i;
      context.partStates.set(part.id, {
        current: i,
        voltage: limitedVoltage,
        brightness: part.type === "led" ? Math.min(1, Math.max(0, (limitedVoltage - 1.3) / 1.2)) : undefined,
        active: part.type === "led" ? limitedVoltage > 1.6 : undefined,
      });
      return twoTerminal(g, i - g * limitedVoltage);
    }
    case "potentiometer": {
      const total = Math.max(parseSpiceValue(part.value, 10_000), 1);
      const position = Math.min(1, Math.max(0, part.position ?? 0.5));
      const g1 = 1 / Math.max(total * position, 1e-3);
      const g2 = 1 / Math.max(total * (1 - position), 1e-3);
      return {
        terminals: [nodes[0], nodes[1], nodes[2]],
        Y: [[g1, -g1, 0], [-g1, g1 + g2, -g2], [0, -g2, g2]],
        Ieq: [0, 0, 0],
      };
    }
    case "varactor": {
      const voltage = nodeVoltage(x, nodes[0]) - nodeVoltage(x, nodes[1]);
      const capacitance = Math.max(parseSpiceValue(part.value, 40e-12) / Math.max(0.2, 1 - voltage / 0.7), 1e-15);
      if (!dt) return twoTerminal(1e-12);
      return twoTerminal(capacitance / dt, -(capacitance / dt) * (previous.get(`${part.id}:v`) ?? 0));
    }
    case "transistor-npn":
    case "transistor-pnp":
      return bjtModel(part, nodes, x, context, spec, vt);
    case "mosfet-n":
    case "mosfet-p":
    case "jfet":
    case "igbt":
      return mosfetModel(part, nodes, x, context, spec);
    case "scr":
    case "triac": {
      const key = `${part.id}:latched`;
      const anode = nodeVoltage(x, nodes[0]);
      const gate = nodeVoltage(x, nodes[1]);
      const cathode = nodeVoltage(x, nodes[2]);
      let latched = (state.get(key) ?? 0) > 0.5;
      if (!latched && gate - cathode > 0.7 && anode - cathode > 0.7) latched = true;
      if (anode - cathode < 0.4) latched = false;
      state.set(key, latched ? 1 : 0);
      context.partStates.set(part.id, { active: latched, current: latched ? (anode - cathode) / 0.05 : 0, voltage: anode - cathode });
      return twoTerminal(latched ? 20 : 1e-9);
    }
    case "relay": {
      const coilVoltage = Math.abs(nodeVoltage(x, nodes[0]) - nodeVoltage(x, nodes[1]));
      const threshold = Math.max(parseSpiceValue(part.value, 5), 1);
      const energised = coilVoltage > threshold * 0.6;
      context.partStates.set(part.id, { active: energised, voltage: coilVoltage });
      const coil: DeviceModel = { terminals: [nodes[0], nodes[1]], Y: matrix2(0.02, -0.02, -0.02, 0.02), Ieq: [0, 0] };
      const contact: DeviceModel = { terminals: [nodes[2], nodes[3]], Y: matrix2(energised ? 100 : 1e-9, energised ? -100 : -1e-9, energised ? -100 : -1e-9, energised ? 100 : 1e-9), Ieq: [0, 0] };
      return combineModels([coil, contact]);
    }
    case "opamp":
    case "comparator":
      return opampModel(part, nodes, x, context);
    case "timer":
      return timerModel(part, nodes, x, context);
    case "logic":
      return logicModel(part, nodes, x, context);
    default:
      return undefined;
  }
}

function combineModels(models: DeviceModel[]): DeviceModel {
  const terminals = models.flatMap((model) => model.terminals);
  const size = terminals.length;
  const Y = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const Ieq = new Array<number>(size).fill(0);
  let offset = 0;
  for (const model of models) {
    const local = model.terminals.length;
    for (let i = 0; i < local; i += 1) {
      for (let j = 0; j < local; j += 1) Y[offset + i][offset + j] += model.Y[i][j];
      Ieq[offset + i] += model.Ieq[i];
    }
    offset += local;
  }
  return { terminals, Y, Ieq };
}

function bjtModel(part: SchematicPart, nodes: number[], x: number[], context: SolveContext, spec: DeviceModelSpec, vt: number): DeviceModel {
  const polarity = part.type === "transistor-pnp" ? -1 : 1;
  const collector = nodeVoltage(x, nodes[1]);
  const base = nodeVoltage(x, nodes[0]);
  const emitter = nodeVoltage(x, nodes[2]);
  const key = `${part.id}:bjt`;
  const stored = context.limited.get(key) ?? context.previous.get(key) ?? 0;
  const rawVbe = polarity * (base - emitter);
  const rawVbc = polarity * (base - collector);
  const vbe = context.noLimit ? rawVbe : pnjlim(rawVbe, stored, vt * (spec.n ?? 1), 0.7);
  const vbc = context.noLimit ? rawVbc : pnjlim(rawVbc, stored, vt * (spec.n ?? 1), 0.7);
  context.limited.set(key, Math.max(vbe, vbc));

  const is = saturationCurrent(spec, vt);
  const nf = spec.n ?? 1;
  const bf = spec.bf ?? 150;
  const br = spec.br ?? 5;
  const vte = nf * vt;
  const expBe = Math.exp(Math.min(vbe / vte, 80));
  const expBc = Math.exp(Math.min(vbc / vte, 80));
  const ict = is * (expBe - expBc);
  const ibe = (is / bf) * (expBe - 1);
  const ibc = (is / br) * (expBc - 1);
  const ic = ict - ibc;
  const ib = ibe + ibc;

  const gmf = (is / vte) * expBe;
  const gmr = (is / vte) * expBc;
  const gbe = (is / (bf * vte)) * expBe + context.gmin;
  const gbc = (is / (br * vte)) * expBc + context.gmin;

  const ic0 = ic - (gmf * vbe - (gmr + gbc) * vbc);
  const ib0 = ib - (gbe * vbe + gbc * vbc);
  const Y = [
    [gbe + gbc, -gbc, -gbe],
    [gmf - gmr - gbc, gmr + gbc, -gmf],
    [-(gbe + gbc + gmf - gmr - gbc), -gmr, gbe + gmf],
  ];
  context.partStates.set(part.id, { current: Math.abs(ic), voltage: Math.abs(collector - emitter) });
  return {
    terminals: [nodes[0], nodes[1], nodes[2]],
    Y,
    Ieq: polarity > 0 ? [ib0, ic0, -(ib0 + ic0)] : [-ib0, -ic0, ib0 + ic0],
  };
}

function mosfetModel(part: SchematicPart, nodes: number[], x: number[], context: SolveContext, spec: DeviceModelSpec): DeviceModel {
  const polarity = part.type === "mosfet-p" ? -1 : 1;
  const gate = nodeVoltage(x, nodes[0]);
  const drain = nodeVoltage(x, nodes[1]);
  const source = nodeVoltage(x, nodes[2]);
  const key = `${part.id}:fet`;
  const stored = context.limited.get(key);
  let vgs = polarity * (gate - source);
  let vds = polarity * (drain - source);
  if (spec.kind === "njf") vgs = -vgs;
  vgs = fetlim(vgs, stored ?? vgs, spec.vto ?? 2);
  const vto = spec.vto ?? 2;
  const beta = spec.kind === "njf" ? (spec.idss ?? 4e-3) / Math.max(vto * vto, 0.01) : spec.kp ?? 0.12;
  const lambda = spec.lambda ?? 0.02;

  if (vds < 0) {
    const swapped = vgs - vds;
    vds = -vds;
    vgs = swapped;
  }
  context.limited.set(key, vgs);

  const vgst = vgs - vto;
  let id = 0;
  let gm = 0;
  let gds = context.gmin;
  if (vgst > 0) {
    if (vds < vgst) {
      id = beta * (vgst * vds - 0.5 * vds * vds) * (1 + lambda * vds);
      gm = beta * vds * (1 + lambda * vds);
      gds = beta * (vgst - vds) * (1 + lambda * vds) + beta * (vgst * vds - 0.5 * vds * vds) * lambda;
    } else {
      id = 0.5 * beta * vgst * vgst * (1 + lambda * vds);
      gm = beta * vgst * (1 + lambda * vds);
      gds = 0.5 * beta * vgst * vgst * lambda;
    }
  }
  const ieq = id - gm * vgs - gds * vds;
  const gg = 1e-12;
  context.partStates.set(part.id, { current: Math.abs(id), voltage: Math.abs(drain - source) });
  return {
    terminals: [nodes[0], nodes[1], nodes[2]],
    Y: [
      [gg, -gg, 0],
      [polarity * gm, polarity * gds, -polarity * (gm + gds)],
      [-polarity * gm, -polarity * gds, polarity * (gm + gds)],
    ],
    Ieq: [0, polarity * ieq, -polarity * ieq],
  };
}

function opampModel(part: SchematicPart, nodes: number[], x: number[], context: SolveContext): DeviceModel {
  const inPlus = nodeVoltage(x, nodes[0]);
  const inMinus = nodeVoltage(x, nodes[1]);
  const out = nodeVoltage(x, nodes[2]);
  const vcc = nodeVoltage(x, nodes[3]);
  const vgnd = nodeVoltage(x, nodes[4]);
  const rails = Math.abs(vcc - vgnd) > 1 ? Math.abs(vcc - vgnd) : 30;
  const centre = Math.abs(vcc - vgnd) > 1 ? (vcc + vgnd) / 2 : 0;
  const gain = part.type === "comparator" ? 2e5 : 1e5;
  const rout = part.type === "comparator" ? 20 : 60;
  const linear = gain * (inPlus - inMinus);
  const normalised = (linear - centre) / (rails * 0.5);
  const clamped = centre + rails * 0.5 * Math.tanh(normalised);
  const sech = 1 / Math.cosh(normalised);
  const gm = (gain * sech * sech) / rout;
  const ieq = gm * (inPlus - inMinus) - clamped / rout;

  context.partStates.set(part.id, { voltage: out, active: Math.abs(clamped - centre) > rails * 0.4 });
  return {
    terminals: nodes,
    Y: [
      [1e-9, -1e-9, 0, 0, 0],
      [-1e-9, 1e-9, 0, 0, 0],
      [-gm, gm, 1 / rout, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
    Ieq: [0, 0, ieq, 0, 0],
  };
}

function timerModel(part: SchematicPart, nodes: number[], x: number[], context: SolveContext): DeviceModel {
  const trigger = nodeVoltage(x, nodes[0]);
  const threshold = nodeVoltage(x, nodes[1]);
  const reset = nodeVoltage(x, nodes[4]);
  const vcc = nodeVoltage(x, nodes[5]);
  const vgnd = nodeVoltage(x, nodes[6]);
  const supply = Math.abs(vcc - vgnd) > 1 ? vcc - vgnd : 9;
  const outKey = `${part.id}:timer:out`;
  const dischKey = `${part.id}:timer:disch`;
  let out = context.state.get(outKey) ?? 0;
  let discharge = context.state.get(dischKey) ?? 1;

  if (reset < supply * 0.35) { out = 0; discharge = 1; }
  else if (threshold > supply * (2 / 3) + supply * 0.005) { out = 0; discharge = 1; }
  else if (trigger < supply * (1 / 3) - supply * 0.005) { out = 1; discharge = 0; }

  if (context.dt) {
    context.state.set(outKey, out);
    context.state.set(dischKey, discharge);
  }

  const outLevel = vgnd + (out ? supply - 0.2 : 0.2);
  const Y = Array.from({ length: 7 }, () => new Array<number>(7).fill(0));
  Y[2][2] += discharge ? 0.2 : 1e-9;
  Y[3][3] += 0.1;
  context.partStates.set(part.id, { active: out > 0.5, voltage: outLevel });
  return { terminals: nodes, Y, Ieq: [0, 0, 0, -outLevel / 10, 0, 0, 0] };
}

function logicModel(part: SchematicPart, nodes: number[], x: number[], context: SolveContext): DeviceModel {
  const gate = logicGateName(part);
  const vcc = nodeVoltage(x, nodes[4]);
  const vgnd = nodeVoltage(x, nodes[5]);
  const supply = Math.abs(vcc - vgnd) > 1 ? vcc - vgnd : 5;
  const threshold = vgnd + supply * 0.5;
  const a = nodeVoltage(x, nodes[0]) > threshold;
  const b = nodeVoltage(x, nodes[1]) > threshold;
  const clk = nodeVoltage(x, nodes[2]) > threshold;
  const outKey = `${part.id}:logic:out`;
  const clkKey = `${part.id}:logic:clk`;
  let out = context.state.get(outKey) ?? 0;
  const lastClk = context.state.get(clkKey) ?? 0;
  const rising = clk && lastClk < 0.5;

  if (gate === "NOT") out = a ? 0 : 1;
  else if (gate === "BUF") out = a ? 1 : 0;
  else if (gate === "AND") out = a && b ? 1 : 0;
  else if (gate === "NAND") out = a && b ? 0 : 1;
  else if (gate === "OR") out = a || b ? 1 : 0;
  else if (gate === "NOR") out = a || b ? 0 : 1;
  else if (gate === "XOR") out = a !== b ? 1 : 0;
  else if (gate === "XNOR") out = a === b ? 1 : 0;
  else if (gate === "D" && rising) out = a ? 1 : 0;
  else if (gate === "T" && rising) out = out ? 0 : 1;
  else if (gate === "JK" && rising) out = a ? (b ? out : 1) : b ? 0 : out;

  if (context.dt) {
    context.state.set(outKey, out);
    context.state.set(clkKey, clk ? 1 : 0);
  }

  const level = out ? vgnd + supply - 0.05 : vgnd + 0.05;
  const Y = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  Y[3][3] += 1 / 120;
  context.partStates.set(part.id, { active: out > 0.5, voltage: level });
  return { terminals: nodes, Y, Ieq: [0, 0, 0, -level / 120, 0, 0] };
}

function assemble(x: number[], context: SolveContext): { A: number[][]; b: number[] } {
  const { topology, gmin, dt, state, time, dcOnly, sourceScale } = context;
  const size = topology.size;
  const A = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const b = new Array<number>(size).fill(0);

  for (let node = 1; node < topology.nodeCount; node += 1) A[node - 1][node - 1] += gmin;

  for (const part of context.document.parts) {
    if (part.type === "ground") continue;
    const model = evaluatePart(part, topology.partNodes.get(part.id) ?? [], x, context);
    if (model) stampModel(A, b, model.terminals, model);
  }

  for (const branch of topology.branches) {
    const part = context.document.parts.find((entry) => entry.id === branch.partId);
    if (!part) continue;
    const row = branch.row;
    if (branch.posNode > 0) { A[branch.posNode - 1][row] += 1; A[row][branch.posNode - 1] += 1; }
    if (branch.negNode > 0) { A[branch.negNode - 1][row] -= 1; A[row][branch.negNode - 1] -= 1; }

    if (branch.kind === "v") {
      b[row] = waveformValue(part, time, dcOnly, sourceScale);
    } else if (branch.kind === "l") {
      const inductance = branch.inductance ?? 1e-3;
      if (dt) {
        const previousCurrent = state.get(`${part.id}:i`) ?? 0;
        const previousVoltage = state.get(`${part.id}:v`) ?? 0;
        if (context.settings.method === "Backward Euler") {
          A[row][row] -= inductance / dt;
          b[row] = -(inductance / dt) * previousCurrent;
        } else if (context.settings.method === "Gear 2") {
          const g = (2 * inductance) / (3 * dt);
          A[row][row] -= g;
          b[row] = -(g * previousCurrent + (4 / 3) * previousVoltage);
        } else {
          const g = (2 * inductance) / dt;
          A[row][row] -= g;
          b[row] = -(g * previousCurrent + previousVoltage);
        }
      } else {
        A[row][row] += 1e-9;
      }
      const partner = branch.partner !== undefined ? topology.branches[branch.partner] : undefined;
      if (partner && dt) {
        const mutual = 0.99 * Math.sqrt(inductance * (partner.inductance ?? 1e-3));
        A[row][partner.row] -= mutual / dt;
        b[row] -= (mutual / dt) * (state.get(`${partner.partId}:i`) ?? 0);
      }
    } else if (branch.kind === "vcvs") {
      if ((branch.controlPos ?? 0) > 0) A[row][(branch.controlPos ?? 0) - 1] -= branch.value;
      if ((branch.controlNeg ?? 0) > 0) A[row][(branch.controlNeg ?? 0) - 1] += branch.value;
    } else if (branch.kind === "ccvs") {
      const controlIndex = branch.controlPartId ? topology.branchByPart.get(branch.controlPartId) : undefined;
      if (controlIndex !== undefined) A[row][topology.branches[controlIndex].row] -= branch.value;
    }
  }

  for (const part of context.document.parts) {
    if (part.type !== "vccs" && part.type !== "cccs") continue;
    const nodes = topology.partNodes.get(part.id) ?? [];
    const gain = parseSpiceValue(part.value, 1);
    let current = 0;
    if (part.type === "cccs") {
      const controlIndex = topology.branchByPart.get(part.model ?? part.ref);
      if (controlIndex !== undefined) {
        current = gain * (x[topology.branches[controlIndex].row] ?? 0);
      } else {
        const control = context.document.parts.find((entry) => entry.id === (part.model ?? part.ref) || entry.ref === (part.model ?? part.ref));
        const controlNodes = control ? topology.partNodes.get(control.id) ?? [0, 0] : [0, 0];
        current = gain * (nodeVoltage(x, controlNodes[0]) - nodeVoltage(x, controlNodes[1])) / Math.max(resistanceAt(control ?? part, context.settings.temperature), 1e-6);
      }
    } else {
      current = gain * (nodeVoltage(x, nodes[2]) - nodeVoltage(x, nodes[3]));
    }
    if (nodes[0] > 0) b[nodes[0] - 1] -= current;
    if (nodes[1] > 0) b[nodes[1] - 1] += current;
  }

  return { A, b };
}

function converged(previous: number[], next: number[], reltol: number, abstol: number) {
  for (let index = 0; index < next.length; index += 1) {
    if (Math.abs(next[index] - previous[index]) > reltol * Math.abs(next[index]) + abstol) return false;
  }
  return true;
}

interface DcSolution {
  x: number[];
  iterations: number;
  converged: boolean;
  linearizations: Map<string, DeviceModel>;
  partStates: Record<string, PartState>;
}

function createContext(document: CircuitDocument, topology: Topology, settings: SimulationSettings): SolveContext {
  return {
    document, topology, settings, time: 0, gmin: GMIN_FLOOR, sourceScale: 1,
    state: new Map(), previous: new Map(), limited: new Map(), partStates: new Map(), dcOnly: true,
  };
}

function collectStates(context: SolveContext) {
  const states: Record<string, PartState> = {};
  for (const [id, state] of context.partStates.entries()) states[id] = state;
  return states;
}

function newtonSolve(context: SolveContext, initial: number[], maxIterations = 120) {
  let x = initial.length ? [...initial] : new Array<number>(context.topology.size).fill(0);
  let iterations = 0;
  let isConverged = false;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    iterations = iteration + 1;
    const { A, b } = assemble(x, context);
    const next = solveDense(A, b);
    if (!next.every((value) => Number.isFinite(value))) break;
    if (converged(x, next, context.settings.reltol, context.settings.abstol)) {
      x = next;
      isConverged = true;
      break;
    }
    const damping = iteration < 3 ? 0.6 : 0.85;
    x = next.map((value, index) => x[index] + damping * (value - x[index]));
  }
  return { x, iterations, converged: isConverged };
}

export function solveOperatingPoint(document: CircuitDocument, settings: SimulationSettings, overrides?: Map<string, number>): DcSolution {
  const effective = overrides?.size
    ? { ...document, parts: document.parts.map((part) => (overrides.has(part.id) ? { ...part, value: String(overrides.get(part.id)) } : part)) }
    : document;
  const topology = buildTopology(effective);
  const context = createContext(effective, topology, settings);
  let x = new Array<number>(topology.size).fill(0);
  let iterations = 0;
  let isConverged = false;

  for (const gmin of settings.gminStepping ? [1e-1, 1e-3, 1e-6, 1e-9, GMIN_FLOOR] : [GMIN_FLOOR]) {
    context.gmin = gmin;
    context.previous = new Map();
    context.limited = new Map();
    const result = newtonSolve(context, x);
    x = result.x;
    iterations += result.iterations;
    isConverged = result.converged;
    if (!isConverged) break;
  }
  if (!isConverged) {
    for (const scale of [0.05, 0.15, 0.35, 0.6, 0.8, 1]) {
      context.sourceScale = scale;
      context.gmin = GMIN_FLOOR;
      context.previous = new Map();
      context.limited = new Map();
      const result = newtonSolve(context, x, 200);
      x = result.x;
      iterations += result.iterations;
      isConverged = result.converged;
      if (!isConverged) break;
    }
  }

  context.limited = new Map();
  context.noLimit = true;
  const linearizations = new Map<string, DeviceModel>();
  for (const part of effective.parts) {
    if (part.type === "ground") continue;
    const model = evaluatePart(part, topology.partNodes.get(part.id) ?? [], x, context);
    if (model) linearizations.set(part.id, model);
  }
  return { x, iterations, converged: isConverged, linearizations, partStates: collectStates(context) };
}

/* ------------------------------------------------------------------ *
 * Analyses
 * ------------------------------------------------------------------ */

function traceNodes(document: CircuitDocument, topology: Topology) {
  const palette = ["#87e84b", "#39b7a4", "#eea550", "#9d8cff"];
  const probes = document.probes.filter((probe) => topology.partNodes.has(probe.pin.partId));
  if (probes.length) {
    return probes.slice(0, 4).map((probe, index) => ({
      name: probe.name || "V(probe)",
      color: palette[index % palette.length],
      node: topology.partNodes.get(probe.pin.partId)?.[probe.pin.pin] ?? 0,
    }));
  }
  const candidate = document.parts.find((part) => part.type === "resistor" || part.type === "capacitor");
  const node = candidate ? topology.partNodes.get(candidate.id)?.[1] ?? 0 : 0;
  return [{ name: `V(${topology.nodeNames[node] ?? "out"})`, color: palette[0], node }];
}

function readNode(x: number[], node: number) {
  return node <= 0 ? 0 : x[node - 1] ?? 0;
}

function transientAnalysis(document: CircuitDocument, settings: SimulationSettings, points: number): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const duration = settings.duration > 0 ? settings.duration : 0.008;
  const steps = Math.max(24, Math.min(600, points));
  const dt = Math.min(settings.timestep > 0 ? settings.timestep : duration / steps, duration / steps);
  const totalSteps = Math.min(4000, Math.ceil(duration / dt) + 1);
  const context = createContext(document, topology, settings);
  context.dcOnly = false;
  context.dt = dt;

  const operating = solveOperatingPoint(document, settings);
  for (const part of document.parts) {
    const nodes = topology.partNodes.get(part.id) ?? [0, 0];
    if (part.type === "capacitor") {
      context.state.set(`${part.id}:v`, readNode(operating.x, nodes[0]) - readNode(operating.x, nodes[1]));
      context.state.set(`${part.id}:i`, 0);
    } else if (part.type === "inductor") {
      const branch = topology.branches.find((entry) => entry.partId === part.id);
      context.state.set(`${part.id}:i`, branch ? operating.x[branch.row] ?? 0 : 0);
      context.state.set(`${part.id}:v`, 0);
    }
  }
  let x = [...operating.x];
  const xValues: number[] = [0];
  const traces: SimulationTrace[] = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [readNode(x, trace.node)], unit: "V" }));
  let time = 0;

  for (let step = 0; step < totalSteps; step += 1) {
    time += dt;
    context.time = time;
    context.previous = new Map(context.state);
    context.limited = new Map();
    let result = newtonSolve(context, x, 90);
    x = result.x;
    if (!result.converged && dt > 1e-10) {
      context.dt = dt / 4;
      const retry = newtonSolve(context, x, 200);
      if (retry.converged) x = retry.x;
      context.dt = dt;
    }
    for (const part of document.parts) {
      const nodes = topology.partNodes.get(part.id) ?? [0, 0];
      if (part.type === "capacitor") {
        const voltage = readNode(x, nodes[0]) - readNode(x, nodes[1]);
        const previousVoltage = context.previous.get(`${part.id}:v`) ?? 0;
        const previousCurrent = context.previous.get(`${part.id}:i`) ?? 0;
        const capacitance = Math.max(Math.abs(parseSpiceValue(part.value, 1e-6)), 1e-18);
        const current = settings.method === "Backward Euler"
          ? (capacitance / dt) * (voltage - previousVoltage)
          : settings.method === "Gear 2"
            ? ((2 * capacitance) / (3 * dt)) * (voltage - previousVoltage) - (4 / 3) * previousCurrent
            : ((2 * capacitance) / dt) * (voltage - previousVoltage) - previousCurrent;
        context.state.set(`${part.id}:v`, voltage);
        context.state.set(`${part.id}:i`, current);
      } else if (part.type === "inductor") {
        const branch = topology.branches.find((entry) => entry.partId === part.id);
        const current = branch ? x[branch.row] ?? 0 : 0;
        const previousCurrent = context.previous.get(`${part.id}:i`) ?? 0;
        const previousVoltage = context.previous.get(`${part.id}:v`) ?? 0;
        const inductance = branch?.inductance ?? 1e-3;
        const voltage = settings.method === "Backward Euler"
          ? (inductance / dt) * (current - previousCurrent)
          : settings.method === "Gear 2"
            ? ((2 * inductance) / (3 * dt)) * (current - previousCurrent) - (4 / 3) * previousVoltage
            : ((2 * inductance) / dt) * (current - previousCurrent) - previousVoltage;
        context.state.set(`${part.id}:i`, current);
        context.state.set(`${part.id}:v`, voltage);
      }
    }
    xValues.push(time);
    selected.forEach((trace, index) => traces[index].values.push(readNode(x, trace.node)));
    if (!x.every((value) => Number.isFinite(value))) break;
  }

  // Decimate long runs so the SVG renderer stays at interactive frame rates.
  const maxPoints = 600;
  const stride = Math.max(1, Math.ceil(xValues.length / maxPoints));
  return {
    domain: "time",
    xLabel: "Time (s)",
    x: xValues.filter((_, index) => index % stride === 0),
    traces: traces.map((trace) => ({ ...trace, values: trace.values.filter((_, index) => index % stride === 0) })),
    duration,
    sampleCount: Math.ceil(xValues.length / stride),
    status: `Transient · ${settings.method} · ${xValues.length} steps · ${settings.temperature} °C`,
    outputVoltage: traces[0]?.values[traces[0].values.length - 1] ?? 0,
    partStates: collectStates(context),
  };
}

function realToComplex(model: DeviceModel) {
  return {
    terminals: model.terminals,
    Y: model.Y.map((row) => row.map((value) => cx(value))),
    Ieq: model.Ieq.map((value) => cx(value)),
  };
}

function stampComplex(A: Complex[][], b: Complex[], nodes: number[], model: { terminals: number[]; Y: Complex[][]; Ieq: Complex[] }) {
  for (let i = 0; i < nodes.length; i += 1) {
    const row = nodes[i] - 1;
    if (row < 0) continue;
    for (let j = 0; j < nodes.length; j += 1) {
      const column = nodes[j] - 1;
      if (column >= 0) A[row][column] = cxAdd(A[row][column], model.Y[i][j]);
    }
    b[row] = cxSub(b[row], model.Ieq[i]);
  }
}

const LINEAR_TYPES = new Set(["resistor", "thermistor", "lamp", "buzzer", "motor", "fuse", "switch", "relay", "potentiometer", "scr", "triac"]);

function buildAcSystem(document: CircuitDocument, topology: Topology, operating: DcSolution, frequency: number, injectPartId?: string) {
  const omega = 2 * Math.PI * frequency;
  const size = topology.size;
  const A: Complex[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => cx()));
  const b: Complex[] = Array.from({ length: size }, () => cx());
  for (let node = 1; node < topology.nodeCount; node += 1) A[node - 1][node - 1] = cxAdd(A[node - 1][node - 1], cx(GMIN_FLOOR));

  for (const part of document.parts) {
    if (part.type === "ground" || part.id === injectPartId) continue;
    const nodes = topology.partNodes.get(part.id) ?? [];
    if (part.type === "capacitor") {
      const capacitance = Math.max(Math.abs(parseSpiceValue(part.value, 1e-6)), 1e-18);
      const y = cx(0, omega * capacitance);
      stampComplex(A, b, [nodes[0], nodes[1]], { terminals: [nodes[0], nodes[1]], Y: [[y, cx(0, -omega * capacitance)], [cx(0, -omega * capacitance), y]], Ieq: [cx(), cx()] });
    } else {
      const model = operating.linearizations.get(part.id);
      if (model) stampComplex(A, b, model.terminals, realToComplex(model));
    }
  }

  for (const branch of topology.branches) {
    const row = branch.row;
    const stampNode = (node: number, sign: number) => {
      if (node <= 0) return;
      A[node - 1][row] = cxAdd(A[node - 1][row], cx(sign));
      A[row][node - 1] = cxAdd(A[row][node - 1], cx(sign));
    };
    stampNode(branch.posNode, 1);
    stampNode(branch.negNode, -1);
    const part = document.parts.find((entry) => entry.id === branch.partId);
    if (branch.kind === "v" && part) {
      b[row] = cx(BRANCH_TYPES.has(part.type) ? (part.type === "voltage" ? 1 : acAmplitude(part)) : 0);
    } else if (branch.kind === "l") {
      const inductance = branch.inductance ?? 1e-3;
      A[row][row] = cxSub(A[row][row], cx(0, omega * inductance));
      if (branch.partner !== undefined) {
        const partner = topology.branches[branch.partner];
        const mutual = 0.99 * Math.sqrt(inductance * (partner.inductance ?? 1e-3));
        A[row][partner.row] = cxSub(A[row][partner.row], cx(0, omega * mutual));
      }
    } else if (branch.kind === "vcvs") {
      if ((branch.controlPos ?? 0) > 0) A[row][(branch.controlPos ?? 0) - 1] = cxSub(A[row][(branch.controlPos ?? 0) - 1], cx(branch.value));
      if ((branch.controlNeg ?? 0) > 0) A[row][(branch.controlNeg ?? 0) - 1] = cxAdd(A[row][(branch.controlNeg ?? 0) - 1], cx(branch.value));
    } else if (branch.kind === "ccvs") {
      const controlIndex = branch.controlPartId ? topology.branchByPart.get(branch.controlPartId) : undefined;
      if (controlIndex !== undefined) A[row][topology.branches[controlIndex].row] = cxSub(A[row][topology.branches[controlIndex].row], cx(branch.value));
    }
  }

  if (injectPartId) {
    const nodes = topology.partNodes.get(injectPartId) ?? [0, 0];
    if (nodes[0] > 0) b[nodes[0] - 1] = cxSub(b[nodes[0] - 1], cx(1));
    if (nodes[1] > 0) b[nodes[1] - 1] = cxAdd(b[nodes[1] - 1], cx(1));
  }
  return { A, b };
}

function acAnalysis(document: CircuitDocument, settings: SimulationSettings, points: number, frequencyStart = 10, frequencyStop = 100_000): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const operating = solveOperatingPoint(document, settings);
  const count = Math.max(24, Math.min(400, points));
  const x: number[] = [];
  const traces: SimulationTrace[] = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [], phase: [], unit: "dB" }));

  for (let step = 0; step < count; step += 1) {
    const frequency = frequencyStart * Math.pow(frequencyStop / frequencyStart, step / Math.max(count - 1, 1));
    const { A, b } = buildAcSystem(document, topology, operating, frequency);
    const solution = solveComplexDense(A, b);
    x.push(frequency);
    selected.forEach((trace, index) => {
      const value = trace.node <= 0 ? cx() : solution[trace.node - 1] ?? cx();
      traces[index].values.push(20 * Math.log10(Math.max(Math.hypot(value.real, value.imaginary), 1e-12)));
      traces[index].phase?.push((Math.atan2(value.imaginary, value.real) * 180) / Math.PI);
    });
  }

  return {
    domain: "frequency",
    xLabel: "Frequency (Hz)",
    x,
    traces,
    duration: 0,
    sampleCount: count,
    status: `AC sweep · ${frequencyStart} Hz → ${frequencyStop} Hz · ${count} points`,
    outputVoltage: Math.pow(10, (traces[0]?.values[0] ?? -120) / 20),
  };
}

function dcSweepAnalysis(document: CircuitDocument, settings: SimulationSettings, points: number): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const source = document.parts.find((part) => BRANCH_TYPES.has(part.type)) ?? document.parts[0];
  const maximum = source ? Math.max(1, source.type === "voltage" ? parseSpiceValue(source.value, 5) : acAmplitude(source)) : 5;
  const steps = Math.max(24, Math.min(300, points));
  const x: number[] = [];
  const traces: SimulationTrace[] = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [], unit: "V" }));
  for (let step = 0; step <= steps; step += 1) {
    const sweep = (maximum * step) / steps;
    const solution = solveOperatingPoint(document, settings, source ? new Map([[source.id, sweep]]) : undefined);
    x.push(sweep);
    selected.forEach((trace, index) => traces[index].values.push(readNode(solution.x, trace.node)));
  }
  return {
    domain: "dc",
    xLabel: `${source?.ref ?? "Source"} (V)`,
    x,
    traces,
    duration: 0,
    sampleCount: x.length,
    status: `DC sweep · 0 → ${maximum} V · ${x.length} points`,
    outputVoltage: traces[0]?.values[traces[0].values.length - 1] ?? 0,
  };
}

function temperatureSweep(document: CircuitDocument, settings: SimulationSettings, points: number): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const count = Math.max(6, Math.min(60, points));
  const x: number[] = [];
  const traces: SimulationTrace[] = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [], unit: "V" }));
  for (let step = 0; step < count; step += 1) {
    const temperature = -20 + (step * 140) / Math.max(1, count - 1);
    const solution = solveOperatingPoint(document, { ...settings, temperature });
    x.push(temperature);
    selected.forEach((trace, index) => traces[index].values.push(readNode(solution.x, trace.node)));
  }
  return {
    domain: "dc",
    xLabel: "Temperature (°C)",
    x,
    traces,
    duration: 0,
    sampleCount: count,
    status: `Temperature sweep · −20 → 120 °C · ${count} points`,
    outputVoltage: traces[0]?.values[traces[0].values.length - 1] ?? 0,
  };
}

function parameterSweep(document: CircuitDocument, settings: SimulationSettings, points: number, parameterId?: string): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const target = document.parts.find((part) => part.id === parameterId)
    ?? document.parts.find((part) => ["resistor", "capacitor", "inductor"].includes(part.type))
    ?? document.parts[0];
  const base = target ? parseSpiceValue(target.value, 1e3) : 1e3;
  const count = Math.max(6, Math.min(80, points));
  const x: number[] = [];
  const traces: SimulationTrace[] = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [], unit: "V" }));
  for (let step = 0; step < count; step += 1) {
    const value = base * (0.2 + (step * 2.6) / Math.max(1, count - 1));
    const solution = solveOperatingPoint(document, settings, target ? new Map([[target.id, value]]) : undefined);
    x.push(value);
    selected.forEach((trace, index) => traces[index].values.push(readNode(solution.x, trace.node)));
  }
  const suffix = (target?.value.match(/[a-zA-Zµμ]+/)?.[0] ?? "").replace("Ω", "");
  return {
    domain: "dc",
    xLabel: `${target?.ref ?? "Parameter"} (${suffix || "value"})`,
    x,
    traces,
    duration: 0,
    sampleCount: count,
    status: `Parameter sweep · ${target?.ref ?? "component"} · ${count} points`,
    outputVoltage: traces[0]?.values[traces[0].values.length - 1] ?? 0,
  };
}

function monteCarloAnalysis(document: CircuitDocument, settings: SimulationSettings, runs: number): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const tolerant = document.parts.filter((part) => ["resistor", "capacitor", "inductor"].includes(part.type));
  const count = Math.max(12, Math.min(200, runs));
  const x: number[] = [];
  const traces: SimulationTrace[] = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [], unit: "V" }));
  for (let run = 0; run < count; run += 1) {
    const varied: CircuitDocument = {
      ...document,
      parts: document.parts.map((part) => {
        if (!tolerant.some((entry) => entry.id === part.id)) return part;
        const tolerance = Math.max(0, Math.min(0.6, parseSpiceValue(part.tolerance ?? "5%", 5) / 100));
        return { ...part, value: String(parseSpiceValue(part.value, 1e3) * (1 + (Math.random() * 2 - 1) * tolerance)) };
      }),
    };
    const solution = solveOperatingPoint(varied, settings);
    x.push(run + 1);
    selected.forEach((trace, index) => traces[index].values.push(readNode(solution.x, trace.node)));
  }
  const values = traces[0]?.values ?? [];
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const sigma = values.length ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) : 0;
  return {
    domain: "samples",
    xLabel: "Monte Carlo run",
    x,
    traces,
    duration: 0,
    sampleCount: count,
    status: `Monte Carlo · ${count} runs · σ = ${sigma.toFixed(4)} V`,
    outputVoltage: values[values.length - 1] ?? 0,
    metrics: { mean: Number(mean.toFixed(5)), sigma: Number(sigma.toFixed(5)), runs: count },
  };
}

function worstCaseAnalysis(document: CircuitDocument, settings: SimulationSettings): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const corners = [0, 1, -1];
  const x: number[] = [];
  const traces: SimulationTrace[] = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [], unit: "V" }));
  for (const sign of corners) {
    const varied: CircuitDocument = {
      ...document,
      parts: document.parts.map((part) => {
        if (!["resistor", "capacitor", "inductor"].includes(part.type) || sign === 0) return part;
        const tolerance = Math.max(0, Math.min(0.6, parseSpiceValue(part.tolerance ?? "5%", 5) / 100));
        return { ...part, value: String(parseSpiceValue(part.value, 1e3) * (1 + sign * tolerance)) };
      }),
    };
    const solution = solveOperatingPoint(varied, settings);
    x.push(corners.indexOf(sign));
    selected.forEach((trace, index) => traces[index].values.push(readNode(solution.x, trace.node)));
  }
  const values = traces[0]?.values ?? [];
  return {
    domain: "dc",
    xLabel: "Corner case",
    x,
    traces,
    duration: 0,
    sampleCount: corners.length,
    status: `Worst case · ${Math.min(...values).toFixed(3)} … ${Math.max(...values).toFixed(3)} V`,
    outputVoltage: values[0] ?? 0,
    metrics: { min: Number(Math.min(...values).toFixed(5)), max: Number(Math.max(...values).toFixed(5)) },
  };
}

function fftReal(samples: number[]): number[] {
  const size = 1 << Math.ceil(Math.log2(Math.max(2, samples.length)));
  const real = new Array<number>(size).fill(0);
  const imaginary = new Array<number>(size).fill(0);
  samples.forEach((value, index) => { real[index] = value; });
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wReal = Math.cos(angle);
    const wImaginary = Math.sin(angle);
    for (let i = 0; i < size; i += length) {
      let currentReal = 1;
      let currentImaginary = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const evenReal = real[i + k];
        const evenImaginary = imaginary[i + k];
        const oddReal = real[i + k + length / 2] * currentReal - imaginary[i + k + length / 2] * currentImaginary;
        const oddImaginary = real[i + k + length / 2] * currentImaginary + imaginary[i + k + length / 2] * currentReal;
        real[i + k] = evenReal + oddReal;
        imaginary[i + k] = evenImaginary + oddImaginary;
        real[i + k + length / 2] = evenReal - oddReal;
        imaginary[i + k + length / 2] = evenImaginary - oddImaginary;
        const nextReal = currentReal * wReal - currentImaginary * wImaginary;
        currentImaginary = currentReal * wImaginary + currentImaginary * wReal;
        currentReal = nextReal;
      }
    }
  }
  const magnitude = new Array<number>(size / 2).fill(0);
  for (let index = 0; index < size / 2; index += 1) magnitude[index] = (2 * Math.hypot(real[index], imaginary[index])) / size;
  return magnitude;
}

function fourierAnalysis(document: CircuitDocument, settings: SimulationSettings, points: number): SimulationResult {
  const transient = transientAnalysis(
    document,
    { ...settings, duration: Math.max(settings.duration, 0.02), timestep: Math.min(settings.timestep || 1e-5, 2e-5) },
    Math.max(256, points),
  );
  const trace = transient.traces[0];
  if (!trace) throw new Error("No probe available for Fourier analysis");
  const samples = trace.values;
  const count = samples.length;
  const mean = samples.reduce((sum, value) => sum + value, 0) / count;
  const spectrum = fftReal(samples.map((value) => value - mean));
  let fundamentalIndex = 1;
  let peak = 0;
  for (let index = 1; index < spectrum.length; index += 1) {
    if (spectrum[index] > peak) { peak = spectrum[index]; fundamentalIndex = index; }
  }
  const harmonics: number[] = [];
  let sumSquares = 0;
  for (let harmonic = 1; harmonic <= 10; harmonic += 1) {
    const magnitude = spectrum[fundamentalIndex * harmonic] ?? 0;
    harmonics.push(magnitude);
    if (harmonic > 1) sumSquares += magnitude * magnitude;
  }
  const thd = peak ? (Math.sqrt(sumSquares) / peak) * 100 : 0;
  return {
    domain: "spectrum",
    xLabel: "Harmonic order",
    x: harmonics.map((_, index) => index + 1),
    traces: [{
      name: `${trace.name} harmonics`,
      color: trace.color,
      values: harmonics.map((value) => 20 * Math.log10(Math.max(value, 1e-12))),
      unit: "dBV",
    }],
    duration: transient.duration,
    sampleCount: harmonics.length,
    status: `Fourier · fundamental bin ${fundamentalIndex} · THD ${thd.toFixed(2)} %`,
    outputVoltage: harmonics[0] ?? 0,
    metrics: { thd: Number(thd.toFixed(3)), fundamental: Number(peak.toFixed(5)), harmonics: harmonics.length },
  };
}

function noiseAnalysis(document: CircuitDocument, settings: SimulationSettings, points: number): SimulationResult {
  const topology = buildTopology(document);
  const selected = traceNodes(document, topology);
  const outputNode = selected[0]?.node ?? 0;
  const operating = solveOperatingPoint(document, settings);
  const resistors = document.parts.filter((part) => part.type === "resistor" || part.type === "thermistor");
  const frequencyStart = 100;
  const frequencyStop = 100_000;
  const count = Math.max(10, Math.min(80, points));
  const x: number[] = [];
  const densities: number[] = [];
  for (let step = 0; step < count; step += 1) {
    const frequency = frequencyStart * Math.pow(frequencyStop / frequencyStart, step / Math.max(count - 1, 1));
    let power = 0;
    for (const resistor of resistors) {
      const resistance = Math.max(resistanceAt(resistor, settings.temperature), 1);
      const density = 4 * K_BOLTZMANN * (settings.temperature + 273.15) / resistance;
      const { A, b } = buildAcSystem(document, topology, operating, frequency, resistor.id);
      const solution = solveComplexDense(A, b);
      const value = outputNode <= 0 ? cx() : solution[outputNode - 1] ?? cx();
      const transfer = Math.hypot(value.real, value.imaginary);
      power += density * transfer * transfer;
    }
    x.push(frequency);
    densities.push(Math.sqrt(power));
  }
  const integrated = Math.sqrt(densities.reduce((sum, value) => sum + value * value, 0) * Math.log(frequencyStop / frequencyStart) / count);
  return {
    domain: "frequency",
    xLabel: "Frequency (Hz)",
    x,
    traces: [{
      name: "Output noise density",
      color: "#eea550",
      values: densities.map((value) => 20 * Math.log10(Math.max(value, 1e-15))),
      unit: "dBV/√Hz",
    }],
    duration: 0,
    sampleCount: count,
    status: `Noise · ${(integrated * 1e9).toFixed(1)} nV rms over ${frequencyStart} Hz – ${frequencyStop} Hz`,
    outputVoltage: densities[densities.length - 1] ?? 0,
    metrics: { integratedNoise: Number((integrated * 1e9).toFixed(2)), bandwidth: frequencyStop - frequencyStart },
  };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function runAnalysis(
  document: CircuitDocument,
  mode: AnalysisMode,
  settings: SimulationSettings = DEFAULT_SETTINGS,
  pointCount = 120,
  options?: { parameterId?: string; method?: IntegrationMethod },
): SimulationResult {
  const effective: SimulationSettings = { ...settings, method: options?.method ?? settings.method };
  switch (mode) {
    case "Transient":
      return transientAnalysis(document, effective, pointCount);
    case "AC Sweep":
      return acAnalysis(document, effective, pointCount);
    case "DC Operating Point": {
      const solution = solveOperatingPoint(document, effective);
      const topology = buildTopology(document);
      const selected = traceNodes(document, topology);
      const traces = selected.map((trace) => ({ name: trace.name, color: trace.color, values: [readNode(solution.x, trace.node)], unit: "V" }));
      return {
        domain: "dc",
        xLabel: "Operating point",
        x: [0],
        traces,
        duration: 0,
        sampleCount: 1,
        status: solution.converged
          ? `DC operating point converged · ${solution.iterations} Newton iterations`
          : "DC operating point did not converge — check the circuit",
        outputVoltage: traces[0]?.values[0] ?? 0,
        partStates: solution.partStates,
      };
    }
    case "DC Sweep":
      return dcSweepAnalysis(document, effective, pointCount);
    case "Temperature Sweep":
      return temperatureSweep(document, effective, pointCount);
    case "Parameter Sweep":
      return parameterSweep(document, effective, pointCount, options?.parameterId);
    case "Monte Carlo":
      return monteCarloAnalysis(document, effective, pointCount);
    case "Worst Case":
      return worstCaseAnalysis(document, effective);
    case "Fourier":
      return fourierAnalysis(document, effective, pointCount);
    case "Noise":
      return noiseAnalysis(document, effective, pointCount);
    default:
      return transientAnalysis(document, effective, pointCount);
  }
}

export function simulateCircuit(
  document: CircuitDocument,
  mode: AnalysisMode = "Transient",
  pointCount = 120,
  settings: SimulationSettings = DEFAULT_SETTINGS,
  options?: { parameterId?: string; method?: IntegrationMethod },
): SimulationResult {
  return runAnalysis(document, mode, settings, pointCount, options);
}

export { thermalVoltage, LINEAR_TYPES };
