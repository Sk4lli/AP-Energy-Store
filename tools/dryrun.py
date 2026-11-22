#!/usr/bin/env python3
"""Dry-run generation test: generate the Energylink Store many times with random options and check
every result.

Each run
  * writes a random player YAML,
  * generates a multiworld with ArchipelagoGenerate (single slot, the world under test),
  * unpacks the output and checks the archive, the spoiler log and the slot_data.

Checked per seed
  * the generator exits without an error,
  * the playthrough reaches the goal (the seed is beatable),
  * exactly `pages - 1` unlock items exist, none of them for page 1,
  * no "Store Page 1" item exists at all,
  * item count == location count,
  * slot_data carries the options unchanged (and prices in whole joules).

Usage:
    python3 tools/dryrun.py --runs 100
    python3 tools/dryrun.py --runs 20 --seed-base 1000 --keep
"""

from __future__ import annotations

import argparse
import io
import json
import os
import pickle
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
import zlib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_AP = Path("/opt/Archipelago/ArchipelagoGenerate")
GAME = "Energylink Store"

# Spellings the joule parser accepts, with the value it has to produce.
JOULES = {
    "10k": 10_000,
    "250k": 250_000,
    "750k": 750_000,
    "1m": 1_000_000,
    "1,5m": 1_500_000,
    "2m": 2_000_000,
    "2g": 2_000_000_000,
    "1.5e6": 1_500_000,
    "1 500 000": 1_500_000,
    "1t": 1_000_000_000_000,
    "0": 0,
}
# base_price has a lower bound of 10 kJ, so 0 is only valid for the step and the filler value.
PRICES = {key: value for key, value in JOULES.items() if value >= 10_000}


@dataclass
class Options:
    progress_pages: int
    locations_per_page: int
    unlock_mode: str
    base_price: str
    price_step: str
    filler_joules: str
    mcguffins_required: int
    trap_percentage: int
    tax_trap: bool
    tax_per_trap: int
    inflation_trap: bool
    inflation_per_trap: int

    def yaml(self) -> str:
        return f"""name: Tester
game: {GAME}

{GAME}:
  progress_pages: {self.progress_pages}
  locations_per_page: {self.locations_per_page}
  unlock_mode: {self.unlock_mode}
  base_price: "{self.base_price}"
  price_step: "{self.price_step}"
  filler_joules: "{self.filler_joules}"
  mcguffins_required: {self.mcguffins_required}
  trap_percentage: {self.trap_percentage}
  tax_trap: {str(self.tax_trap).lower()}
  tax_per_trap: {self.tax_per_trap}
  inflation_trap: {str(self.inflation_trap).lower()}
  inflation_per_trap: {self.inflation_per_trap}
"""


@dataclass
class Result:
    seed: int
    options: Options
    ok: bool = True
    failures: list[str] = field(default_factory=list)
    seconds: float = 0.0

    def fail(self, reason: str) -> None:
        self.ok = False
        self.failures.append(reason)


class Stub:
    """Stand-in for classes the pickle needs that are not importable here (NetUtils, ...)."""

    def __init__(self, *args, **kwargs):
        self.args = args

    def __setstate__(self, state):
        self.state = state


class StubUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        return type(name, (Stub,), {})


def read_slot_data(archive: Path) -> dict:
    """slot_data of the only slot, from the .archipelago file (zlib + pickle)."""
    raw = archive.read_bytes()
    return StubUnpickler(io.BytesIO(zlib.decompress(raw[1:]))).load()["slot_data"]


def random_options(rng: random.Random) -> Options:
    pages = rng.choice([1, 2, 3, 4, 5, 5, 6, 8, 10, 12, 15, 20])
    per_page = rng.choice([5, 5, 6, 7, 8, 8, 9, 10])
    base = rng.choice(list(PRICES))
    step = rng.choice(list(JOULES))
    # ask for more McGuffins than there are locations now and then: the world has to clamp that
    locations = pages * per_page
    wanted = rng.choice([1, 3, locations // 2 or 1, locations, locations + 10, 500])
    return Options(
        progress_pages=pages,
        locations_per_page=per_page,
        unlock_mode=rng.choice(["page", "page", "progressive"]),
        base_price=base,
        price_step=step,
        filler_joules=rng.choice(["0", "0", "500k", "1m", "2g"]),
        mcguffins_required=max(1, wanted),
        trap_percentage=rng.choice([0, 0, 15, 30, 60, 100]),
        tax_trap=rng.choice([True, False]),
        tax_per_trap=rng.choice([0, 5, 10, 50, 100]),
        inflation_trap=rng.choice([True, False]),
        inflation_per_trap=rng.choice([1, 20, 50, 100]),
    )


def parse_spoiler(text: str) -> dict:
    locations = {}
    for match in re.finditer(r"^(Page (\d+) Location (\d+)): (.+)$", text, re.MULTILINE):
        locations[match.group(1)] = match.group(4)
    playthrough = text.split("Playthrough:", 1)[1] if "Playthrough:" in text else ""
    return {
        "locations": locations,
        "has_victory": "Store Completed: Victory" in playthrough,
        "mode_line": re.search(r"unlock mode (\w+)", text),
        "item_count": len(locations),
    }


def check(result: Result, slot_data: dict, spoiler: dict, archive_exists: bool) -> None:
    options = result.options
    if not archive_exists:
        result.fail("no .archipelago archive in the output")
        return

    expected_locations = options.progress_pages * options.locations_per_page
    if spoiler["item_count"] != expected_locations:
        result.fail(f"locations {spoiler['item_count']} != {expected_locations}")
    if not spoiler["has_victory"]:
        result.fail("goal not reachable in the playthrough")
    if spoiler["mode_line"] and spoiler["mode_line"].group(1) != options.unlock_mode:
        result.fail(f"spoiler mode {spoiler['mode_line'].group(1)} != {options.unlock_mode}")

    # Items of the places that were created, one per location.
    created = {"Page %d Location %d" % (p, s)
               for p in range(1, options.progress_pages + 1)
               for s in range(1, options.locations_per_page + 1)}
    if set(spoiler["locations"]) != created:
        result.fail("location names do not match the configured pages")

    names = list(spoiler["locations"].values())
    unlocks = [name for name in names if name.startswith("Store Page ")]
    if "Store Page 1" in names:
        result.fail("an unlock item for page 1 exists")
    if options.progress_pages == 1:
        if unlocks or "Progressive Store Unlock" in names:
            result.fail("a single page seed has unlock items")
    elif options.unlock_mode == "page":
        want = {f"Store Page {page}" for page in range(2, options.progress_pages + 1)}
        missing = want - set(unlocks)
        if missing:
            result.fail(f"missing unlock items: {sorted(missing)}")
    else:
        copies = names.count("Progressive Store Unlock")
        if copies != options.progress_pages - 1:
            result.fail(f"{copies} progressive unlocks, expected {options.progress_pages - 1}")

    # slot_data must carry the options unchanged.
    data = next(iter(slot_data.values())) if slot_data else {}
    if data.get("progress_items") != options.progress_pages:
        result.fail(f"slot_data progress_items {data.get('progress_items')}")
    if data.get("locations_per_page") != options.locations_per_page:
        result.fail(f"slot_data locations_per_page {data.get('locations_per_page')}")
    if data.get("unlock_mode") != options.unlock_mode:
        result.fail(f"slot_data unlock_mode {data.get('unlock_mode')}")
    if data.get("base_price") != JOULES[options.base_price]:
        result.fail(f"slot_data base_price {data.get('base_price')} != {JOULES[options.base_price]}")
    if data.get("price_step") != JOULES[options.price_step]:
        result.fail(f"slot_data price_step {data.get('price_step')}")
    # The world places the unlock items first and clamps the McGuffins to the locations that are
    # left over.
    unlock_count = 0 if options.progress_pages < 2 else options.progress_pages - 1
    free = expected_locations - unlock_count
    expected_mcguffins = max(1, min(options.mcguffins_required, max(1, free)))
    if data.get("mcguffins_required") != expected_mcguffins:
        result.fail(f"slot_data mcguffins {data.get('mcguffins_required')} != {expected_mcguffins}")


def run_once(generator: Path, workdir: Path, result: Result, seed: int) -> None:
    players = workdir / "players"
    out = workdir / "out"
    shutil.rmtree(players, ignore_errors=True)
    shutil.rmtree(out, ignore_errors=True)
    players.mkdir(parents=True)
    out.mkdir(parents=True)
    (players / f"seed{seed}.yaml").write_text(result.options.yaml(), encoding="utf-8")

    started = time.monotonic()
    try:
        proc = subprocess.run(
            [str(generator), "--player_files_path", str(players), "--outputpath", str(out),
             "--spoiler", "2", "--seed", str(seed)],
            input="\n", capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired:
        result.seconds = time.monotonic() - started
        result.fail("generator timed out")
        return
    result.seconds = time.monotonic() - started

    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
        result.fail("generator failed: " + " | ".join(tail))
        return

    archives = list(out.glob("*.zip"))
    if not archives:
        result.fail("no output zip")
        return
    with zipfile.ZipFile(archives[0]) as bundle:
        names = bundle.namelist()
        spoiler_name = next((n for n in names if n.endswith("_Spoiler.txt")), None)
        archive_name = next((n for n in names if n.endswith(".archipelago")), None)
        if spoiler_name is None or archive_name is None:
            result.fail(f"output missing files: {names}")
            return
        spoiler_text = bundle.read(spoiler_name).decode("utf-8-sig")
        (workdir / "archive.archipelago").write_bytes(bundle.read(archive_name))

    try:
        slot_data = read_slot_data(workdir / "archive.archipelago")
    except Exception as error:  # noqa: BLE001 - any decode problem is a failed check
        result.fail(f"slot_data unreadable: {error}")
        return

    if opts_keep:
        shutil.copy(workdir / "archive.archipelago", workdir / f"seed{seed}.archipelago")
    check(result, slot_data, parse_spoiler(spoiler_text), archive_exists=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runs", type=int, default=100)
    parser.add_argument("--seed-base", type=int, default=1)
    parser.add_argument("--generator", type=Path, default=DEFAULT_AP)
    parser.add_argument("--keep", action="store_true", help="keep the used YAMLs and archives")
    parser.add_argument("--report", type=Path, default=None, help="write a JSON report here")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    if not args.generator.exists():
        print(f"generator not found: {args.generator}", file=sys.stderr)
        return 2

    global opts_keep
    opts_keep = args.keep

    rng = random.Random(args.seed_base)
    base = Path(tempfile.mkdtemp(prefix="ap-dryrun-"))
    results: list[Result] = []
    started = time.monotonic()

    for index in range(args.runs):
        seed = args.seed_base + index
        options = random_options(rng)
        result = Result(seed=seed, options=options)
        workdir = base / f"run{seed}"
        workdir.mkdir(parents=True)
        run_once(args.generator, workdir, result, seed)
        results.append(result)
        if not args.keep:
            shutil.rmtree(workdir, ignore_errors=True)
        if not args.quiet:
            status = "ok  " if result.ok else "FAIL"
            extra = "" if result.ok else "  <- " + "; ".join(result.failures)
            print(f"[{index + 1:3}/{args.runs}] seed {seed:5} {status} "
                  f"{result.options.progress_pages:2}p x {result.options.locations_per_page:2} "
                  f"{result.options.unlock_mode:11} {result.seconds:5.1f}s{extra}", flush=True)

    total = time.monotonic() - started
    failed = [r for r in results if not r.ok]
    print()
    print(f"runs        {len(results)}")
    print(f"passed      {len(results) - len(failed)}")
    print(f"failed      {len(failed)}")
    print(f"total time  {total:.0f}s  ({total / max(1, len(results)):.1f}s per run)")
    if failed:
        print("\nfailures:")
        for result in failed:
            print(f"  seed {result.seed}: {'; '.join(result.failures)}")
            print(f"    options: {json.dumps(result.options.__dict__)}")
            print(f"    yaml dir: {base}")

    if args.report:
        args.report.write_text(json.dumps({
            "runs": len(results),
            "failed": len(failed),
            "seconds": round(total, 1),
            "cases": [{
                "seed": r.seed,
                "ok": r.ok,
                "failures": r.failures,
                "seconds": round(r.seconds, 2),
                "options": r.options.__dict__,
            } for r in results],
        }, indent=2) + "\n", encoding="utf-8")

    print(f"\nworkdir {base}")
    if not args.keep and not failed:
        shutil.rmtree(base, ignore_errors=True)
    return 0 if not failed else 1


opts_keep = False

if __name__ == "__main__":
    sys.exit(main())
