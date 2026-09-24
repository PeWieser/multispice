export type AnalysisMode =
  | "Transient"
  | "AC Sweep"
  | "DC Operating Point"
  | "DC Sweep"
  | "Monte Carlo"
  | "Fourier"
  | "Noise"
  | "Temperature Sweep"
  | "Parameter Sweep"
  | "Worst Case";

export type IntegrationMethod = "Trapezoidal" | "Backward Euler" | "Gear 2";

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
  /** Wiper position for potentiometers, 0…1. */
  position?: number;
  /** Contact state for switches, relays and fuses. */
  closed?: boolean;
  /** Optional SPICE model name / subcircuit reference. */
  model?: string;
  /** Free-form note shown in the inspector. */
  note?: string;
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
  unit?: string;
}

export interface SimulationResult {
  domain: "time" | "frequency" | "dc" | "samples" | "spectrum";
  xLabel: string;
  x: number[];
  traces: SimulationTrace[];
  duration: number;
  sampleCount: number;
  status: string;
  outputVoltage: number;
  metrics?: Record<string, string | number>;
  /** Per-part interactive states resolved during the last run (LED, lamp, switch …). */
  partStates?: Record<string, { brightness?: number; current?: number; voltage?: number; active?: boolean }>;
}

export interface SimulationSettings {
  method: IntegrationMethod;
  /** Transient stop time in seconds. */
  duration: number;
  /** Maximum timestep in seconds. */
  timestep: number;
  /** Ambient temperature in °C. */
  temperature: number;
  /** Enable GMIN stepping for difficult DC operating points. */
  gminStepping: boolean;
  reltol: number;
  abstol: number;
}

export const DEFAULT_SETTINGS: SimulationSettings = {
  method: "Trapezoidal",
  duration: 0.008,
  timestep: 0.00001,
  temperature: 27,
  gminStepping: true,
  reltol: 1e-4,
  abstol: 1e-12,
};
