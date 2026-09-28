# Fred
Fred is my Buttler, who help me with all kind of things

## Google Kalender einrichten (einmalig, ca. 10 Minuten)

Fred braucht dafür eine eigene "Client-ID". Sie ist kein Geheimnis, wird aber nur im Browser gespeichert (Settings), nie im Code.

1. Öffne https://console.cloud.google.com und lege ein neues Projekt an (Name z. B. "Fred").
2. Menü "APIs & Dienste" → "Bibliothek" → **Google Calendar API** suchen → **Aktivieren**.
3. "APIs & Dienste" → "OAuth-Zustimmungsbildschirm" (auch "Google Auth Platform"): Nutzertyp **Extern**, App-Name "Fred", deine E-Mail als Support- und Kontakt-Adresse.
4. Bei "Bereiche" (Scopes) den Bereich `https://www.googleapis.com/auth/calendar.events` hinzufügen.
5. Bei "Testnutzer" deine eigene Google-Adresse eintragen. Veröffentlichungsstatus: **Testing** (reicht für dich allein).
6. "Anmeldedaten" → "Anmeldedaten erstellen" → **OAuth-Client-ID** → Anwendungstyp **Webanwendung**.
7. Bei "Autorisierte JavaScript-Quellen" genau eintragen: `https://martin290827-dev.github.io` (ohne Pfad, ohne Schrägstrich am Ende). Weiterleitungs-URIs bleiben leer.
8. Die Client-ID kopieren, in Fred unter **Settings → Google Client ID** einfügen, **Save**, dann **Connect**.
9. Google warnt evtl. "App nicht bestätigt": **Erweitert** → "Weiter zu Fred". Das ist deine eigene App.

Hinweise:
- Google gibt Zugriff nur für eine Stunde. Danach in der Karte "Calendar" einmal **Connect** klicken.
- Fred liest Termine der nächsten 30 Tage und schreibt nur Einträge, die du selbst in Fred anlegst (Events, Aufgaben mit Uhrzeit).
- Erinnerungen: Aufgaben mit Uhrzeit werden als Kalendereintrag mit Pop-up-Erinnerung angelegt. Die Erinnerung sendet Google, auch wenn Fred geschlossen ist (Google-Kalender-App am Handy nötig).
