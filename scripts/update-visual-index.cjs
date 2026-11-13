const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const directory = path.join(__dirname, "../visual");
const size = 420;
const japaneseSource = "https://japanesepokecards.com";
const promoCodes = {
  "mega-evolution": "M-P", "scarlet-and-violet": "SV-P", "sword-and-shield": "S-P",
  "sun-and-moon": "SM-P", xy: "XY-P", "black-and-white": "BW-P", legend: "L-P",
  platinum: "Pt-P", "diamond-and-pearl": "DP-P", play: "PLAY", pcg: "PCG-P",
  adv: "ADV-P", ppp: "PPP", t: "T", j: "J", p: "P"
};

async function download(url, format) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response[format]();
}

function decode(text) {
  return text.replace(/&(?:amp|quot|lt|gt|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'" };
    const key = entity.slice(1, -1);
    return key[0] === "#" ? String.fromCodePoint(Number(key.replace(/^#x/i, "0x").replace(/^#/, ""))) : named[key];
  });
}

async function japaneseSets(references) {
  const inventory = await download(japaneseSource + "/sets/", "text");
  const sets = [...inventory.matchAll(/href="(\/sets\/([^"]+)-japanese-card-list\/)"[^>]*>.*?<span class="hw"><b>([^<]+)<\/b>(?:<i>\([^<]+\)<\/i>)?<small>(\d{4}) · (\d+) cards?<\/small>/g)];
  if (sets.length < 100) throw new Error("Japanese set inventory missing or incomplete");
  const byImage = new Set(references.map(card => card.image));
  const bySetNumber = new Set(references.filter(card => card.printedNumber)
    .map(card => card.set?.id + "/" + card.printedNumber));
  const additions = [];
  for (const [, url, slug, title, year, count] of sets) {
    const page = await download(japaneseSource + url, "text").catch(error => {
      console.warn(error.message);
      return "";
    });
    const rows = [...page.matchAll(/<tr data-pic="([^"]+)" data-set="[^"]*" data-r="([^"]*)"[^>]*><td>([^<]*)<\/td><td>([^<]*)<\/td>/g)];
    if (rows.length < Number(count) * .85) {
      console.warn(slug + ": incomplete set, will retry");
      continue;
    }
    const knownSet = references.find(card => card.image?.startsWith("https://img.japanesepokecards.com/") &&
      new URL(card.image).pathname.split("/").includes(slug));
    const set = knownSet?.set || { id: "jp-" + slug, name: year + " " + decode(title) };
    for (const [, rawImage, rarity, rawNumber, rawName] of rows) {
      const image = decode(rawImage);
      if (!image.startsWith("https://img.japanesepokecards.com/") || byImage.has(image)) continue;
      const number = decode(rawNumber).trim();
      const printed = /^(\d+)(?:\/([\w+-]+))?$/.exec(number);
      const suffix = printed?.[2] || promoCodes[slug.replace(/-promos$/, "")];
      const localId = printed?.[1].padStart(3, "0");
      const printedNumber = localId && suffix ? localId + "/" + suffix : number;
      const key = set.id + "/" + printedNumber;
      if (printed && bySetNumber.has(key)) continue;
      const filename = new URL(image).pathname.split("/").pop().replace(/\.[^.]+$/, "");
      const name = decode(rawName).trim();
      if (!filename || !name) continue;
      additions.push({
        id: "jp-source-" + slug + "-" + filename,
        localId: localId || filename,
        name, nameEn: name, set, image, localOnly: true,
        ...(printed ? { printedNumber } : { unnumbered: true }),
        ...(/Holo/i.test(rarity) ? { variants: { holo: true } } : {})
      });
      byImage.add(image);
    }
  }
  return additions;
}

async function update(language) {
  const idsFile = path.join(directory, language + ".json");
  const binFile = path.join(directory, language + ".bin");
  const referenceFile = path.join(directory, "ja-vintage.json");
  const ids = JSON.parse(await fs.readFile(idsFile, "utf8"));
  const existing = await fs.readFile(binFile);
  if (existing.length !== ids.length * size) throw new Error("Invalid " + language + " index");
  const indexed = new Set(ids);
  const references = language === "ja" ? JSON.parse(await fs.readFile(referenceFile, "utf8")) : [];
  const catalogue = await download("https://api.tcgdex.net/v2/" + language + "/cards", "json");
  if (!Array.isArray(catalogue) || !catalogue.length) throw new Error("Empty " + language + " catalogue");
  const byId = new Map(catalogue.filter(card => card.image?.startsWith("https://assets.tcgdex.net/") &&
    !card.image.includes("/tcgp/")).map(card => [card.id, { ...card, image: card.image + "/low.webp" }]));
  const allReferences = new Set(references.map(card => card.id));
  if (language === "ja") {
    const supplement = await japaneseSets(references).catch(error => {
      console.warn(error.message);
      return [];
    });
    for (const card of supplement) if (!byId.has(card.id)) byId.set(card.id, card);
  }
  const pending = [...byId.values()].filter(card => !indexed.has(card.id) && !allReferences.has(card.id));
  const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < pending.length) {
      const card = pending[cursor++];
      try {
        const data = await download(card.image, "arrayBuffer");
        const signature = await sharp(Buffer.from(data)).flatten({ background: "#888" })
          .resize(10, 14, { fit: "fill", kernel: "linear" })
          .removeAlpha().toColourspace("srgb").raw().toBuffer();
        if (signature.length !== size) throw new Error("Invalid fingerprint");
        results.push({ card, signature });
      } catch (error) {
        console.warn(card.id + ": " + error.message);
      }
    }
  }));
  results.sort((a, b) => a.card.id.localeCompare(b.card.id, "en"));
  if (results.length) {
    const newReferences = results.map(item => item.card).filter(card => card.localOnly);
    if (newReferences.length) await fs.writeFile(referenceFile, JSON.stringify([...references, ...newReferences]));
    await fs.writeFile(idsFile, JSON.stringify([...ids, ...results.map(item => item.card.id)]));
    await fs.writeFile(binFile, Buffer.concat([existing, ...results.map(item => item.signature)]));
  }
  console.log(language + ": " + results.length + " indexed, " + (pending.length - results.length) + " will retry");
}

(async () => {
  for (const language of ["ja", "de", "zh-tw", "en"]) await update(language);
})().catch(error => { console.error(error); process.exitCode = 1; });
