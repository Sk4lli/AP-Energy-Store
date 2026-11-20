# Energylink Store

Ein Shop-World für Archipelago. Es hat kein eigenes Gameplay: gekauft wird im Browser-Client aus
diesem Repository, der Joule aus dem EnergyLink-Speicher des Teams bezahlt und danach die Location
checkt. Jede gekaufte Location schickt ihr Item an den Empfänger im Multiworld.

## Installieren

`.apworld` bauen und in den `custom_worlds`-Ordner (oder `worlds`) von Archipelago legen:

```bash
cd apworld
./build.sh
cp energylink_store.apworld ~/.local/share/Archipelago/worlds/
```

Bei einer Source-Installation reicht es, den Ordner `energylink_store` nach `Archipelago/worlds/`
zu kopieren.

Danach eine Player-YAML mit `game: Energylink Store` anlegen und normal generieren.
`ArchipelagoServer` mit der Ausgabedatei starten und den Store über `index.html` im Browser öffnen,
mit dem Slotnamen aus der YAML.

## Optionen

| Option                   | Standard  | Bedeutung                                                        |
| ------------------------ | --------- | ---------------------------------------------------------------- |
| `progress_pages`         | 5         | Anzahl der Store-Seiten (1–20)                                   |
| `locations_per_page`     | 5         | Locations pro Seite (5–10), der Client kann denselben Bereich     |
| `base_price`             | 1 000 000 | Preis einer Location auf Seite 1, in Joule                       |
| `price_step`             | 1 000 000 | Aufschlag pro Seite                                              |
| `mcguffins_required`     | 50        | McGuffins bis zum Sieg                                           |
| `filler_joules`          | 0         | reiner Anzeigewert eines Filler-Items                            |
| `trap_percentage`        | 15        | Anteil der Filler-Plätze, die zu Traps werden                    |
| `tax_trap`               | an        | Steuer-Traps erlauben                                            |
| `tax_per_trap`           | 10        | Prozent, die ein Steuer-Trap dauerhaft auf alle Preise legt      |
| `inflation_trap`         | an        | Inflation-Traps erlauben                                         |
| `inflation_per_trap`     | 20        | Prozent des EnergyLink-Speichers, die ein Inflation-Trap verbrennt |
| `team_energylink`        | an        | Team-Schlüssel `EnergyLink<team>` nutzen, denselben wie Factorio  |

Der Preis einer Location ist `base_price + price_step * (Seite - 1)`. Alle Locations einer Seite
kosten gleich viel. Seite N öffnet im Client erst, wenn Seite N-1 ausverkauft ist.

`mcguffins_required` wird auf die Anzahl der angelegten Locations begrenzt, damit der Seed immer
besiegbar ist. Wenn das passiert, steht eine Warnung im Log.

## Items

| Item               | Klasse      | Wirkung                                                     |
| ------------------ | ----------- | ----------------------------------------------------------- |
| `McGuffin`         | progression | `mcguffins_required` Stück sammeln und gewinnen             |
| `Store Filler`     | filler      | nichts                                                      |
| `Tax Trap`         | trap        | alle Preise steigen dauerhaft um `tax_per_trap` Prozent      |
| `Inflation Trap`   | trap        | `inflation_per_trap` Prozent des Speichers werden verbrannt  |

Traps und McGuffins werden **ganz normal** von Archipelago platziert, sie können also überall im
Multiworld liegen. Das ist Absicht: Ein Trap gehört seiner Wirkung nach immer der Store-World, die
ihn erzeugt hat, egal in welcher Location er liegt.

Der Client wendet die Wirkung in beiden Fällen an:

1. **Du kaufst die Location im Store.** Der Client liest die Location per Scouting und löst den Trap
   sofort aus.
2. **Ein anderer Spieler kauft die Location in seiner Welt.** Das Item wird an diese Store-World
   geschickt, und der Client löst den Trap beim Eintreffen aus.

Die Location-ID verhindert dabei Doppelzählung: Ein Trap, der sowohl gekauft als auch empfangen wird,
wirkt genau einmal. Bereits gewirkte Traps werden in `localStorage` gemerkt, damit ein Neuladen der
Seite weder den Speicher erneut verbrennt noch den Steuer-Aufschlag vergisst. Ein Trap muss den Spieler treffen, der die Location gekauft hat,
und das Ziel zählt McGuffins in diesem Slot. Der Client liest die Traps aus den Items, die er
empfängt; ein Trap wirkt also in dem Moment, in dem die Location gekauft wird, die ihn enthält.

## Locations

Die Namen sind `Page <n> Location <m>`, die IDs ergeben sich aus Seite und Platz. Die Tabelle deckt
das Maximum ab (20 Seiten x 10 Locations), weil `location_name_to_id` für alle Spieler im Multiworld
gleich sein muss. Angelegt werden nur die Locations, die die Optionen verlangen.

Der Client baut seine Seiten aus denselben slot_data-Werten (`progress_items`, `locations_per_page`),
deshalb stimmen Seiten- und Platznummern auf beiden Seiten überein.

## slot_data

Das World schickt alles, was der Client braucht:

```json
{
  "progress_items": 5,
  "locations_per_page": 5,
  "base_price": 1000000,
  "price_step": 1000000,
  "mcguffins_required": 50,
  "filler_joules": 0,
  "trap_percentage": 15,
  "tax_per_trap": 0.1,
  "inflation_per_trap": 0.2,
  "use_team_energylink": true,
  "mcguffin_name": "McGuffin",
  "store_version": 2
}
```

## Ziel erreichen

Käufe schicken die Items ins Multiworld, manche davon kommen zurück. Das Spiel ist gewonnen, sobald
`mcguffins_required` McGuffins im eigenen Inventar sind. Der Client zeigt den Stand als
"Ziel" in der Statusleiste. Das Ziel meldet der Client wie jeder andere Client, es ist nichts weiter
nötig.

## Hinweise

- Das World fasst den EnergyLink-Speicher nicht selbst an. Nur der Browser-Client bucht Joule ab,
  damit es genau eine Stelle gibt, die Preise kennt.
- Weil der Client Locations checkt, muss er als echter Slot mit Spielnamen verbinden. Den Spielnamen
  erkennt der Client am Server, die YAML braucht dafür nichts Besonderes.
