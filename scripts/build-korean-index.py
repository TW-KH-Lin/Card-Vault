"""Build the Korean card catalogue and fingerprints from PTCG-database/data_ko."""

import io
import json
import sys
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

PHOTO_SETS = {"SV4M"}

output = Path(__file__).resolve().parents[1] / "visual"
cards = {}
for path in sorted(Path(sys.argv[1]).glob("*/*.json")):
    source = json.loads(path.read_text(encoding="utf-8"))
    code = path.parent.name
    number = str(source.get("number") or "")
    card_id = source.get("ko_id")
    if not (card_id and number and source.get("name")):
        continue
    total = source.get("set_total")
    set_info = {"id": code, "name": source.get("set_full_name") or code}
    if (logo := source.get("set_img")) and logo.startswith("https://cards.image.pokemonkorea.co.kr/"):
        set_info["logo"] = logo
    card = {"id": card_id, "localId": number, "name": source["name"], "set": set_info,
            "printedNumber": f"{number}/{total}" if total else number, "localOnly": True}
    image = (source.get("img") or "").replace("/data/wmimages/", "/data/images/")
    if image.startswith(("https://cards.image.pokemonkorea.co.kr/", "https://pokemoncard.co.kr/")):
        card["image"] = image
    cards[card_id] = card

if len(cards) < 10000:
    raise ValueError("Incomplete Korean catalogue")
(output / "ko-cards.json").write_text(json.dumps(list(cards.values()), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def fingerprint(card):
    try:
        data = subprocess.check_output(["curl", "-fsSL", "--max-time", "22", card["image"]], stderr=subprocess.DEVNULL)
        picture = Image.open(io.BytesIO(data))
        return picture.convert("RGB").resize((10, 14), Image.Resampling.BILINEAR).tobytes()
    except (OSError, ValueError, subprocess.CalledProcessError):
        return None


# Prioritize common modern sets for the first photo index.
targets = [card for card in cards.values() if card.get("image") and card["set"]["id"] in PHOTO_SETS]
with ThreadPoolExecutor(max_workers=4) as pool:
    results = [(card["id"], pixels) for card, pixels in zip(targets, pool.map(fingerprint, targets)) if pixels]
if not results:
    raise ValueError(f"Only {len(results)} of {len(targets)} images downloaded")
(output / "ko.json").write_text(json.dumps([card_id for card_id, _ in results], separators=(",", ":")), encoding="utf-8")
(output / "ko.bin").write_bytes(b"".join(pixels for _, pixels in results))
print(f"{len(cards)} cards in catalogue, {len(results)} image fingerprints", flush=True)
