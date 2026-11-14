"""Match Gem Pack printings against verified Cardmarket expansion IDs."""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "visual"
EXPANSIONS = [6001, 6111, 6292, 6447, 6544, 6669]


def name_key(name):
    return re.sub(r"[^a-z0-9]", "", name.lower().removeprefix("basic "))


products = json.loads(Path(sys.argv[1]).read_text())["products"]
cards = json.loads((ROOT / "zh-cn-cards.json").read_text())
matches = {}
for volume, expansion in enumerate(EXPANSIONS, 1):
    set_id = f"CBB{volume}C"
    local = sorted((card for card in cards if card["set"]["id"] == set_id), key=lambda card: card["localId"])
    market = sorted((row for row in products if row["idExpansion"] == expansion and row["idCategory"] == 51),
                    key=lambda row: row["idProduct"])
    if len(local) != len(market):
        raise ValueError(f"{set_id} counts disagree")
    if volume <= 5:
        # These releases were entered in collector-number order.
        pairs = zip(local, market)
    else:
        # Volume 6 includes a product created before the rest of its set.
        groups = defaultdict(list)
        for row in market:
            groups[name_key(row["name"].split(" [")[0])].append(row)
        local_groups = defaultdict(list)
        for card in local:
            local_groups[name_key(card["nameEn"])].append(card)
        pairs = [(card, row) for name, group in local_groups.items()
                 if len(group) == len(groups[name]) and
                 groups[name][-1]["idProduct"] - groups[name][0]["idProduct"] == len(group) - 1
                 for card, row in zip(group, groups[name])]
    for card, row in pairs:
        name = card["nameEn"]
        if card["name"].replace(" ", "") == "船长皮卡丘":
            name = "Captain Pikachu"
        if name and name_key(name) == name_key(row["name"].split(" [")[0]):
            matches[card["id"]] = row["idProduct"]
(ROOT / "cardmarket-gem-matches.json").write_text(json.dumps(matches, separators=(",", ":")) + "\n")
print(f"Matched {len(matches)} Gem Pack printings")
