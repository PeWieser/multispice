import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/eda-solver";
import { DEFAULT_SETTINGS } from "@/lib/eda-types";
import type { AnalysisMode, CircuitDocument } from "@/lib/eda-types";

export const dynamic = "force-dynamic";

const ANALYSIS_MODES: AnalysisMode[] = [
  "Transient", "AC Sweep", "DC Operating Point", "DC Sweep", "Monte Carlo",
  "Fourier", "Noise", "Temperature Sweep", "Parameter Sweep", "Worst Case",
];

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "A circuit document is required." }, { status: 400 });
    }
    const body = payload as { document?: unknown; mode?: unknown; points?: unknown };
    const document = body.document as CircuitDocument | undefined;
    if (!document?.parts || !Array.isArray(document.connections)) {
      return NextResponse.json({ error: "The circuit document is missing parts or connections." }, { status: 400 });
    }
    const mode = ANALYSIS_MODES.includes(body.mode as AnalysisMode) ? (body.mode as AnalysisMode) : "Transient";
    const points = typeof body.points === "number" ? Math.max(24, Math.min(400, Math.round(body.points))) : 120;
    const result = runAnalysis(document, mode, DEFAULT_SETTINGS, points);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
