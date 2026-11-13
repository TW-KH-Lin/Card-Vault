"""Package the public Cardmarket Pokémon singles catalogue for browser search."""

import json
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json"


def main():
    destination = Path(sys.argv[1])
    with urllib.request.urlopen(SOURCE, timeout=90) as response:
        catalogue = json.load(response)
    products = [
        [row["idProduct"], row["name"], row["idExpansion"]]
        for row in catalogue["products"]
        if row["idCategory"] == 51
    ]
    if len(products) < 10000:
        raise ValueError("Incomplete Pokémon singles catalogue")
    destination.write_text(json.dumps(products, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Staged {len(products)} products")


if __name__ == "__main__":
    main()
