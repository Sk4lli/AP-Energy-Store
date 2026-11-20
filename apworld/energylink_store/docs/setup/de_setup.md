# Energylink Store Einrichtung

## Was du brauchst

- Einen Archipelago-Server (0.6.4 oder neuer) mit installiertem `energylink_store.apworld`
- Einen Browser; der Client ist reines HTML/CSS/JS, nichts zu installieren

## Generieren

1. World bauen und installieren: `cd apworld && ./build.sh`, dann `energylink_store.apworld` in den
   `worlds`-Ordner von Archipelago kopieren.
2. Eine YAML mit `game: Energylink Store` und deinem Slotnamen anlegen.
3. `ArchipelagoGenerate` ausführen und `ArchipelagoServer` mit der erzeugten Datei starten.

## Verbinden

1. Den Client über HTTP ausliefern (`python3 -m http.server 3000`) und
   `http://localhost:3000` öffnen.
2. Serveradresse (`host:port`), Slotname und, falls gesetzt, das Passwort eintragen.
3. Der Client holt den Spielnamen des Slots vom Server und verbindet damit. Diese erste Abfrage
   erscheint im Raum-Chat als TextOnly-Join/Part; das ist normal und passiert nur einmal pro Server
   und Slot.

## Kaufen

Der Store zahlt mit Joule aus dem EnergyLink-Speicher des Teams, demselben, den Factorio nutzt. Ist
der Speicher leer, bleibt der Kauf-Button gesperrt. Die Preise steigen pro Seite, und Traps aus
gekauften Locations ändern sofort den Speicher oder die Preise.
