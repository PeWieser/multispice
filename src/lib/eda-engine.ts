/**
 * Facade over the Circuit Studio engine layers.
 *
 * - `eda-types`    shared document and result contracts
 * - `eda-document` pin geometry, routing, value parsing
 * - `eda-presets`  ready-made example circuits
 * - `eda-netlist`  SPICE netlist generation and import
 * - `eda-solver`   modified nodal analysis and all analyses
 */
export * from "./eda-types";
export * from "./eda-document";
export * from "./eda-presets";
export * from "./eda-netlist";
export {
  buildTopology,
  runAnalysis,
  simulateCircuit,
  solveOperatingPoint,
  thermalVoltage,
} from "./eda-solver";
