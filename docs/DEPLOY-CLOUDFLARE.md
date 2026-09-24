# Circuit Studio auf Cloudflare deployen — über das Dashboard

Anleitung komplett über die **Cloudflare-Weboberfläche** (dashboard.cloudflare.com),
ohne lokales Terminal. Zwei Wege: **ohne Datenbank** und **mit Datenbank**.

> Circuit Studio ist eine Next.js-App. Die Simulation läuft **im Browser** —
> ein Server wird nur für das Projekte-Speichern gebraucht.

---

## Übersicht

| | **A · ohne DB** | **B · mit Postgres** | **C · mit D1** |
|---|---|---|---|
| Was | Statische Seiten auf Pages | Worker + externe Postgres | Worker + Cloudflare D1 |
| Speichern | `localStorage` im Browser | serverseitig, geräteübergreifend | serverseitig, geräteübergreifend |
| Kosten | 0 € | DB-Anbieter (Neon/Supabase haben Free Tier) | 0 € (D1 Free Tier) |
| Aufwand | ~10 Min | ~25 Min | ~20 Min |
| API-Routen | nein | ja | ja |

---

## Teil 1 · Repo vorbereiten (einmalig, lokal)

**Für A (ohne DB):** statischen Export aktivieren. In `next.config.ts`:

```ts
const nextConfig: NextConfig = { output: "export", images: { unoptimized: true } };
```

Dann committen und zu GitHub/GitLab pushen.

**Für B und C:** nichts ändern — die App deployed mit SSR.

> Die API-Routen `/api/projects`, `/api/simulate`, `/api/health` funktionieren
> nur in B und C. In A fällt die App automatisch auf `localStorage` zurück.

---

## Teil 2 · Cloudflare Pages-Projekt anlegen

1. Dashboard öffnen → linke Navigation → **Workers & Pages**.
2. **Create application** → Tab **Pages** → **Connect to Git**.
3. Repository auswählen (GitHub autorisieren, falls noch nicht geschehen).
4. **Build settings** eintragen:

| Feld | A · ohne DB | B / C · mit DB |
|---|---|---|
| Framework preset | `Next.js` | `Next.js` |
| Build command | `npm run build` | `npm run build` |
| Build output directory | `out` | `.vercel/static/out` |
| Root directory | `/` | `/` |
| Node version | `20` oder höher | `20` oder höher |

5. **Save and Deploy** klicken. Der erste Bau dauert 1–3 Minuten.
6. Danach ist die App unter `<projekt>.pages.dev` erreichbar.

### Was in A nicht geht

`localStorage` ist pro Browser und Gerät gebunden. Auf dem Handy sind die
Projekte vom PC nicht sichtbar — dafür aber **Export → .ms** (Datei lässt sich
überall importieren). Das ist für Demos, Portfolios und Einzelnutzer vollkommen
ausreichend.

---

## Teil 3 · Mit Datenbank (Variante B — Postgres)

Empfohlen, wenn du von mehreren Geräten arbeiten willst.

### 3.1 Postgres-Datenbank besorgen

**Neon** (empfohlen, serverless):
1. [neon.tech](https://neon.tech) → Sign up → **Create project**.
2. Region möglichst nahe an deinen Nutzern (`eu-central-1` für DACH).
3. In **Connection Details** den String kopieren, Form **Pooled connection**:
   `postgres://user:password@ep-xyz-pooler.eu-central-1.aws.neon.tech/dbname?sslmode=require`

**Supabase** geht genauso: Projekt anlegen → **Project Settings → Database →
Connection string → URI**, Port `6543` (Pooler) nutzen.

### 3.2 Schema anlegen

Im Neon-Dashboard: **SQL Editor** → dieses Statement einfügen → **Run**:

```sql
CREATE TABLE IF NOT EXISTS eda_projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  document    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eda_projects_updated_at_idx ON eda_projects (updated_at DESC);
```

### 3.3 Verbindung in Cloudflare hinterlegen

1. Pages-Projekt öffnen → **Settings** → **Environment variables**.
2. Variable anlegen:

| Name | Wert |
|---|---|
| `DATABASE_URL` | der Connection-String aus 3.1 |

3. Haken **Production** (und **Preview**, wenn gewünscht) setzen → **Save**.
4. Wichtig: Nach dem Ändern von Variablen unter **Deployments** oben rechts
   **Retry deployment** auslösen — der Wert steht erst im nächsten Deployment
   zur Verfügung.

### 3.4 Prüfen

`https://<projekt>.pages.dev/api/health` aufrufen. Antwort:

```json
{ "ok": true }
```

Erscheint `{ "ok": false }`, ist die Variable nicht gesetzt oder der String
falsch (häufig: `?sslmode=require` fehlt, oder Passwort enthielt Sonderzeichen,
die URL-kodiert werden müssen).

---

## Teil 4 · Mit D1 statt Postgres (Variante C — alles bei Cloudflare)

Wenn du keinen externen DB-Anbieter willst.

### 4.1 D1-Datenbank anlegen

1. Dashboard → **Workers & Pages** → Tab **D1 SQL Database** → **Create**.
2. Name: `circuit-studio`, Location: automatisch.
3. Datenbank öffnen → Tab **Console** → einfügen und ausführen:

```sql
CREATE TABLE IF NOT EXISTS eda_projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS eda_projects_updated_at_idx ON eda_projects (updated_at DESC);
```

### 4.2 Bindung an Pages/Worker knüpfen

1. Pages-Projekt → **Settings** → **Functions** → **D1 database bindings**.
2. **Add binding**:

| Feld | Wert |
|---|---|
| Variable name | `DB` |
| D1 database | `circuit-studio` |

3. **Save** → **Retry deployment**.

### 4.3 Code-Umstellung

D1 spricht SQLite, nicht Postgres. In `src/app/api/projects/route.ts` statt
Drizzle das Binding benutzen:

```ts
export const runtime = "edge";

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> };
  };
}

export async function GET() {
  const { results } = await getDB()
    .prepare("SELECT id, name, document, updated_at AS updatedAt FROM eda_projects ORDER BY updated_at DESC LIMIT 30")
    .all<{ id: string; name: string; document: string; updatedAt: string }>();
  return Response.json(results.map((row) => ({ ...row, document: JSON.parse(row.document) })));
}

function getDB(): D1Database {
  // @ts-expect-error -- Cloudflare binding, injected at the edge
  return globalThis.DB as D1Database;
}
```

Für `POST` analog mit `INSERT … ON CONFLICT(id) DO UPDATE SET …`.

Das UI bleibt unverändert, weil es nur `/api/projects` aufruft.

---

## Teil 5 · Eigenene Domain

1. Pages-Projekt → **Custom domains** → **Set up a domain**.
2. Domain eintragen, Cloudflare prüft die DNS-Einträge automatisch.
3. Nach Aktivierung ist die App unter der eigenen Domain erreichbar;
   `<projekt>.pages.dev` leitet weiter.

---

## Teil 6 · Wartung

| Aufgabe | Wo |
|---|---|
| Neues Deployment | Push zu `main` → automatisch |
| Manuell neu bauen | **Deployments → ⋯ → Retry deployment** |
| Zurückrollen | **Deployments → älteres Deployment → ⋯ → Rollback** |
| Variable ändern | **Settings → Environment variables** → danach Retry |
| Logs ansehen | **Deployments → Live logs** |
| D1-Daten prüfen | D1 → **Console** → `SELECT * FROM eda_projects LIMIT 5` |

---

## Fehlerbehebung

| Symptom | Ursache | Behebung |
|---|---|---|
| `DATABASE_URL is required` | Variable fehlt im Deployment | Settings → Variables → danach **Retry deployment** |
| `/api/health` gibt 404 | Variante A (statischer Export) | `output: "export"` entfernen oder lokalen Modus nutzen |
| `{ "ok": false }` | String falsch / SSL fehlt | `?sslmode=require` anhängen, Sonderzeichen im Passwort URL-kodieren |
| D1: `JSON.parse` wirft Fehler | Dokument nicht als Text gespeichert | Spalte `document TEXT`, beim Schreiben `JSON.stringify()` |
| Build schlägt fehl: „Failed to compile" | Node-Version zu alt | Settings → Build → Node `20` |
| Änderungen unsichtbar | Build-Cache | Deployments → ⋯ → **Retry deployment** mit Cache löschen |

---

## Empfehlung

- **Demo, Portfolio, ein Nutzer, ein Gerät** → Variante A. Null Kosten, null Wartung.
- **Ernsthafte Nutzung, Team, mehrere Geräte** → Variante B mit Neon.
- **Alles in einem Cloudflare-Account, kein externer Anbieter** → Variante C mit D1.
