# Fred

*At your service.*
Fred is my Buttler, who help me with all kind of things

## Google Kalender einrichten (einmalig, ca. 10 Minuten)

Fred braucht dafür eine eigene "Client-ID". Sie ist kein Geheimnis, wird aber nur im Browser gespeichert (Settings), nie im Code.

1. Öffne https://console.cloud.google.com und lege ein neues Projekt an (Name z. B. "Fred").
2. Menü "APIs & Dienste" → "Bibliothek" → **Google Calendar API** suchen → **Aktivieren**. Genauso **Google Drive API** aktivieren (für den Abgleich zwischen deinen Geräten).
3. "APIs & Dienste" → "OAuth-Zustimmungsbildschirm" (auch "Google Auth Platform"): Nutzertyp **Extern**, App-Name "Fred", deine E-Mail als Support- und Kontakt-Adresse.
4. Bei "Bereiche" (Scopes / Datenzugriff) diese drei Bereiche hinzufügen: `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/drive.appdata` und `https://www.googleapis.com/auth/drive.file`.
5. Bei "Testnutzer" deine eigene Google-Adresse eintragen. Veröffentlichungsstatus: **Testing** (reicht für dich allein).
6. "Anmeldedaten" → "Anmeldedaten erstellen" → **OAuth-Client-ID** → Anwendungstyp **Webanwendung**.
7. Bei "Autorisierte JavaScript-Quellen" genau eintragen: `https://martin290827-dev.github.io` (ohne Pfad, ohne Schrägstrich am Ende). Weiterleitungs-URIs bleiben leer.
8. Die Client-ID kopieren, in Fred unter **Settings → Google Client ID** einfügen, **Save**, dann **Connect**.
9. Google warnt evtl. "App nicht bestätigt": **Erweitert** → "Weiter zu Fred". Das ist deine eigene App.

Hinweise:
- Google gibt Zugriff nur für eine Stunde. Danach erscheint in Fred ein **Reconnect**-Knopf.
- Fred liest und schreibt nur deine Termine: "Tasks & Reminders" zeigt Termine mit Uhrzeit (30 Tage), "Events" ganztägige und mehrtägige Termine (ein Jahr). Mit **+**, Stift und Mülleimer legst du Termine direkt in Google an, änderst oder löschst sie.
- Abgleich zwischen Geräten: Fred speichert Einstellungen, Notizen und Einkaufsliste in einer versteckten Datei in deinem Google Drive (Ordner "App-Daten", nur für Fred sichtbar). Auf einem neuen Gerät nur die Client-ID eintragen und Connect drücken.
- Food: Fred schreibt dein Essensprotokoll und dein Gewicht in zwei Google Sheets in deinem Drive ("Fred Food Log", "Fred Weight Log"). Mit `drive.file` sieht Fred nur Dateien, die Fred selbst angelegt hat. Kalorien schätzt Claude über deinen eigenen Anthropic-Key (Settings); die Texte gehen dafür an Anthropic.

## Schritte aus Apple Health (optional, einmalig ca. 15 Minuten)

Fred ist eine Web-App und kann Apple Health nicht direkt lesen. Darum der Weg: iPhone-Kurzbefehl → kleines Google Apps Script in deinem eigenen Google-Konto → Fred.

**1. Script anlegen (am Computer)**
1. Neues Google Sheet anlegen, z. B. „Fred Health“.
2. Erweiterungen → Apps Script. Den Inhalt von `health-script.gs` aus diesem Repo einfügen. (Oder ein eigenständiges Projekt auf script.google.com: dann `SHEET_ID` auf die ID aus dem Sheet-Link setzen.)
3. `KEY` auf ein eigenes, langes Zufallswort ändern. Speichern.
4. Bereitstellen → Neue Bereitstellung → Typ „Web-App“. Ausführen als: **Ich**. Zugriff: **Jeder**. Bereitstellen, Zugriff erlauben.
5. Den Link kopieren (endet auf `/exec`).
6. In Fred: Settings → Activity → Apple Health link: `<Link>?key=<dein KEY>` eintragen und speichern.

**2. Kurzbefehl (am iPhone, App „Kurzbefehle“)**
1. Neuer Kurzbefehl „Fred Schritte“.
2. Aktion „Health-Samples suchen“: Filter „Typ ist Schritte“ und „Startdatum ist heute“. „Gruppieren nach: Tag“.
3. Aktion „Datum formatieren“: Aktuelles Datum, Format „Eigenes“: `yyyy-MM-dd`.
4. Aktion „Inhalte von URL abrufen“: `<Link>?key=<dein KEY>&date=` + Variable „Formatiertes Datum“ + `&steps=` + Variable „Health-Samples“ (auf die Variable tippen → „Wert“).
5. Einmal testen (▶). In Fred erscheint die Zahl nach dem nächsten Laden.

**3. Automatisch ausführen**
Kurzbefehle → Automation → + → „Tageszeit“ → z. B. 12:00, täglich → „Sofort ausführen“ → „Fred Schritte“. Dasselbe für 18:00 und 23:30. Jeder Lauf überschreibt den Wert des Tages.

Hinweise: Apple Health rechnet iPhone und Uhr/Band (z. B. Whoop) beim Gruppieren nach Tag ohne Doppelzählung zusammen. Die Daten liegen nur in deinem Google Sheet und in deinem Browser, nie im Repo.
