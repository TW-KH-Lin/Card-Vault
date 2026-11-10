"""Download the public Pokémon price guide and write the site's EUR trend index."""

import json
import math
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

SOURCE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json"
DESTINATION = Path(__file__).resolve().parents[1] / "visual" / "cardmarket-prices.json"


def trend(value):
    if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
        return value
    return None


def main():
    if len(sys.argv) > 1:
        guide = json.loads(Path(sys.argv[1]).read_bytes())
    else:
        with urllib.request.urlopen(SOURCE, timeout=60) as response:
            guide = json.load(response)
    updated = datetime.strptime(guide["createdAt"], "%Y-%m-%dT%H:%M:%S%z").isoformat()
    prices = {}
    for row in guide["priceGuides"]:
        regular = trend(row.get("trend"))
        reverse = trend(row.get("trend-holo"))
        if regular or reverse:
            prices[row["idProduct"]] = [regular, reverse] if reverse else [regular]
    if len(prices) < 10000:
        raise ValueError("Incomplete Pokémon price guide")
    payload = {"updated": updated, "prices": prices}
    pending = DESTINATION.with_suffix(".tmp")
    pending.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    pending.replace(DESTINATION)
    print(f"{updated}: {len(prices)} Cardmarket products")


if __name__ == "__main__":
    main()
