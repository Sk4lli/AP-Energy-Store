# Archipelago Energylink Store

Rein browserbasierter Client für Archipelago. Kein Build, kein Framework: HTML, CSS und
JavaScript (ES-Module), Verbindung über [archipelago.js](https://github.com/ThePhar/archipelago.js).
Der Store verkauft Locations gegen Joule aus dem EnergyLink-Speicher.

## Starten

Die Seite **muss über HTTP** geöffnet werden. Ein Doppelklick auf `index.html` (`file://`) führt zu
einer leeren Sprachauswahl und einer stummen Konsole, weil Browser dort JavaScript-Module
blockieren. Die Seite zeigt in dem Fall einen Hinweis an.

Am einfachsten mit dem Startskript:

```bash
./start.sh          # Linux/macOS, startet Server und öffnet den Browser
start.cmd           # Windows
```

Oder von Hand:

```bash
python3 -m http.server 3000   # oder: npm run serve
# Browser: http://localhost:3000/index.html
```

Anderer Port: `PORT=8080 ./start.sh`.

### GitHub Pages

Die Seite läuft auf GitHub Pages, weil alle Pfade relativ sind. Zwei Dinge sind dort anders:

- **HTTPS.** Pages liefert über `https://`, deshalb ist nur `wss://` möglich. Ein selbst gehosteter
  Archipelago-Server ohne Zertifikat ist von dort **nicht** erreichbar; nötig ist ein Server mit TLS
  (z. B. `archipelago.gg`) oder ein eigener Reverse-Proxy davor.
- **Unterpfad.** Die Seite liegt unter `/<repo>/`. Das funktioniert, solange sie als Projekt-Pages
  ausgeliefert wird; bei einer User-Pages im Wurzelverzeichnis genauso.

Aktivieren: Einstellungen → Pages → Source „Deploy from a branch", Branch `main`, Ordner `/ (root)`.
Die Seite ist dann unter `https://<user>.github.io/AP-Engery-Store/index.html` erreichbar.

Die Adresse darf mit oder ohne Protokoll eingegeben werden. Der Client probiert beide Wege, weil
öffentliche Hosts nur `wss://` sprechen, ein selbst gehosteter Server ohne Zertifikat aber nur
`ws://`: lokal zuerst `ws`, bei entfernten Hosts zuerst `wss`. Auf einer HTTPS-Seite ist nur `wss`
möglich (sonst blockiert der Browser gemischten Inhalt). Ein explizites `ws://` oder `wss://` in der
Adresse wird unverändert verwendet.

## Verbinden

Nur drei Felder: Server (`host:port`), Slotname, Passwort (leer lassen, wenn keins gesetzt ist).
Der Spielname wird **nicht** abgefragt, er kommt aus der APworld:

1. Der Client verbindet einmal als TextOnly und liest den Spielnamen des Slots aus `slot_info`.
2. Danach verbindet er mit diesem Spielnamen. Nötig, weil der Server von TextOnly-Clients
   keine Location-Checks annimmt (`no_locations`).
3. Der Spielname wird pro Server+Slot in `localStorage` gemerkt, ein Reconnect braucht die
   TextOnly-Probe nicht mehr. Lehnt der Server den Login mit `InvalidGame` ab (z.B. nach dem
   Neugenerieren des Raums), wird der Cache verworfen und einmal neu geprobt.
4. Andere Ablehnungen werden im Klartext angezeigt, etwa `InvalidSlot` mit dem Hinweis, dass der
   Slotname nicht im Raum vorkommt.

Die erste Verbindung erzeugt im Raum-Chat eine Join/Part-Meldung (TextOnly). Das ist eine
Eigenheit des Protokolls, kein Fehler.

## APWorld

Die passende World liegt in `apworld/energylink_store`. Sie erzeugt Locations, McGuffins, Filler und
Traps und schickt die Store-Konfiguration als slot_data.

```bash
cd apworld && ./build.sh
cp energylink_store.apworld ~/.local/share/Archipelago/worlds/
```

Details zu Optionen, Items und Ziel: `apworld/energylink_store/docs/`.

Erzeugte Items:

| Item               | Klasse      | Wirkung im Store                                   |
| ------------------ | ----------- | -------------------------------------------------- |
| `McGuffin`         | progression | Ziel: `mcguffins_required` Stück sammeln            |
| `Store Filler`     | filler      | nichts                                             |
| `Tax Trap`         | trap        | alle Preise steigen dauerhaft um `tax_per_trap` %   |
| `Inflation Trap`   | trap        | `inflation_per_trap` % des EnergyLink-Speichers brennt |

Traps und McGuffins werden von Archipelago **ganz normal platziert**, sie können also überall im
Multiworld liegen. Ein Trap gehört aber immer der Store-World, die ihn erzeugt hat. Der Client löst
ihn in beiden Fällen aus:

- du kaufst die Location im Store, oder
- ein anderer Spieler kauft sie in seiner Welt und das Item kommt bei dir an.

Die Location-ID verhindert Doppelzählung. Bereits gewirkte Traps liegen in `localStorage`, ein
Neuladen der Seite verbrennt den Speicher also nicht erneut und vergisst den Steuer-Aufschlag nicht.

## Store-Konfiguration (slot_data)

Die Anzahl der Progress-Seiten und Locations pro Seite kommen aus den `slot_data` des Slots,
also aus der Player-YAML. Erwartete Schlüssel (alle optional):

| Schlüssel (Aliase)                       | Bedeutung                            | Standard  |
| ---------------------------------------- | ------------------------------------ | --------- |
| `progress_items`                         | Anzahl der Progress-Seiten           | 5         |
| `locations_per_page`                     | Locations je Seite, 5–10             | 5         |
| `base_price`                             | Preis einer Location auf Seite 1 (J) | 1 000 000 |
| `price_step`                             | Aufschlag pro Seite (J)              | 1 000 000 |
| `energylink_key`                         | EnergyLink-Schlüssel überschreiben   | `EnergyLink{team}` |
| `mcguffins_required`                     | Ziel-Anzahl McGuffins (Anzeige)      | 0         |
| `mcguffin_name`                          | Itemname für das Ziel                | `McGuffin` |
| `tax_per_trap`                           | Preisaufschlag pro Steuer-Trap (Anteil) | 0      |
| `inflation_per_trap`                     | verbranntes Pool-Anteil pro Inflation-Trap | 0   |

Aliase: `progressItems`, `locations_per_progress`, `price_base`, `starting_price`, `price_increase` usw.
Zusätzlich wird ein verschachteltes Objekt `energylink_store`, `store` oder `config` erkannt.
Fehlt alles, laufen die Standardwerte und die Konsole zeigt eine Warnung.

Preis einer Location: `base_price + price_step * (Seite - 1)`. Alle Locations einer Seite kosten
also gleich viel, höhere Seiten werden teurer.

Beispiel für die YAML des Worlds:

```yaml
EnergyLink Store:
  progress_items: 5
  locations_per_page: 8
  base_price: 750000
  price_step: 1500000
```

Die Locations einer Seite sind die Location-IDs des Slots, aufsteigend sortiert, in Blöcken von
`locations_per_page`. Seite 2 wird erst freigeschaltet, wenn Seite 1 komplett gekauft ist.

Beim Verbinden und nach jedem Kauf springt der Store auf die **erste Seite, auf der noch etwas zu
kaufen ist**. Ausverkaufte Seiten lassen sich weiterhin über die Seitenleiste ansehen.

Statt `Page 1 Location 1` zeigt jede Zeile die **Kategorie des Items**, das dort liegt:
`Progression`, `Useful`, `Trap` oder `Filler`. Der Client fragt das beim Verbinden per Scouting ab;
der Location-Name und der Item-Name stehen im Tooltip. In Race-Seeds verweigert der Server die
Auskunft, dann steht dort `Unknown`.

## Kauf-Ablauf

Traps wirken beim Kauf der Location, die sie enthält:

- **Inflation Trap** verbrennt einen Anteil des EnergyLink-Speichers (Standard 20 %). Der Anteil
  wird über `mul` auf den aktuellen Stand gerechnet, trifft also auch Joule, die inzwischen
  dazugekommen sind.
- **Tax Trap** hebt alle Preise dauerhaft um einen Anteil an (Standard 10 % pro Trap). Der
  Aufschlag bleibt für den Rest des Runs.

Ein Kauf ist eine Transaktion, damit kein Guthaben verloren geht:

1. Buchung auf `EnergyLink{team}`: `add -price`, dann `max 0`.
2. Der Server antwortet mit `original_value` und `value`. Entspricht die Differenz genau dem Preis,
   wird die Location per `client.check(...)` als geprüft gemeldet.
3. Bei Abweichung (ein anderer Client hat gleichzeitig gebucht) wird der Teilbetrag
   zurückgebucht und der Kauf abgebrochen. Es wird nichts abgebucht, wenn das Guthaben
   zwischen Anzeige und Kauf geschrumpft ist.

Erst zahlen, dann checken – so kann kein zweiter Client dieselben Joule ein zweites Mal ausgeben.

## Konsole

Textclient unter dem Store. Befehle:

```
help                                  Hilfe
connect <server> <slot> [passwort]    Verbinden
disconnect                            Trennen
status                                Verbindungs- und Store-Status
balance                               EnergyLink-Guthaben neu lesen
page <n>                              Zu Seite n wechseln
pages                                 Alle Seiten mit Kaufstand
buy [n]                               Location n (oder die nächste) kaufen
locations                             Locations der aktuellen Seite
lang <code>                           Sprache wechseln (de_DE, en_US)
say <text>                            In den AP-Chat schreiben
refresh                               EnergyLink neu abfragen
clear                                 Konsole leeren
```

Filter `all` / `log` / `chat` oben rechts in der Konsole. Fehler erscheinen als `ERROR`, Server-Chat
als `CHAT`. Pfeil hoch/runter blättert durch die Befehls-Historie.

## Sprachen

`lang/de_DE.lang` und `lang/en_US.lang`, Format `key=value`, `#` beginnt einen Kommentar.
Die Auswahl im Kopf der Seite wird in `localStorage` gemerkt. Fehlt ein Schlüssel in der gewählten
Sprache, greift `en_US`. Eine neue Sprache: Datei anlegen und in `js/i18n.js` bei `LANGUAGES`
eintragen.

## Dateien

```
index.html                  Aufbau der Seite
css/style.css               Styles (Dark Theme, responsive)
js/main.js                  UI-Verdrahtung
js/ap.js                    Verbindung, EnergyLink, Kauf-Transaktion, Traps
js/config.js                slot_data -> Store-Konfiguration
js/store.js                 Seiten/Locations-Modell
js/console.js               Konsole mit Befehlen und Log
js/i18n.js, js/util.js      Sprachdateien, Helfer
lang/*.lang                 Texte
assets/vendor/              archipelago.js 2.1.0 (MIT)
apworld/energylink_store/   Die Archipelago-World (Python), build.sh packt sie
examples/player.yaml        YAML-Beispiel
tests/                      Mock-Server, Browser-, Unit- und E2E-Tests
```

## Tests

Zum Ausprobieren und für die Tests werden keine Abhängigkeiten gebraucht: `start.sh` und die Seite
selbst laufen mit einem beliebigen HTTP-Server. Nur die automatisierten Tests brauchen `ws` und
`playwright`:

```bash
npm install                     # einmalig: ws + playwright (+ Browser: npx playwright install chromium)
npm run mock                    # Terminal 1: Mock auf ws://localhost:38281
npm run serve                   # Terminal 2: Seite auf :3000
npm test                        # Terminal 3: Browser-Test
npm run test:edge               # ohne slot_data, Standardwerte, Konsolenbefehle
npm run test:connect            # veralteter Spielnamen-Cache, falscher Slotname
npm run test:file               # Hinweis bei file:// statt leerer Seite
npm run test:protocol           # ws/wss-Fallback der Serveradresse
npm run test:pages              # automatische Seitenwahl und Kategorie-Anzeige
```

Getestet: Verbindung mit Spielnamen-Erkennung, EnergyLink-Anzeige, Kauf mit Abbuchung und
Location-Check, Seiten-Sperre, zu wenig Guthaben, Passwort-Fehler, Sprachwechsel (UI und Konsole),
Konsolenbefehle, Wettlauf beim Kauf (nichts abgebucht), Trennen.

Zusätzlich gegen einen echten Archipelago-Server mit der World:

```bash
npm run test:real       # braucht einen laufenden AP-Server mit der World
npm run test:trapOnBuy  # Trap wirkt beim Kauf (Mock-Server genügt)
npm run test:all        # alle Mock-Suiten, jede gegen einen frischen Mock-Server
npm run test:trapBothWays  # Trap beim eigenen Kauf und beim Eintreffen aus einer fremden Welt
```

Getestet wurde mit Archipelago 0.6.8: Generierung der World, slot_data, Locationnamen, Kauf,
McGuffin-Fortschritt, Steuer- und Inflation-Trap.

Die Tests legen Screenshots unter `tests/` ab; die sind wie `node_modules` nicht eingecheckt.

## Lizenz

Der Client steht unter der MIT-Lizenz, siehe `LICENSE`.

Mitgeliefert in `assets/vendor/`:

- [archipelago.js](https://github.com/ThePhar/archipelago.js) 2.1.0, MIT — Lizenztext in
  `assets/vendor/archipelago.LICENSE`

## Hinweise

- Die EnergyLink-Buchung wirkt auf den gemeinsamen Speicher des Teams, also auch auf Factorio.
- Der Client verbindet mit `items_handling = all`, sonst kämen eigene Items (McGuffins, Traps) nie
  an. Die kurze TextOnly-Probe verbindet dagegen mit `minimal`, weil der Server für TextOnly-Slots
  keine eigenen Items erlaubt.
- Der Client checkt Locations selbst; er spielt das Spiel nicht. Items, die daraus entstehen,
  gehen normal an den Empfänger im Multiworld.
- Der Store ist nur so genau wie der EnergyLink-Stand. Ein anderer Client kann zwischen Anzeige
  und Kauf buchen; dieser Fall wird abgefangen, aber die Anzeige kann kurz veraltet sein.
