import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { edaProjects } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = await db
      .select()
      .from(edaProjects)
      .orderBy(desc(edaProjects.updatedAt))
      .limit(30);
    return NextResponse.json(projects);
  } catch {
    return NextResponse.json({ error: "Projects are currently unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "A project document is required." }, { status: 400 });
    }
    const body = payload as { id?: unknown; name?: unknown; document?: unknown };
    if (!body.document || typeof body.document !== "object" || Array.isArray(body.document)) {
      return NextResponse.json({ error: "The circuit document is invalid." }, { status: 400 });
    }
    const document = body.document as Record<string, unknown>;
    if (!Array.isArray(document.parts) || !Array.isArray(document.connections)) {
      return NextResponse.json({ error: "The circuit document is missing parts or connections." }, { status: 400 });
    }

    const id = typeof body.id === "string" && body.id.length < 80 ? body.id : randomUUID();
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Untitled circuit";
    const now = new Date();
    const [project] = await db
      .insert(edaProjects)
      .values({ id, name, document, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: edaProjects.id,
        set: { name, document, updatedAt: now },
      })
      .returning();

    return NextResponse.json(project, { status: 200 });
  } catch {
    return NextResponse.json({ error: "The project could not be saved." }, { status: 503 });
  }
}
