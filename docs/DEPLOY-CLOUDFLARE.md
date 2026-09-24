# MultiSpice auf Cloudflare Pages deployen

Standard: **statische Seite, keine Datenbank, kein Server.** Die gesamte
Simulation läuft im Browser. Eine Datenbank lässt sich später ergänzen, ohne
Code umzuschreiben (siehe Teil 3).

---

## Wie der Build entscheidet

`next.config.ts` wählt den Modus automatisch:

| Bedingung | Modus | Ergebnis |
|---|---|---|
| keine `DATABASE_URL`, kein `NEXT_OUTPUT` | **statisch** (Standard) | Ordner `out/` → Cloudflare Pages |
| `DATABASE_URL` gesetzt **oder** `NEXT_OUTPUT=server` | Server | `.next/` + API-Routen (`/api/projects`, `/api/simulate`, `/api/health`) |

Die API-Routen liegen als `src/app/api/**/route.server.ts` im Repo. Im
statischen Modus ignoriert Next.js sie; im Server-Modus werden sie aktiv.

**Speichern im statischen Modus:** Projekte liegen im Browser
(`localStorage`). Über **Export → .ms** lässt sich jede Schaltung als Datei
sichern und auf jedem Gerät per **Import** wieder öffnen.

---

## Teil 1 · Deployen über das Dashboard (ohne DB)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   **Create** → Tab **Pages** → **Connect to Git**.
2. Repository `multispice` auswählen → **Begin setup**.
3. Build-Einstellungen:

| Feld | Wert |
|---|---|
| Framework preset | `None` (oder `Next.js (Static HTML Export)`) |
| Build command | `npm run build` |
| Build output directory | `out` |
| Root directory | *(leer lassen)* |

4. **Environment variables:** keine nötig. Wichtig: **keine** `DATABASE_URL`
   setzen, sonst baut Next.js im Server-Modus und `out/` fehlt.
5. **Save and Deploy.** Nach ca. 1–2 Minuten läuft die App unter
   `https://<projekt>.pages.dev`.

> Das Repo enthält eine `wrangler.toml` mit `pages_build_output_dir = "out"`.
> Cloudflare liest sie automatisch – das Output-Feld im Dashboard ist damit
> bereits korrekt vorbelegt.

### Wichtig: keine `.env` ins Repo committen

Liegt eine `.env` mit `DATABASE_URL` im Repository, schaltet der Build auf
Server-Modus und das Deployment schlägt mit *„Output directory "out" not
found"* fehl. `.env` gehört in `.gitignore`.

### Updates

Jeder Push auf den Produktions-Branch löst automatisch ein neues Deployment
aus. Zurückrollen: **Deployments** → älteres Deployment → **⋯** → **Rollback**.

### Eigene Domain

Projekt → **Custom domains** → **Set up a custom domain** → Domain eintragen.
Liegt die Domain bereits bei Cloudflare, werden die DNS-Einträge automatisch
gesetzt.

---

## Teil 2 · Lokal prüfen, was Cloudflare baut

```bash
npm install
npm run build          # ohne DATABASE_URL → erzeugt out/
npx serve out          # oder: npx wrangler pages dev out
```

Wenn `out/index.html` existiert, funktioniert auch das Cloudflare-Deployment.

---

## Teil 3 · Später: Datenbank ergänzen

Cloudflare Pages liefert nur statische Dateien aus. Für die API-Routen braucht
es einen Server-Runtime – bei Cloudflare sind das **Workers** über
[OpenNext](https://opennext.js.org/cloudflare). Der Code ist dafür vorbereitet:

- API-Routen existieren bereits (`route.server.ts`).
- `src/db/index.ts` verbindet sich lazy – nur wenn eine Route die DB benutzt.
- Das UI schaltet automatisch um: Mit `NEXT_PUBLIC_PERSISTENCE=server`
  (automatisch gesetzt im Server-Modus) werden Projekte über `/api/projects`
  gespeichert und geräteübergreifend geladen.

### 3.1 Postgres anlegen (z. B. Neon, kostenloser Einstieg)

1. [neon.tech](https://neon.tech) → Projekt anlegen, Region `eu-central-1`.
2. **SQL Editor** → ausführen:

```sql
CREATE TABLE IF NOT EXISTS eda_projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  document   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eda_projects_updated_at_idx ON eda_projects (updated_at DESC);
```

3. Den **pooled** Connection-String kopieren
   (`postgres://…-pooler…neon.tech/db?sslmode=require`).

### 3.2 Auf Workers umstellen (einmalig, lokal)

```bash
npm install -D @opennextjs/cloudflare wrangler
```

`wrangler.toml` ersetzen durch:

```toml
name = "multispice"
main = ".open-next/worker.js"
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = ".open-next/assets"
binding = "ASSETS"
```

`open-next.config.ts` im Projektroot anlegen:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig();
```

In `package.json` diese Scripts ergänzen:

```json
"build:worker": "NEXT_OUTPUT=server opennextjs-cloudflare build",
"deploy:worker": "npm run build:worker && wrangler deploy"
```

### 3.3 Im Dashboard verbinden

1. **Workers & Pages** → **Create** → Tab **Workers** → **Import a repository**.
2. Build command: `npm run build:worker` · Deploy command: `npx wrangler deploy`.
3. **Settings → Variables and Secrets** → **Add**:
   - `DATABASE_URL` (Typ *Secret*) = Connection-String aus 3.1
   - `NEXT_OUTPUT` = `server`
4. **Deploy**. Prüfen: `https://<worker>.workers.dev/api/health` → `{"ok":true}`.

Das bestehende Pages-Projekt kann danach gelöscht oder als statische
Fallback-Version weiterbetrieben werden.

---

## Fehlerbehebung

| Meldung | Ursache | Lösung |
|---|---|---|
| `Output directory "out" not found` | Build lief im Server-Modus | `DATABASE_URL`/`NEXT_OUTPUT` aus den Pages-Variablen entfernen, `.env` nicht committen |
| `Wrangler configuration file … does not appear to be valid` | alte `wrangler.json(c)` im Repo | löschen; nur `wrangler.toml` mit `pages_build_output_dir` behalten |
| Seite lädt, Speichern sagt „Im Browser gespeichert" | statischer Modus – korrektes Verhalten | für geräteübergreifendes Speichern Teil 3 umsetzen |
| `/api/health` gibt 404 | statischer Modus hat keine API | erwartet; API nur mit Teil 3 |
| Build: `Node.js version` zu alt | Pages nutzt ältere Node-Version | Variable `NODE_VERSION` = `22` setzen |
