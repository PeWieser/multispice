# DESIGN.md — Circuit Studio

Verbindliches Design- und Interaktionsdokument. Änderungen an der Oberfläche
werden hier als **Befund → Maßnahme** protokolliert. Bei Grundsatzfragen gilt
`KERN-MANIFEST.md`.

---

## 1 · Materialvokabular

Vier geschichtete Flächen, eine Lichtquelle von oben, Kanten als Haarlinien.

| Token | Bedeutung |
|---|---|
| `--surface-1` | App-Chrome: App-Leiste, Seitenleisten, Dock, Statusleiste |
| `--surface-2` | Verschachtelte Zeilen, Eingaben, Listen |
| `--surface-3` | Popovers, Tooltips, schwebende Instrumente |
| `--surface-4` | Erhobene Karten (Zusammenfassung, Presets) |
| `--stage` | **Die Bühne.** Hellerer Grund als die Chrome — das Bild ist der Star |
| `--line` | Haarlinie (1 px), nie ein schwarzer Balken |
| `--line-strong` | Haarlinie für aktive/abgegrenzte Bereiche |

Licht kommt von oben: `inset 0 1px 0 rgba(255,255,255,.04)` auf Chrome,
nach unten abnehmende Schatten auf Erhebungen. Schatten tragen Tiefe, keine Deko.

**Dunkel zuerst.** `.studio-shell` setzt `color-scheme: dark`,
`.theme-light` schaltet auf `light`. Alle Farbtokens sind als
`light-dark(hell, dunkel)` definiert — kein harter Farbwert in Komponenten.

### Dokumentierte Ausnahme: Canvas-Rendering

Der Schaltplan ist ein technisches Renderings. Signalfarben sind **nicht**
UI-Akzent, sondern Bedeutungen:

| Farbe | Bedeutung |
|---|---|
| `--signal` | Leiterbahn / Netz |
| `--signal-live` | Aktives, simuliertes Netz |
| `#ff6a55` | LED-Licht (Helligkeit simuliert) |
| `#87e84b · #39b7a4 · #eea550 · #9d8cff` | Messkanäle 1–4 |

---

## 2 · Typografie

Zwei Stimmen, keine dritte.

- **Geist Sans** (`--font-sans`) spricht: every UI word.
- **Geist Mono** (`--font-mono`) zählt: **every** measurement, node name, netlist
  line, coordinate, timestamp. `font-variant-numeric: tabular-nums` ist an
  jeder Stelle Pflicht, an der sich eine Ziffer ändern kann — Zahlen flackern nie.

Größen: 8/9/10/11/13/15/17 px. Dichte ist Absicht (Werkzeug, keine Website),
aber nie unter 8 px.

---

## 3 · Akzentfarbe

**Blau heißt: hier bist du, hier kannst du handeln.**

Akzent erscheint nur für
1. das aktive Werkzeug / die aktive Auswahl,
2. Fokus (`--accent-ring`),
3. **eine** primäre Einladung pro Ansicht (aktuell: **Run**).

Alles andere ist Grauskala. Grün ist reserviert für Signale und den
„verbunden/bereit"-Status — nie für Interaktion.

---

## 4 · Bewegung

```
--dur-1: 120ms   Mikro-Rückmeldung (Hover, Toggle)
--dur-2: 180ms   Zustandswechsel (Panels, Popovers, Auswahl)
--dur-3: 250ms   harte Obergrenze
--ease:  cubic-bezier(.22, 1, .36, 1)
```

Kubisch ausklingend, kleine Wege, kein Bounce, kein Konfetti, keine
Daueranimation außer der Simulations-LED (die sagt: *es läuft jetzt*).
`prefers-reduced-motion` schaltet alles auf 1 ms.

---

## 5 · Interaktionsregeln (aus dem Manifest, hier konkret)

| Regel | Umsetzung in dieser App |
|---|---|
| Jeder Klick bekommt eine Antwort ≤ 100 ms | Hover-Zustand auf every control; Toggle-Sofortumschaltung; Toast `role="status"` |
| Direkte Manipulation | Bauteile per Drag, Potentiometer per Slider, Schalter per Klick — Simulation rechnet sofort neu |
| Modi haben sichtbare Grenzen | Aktives Werkzeug ist blau markiert; ein Hinweis-Banner erklärt Modus + Ausgang |
| Sichtbarer Ausgang | `Escape` verlässt jeden Modus (Platzieren, Verdrahten, Sonde, Pan, Instrument) |
| Zero Dead Ends | Kein Werkzeugwechsel ohne Rückweg; after placement the tool returns to *Select* |
| Unsichtbare Operationen sichtbar | LED-Glow, Schalterzustand, Netz-Highlight, Fortschritts-Linie im Scope |
| Erschaffenes bleibt greifbar | Jede Leitung ist anklickbar, wird markiert und ist mit `Entf` löschbar |
| Vergebung vor Bestätigung | Undo/Redo (⌘Z / ⇧⌘Z) deckt Platzieren, Verschieben, Verdrahten, Löschen, Parametern — **keine** „Sicher?"-Dialoge |
| Eine Funktion, ein Ort | Jede Aktion hat genau eine Heimat; Kurzbefehle gehen denselben Weg |
| Ehrlichkeit der Materialien | Jeder Button tut, was sein Label sagt; tote Controls wurden entfernt |

### Kurzbefehle

| Taste | Wirkung |
|---|---|
| `V` / `W` / `H` | Auswahlen · Verdrahten · Pan |
| `/` | Fokus in die Bauteilsuche |
| `Entf` / `Backspace` | Auswahl löschen (Bauteil oder Leitung) |
| `Esc` | Modus / Auswahl verlassen |
| `⌘S` | Speichern |
| `⌘Z` / `⇧⌘Z` | Undo / Redo |

---

## 6 · Leere Zustände

- **Kein Bauteil ausgewählt:** Inspector zeigt Design-Zusammenfassung
  (Teile, Leitungen, Sonden) + Analyse-Setup — keine leere Fläche.
- **Leere Suche:** „Keine Bauteile gefunden" + Hinweis.
- **Leere Konsole:** „Console cleared · run an analysis".
- **Bühne ohne Projekt:** Watermark-Einladung „DESIGN SPACE" + Hinweis auf
  Drag & Drop; Chrome tritt zurück (HUD ausgeblendet bei leerem Plan).

---

## 7 · Export = Produkt

Export ist identisch zur Bühne, nicht „ähnlich":

- **SVG** bettet ein eigenes Stylesheet — die exportierte Datei sieht ohne die
  App exakt so aus wie auf der Bühne.
- **CSV** enthält Zeitachse + every Messkanal mit Einheit.
- **SPICE (.cir)** ist die echte Netlist, keine Näherung.
- **.ms** round-trippt: Import → Bearbeiten → Export → Import.

---

## 8 · Release-Checkliste

Vor jedem Merge gegen `main` — ausnahmslos:

- [x] `npx next typegen` fehlerfrei
- [x] `tsc --noEmit` fehlerfrei
- [x] `next build` erfolgreich
- [x] Jeder Control: Klick, Tastaturfokus, `Esc` — each Eingabe hat eine sichtbare Antwort
- [x] Jeder Modus: Eintritt sichtbar, Austritt sichtbar, keine Modusleichen
- [x] Kein toter Pixel: every Control funktional, every Tooltip wahr
- [x] Leere Zustände: Chrome tritt zurück, Einladung klar
- [x] Zahlen stabil: tabular, Einheiten immer mit
- [x] Bewegung ≤ 250 ms, kein Bounce
- [x] Undo/Redo deckt each neue Aktion ab
- [x] Export identisch zur Bühnenansicht
- [x] `role="status"` für Banner, `aria-*` for Dialoge/Toggles, Fokus sichtbar
- [x] Kein Konsolenfehler im Normaldurchlauf

---

## 9 · Änderungsprotokoll (Befund → Maßnahme)

| Befund | Maßnahme |
|---|---|
| Akzent war grün — kolidiert mit Signalfarbe, keine Bedeutungszuweisung | Akzent auf Blau umgestellt; Grün ausschließlich für Signale/Status |
| Chrome (App-Leiste) war dunkler als die Bühne — Bild war nicht der Star | Stage heller als Chrome, Vignette, Chrome zurückgenommen |
| Harte Farbwerte in Komponenten, zwei getrennte Theme-Blöcke | Alle Tokens auf `light-dark()` umgestellt; `color-scheme` schaltet |
| Gemischte Fonts, teils proportional Zahlen | Geist Sans (UI) + Geist Mono (alle Messwerte), `tabular-nums` global |
| Erzeugte Leitungen waren nicht auswählbar oder löschbar | Leitungen anklickbar, Auswahl sichtbar, `Entf` löscht, Inspector zeigt Netz |
| Tote Controls: Bibliotheks-„Einstellungen", „Open all", Version-„More", statische Netz-Zeilen als Buttons | Entfernt bzw. in echte Aktionen überführt; statische Zeilen sind keine Buttons mehr |
| `/` hatte keine Funktion, obwohl als Taste angezeigt | Fokussiert die Bauteilsuche |
| Banner ohne Live-Region | Toast mit `role="status"` und `aria-live="polite"` |
| Standard war Light — Manifest verlangt Dunkel zuerst | Dark ist Default, Light ist Opt-in |
