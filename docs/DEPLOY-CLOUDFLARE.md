# Deployment auf Cloudflare

Circuit Studio ist eine Next.js-16-App (App Router) mit einer eigenen
TypeScript-SPICE-Engine. Es gibt **drei sinnvolle Deployment-Wege** – von
"ohne Datenbank" bis "mit serverloser Postgres-DB".

> Wichtig: Next.js 16 läuft auf Cloudflare **nicht** nativ. Du brauchst
> entweder **OpenNext für Cloudflare** (empfohlen, unterstützt SSR, Route
> Handlers und Middleware) oder einen **statischen Export** (dann ohne
> Server-API). `next-on-pages` wird für Next 15/16 nicht mehr empfohlen.

---

## Übersicht der Varianten

| Variante | Runtime | Datenbank | Projekt-Speichern | Aufwand |
|---|---|---|---|---|
| **A. Cloudflare Pages (statisch)** | Edge (statisch) | keine | nur `localStorage` + Export | gering |
| **B. Workers + OpenNext** | Workers (Node-kompatibel) | Neon / Supabase / Hyperdrive | serverseitig | mittel |
| **C. Workers + OpenNext + D1** | Workers | D1 (SQLite) | serverseitig | mittel |

---

## Variante A — Cloudflare Pages, statisch, ohne DB

Am schnellsten. Die App läuft komplett im Browser, inklusive Simulation.
 Projekte liegen in `localStorage`; über **Export → .ms / SPICE / CSV**
kannst du everything sichern.

1. Statischen Export aktivieren (`next.config.ts`):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Wichtig: die API-Routen sind im statischen Modus nicht verfügbar.
  images: { unoptimized: true },
};

export default nextConfig;
```

2. Die Client-Seite darf beim Build keine Server-Abhängigkeit haben.
   `src/app/page.tsx` rendert bereits nur die Client-Workbench – gut.
   Die API-Routen (`/api/projects`, `/api/simulate`, `/api/health`) werden
   beim Export ignoriert; die Workbench fällt automatisch auf
   `localStorage` zurück (siehe `saveProject()`).

3. Bauen und deployen:

```bash
npm run build                      # erzeugt out/
npx wrangler pages deploy out --project-name circuit-studio
```

Optional mit GitHub-Integration: Repository in Cloudflare Pages anbinden,
Build-Command `npm run build`, Output-Verzeichnis `out`.

**Nice to know:** `localStorage` ist pro Browser/Gerät gebunden. Für
Geräte-übergreifendes Arbeiten → Variante B oder C.

---

## Variante B — Cloudflare Workers mit OpenNext + Postgres (Neon/Supabase)

Empfohlen, wenn du serverseitig speichern willst (mehrere Geräte, Teams).

### 1. OpenNext installieren

```bash
npm install -D @opennextjs/cloudflare
npx opennextjs-cloudflare init
```

Das legt u. a. `open-next.config.ts`, `wrangler.jsonc` und ein
`cloudflare-env.d.ts` an.

### 2. `wrangler.jsonc` (Kern)

```jsonc
{
  "name": "circuit-studio",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "directory": ".open-next/assets"
  }
}
```

`nodejs_compat` ist Pflicht, weil `pg` (Drizzle/node-postgres) Node-APIs
nutzt.

### 3. Postgres verbinden

Zwei Optionen:

**Option 1 – Neon / Supabase (einfach):** Connection-String als Secret
hinterlegen. `pg` funktioniert im Workers-Node-Modus, aber jede Query
öffnet eine TCP-Verbindung → langsam und teuer.

```bash
npx wrangler secret put DATABASE_URL
# Wert: postgres://user:password@ep-xyz.eu-central-1.aws.neon.tech/db?sslmode=require
```

**Option 2 – Hyperdrive (empfohlen):** Connection-Pooling + Caching.

```bash
npx wrangler hyperdrive create circuit-db \
  --connection-string="postgres://user:password@host:5432/app_db"
```

Dann in `wrangler.jsonc`:

```jsonc
{
  "hyperdrive": { "bindings": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive-id>" }] }
}
```

Und `src/db/index.ts` anpassen, damit Hyperdrive bevorzugt wird:

```ts
const connectionString = process.env.DATABASE_URL ?? process.env.HYPERDRIVE_CONNECTION_STRING;
```

`src/db/index.ts` initialisiert den Pool bereits faul (erst bei der ersten
Query), sodass der Build nicht fehlschlägt, wenn zur Build-Zeit kein
`DATABASE_URL` gesetzt ist.

### 4. Schema anlegen

Das Schema ist in `src/db/schema.ts` (Tabelle `eda_projects`). Auf Neon
oder Supabase einmalig ausführen:

```bash
DATABASE_URL="postgres://…" npx drizzle-kit push
```

### 5. Deployen

```bash
npm run build
npx opennextjs-cloudflare build
npx wrangler deploy
```

Vorschau-Worker testen:

```bash
npx wrangler dev
```

---

## Variante C — Workers + OpenNext + D1 (SQLite)

Wenn du **kein** externes Postgres willst. D1 ist serverlos, günstig und
liegt im gleichen Account. Nachteil: SQL-Dialekt unterscheidet sich
(keine `jsonb`-Operatoren wie Postgres, dafür `TEXT` + JSON-Strings).

### 1. D1 anlegen

```bash
npx wrangler d1 create circuit-studio
# → database_id in wrangler.jsonc eintragen
```

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "circuit-studio", "database_id": "<id>" }
  ]
}
```

### 2. Migrationsdatei

```sql
-- migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS eda_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS eda_projects_updated_at_idx ON eda_projects (updated_at DESC);
```

```bash
npx wrangler d1 execute circuit-studio --file=migrations/0001_init.sql --remote
```

### 3. API-Route auf D1 umstellen

In `src/app/api/projects/route.ts` statt `db` aus `@/db` den D1-Binding
nutzen:

```ts
export const runtime = "edge";

const { env } = getRequestContext() as { env: { DB: D1Database } };

export async function GET() {
  const { results } = await env.DB
    .prepare("SELECT id, name, document, updated_at AS updatedAt FROM eda_projects ORDER BY updated_at DESC LIMIT 30")
    .all();
  return Response.json(results.map((row) => ({ ...row, document: JSON.parse(row.document as string) })));
}
```

Das UI bleibt unverändert, weil es nur `/api/projects` aufruft.

### 4. Deployen

```bash
npm run build && npx opennextjs-cloudflare build && npx wrangler deploy
```

---

## Was funktioniert wo?

| Feature | Pages statisch | Workers + Postgres | Workers + D1 |
|---|---|---|---|
| Schaltplan-Editor, Drag & Drop | ✅ | ✅ | ✅ |
| SPICE-Simulation (lokal, im Browser) | ✅ | ✅ | ✅ |
| Instrumente (Scope, DMM, Logic …) | ✅ | ✅ | ✅ |
| Export (.ms, SPICE, SVG, CSV) | ✅ | ✅ | ✅ |
| SPICE-Netlist importieren | ✅ | ✅ | ✅ |
| Presets | ✅ | ✅ | ✅ |
| Serverseitiges Speichern/Laden | ❌ (localStorage) | ✅ | ✅ |
| `/api/simulate` (Server-Solver) | ❌ | ✅ | ✅ |
| `/api/health` | ❌ | ✅ | ✅ |

> Die Simulation läuft **immer im Browser** – das ist der große Vorteil
> dieses Aufbaus: kein Server, keine Wartezeit, offline nutzbar. Die
> Server-API ist nur für Speichern und optionale Stapel-Simulation.

---

## Häufige Fehler

| Symptom | Ursache | Fix |
|---|---|---|
| `DATABASE_URL is required` beim Build | `src/db/index.ts` wirft beim Import | Pool lazy initialisieren (siehe B.3) |
| `Error: Cannot find module '.open-next/worker.js'` | OpenNext-Build fehlt | `npx opennextjs-cloudflare build` vor `wrangler deploy` |
| API-Routen liefern 404 | statischer Export | `output: "export"` entfernen oder API ans Client koppeln |
| `nodejs_compat` fehlt | `pg` braucht Node-APIs | Flag in `wrangler.jsonc` setzen |
| D1: `JSON.parse` schlägt fehl | Spalten-Typ | Dokument als `TEXT` speichern, nicht als JSON1 |

---

## Empfehlung

- **Schnell testen / Demo / Portfolio** → Variante A (Pages, statisch).
- **Ernsthaft nutzen, Team, mehrere Geräte** → Variante B mit Neon +
  Hyperdrive. Postgres bleibt, das Schema ist bereits dafür gebaut
  (`jsonb`-Dokumente).
- **Alles in einem Account, kein externer DB-Anbieter** → Variante C mit D1.
