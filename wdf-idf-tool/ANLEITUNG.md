# WDF*IDF-Tool – Anleitung (Online-Version auf Netlify)

Keyword oder Link eingeben, und du siehst, welche Begriffe dir im Vergleich zu den Google-Top-10/20 fehlen und wie oft du sie erwähnen solltest. Das Tool läuft auf Netlify, ist mit deinem Passwort geschützt und hat eine Schnittstelle für Bots.

## Einmalig einrichten: 4 Werte in Netlify eintragen
In Netlify: dein Projekt öffnen → **Project configuration → Environment variables → Add a variable**.
Bei jedem Wert **„Contains secret values“** anhaken und als Bereich mindestens **Functions** auswählen.

| Name | Was du einträgst |
|---|---|
| `APP_PASSWORD` | Dein Passwort für die Webseite (mind. 12 Zeichen) |
| `BOT_API_KEY` | Ein langer, zufälliger Schlüssel für deine Bots (z. B. aus einem Passwort-Generator, 40+ Zeichen) |
| `DFS_LOGIN` | Dein DataForSEO-API-Login (E-Mail), zu finden unter https://app.dataforseo.com/api-access |
| `DFS_PASSWORD` | Dein DataForSEO-**API**-Passwort (nicht dein normales Login-Passwort) |

Danach: **Deploys → Trigger deploy → Deploy site**, damit die Werte aktiv werden.
Solange `APP_PASSWORD` fehlt, kann sich niemand anmelden – das Tool ist dann komplett gesperrt.

## So nutzt du es
- **Mit Keyword:** Keyword ins obere Feld, optional deinen Text einfügen, „Analyse starten“. Dauert ca. 20–60 Sekunden.
- **Mit Link:** Link zu deinem Artikel ins obere Feld, „Artikel laden“. Das Tool schlägt dir das Keyword vor (anklicken oder ändern), dann „Mit diesem Keyword analysieren“.
- **Ohne eigenen Text:** Du bekommst eine Schreibvorlage mit empfohlener Länge und den Begriffen, die rein sollten.
- **Top 10 oder Top 20:** unter „Erweitert“ (Standard: Top 20).
- **Wortformen** werden zusammengeführt („Tipp/Tipps“). In der Tabelle siehst du die Schreibweisen.
- **Automatischer Filter:** Amazon, Shops, Preisvergleiche, YouTube, Social Media, Foren, PDFs, Produktseiten und zu kurze Seiten werden aussortiert. Unter „Konkurrenz“ siehst du, was warum aussortiert wurde, und kannst Seiten trotzdem nutzen oder rausnehmen.
- **Projekte:** Jede Analyse wird online gespeichert (auch die deiner Bots, markiert mit 🤖). Projekt öffnen → Text überarbeiten → **„Erneut prüfen“**. Kostet nichts. Im Verlauf siehst du vorher → nachher.
- **Bericht:** Screenshot (am Mac ⌘ ⇧ 4, Leertaste, klicken) oder „Als PDF sichern“.

## Die Reiter
- **Analyse:** wie bisher, plus **Google-Einblicke** im Bericht: deine aktuelle Position, „Nutzer fragen auch“-Fragen und ob du in der KI-Übersicht zitiert wirst.
- **Rankings:** Keywords beobachten. Jeden Montag früh werden die Positionen automatisch geprüft (Top 30). Dazu: „Wofür rankt meine Domain?“
- **Keyword-Ideen:** verwandte Keywords mit Suchvolumen und Schwierigkeit, plus **Content-Lücken** gegenüber einer Konkurrenz-Domain.
- **Backlinks:** wer auf dich verlinkt, plus **Link-Lücken** (wer auf die Konkurrenz verlinkt, aber nicht auf dich).
- **KI-Sichtbarkeit:** Zusammenfassung aus deinen Analysen (kostenlos) und Erwähnungen in KI-Antworten (ChatGPT-Daten gibt es bei DataForSEO nur für USA/Englisch).
- **Einstellungen:** deine Domains, Monatsbudget und Verbrauch.

Alle Recherche-Ergebnisse werden gespeichert – erneutes Ansehen ist kostenlos, „Neu abfragen“ kostet.

## Für deine Bots (z. B. Grokbot in Cursor)
Gib deinem Bot zwei Dinge:
1. Die Adresse des Tools plus `/api.html` – dort steht die komplette Anleitung für Bots.
2. Den `BOT_API_KEY`.

Mehr braucht er nicht. Er kann dann analysieren, Texte überarbeiten und kostenlos erneut prüfen.

## Kosten
Pro neuer Analyse eine Google-Abfrage bei DataForSEO (die tatsächlichen Kosten stehen unter „Konkurrenz“). „Erneut prüfen“ ist kostenlos. Netlify: Die Nutzung sollte im kostenlosen Rahmen bleiben, das hängt aber von deinem Netlify-Tarif ab.

## Gut zu wissen
- Die Werte weichen von TermLabs & Co. ab, weil diese den IDF über riesige Web-Datenbanken berechnen. Hier wird über die verglichenen Seiten gerechnet.
- Seiten, die ihren Text erst per JavaScript nachladen, können nicht gelesen werden. Sie erscheinen als „Zu wenig Text (0 Wörter)“.
- Der Wortformen-Abgleich ist teils großzügig (z. B. „Einsamkeit“ und „einsam“ zählen zusammen).
