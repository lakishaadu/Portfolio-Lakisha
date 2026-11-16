# WDF*IDF-Tool – Anleitung (Mac)

Keyword eingeben, Text einfügen, und du siehst, welche Begriffe dir im Vergleich zu den Google-Top-10 fehlen und wie oft du sie erwähnen solltest. Das Tool läuft nur auf deinem Mac, deine Daten bleiben dort.

## 1. Einmalig: Node.js installieren
1. Öffne https://nodejs.org und lade die **LTS-Version** für macOS herunter.
2. Installer öffnen und durchklicken.

## 2. Tool starten
1. Doppelklick auf **`Start.command`** in diesem Ordner.
2. **Beim allerersten Mal** blockiert macOS das eventuell („Entwickler kann nicht überprüft werden“). Dann so vorgehen:
   - Rechtsklick auf `Start.command` → **Öffnen** → nochmal **Öffnen**, oder
   - **Systemeinstellungen → Datenschutz & Sicherheit** → ganz unten bei „Start.command“ auf **Dennoch öffnen** klicken.
3. Es öffnet sich ein Terminal-Fenster (offen lassen!) und dein Browser mit dem Tool unter http://localhost:8787.
4. Zum Beenden das Terminal-Fenster schließen.

Falls der Doppelklick gar nicht klappt: Terminal öffnen, `cd ` (mit Leerzeichen) eintippen, den Ordner `wdf-idf-tool` ins Terminal ziehen, Enter, dann `node server.mjs` eintippen und http://localhost:8787 im Browser öffnen.

## 3. Einmalig: DataForSEO-Zugang eintragen
Damit das Tool die Google-Ergebnisse selbst holen kann:
1. Bei https://app.dataforseo.com einloggen → Bereich **API Access** (https://app.dataforseo.com/api-access).
2. Dort stehen dein **API-Login** (deine E-Mail) und dein **API-Passwort**. Das API-Passwort ist **nicht** dein normales Login-Passwort.
3. Im Tool links unten auf **⚙ Einstellungen** → beides eintragen → Speichern.

Die Zugangsdaten liegen danach nur auf deinem Mac (Ordner `daten`).

## So nutzt du es
- **Mit Keyword:** Keyword ins obere Feld, optional deinen Text einfügen, „Analyse starten“. Dauert ca. 20–60 Sekunden.
- **Mit Link:** Link zu deinem Artikel ins obere Feld, „Artikel laden“. Das Tool schlägt dir das Keyword vor (anklicken oder selbst ändern), dann „Mit diesem Keyword analysieren“. Dein Artikel ist automatisch „dein Text“.
- **Ohne eigenen Text:** Du bekommst eine Schreibvorlage mit empfohlener Länge und den Begriffen, die rein sollten.
- **Automatischer Filter:** Amazon, Shops, Preisvergleiche, YouTube, Social Media, Foren, PDFs, Produktseiten und zu kurze Seiten werden aussortiert. Du siehst unter „Konkurrenz“, was warum aussortiert wurde, und kannst Seiten trotzdem nutzen oder rausnehmen.
- **Projekte:** Jede Analyse wird links gespeichert. Projekt öffnen → Text überarbeiten → **„Erneut prüfen“**. Das kostet nichts, weil die Konkurrenz gespeichert ist. Im Verlauf siehst du vorher → nachher.
- **Bericht:** Oben auf der Ergebnisseite. Screenshot mit ⌘ ⇧ 4, dann Leertaste, dann auf den Bericht klicken – oder „Als PDF sichern“.

## Wenn etwas nicht klappt
Schau ins Terminal-Fenster: Dort steht bei jeder Analyse, wie viele Google-Treffer kamen und welche Seiten geladen werden konnten (und warum nicht). Ein Foto davon hilft beim Fehlersuchen.

## Neue Version installieren
1. Tool beenden (Terminal-Fenster schließen).
2. Neue ZIP entpacken.
3. Den Ordner **`daten`** aus dem alten Tool-Ordner in den neuen Ordner ziehen. Darin sind deine Projekte und Zugangsdaten.
4. Neuen Ordner an den alten Platz legen und `Start.command` doppelklicken. Das „Dennoch öffnen“ kommt bei einer neuen Version einmal wieder.

## Kosten
Pro neuer Analyse eine Google-Abfrage bei DataForSEO. Die tatsächlichen Kosten zeigt das Tool unter „Konkurrenz“ an. „Erneut prüfen“ ist kostenlos.

## Gut zu wissen
- Die Werte weichen von TermLabs & Co. ab, weil diese den IDF über riesige Web-Datenbanken berechnen. Hier wird über die verglichenen Seiten gerechnet. Die Empfehlungen zeigen in dieselbe Richtung.
- Manche Seiten blockieren automatische Abrufe. Die erscheinen unter „Nicht ladbar“, das Tool nimmt dann die nächsten Treffer.
- Beugungsformen (z. B. „Marketing“ / „Marketings“) werden als eigene Begriffe gezählt.
