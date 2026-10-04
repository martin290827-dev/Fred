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

## Sicherheit (kurz)

- Fred hat kein Backend. Alle Schlüssel (Anthropic, Finnhub, Twelve Data, Google Client-ID) liegen im Browser (localStorage) und, wenn Sync an ist, in einer versteckten Datei in deinem eigenen Google Drive. Wer Skripte auf der Seite ausführen oder deinen Browser lesen kann, kommt an sie heran.
- Gegenmittel: eine Content-Security-Policy in `index.html` (nur eigene Skripte plus das Google-Anmeldeskript, nur die genannten API-Hosts, keine Inline-Skripte), kein `innerHTML` mit fremden Daten, kein Fremdcode außer dem Google-Anmeldeskript.
- Anthropic-Schlüssel: in der Anthropic Console ein eigenes Ausgabenlimit für diesen Schlüssel setzen. Dann ist der Schaden bei Verlust begrenzt.
- Das Google-Zugriffstoken lebt nur im Arbeitsspeicher der Seite, eine Stunde lang.
- Neue API-Hosts müssen in der CSP (`connect-src`) ergänzt werden, sonst blockiert der Browser sie.
