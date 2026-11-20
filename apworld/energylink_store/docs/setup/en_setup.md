# Energylink Store Setup Guide

## What you need

- An Archipelago server (0.6.4 or newer) with the `energylink_store.apworld` installed
- A web browser; the client is plain HTML/CSS/JS, no install step

## Generate

1. Build and install the world: `cd apworld && ./build.sh`, then copy
   `energylink_store.apworld` into your Archipelago `worlds` folder.
2. Create a YAML with `game: Energylink Store` and your slot name.
3. Run `ArchipelagoGenerate` and start `ArchipelagoServer` with the generated file.

## Connect

1. Serve the client over HTTP (`python3 -m http.server 3000`) and open `http://localhost:3000`.
2. Enter server address (`host:port`), your slot name and the password if the room has one.
3. The client looks up the game name of the slot on the server and connects with it. That first
   lookup appears as a TextOnly join/part in the room chat; it is normal and only happens once per
   server and slot.

## Buying

The store pays with joules from the team's EnergyLink pool, the same pool Factorio uses. Nothing is
bought while the pool is empty: the buy button stays disabled. Prices rise per page, and traps that
arrive from bought locations change the pool or the prices immediately.
