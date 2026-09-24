import type { CircuitDocument, Probe, SchematicPart, WireConnection } from "./eda-types";

interface Draft {
  parts: SchematicPart[];
  connections: WireConnection[];
  probes: Probe[];
  index: number;
}

function createDraft(): Draft {
  return { parts: [], connections: [], probes: [], index: 0 };
}

function add(draft: Draft, type: string, ref: string, value: string, x: number, y: number, rotation = 0, extra: Partial<SchematicPart> = {}) {
  const part: SchematicPart = { id: `${ref.toLowerCase()}-${draft.index++}`, type, ref, value, x, y, rotation, ...extra };
  draft.parts.push(part);
  return part;
}

function connect(draft: Draft, from: SchematicPart, fromPin: number, to: SchematicPart, toPin: number) {
  draft.connections.push({ id: `w-${draft.connections.length + 1}`, from: { partId: from.id, pin: fromPin }, to: { partId: to.id, pin: toPin } });
}

function probe(draft: Draft, part: SchematicPart, pin: number, name: string) {
  draft.probes.push({ id: `p-${draft.probes.length + 1}`, name, pin: { partId: part.id, pin } });
}

function finish(draft: Draft, name: string): CircuitDocument {
  return { version: 1, name, parts: draft.parts, connections: draft.connections, probes: draft.probes };
}

/** Classic RC low-pass filter — the default startup circuit. */
export function rcLowPass(): CircuitDocument {
  const draft = createDraft();
  const v1 = add(draft, "voltage", "V1", "5 V", 280, 360, 90);
  const r1 = add(draft, "resistor", "R1", "1 kΩ", 450, 320, 0, { tolerance: "5%", tempCoeff: "100 ppm/°C" });
  const r2 = add(draft, "resistor", "R2", "10 kΩ", 620, 400, 90, { tolerance: "1%", tempCoeff: "50 ppm/°C" });
  const c1 = add(draft, "capacitor", "C1", "1 µF", 760, 400, 90, { tolerance: "10%" });
  const g1 = add(draft, "ground", "GND", "0", 280, 540);
  const g2 = add(draft, "ground", "GND", "0", 620, 540);
  const g3 = add(draft, "ground", "GND", "0", 760, 540);
  connect(draft, v1, 0, r1, 0);
  connect(draft, r1, 1, r2, 0);
  connect(draft, r2, 0, c1, 0);
  connect(draft, v1, 1, g1, 0);
  connect(draft, r2, 1, g2, 0);
  connect(draft, c1, 1, g3, 0);
  probe(draft, r1, 1, "V(out)");
  return finish(draft, "RC low-pass filter");
}

/** Interactive potentiometer divider — drag the wiper in the inspector. */
export function potDivider(): CircuitDocument {
  const draft = createDraft();
  const v1 = add(draft, "voltage", "V1", "5 V", 260, 340, 90);
  const rv1 = add(draft, "potentiometer", "RV1", "10 kΩ", 520, 320, 0, { position: 0.5 });
  const r1 = add(draft, "resistor", "R1", "1 kΩ", 760, 420, 90, { tolerance: "5%" });
  const g1 = add(draft, "ground", "GND", "0", 260, 520);
  const g2 = add(draft, "ground", "GND", "0", 760, 540);
  connect(draft, v1, 0, rv1, 0);
  connect(draft, v1, 1, g1, 0);
  connect(draft, rv1, 2, g1, 0);
  connect(draft, rv1, 1, r1, 0);
  connect(draft, r1, 1, g2, 0);
  probe(draft, rv1, 1, "V(wiper)");
  return finish(draft, "Potentiometer voltage divider");
}

/** Half-wave rectifier with smoothing capacitor. */
export function rectifier(): CircuitDocument {
  const draft = createDraft();
  const v1 = add(draft, "ac-source", "V1", "SINE(0 5 1k)", 240, 340, 90);
  const d1 = add(draft, "diode", "D1", "1N4148", 440, 300, 0, { model: "1N4148" });
  const c1 = add(draft, "capacitor", "C1", "10 µF", 640, 420, 90, { tolerance: "20%" });
  const r1 = add(draft, "resistor", "R1", "1 kΩ", 840, 420, 90, { tolerance: "5%" });
  const g1 = add(draft, "ground", "GND", "0", 240, 540);
  const g2 = add(draft, "ground", "GND", "0", 640, 540);
  const g3 = add(draft, "ground", "GND", "0", 840, 540);
  connect(draft, v1, 0, d1, 0);
  connect(draft, d1, 1, c1, 0);
  connect(draft, c1, 0, r1, 0);
  connect(draft, c1, 1, g2, 0);
  connect(draft, r1, 1, g3, 0);
  connect(draft, v1, 1, g1, 0);
  probe(draft, d1, 1, "V(rect)");
  return finish(draft, "Half-wave rectifier");
}

/** NPN common-emitter small-signal amplifier. */
export function npnAmplifier(): CircuitDocument {
  const draft = createDraft();
  const vcc = add(draft, "voltage", "V1", "12 V", 200, 300, 90);
  const rc = add(draft, "resistor", "RC", "4.7 kΩ", 560, 260, 90, { tolerance: "5%" });
  const q1 = add(draft, "transistor-npn", "Q1", "2N3904", 560, 440, 0, { model: "2N3904" });
  const re = add(draft, "resistor", "RE", "1 kΩ", 760, 520, 90, { tolerance: "5%" });
  const r1 = add(draft, "resistor", "R1", "100 kΩ", 360, 280, 90, { tolerance: "5%" });
  const r2 = add(draft, "resistor", "R2", "22 kΩ", 360, 440, 90, { tolerance: "5%" });
  const cin = add(draft, "capacitor", "Cin", "10 µF", 440, 440, 0, { tolerance: "20%" });
  const vin = add(draft, "ac-source", "Vin", "SINE(0 0.01 1k)", 300, 420, 90);
  const cout = add(draft, "capacitor", "Cout", "10 µF", 720, 300, 0, { tolerance: "20%" });
  const rl = add(draft, "resistor", "RL", "10 kΩ", 940, 400, 90, { tolerance: "5%" });
  const g1 = add(draft, "ground", "GND", "0", 200, 480);
  const g2 = add(draft, "ground", "GND", "0", 300, 540);
  const g3 = add(draft, "ground", "GND", "0", 360, 540);
  const g4 = add(draft, "ground", "GND", "0", 760, 640);
  const g5 = add(draft, "ground", "GND", "0", 940, 500);
  connect(draft, vcc, 0, rc, 0);
  connect(draft, rc, 1, q1, 1);
  connect(draft, vcc, 0, r1, 0);
  connect(draft, r1, 1, r2, 0);
  connect(draft, r2, 1, g3, 0);
  connect(draft, r1, 1, cin, 1);
  connect(draft, cin, 1, q1, 0);
  connect(draft, vin, 0, cin, 0);
  connect(draft, vin, 1, g2, 0);
  connect(draft, q1, 2, re, 0);
  connect(draft, re, 1, g4, 0);
  connect(draft, q1, 1, cout, 0);
  connect(draft, cout, 1, rl, 0);
  connect(draft, rl, 1, g5, 0);
  connect(draft, vcc, 1, g1, 0);
  probe(draft, q1, 1, "V(collector)");
  return finish(draft, "NPN common-emitter amplifier");
}

/** Inverting op-amp amplifier with 100 kΩ feedback. */
export function opampInverter(): CircuitDocument {
  const draft = createDraft();
  const vin = add(draft, "ac-source", "V1", "SINE(0 0.5 1k)", 260, 420, 90);
  const r1 = add(draft, "resistor", "R1", "10 kΩ", 440, 420, 0, { tolerance: "1%" });
  const r2 = add(draft, "resistor", "R2", "100 kΩ", 440, 280, 90, { tolerance: "1%" });
  const u1 = add(draft, "opamp", "U1", "LM741", 640, 360, 0, { model: "LM741" });
  const r3 = add(draft, "resistor", "RL", "10 kΩ", 880, 400, 90, { tolerance: "5%" });
  const g1 = add(draft, "ground", "GND", "0", 260, 540);
  const g2 = add(draft, "ground", "GND", "0", 880, 540);
  connect(draft, vin, 0, r1, 0);
  connect(draft, vin, 1, g1, 0);
  connect(draft, r1, 1, u1, 1);
  connect(draft, r2, 1, u1, 1);
  connect(draft, r2, 0, u1, 2);
  connect(draft, u1, 0, g1, 0);
  connect(draft, u1, 2, r3, 0);
  connect(draft, r3, 1, g2, 0);
  probe(draft, u1, 2, "V(out)");
  return finish(draft, "Inverting op-amp amplifier");
}

/** 555 timer in astable configuration. */
export function timerAstable(): CircuitDocument {
  const draft = createDraft();
  const v1 = add(draft, "voltage", "V1", "9 V", 200, 320, 90);
  const u1 = add(draft, "timer", "U1", "NE555", 620, 380, 0, { model: "NE555" });
  const r1 = add(draft, "resistor", "R1", "10 kΩ", 400, 260, 90, { tolerance: "5%" });
  const r2 = add(draft, "resistor", "R2", "10 kΩ", 520, 260, 90, { tolerance: "5%" });
  const c1 = add(draft, "capacitor", "C1", "100 nF", 620, 520, 90, { tolerance: "10%" });
  const g1 = add(draft, "ground", "GND", "0", 200, 500);
  const g2 = add(draft, "ground", "GND", "0", 620, 640);
  connect(draft, v1, 0, u1, 5);
  connect(draft, v1, 0, u1, 4);
  connect(draft, v1, 0, r1, 0);
  connect(draft, v1, 1, g1, 0);
  connect(draft, r1, 1, r2, 0);
  connect(draft, r1, 1, u1, 2);
  connect(draft, r2, 1, c1, 0);
  connect(draft, r2, 1, u1, 1);
  connect(draft, c1, 1, g2, 0);
  connect(draft, u1, 6, g1, 0);
  probe(draft, u1, 3, "V(out)");
  return finish(draft, "555 astable oscillator");
}

/** Interactive LED with SPST switch — click the switch to toggle it. */
export function ledSwitch(): CircuitDocument {
  const draft = createDraft();
  const v1 = add(draft, "voltage", "V1", "5 V", 260, 340, 90);
  const s1 = add(draft, "switch", "S1", "Open", 460, 300, 0, { closed: false });
  const r1 = add(draft, "resistor", "R1", "220 Ω", 660, 340, 90, { tolerance: "5%" });
  const d1 = add(draft, "led", "D1", "Red · 5 mm", 880, 340, 90, { model: "LED-RED" });
  const g1 = add(draft, "ground", "GND", "0", 260, 520);
  const g2 = add(draft, "ground", "GND", "0", 880, 520);
  connect(draft, v1, 0, s1, 0);
  connect(draft, s1, 1, r1, 0);
  connect(draft, r1, 1, d1, 0);
  connect(draft, d1, 1, g2, 0);
  connect(draft, v1, 1, g1, 0);
  probe(draft, d1, 0, "V(led)");
  return finish(draft, "LED switch circuit");
}

/** Startup circuit — kept as a named export for backwards compatibility. */
export const DEFAULT_CIRCUIT: CircuitDocument = rcLowPass();

export interface CircuitPreset {
  id: string;
  name: string;
  category: string;
  detail: string;
  build: () => CircuitDocument;
}

export const CIRCUIT_PRESETS: CircuitPreset[] = [
  { id: "rc-low-pass", name: "RC low-pass filter", category: "Passive", detail: "1 kΩ · 1 µF · first order", build: rcLowPass },
  { id: "pot-divider", name: "Potentiometer divider", category: "Passive", detail: "Interactive wiper · 10 kΩ", build: potDivider },
  { id: "rectifier", name: "Half-wave rectifier", category: "Power", detail: "1N4148 · 10 µF smoothing", build: rectifier },
  { id: "npn-amplifier", name: "NPN amplifier", category: "Analog", detail: "2N3904 · common emitter", build: npnAmplifier },
  { id: "opamp-inverter", name: "Inverting op-amp", category: "Analog", detail: "LM741 · gain −10", build: opampInverter },
  { id: "timer-astable", name: "555 astable", category: "Mixed", detail: "NE555 · square wave", build: timerAstable },
  { id: "led-switch", name: "LED switch", category: "Interactive", detail: "Click the switch in the canvas", build: ledSwitch },
];
