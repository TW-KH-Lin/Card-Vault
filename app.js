"use strict";

const $ = id => document.getElementById(id);
const status = message => { $("status").textContent = message; };
function scanStatus(message) {
  status(message);
  $("scan-progress").textContent = message;
  $("scan-progress").hidden = false;
}
const storageKey = "card-vault-collection-v1";
const tcgdex = "https://api.tcgdex.net/v2";
const cryst = "https://tcg.mik.moe/api/v3/card";
const ocrLanguages = { de: "deu", fr: "fra", es: "spa", it: "ita", pt: "por", en: "eng", ja: "jpn", "zh-cn": "chi_sim", "zh-tw": "chi_tra" };
const nameExamples = { de: "Glurak", ja: "ピカチュウ", "zh-cn": "皮卡丘", "zh-tw": "皮卡丘" };
const variants = { normal: t("Standard"), holo: t("Holo"), reverse: t("Reverse holo"), firstEdition: t("First edition"), firstEditionHolo: t("First edition holo"), unlimited: t("Unlimited"), unlimitedHolo: t("Unlimited holo"), noRarity: t("No rarity mark"), lenticular: t("Lenticular") };
const marketKeys = { normal: ["normal"], holo: ["holofoil", "holo"], reverse: ["reverse-holofoil", "reverse"], firstEdition: ["1st-edition"], firstEditionHolo: ["1st-edition-holofoil"], unlimited: ["unlimited"], unlimitedHolo: ["unlimited-holofoil"] };
const tcgVariant = (pricing, variant) => marketKeys[variant]?.map(key => pricing?.[key]).find(Boolean);
let stream, photoUrl, ocrLibrary, collection = [], active = 0, cameraRequest = 0;
const catalogues = new Map();
const cardDetails = new Map();
const referenceImages = new Set(Object.values(cardReferences).flat().map(card => card.image));
let vintageReferences;
const profileKey = "card-vault-profiles-v1";
function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const profiles = readLocal(profileKey, [{ id: "default", name: "My collection" }]);
let currentProfile = profiles.find(profile => profile.id === readLocal(profileKey + "-active", "default")) || profiles[0];
const profileLabel = profile => profile.id === "default" && profile.name === "My collection"
  ? t("My collection") : profile.name;
const profileStorage = profile => profile.id === "default" ? storageKey : storageKey + "-" + profile.id;
collection = readLocal(profileStorage(currentProfile), []);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function image(card, quality = "low") {
  if (!card.image) return null;
  const tcgdexImage = card.image.startsWith("https://assets.tcgdex.net/");
  const vintageImage = card.image.startsWith("https://img.japanesepokecards.com/") ||
    card.image.startsWith("https://vintagecardorigins.com/img/");
  const correctedFront = /^visual\/fronts\/[A-Za-z0-9-]+\.webp$/.test(card.image);
  const deckImage = /^https:\/\/pokecardex-scans\.b-cdn\.net\/sets_jp\/(?:PESD|MCMP|MCVS5)\/\d+\.jpg$/.test(card.image);
  if (!tcgdexImage && !vintageImage && !correctedFront && !deckImage && !referenceImages.has(card.image) && !card.image.startsWith("https://tcg.mik.moe/static/img/")) return null;
  const img = element("img");
  img.src = tcgdexImage ? card.image + "/" + quality + ".webp" : card.image;
  img.alt = card.name;
  img.loading = "lazy";
  return img;
}

async function api(language, path) {
  const response = await fetch(tcgdex + "/" + language + path, { signal: AbortSignal.timeout(14000) });
  if (!response.ok) throw new Error("Catalogue request failed");
  return response.json();
}

function mergeReferences(cards, references) {
  if (!references.length) return cards;
  const byId = new Map(cards.map(card => [card.id, card]));
  for (const card of references) byId.set(card.id, { ...byId.get(card.id), ...card });
  return [...byId.values()];
}

async function referencesFor(language) {
  const references = cardReferences[language] || [];
  if (language !== "ja") return references;
  vintageReferences ??= fetch("visual/ja-vintage.json", { cache: "no-cache", signal: AbortSignal.timeout(12000) }).then(response => {
    if (!response.ok) throw new Error("Vintage catalogue unavailable");
    return response.json();
  });
  try {
    return [...references, ...await vintageReferences];
  } catch {
    vintageReferences = null;
    return references;
  }
}

function catalogue(language) {
  if (!catalogues.has(language)) {
    const request = language === "zh-cn"
      ? fetch("visual/zh-cn-cards.json?v=3", { signal: AbortSignal.timeout(12000) }).then(response => {
        if (!response.ok) throw new Error("Image catalogue unavailable");
        return response.json();
      })
      : Promise.all([api(language, "/cards"), referencesFor(language)]).then(([cards, references]) => mergeReferences(cards, references));
    catalogues.set(language, request);
    request.catch(() => catalogues.delete(language));
  }
  return catalogues.get(language);
}

async function crystRequest(endpoint, body) {
  const response = await fetch(cryst + "/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(14000)
  });
  if (!response.ok) throw new Error("Simplified Chinese catalogue request failed");
  const result = await response.json();
  if (result.code !== 200 || !result.data) throw new Error("Simplified Chinese card unavailable");
  return result.data;
}

function crystCard(card) {
  return {
    id: card.setCode + "-" + card.cardIndex,
    localId: card.cardIndex,
    name: card.cardName || card.name,
    nameEn: card.nameEn,
    image: "https://tcg.mik.moe/static/img/" + encodeURIComponent(card.setCode) + "/" + encodeURIComponent(card.cardIndex) + ".png",
    set: { id: card.setCode, name: card.setCode, cardCount: { official: Number(card.setCardsNum) || undefined } },
    rarity: card.rarity
  };
}

async function findCard(language, id) {
  if (language !== "zh-cn") {
    const reference = (await referencesFor(language)).find(card => card.id === id);
    if (reference?.localOnly) return reference;
    const card = await api(language, "/cards/" + encodeURIComponent(id)).catch(error => {
      if (!reference) throw error;
      return {};
    });
    return reference ? { ...card, ...reference, set: card.set || reference.set } : card;
  }
  const local = (await catalogue(language).catch(() => [])).find(card => card.id === id && card.localOnly);
  if (local) return local;
  const separator = id.lastIndexOf("-");
  const card = await crystRequest("card-detail", { setCode: id.slice(0, separator), cardIndex: id.slice(separator + 1) });
  return crystCard(card);
}

function getCard(language, id) {
  const key = language + "/" + id;
  const cached = cardDetails.get(key);
  if (cached?.expires > Date.now()) return cached.request;
  const entry = { expires: Date.now() + 300000, request: findCard(language, id) };
  cardDetails.set(key, entry);
  entry.request.catch(() => {
    if (cardDetails.get(key) === entry) cardDetails.delete(key);
  });
  return entry.request;
}

function normalizedNumber(value) {
  return String(value).normalize("NFKC").trim().toUpperCase().replace(/^(\D*)0+(?=\d)/, "$1");
}

async function findCards(language, name, number) {
  if (language === "zh-cn") {
    const needle = clean(name);
    const local = (await catalogue(language).catch(() => [])).filter(card => card.localOnly &&
      [card.name, card.nameEn].some(value => clean(value || "").includes(needle)));
    const body = { searchText: name, exact: false, unique: false, page: 1, pageSize: 100 };
    const result = await crystRequest("card-basic-search", body).catch(error => {
      if (!local.length) throw error;
      return { list: [], pageNum: 0 };
    });
    let cards = result.list.map(crystCard);
    while (number && !cards.some(card => matchNumber(card, number)) && body.page < result.pageNum) {
      const next = await crystRequest("card-basic-search", { ...body, page: ++body.page });
      cards = cards.concat(next.list.map(crystCard));
    }
    return mergeReferences(cards, local);
  }
  const query = new URLSearchParams({ name: name.replace(/[|:]/g, " "), "pagination:itemsPerPage": "100" });
  const needle = clean(name);
  const references = (await referencesFor(language)).filter(card =>
    needle && [card.name, card.nameEn].some(value => clean(value || "").includes(needle)));
  const cards = await api(language, "/cards?" + query).catch(error => {
    if (!references.length) throw error;
    return [];
  });
  return mergeReferences(cards, references);
}

function matchNumber(card, number) {
  const localId = normalizedNumber(number);
  return normalizedNumber(card.localId) === localId ||
    (card.printedNumber && normalizedNumber(card.printedNumber.split("/")[0]) === localId);
}

function promoSeries(code) {
  return /^(?:[A-Z]{1,4}-P|P|J|T|PLAY)$/i.test(code || "");
}

function matchesPromoSeries(card, code) {
  return card.printedNumber?.split("/")[1]?.toUpperCase() === code.toUpperCase();
}

function matchTotal(card, total, set = card.set) {
  return Number(card.printedNumber?.split("/")[1] || set?.cardCount?.official) === Number(total);
}

function cardNumberLabel(card) {
  if (card.printedNumber) return "#" + card.printedNumber;
  if (card.pokedexNumber) return t("Pokédex No. {number}", { number: card.pokedexNumber });
  if (card.unnumbered) return t("Unnumbered");
  const total = card.set?.cardCount?.official;
  return "#" + card.localId + (total ? "/" + total : "");
}

const japaneseSetCode = /^(?:XY|EBB|SC|CP[1-6]|sm2\+|(?:BW|XY|SM|SV|S|M)(?:\d[\w.+]*|-[Pp]|[A-Z]{1,3}))$/;

function cardSetId(card) {
  return card.set?.id || card.setId || card.id.slice(0, -(String(card.localId).length + 1));
}

function cardSetLabel(card) {
  const setId = cardSetId(card);
  const setName = typeof card.set === "string" ? card.set : card.set?.name;
  if (!setName) return setId || t("Unknown");
  return japaneseSetCode.test(setId) ? setName + " · " + setId : setName;
}

async function showMatches(cards, language, message) {
  clearSummaries($("results"));
  $("results").replaceChildren();
  $("detail").replaceChildren();
  status(message);
  const needsReference = ["de", "es", "fr", "it", "pt"].includes(language) && cards.some(card => !card.image);
  const missing = [];
  for (const card of cards) {
    const tile = element("div", "", "match-tile");
    const link = summaryMarketLink();
    const button = element("button", "", "match");
    const artwork = element("span", "", "artwork");
    const img = image(card);
    const unavailable = () => artwork.replaceChildren(element("small", t("Image unavailable")));
    if (img) {
      img.addEventListener("error", unavailable, { once: true });
      artwork.append(img);
    } else {
      unavailable();
      if (needsReference) missing.push({ card, artwork, button });
    }
    button.append(artwork, element("strong", card.name), cardFacts(card, language, undefined, link));
    if (card.visualMatch) button.append(element("span", t("IMAGE MATCH"), "match-method"));
    button.addEventListener("click", () => showCard(card.id, language, undefined, true));
    tile.append(button, link);
    $("results").append(tile);
  }
  if (!missing.length) return;
  const reference = await catalogue("en").catch(() => []);
  const images = new Map(reference.map(card => [card.id, card.image]));
  for (const { card, artwork, button } of missing) {
    if (!artwork.isConnected) continue;
    const img = image({ ...card, image: images.get(card.id) });
    if (!img) continue;
    img.alt = t("English reference image");
    img.addEventListener("error", () => artwork.replaceChildren(element("small", t("Image unavailable"))), { once: true });
    artwork.replaceChildren(img);
    button.append(element("small", t("English reference")));
  }
}

function updateCardLanguageHelp() {
  const language = $("language").value;
  $("name").placeholder = t("e.g. {example}", { example: nameExamples[language] || "Charizard" });
  $("number").placeholder = t("e.g. {example}", { example: language === "zh-cn" ? "CBB4C 1405/07" : language === "ja" ? "SV2a 025/165" : "4/102" });
  $("language-help").textContent = language === "zh-cn"
    ? t("Artwork search covers selected sets. Other cards use printed details. Prices open in PikaQian.")
    : t("Used for photo scans and searches.");
}

const savedCardLanguage = readLocal("card-vault-card-language", "ja");
if (Object.hasOwn(ocrLanguages, savedCardLanguage)) $("language").value = savedCardLanguage;
updateCardLanguageHelp();

$("language").addEventListener("change", () => {
  ++active;
  $("scan-progress").hidden = true;
  try { localStorage.setItem("card-vault-card-language", JSON.stringify($("language").value)); } catch {}
  updateCardLanguageHelp();
  showMatches([], $("language").value, t("Scan a photo or search by name in the selected language."));
});

$("search").addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("name").value.normalize("NFKC").trim();
  const language = $("language").value;
  const input = $("number").value.normalize("NFKC").trim().toUpperCase();
  const [number, total] = input.split(/\s*\/\s*/);
  const setAndNumber = language === "zh-cn" && input.match(/^([A-Z][A-Z0-9.]*[A-Z])(?:[\s:#-]*)(\d(?:[ \t]*\d){0,3})(?:\s*\/\s*(\d+))?$/) ||
    (language === "zh-cn" && number.match(/^([A-Z0-9.-]+)\s+([A-Z0-9]+)$/));
  if (!name && !number) {
    status(language === "zh-cn"
      ? t("Enter the printed set code and number together, a card name, or scan a photo.")
      : t("Enter a name or collector number, or scan a photo."));
    return;
  }
  const request = ++active;
  $("scan-progress").hidden = true;
  showMatches([], language, t("Searching the card catalogue…"));
  try {
    let cards;
    if (setAndNumber) {
      const [, setCode, printedId, denominator] = setAndNumber;
      const localId = printedId.replace(/\s/g, "");
      const local = await catalogue(language).catch(() => []);
      cards = local.filter(card => cardSetId(card).toUpperCase() === setCode && matchNumber(card, localId));
      if (!cards.length && !/^CBB[1-7]C$/.test(setCode)) cards = [await findCard(language, setCode + "-" + localId)];
      if (denominator) cards = cards.filter(card => !card.printedNumber || matchTotal(card, denominator));
    } else if (language === "zh-cn" && !name) {
      cards = (await catalogue(language)).filter(card => matchNumber(card, number.replace(/\s/g, "")) &&
        (!total || matchTotal(card, total)));
    } else {
      const japaneseNumber = language === "ja" && number.match(/^([A-Z0-9.+-]+)[\s-]+(\d+[A-Z]?)$/i);
      cards = name ? await findCards(language, name, japaneseNumber?.[2] || number) : await catalogue(language);
      if (japaneseNumber) {
        const [, setCode, localId] = japaneseNumber;
        cards = cards.filter(card => (cardSetId(card).toUpperCase() === setCode.toUpperCase() ||
          (promoSeries(setCode) && matchesPromoSeries(card, setCode))) &&
          matchNumber(card, localId) && (!total || !card.printedNumber || matchTotal(card, total)));
      } else if (number) cards = cards.filter(card => matchNumber(card, number) ||
        (!total && card.pokedexNumber && normalizedNumber(card.pokedexNumber) === normalizedNumber(number.replace(/^No\.?\s*/i, ""))));
    }
    if (language === "ja" && promoSeries(total)) {
      cards = cards.filter(card => matchesPromoSeries(card, total));
    } else if (total && cards.length > 1 && language !== "zh-cn") {
      const sets = await api(language, "/sets").catch(() => []);
      const byId = new Map(sets.map(set => [set.id, set]));
      cards = cards.map(card => ({ ...card, set: card.set || byId.get(card.id.slice(0, -(String(card.localId).length + 1))) }));
      cards.sort((a, b) => Number(matchTotal(b, total)) - Number(matchTotal(a, total)));
    }
    if (request === active) showMatches(cards, language, cards.length ? t("Choose the matching printing to see market prices.") : t("No matches. Check the spelling or try leaving the collector number blank."));
  } catch {
    if (request === active) status(t("The card catalogue is unavailable. Try again in a moment."));
  }
});

function stopCamera() {
  ++cameraRequest;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  $("video").srcObject = null;
  $("video").hidden = $("guide").hidden = $("capture").hidden = $("stop").hidden = true;
  $("camera").hidden = $("camera").disabled = false;
  $("placeholder").hidden = Boolean(photoUrl);
  $("photo").hidden = !photoUrl;
}

$("native-camera").addEventListener("click", () => {
  stopCamera();
  $("native").click();
});

$("camera").addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    scanStatus(t("Live camera unavailable. Try Phone camera or Upload photo."));
    return;
  }
  const request = ++cameraRequest;
  $("camera").disabled = true;
  $("stop").hidden = false;
  scanStatus(t("Opening camera…"));
  const timeout = setTimeout(() => {
    if (request !== cameraRequest) return;
    stopCamera();
    scanStatus(t("Live camera unavailable. Try Phone camera or Upload photo."));
  }, 8000);
  try {
    const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    if (request !== cameraRequest) {
      opened.getTracks().forEach(track => track.stop());
      return;
    }
    stream = opened;
    $("video").srcObject = stream;
    $("video").hidden = false;
    await $("video").play();
    if (request !== cameraRequest) return;
    $("capture").hidden = $("stop").hidden = false;
    $("guide").hidden = $("group-photo").checked;
    $("camera").hidden = $("placeholder").hidden = $("photo").hidden = true;
    scanStatus(t("Align the full front of the card inside the guide, then take a photo."));
  } catch {
    if (request === cameraRequest) {
      stopCamera();
      scanStatus(t("Live camera unavailable. Try Phone camera or Upload photo."));
    }
  } finally {
    clearTimeout(timeout);
    if (request === cameraRequest) $("camera").disabled = false;
  }
});

$("group-photo").addEventListener("change", () => {
  if (stream) $("guide").hidden = $("group-photo").checked;
  $("viewfinder").classList.toggle("group-viewfinder", $("group-photo").checked);
});
$("stop").addEventListener("click", () => {
  stopCamera();
  $("scan-progress").hidden = true;
});
const scanPanel = $("scan-title").closest("details");
const lookupPanel = $("lookup-title").closest("details");
scanPanel.addEventListener("toggle", () => {
  if (!scanPanel.open && (stream || $("camera").disabled)) stopCamera();
});
window.addEventListener("pagehide", stopCamera);
$("capture").addEventListener("click", () => {
  const video = $("video");
  if (!video.videoWidth) return;
  const view = video.getBoundingClientRect();
  const guide = $("guide").getBoundingClientRect();
  const zoom = Math.max(view.width / video.videoWidth, view.height / video.videoHeight);
  const sourceWidth = $("group-photo").checked ? video.videoWidth : guide.width / zoom;
  const sourceHeight = $("group-photo").checked ? video.videoHeight : guide.height / zoom;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth);
  canvas.height = Math.round(sourceHeight);
  const sourceX = (video.videoWidth - sourceWidth) / 2;
  const sourceY = (video.videoHeight - sourceHeight) / 2;
  canvas.getContext("2d").drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  stopCamera();
  canvas.toBlob(blob => { if (blob) scan(blob); }, "image/jpeg", .94);
});

for (const id of ["upload", "native"]) {
  $(id).addEventListener("change", event => {
    const [file] = event.target.files;
    event.target.value = "";
    if (file) scan(file);
  });
}

function loadOCR() {
  ocrLibrary ??= new Promise((resolve, reject) => {
    const script = element("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => { script.remove(); ocrLibrary = null; reject(new Error("OCR unavailable")); };
    document.head.append(script);
  });
  return ocrLibrary;
}

function clean(text) {
  return text.normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function setCodes(text) {
  return text.toUpperCase().match(/[A-Z0-9]+(?:[.-][A-Z0-9]+)*/g) || [];
}

function readMatches(cards, text, printedNumbers) {
  const lines = text.split("\n").filter(Boolean).map(clean);
  const header = lines.slice(0, 5);
  const compactLines = lines.map(line => line.replaceAll(" ", ""));
  const tokens = new Set(setCodes(text));
  return cards.flatMap(card => {
    const name = clean(card.name);
    if (!name) return [];
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name);
    const compactName = name.replaceAll(" ", "");
    const pattern = cjk ? null : new RegExp("(?:^| )" + name + "(?: |$)");
    const hasName = (value, index) => cjk ? compactLines[index].includes(compactName) : pattern.test(value);
    const line = header.findIndex(hasName);
    const exactPromo = printedNumbers.some(([, number, code]) =>
      promoSeries(code) && matchesPromoSeries(card, code) && matchNumber(card, number));
    if (exactPromo) return [{ card, score: 450 }];
    const exactNumber = printedNumbers.some(([, number, total]) => !promoSeries(total) && matchNumber(card, number));
    if (line < 0 && !(exactNumber && lines.some(hasName))) return [];
    const setCode = card.id.slice(0, -(String(card.localId).length + 1)).toUpperCase();
    const exactSet = cjk && exactNumber && tokens.has(setCode);
    return [{ card, score: 100 + (exactNumber ? 180 : 0) + (exactSet ? 130 : 0) + name.length * 2 - (line < 0 ? 30 : line * 8) }];
  }).sort((a, b) => b.score - a.score);
}

async function readSimplifiedChinese(text, numbers, cards) {
  const codes = [...new Set(setCodes(text))].filter(code => /^(?:C(?:S|B)[A-Z0-9.]+|151C|30TH[A-Z]*C|(?:SM|SV|S|M)-?P)$/.test(code));
  const gemMatches = cards.filter(card => /^CBB[1-7]C$/.test(card.set?.id) &&
    codes.includes(card.set.id) && numbers.some(([, number, total]) => matchNumber(card, number) && matchTotal(card, total)));
  if (gemMatches.length === 1) return [{ card: gemMatches[0], score: 420 }];

  if (codes.length === 1 && numbers.length === 1) {
    try {
      const card = await findCard("zh-cn", codes[0] + "-" + numbers[0][1]);
      return [{ card, score: 1 }];
    } catch {
      // OCR can misread the set code. Fall back to searching by the name.
    }
  }
  const names = text.split("\n").slice(0, 8)
    .map(line => line.replace(/\s+/g, "").replace(/^基础/, "").match(/^\p{Script=Han}{2,12}/u)?.[0])
    .filter(Boolean);
  for (const name of [...new Set(names)].slice(0, 2)) {
    const cards = await findCards("zh-cn", name);
    const matches = readMatches(cards, text, numbers);
    if (matches.length) return matches;
  }
  return [];
}

async function readPrintedDetails(canvas, language, cards) {
  const tesseract = await loadOCR();
  const worker = await tesseract.createWorker(ocrLanguages[language], 1);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(canvas);
    let text = data.text.normalize("NFKC");
    if (language === "zh-cn" && canvas.width / canvas.height < .82) {
      const footer = document.createElement("canvas");
      const height = Math.round(canvas.height * .14);
      const width = Math.round(canvas.width * .55);
      footer.width = 700;
      footer.height = Math.round(700 * height / width);
      footer.getContext("2d").drawImage(canvas, 0, canvas.height - height, width, height, 0, 0, footer.width, footer.height);
      const footerText = (await worker.recognize(footer)).data.text.normalize("NFKC");
      text += "\n" + footerText;
    }
    const numberText = language === "zh-cn" && /\bCBB[1-7]C\b/i.test(text)
      ? text.replace(/\b(\d{2})[^\S\r\n]+(\d{2})(?=\s*\/\s*\d{2}\b)/g, "$1$2")
      : text;
    const numbers = [...numberText.matchAll(/\b([A-Z]{0,4}\d{1,4}[A-Z]?)\s*\/\s*(\d{2,4})\b/gi)];
    if (language === "ja") {
      for (const [full, number, code] of text.matchAll(/\b(\d{1,4})\s*\/\s*([A-Z]{1,4}\s*[-–−]\s*P|PLAY|P|J|T)\b/gi)) {
        numbers.push([full, number, code.replace(/[–−]/g, "-").replace(/\s/g, "").toUpperCase()]);
      }
    }
    const matches = language === "zh-cn"
      ? await readSimplifiedChinese(text, numbers, cards)
      : readMatches(cards, text, numbers);
    return { matches, numbers };
  } finally {
    await worker.terminate();
  }
}

async function scanCandidates(canvas, language, request) {
  const cards = (await catalogue(language).catch(async error => {
    const references = await referencesFor(language);
    if (language !== "zh-cn" && !references.length) throw error;
    return references;
  })).filter(card => !card.image?.includes("/tcgp/"));
  const imageMatches = cards.length ? await visualSearch.search(canvas, language, cards).catch(() => []) : [];
  const images = language === "zh-cn"
    ? imageMatches.filter(({ card, distance }) => distance <= (/^CBB[1-7]C$/.test(card.set?.id) ? 24 : 16))
    : imageMatches;
  if (request !== active) return [];
  const visualCards = images.map(({ card }) => ({ ...card, visualMatch: true }));
  const gem = images[0]?.card;
  const gemVariants = gem && /^CBB[1-7]C$/.test(gem.set?.id)
    ? cards.filter(card => card.set?.id === gem.set.id && card.name === gem.name &&
      card.localId.slice(0, 2) === gem.localId.slice(0, 2))
    : [];
  const includeGemVariants = matches => mergeReferences(matches,
    gemVariants.filter(card => !matches.some(match => match.id === card.id)));

  const decisive = images[0]?.distance < 12 && (!images[1] || images[1].distance - images[0].distance > 3);
  if (decisive && gemVariants.length < 2) return visualCards;

  scanStatus(visualCards.length ? t("Checking printed details to refine the image matches…") : t("Checking the printed card details…"));
  const emptyDetails = { matches: [], numbers: [] };
  const printedDetails = readPrintedDetails(canvas, language, cards).catch(() => emptyDetails);
  let deadline;
  const { matches, numbers } = await (visualCards.length
    ? Promise.race([
      printedDetails,
      new Promise(resolve => { deadline = setTimeout(() => resolve(emptyDetails), 4000); })
    ]).finally(() => clearTimeout(deadline))
    : printedDetails);
  if (request !== active) return [];
  const visualIds = new Set(visualCards.map(card => card.id));
  if (images.length) {
    const printedScores = new Map(matches.map(({ card, score }) => [card.id, score]));
    const confirmedGem = matches.find(match => match.score === 420);
    const combined = visualCards.map((card, index) => ({
      card,
      rank: images[index].distance - (printedScores.get(card.id) || 0) / 60 -
        (numbers.some(([, number, code]) => matchNumber(card, number) &&
          (!promoSeries(code) || matchesPromoSeries(card, code))) ? 2 : 0)
    })).sort((a, b) => a.rank - b.rank).map(item => item.card);
    const textOnly = matches.filter(({ card }) => !visualIds.has(card.id)).slice(0, 3).map(({ card }) => card);
    const ranked = [...combined, ...textOnly];
    if (confirmedGem) return [confirmedGem.card, ...includeGemVariants(ranked).filter(card => card.id !== confirmedGem.card.id)];
    return includeGemVariants(ranked);
  }
  const shortlist = matches.slice(0, 12);
  if (language === "zh-cn" || !numbers.length || shortlist.length < 2) return shortlist.map(({ card }) => card);
  const sets = await api(language, "/sets").catch(() => []);
  const byId = new Map(sets.map(set => [set.id, set]));
  return shortlist.map(({ card, score }) => {
    const set = card.set || byId.get(card.id.slice(0, -(String(card.localId).length + 1)));
    const totalMatches = numbers.some(number => matchNumber(card, number[1]) && matchTotal(card, number[2], set));
    return { card: { ...card, set }, score: score + (totalMatches ? 100 : 0) };
  }).sort((a, b) => b.score - a.score).map(({ card }) => card);
}

let sourcePhoto;
let cropStart;
const cropCanvas = $("crop-photo");
const cropButton = $("select-card");

cropButton.addEventListener("click", () => {
  if (!sourcePhoto) return;
  cropStart = null;
  cropCanvas.hidden = false;
  cropCanvas.width = sourcePhoto.width;
  cropCanvas.height = sourcePhoto.height;
  cropCanvas.getContext("2d").drawImage(sourcePhoto, 0, 0);
  scanStatus(t("Drag a box around one card. Repeat for each card in the photo."));
});

function cropPoint(event) {
  const bounds = cropCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(cropCanvas.width, (event.clientX - bounds.left) * cropCanvas.width / bounds.width)),
    y: Math.max(0, Math.min(cropCanvas.height, (event.clientY - bounds.top) * cropCanvas.height / bounds.height))
  };
}

function cropBounds(point) {
  return [Math.round(Math.min(cropStart.x, point.x)), Math.round(Math.min(cropStart.y, point.y)),
    Math.round(Math.abs(point.x - cropStart.x)), Math.round(Math.abs(point.y - cropStart.y))];
}

cropCanvas.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  cropStart = cropPoint(event);
  cropCanvas.setPointerCapture(event.pointerId);
});
cropCanvas.addEventListener("pointermove", event => {
  if (!cropStart || !event.isPrimary) return;
  const context = cropCanvas.getContext("2d");
  context.drawImage(sourcePhoto, 0, 0);
  context.strokeStyle = "#d4fb77";
  context.lineWidth = 5;
  context.strokeRect(...cropBounds(cropPoint(event)));
});
cropCanvas.addEventListener("pointercancel", () => { cropStart = null; });
cropCanvas.addEventListener("pointerup", event => {
  if (!cropStart || !event.isPrimary) return;
  const [x, y, width, height] = cropBounds(cropPoint(event));
  cropStart = null;
  if (width < 30 || height < 30) return;
  const card = document.createElement("canvas");
  card.width = width;
  card.height = height;
  card.getContext("2d").drawImage(sourcePhoto, x, y, width, height, 0, 0, width, height);
  scanPhoto(card);
});

async function scan(blob) {
  stopCamera();
  const request = ++active;
  cropCanvas.hidden = true;
  cropButton.hidden = true;
  sourcePhoto = null;
  $("group-results").replaceChildren();
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(blob);
  const photo = $("photo");
  photo.src = photoUrl;
  photo.hidden = false;
  $("placeholder").hidden = true;
  try {
    await photo.decode();
    if (request !== active) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2400 / Math.max(photo.naturalWidth, photo.naturalHeight));
    canvas.width = Math.round(photo.naturalWidth * scale);
    canvas.height = Math.round(photo.naturalHeight * scale);
    canvas.getContext("2d").drawImage(photo, 0, 0, canvas.width, canvas.height);
    sourcePhoto = canvas;
    cropButton.hidden = false;
    if ($("group-photo").checked) await scanGroup(canvas, request);
    else await scanPhoto(canvas);
  } catch {
    if (request === active) scanStatus(t("The photo could not be read or the catalogue did not respond. Try again or search manually."));
  }
}

async function scanGroup(canvas, request) {
  const language = $("language").value;
  const group = $("group-results");
  showMatches([], language, t("Comparing card artwork. The first scan may take a moment…"));
  scanStatus(t("Finding cards in the photo…"));
  const cards = (await catalogue(language).catch(() => referencesFor(language)))
    .filter(card => !card.image?.includes("/tcgp/"));
  const results = await visualSearch.group(canvas, language, cards, () => request === active);
  if (request !== active) return;
  if (!results.length) {
    scanStatus(t("No group match. Space the cards apart or use Select a card in the photo."));
    return;
  }
  scanStatus(t("Select each photographed card to check its printing."));
  for (const [index, result] of results.entries()) {
    const button = element("button", t("Card {number}", { number: index + 1 }));
    const thumbnail = element("img");
    thumbnail.alt = "";
    thumbnail.src = result.canvas.toDataURL("image/jpeg", .7);
    button.prepend(thumbnail);
    button.append(element("span", result.matches[0]?.card.name || t("No match found")));
    button.addEventListener("click", () => scanPhoto(result.canvas));
    group.append(button);
  }
}

async function scanPhoto(canvas) {
  const request = ++active;
  const language = $("language").value;
  const comparing = t("Comparing card artwork. The first scan may take a moment…");
  showMatches([], language, comparing);
  scanStatus(comparing);
  try {
    if (request !== active) return;
    const candidates = await scanCandidates(canvas, language, request);
    if (request !== active) return;
    if (!candidates.length) {
      scanStatus(t("No match found. Try a straight, close photo with less glare, or search by printed details."));
      return;
    }
    $("scan-progress").hidden = true;
    const first = candidates[0];
    const similarGemPrintings = /^CBB[1-7]C$/.test(first.set?.id) && candidates.some(card =>
      card.id !== first.id && card.set?.id === first.set.id && card.name === first.name &&
      card.localId.slice(0, 2) === first.localId.slice(0, 2));
    showMatches(candidates, language, similarGemPrintings
      ? t("Several foil versions share this artwork. Compare the full number printed on your card.")
      : t("Compare the card images and collector numbers, then choose a printing."));
    lookupPanel.open = true;
    if (matchMedia("(max-width: 680px)").matches) $("lookup-title").scrollIntoView({ block: "start" });
  } catch {
    if (request === active) scanStatus(t("The photo could not be read or the catalogue did not respond. Try again or search manually."));
  }
}

const money = (value, currency) => new Intl.NumberFormat(interfaceLanguage, { style: "currency", currency }).format(value);
const validPrice = value => typeof value === "number" && value > 0;

let usdRate;
function latestUsdRate() {
  const now = Date.now();
  if (!usdRate || usdRate.expires <= now) {
    const entry = { expires: now + 900000, request: fetch("https://api.frankfurter.dev/v2/providers/ecb/rate/usd/eur", {
      cache: "no-store", signal: AbortSignal.timeout(10000)
    }).then(async response => {
      if (!response.ok) throw new Error("Rate unavailable");
      const rate = await response.json();
      if (rate.base !== "USD" || rate.quote !== "EUR" || !Number.isFinite(rate.rate) || rate.rate <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(rate.date)) throw new Error("Invalid exchange rate");
      return rate;
    }).catch(() => {
      if (usdRate === entry) usdRate = null;
      return null;
    }) };
    usdRate = entry;
  }
  return usdRate.request;
}

async function euroQuote(quote) {
  if (!quote || !validPrice(quote.value)) return null;
  if (quote.currency === "EUR") return quote;
  const rate = await latestUsdRate();
  return rate ? { ...quote, currency: "EUR", value: quote.value * rate.rate, fxDate: rate.date } : null;
}

const fxLabel = quote => quote.fxDate ? " · " + t("ECB FX {date}", { date: quote.fxDate }) : "";

function validManualPrice(cents) {
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100000000;
}

function manualQuote(item) {
  if (!validManualPrice(item?.manualPriceCents)) return null;
  return { name: t("Manual estimate"), currency: "EUR", value: item.manualPriceCents / 100 };
}

function pricingVariant(item, variant) {
  return ["noRarity", "unspecified"].includes(variant) && parseCardmarketProduct(item?.cardmarketUrl)?.id ? "normal" : variant;
}

function quotes(card, variant) {
  const cm = card.pricing?.cardmarket;
  const tcg = card.pricing?.tcgplayer;
  const gemPrice = /^CBB[1-7]C-/.test(card.id) && cm?.idProduct;
  const market = gemPrice ? (validPrice(cm["trend-holo"]) ? cm["trend-holo"] : cm.trend) : ["normal", "holo", "unlimited", "unlimitedHolo"].includes(variant) ? cm?.trend : variant === "reverse" ? cm?.["trend-holo"] : null;
  return [
    { name: "Cardmarket", currency: "EUR", value: market, updated: cm?.updated, metric: t("Price trend") },
    { name: "TCGplayer", currency: "USD", value: tcgVariant(tcg, variant)?.marketPrice, updated: tcg?.updated, metric: t("Market price") }
  ];
}

function offeredVariants(card) {
  return Object.keys(variants).filter(key => card.variants?.[key] || tcgVariant(card.pricing?.tcgplayer, key));
}

function normalizeProductId(value) {
  const text = String(value ?? "").trim();
  return /^[1-9]\d{0,11}$/.test(text) ? text : null;
}

function productIdUrl(id) {
  return "https://www.cardmarket.com/Pokemon/Products?idProduct=" + id;
}

function parseCardmarketProduct(value) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://www.cardmarket.com" || url.username || url.password) return null;
    const path = url.pathname.replace(/^\/[a-z]{2}(?=\/Pokemon\/)/i, "").replace(/\/$/, "");
    if (/^\/Pokemon\/Products\/Singles\/[^/]+\/[^/]+$/.test(path)) {
      return { url: url.origin + "/en" + path, id: null };
    }
    const ids = url.searchParams.getAll("idProduct");
    const id = ids.length === 1 && normalizeProductId(ids[0]);
    if (path === "/Pokemon/Products" && id) return { url: productIdUrl(id), id };
  } catch {}
  return null;
}

function cardmarketProductUrl(value) {
  return parseCardmarketProduct(value)?.url || null;
}

function cardmarketId(card) {
  return parseCardmarketProduct(card.marketUrl)?.id || normalizeProductId(card.pricing?.cardmarket?.idProduct);
}

function marketLink(card) {
  const product = parseCardmarketProduct(card.marketUrl);
  const id = cardmarketId(card);
  return product ? card.marketUrl : (id ? productIdUrl(id) : null);
}

function collectionMarketCard(detail, item) {
  const selected = parseCardmarketProduct(item?.cardmarketUrl);
  if (!selected || selected.url === cardmarketProductUrl(marketLink(detail))) return detail;
  if (selected.id && selected.id === cardmarketId(detail)) {
    return { ...detail, marketUrl: selected.url };
  }
  return { ...detail, marketUrl: selected.url, marketLabel: undefined, pricing: undefined, priceSnapshot: false };
}

let marketGuide;
const marketMatches = new Map();

async function matchedMarketProduct(card, language) {
  if (card.marketUrl) return null;
  const path = language === "ja" ? "visual/cardmarket-matches.json?v=1"
    : language === "zh-cn" && /^CBB[1-7]C-/.test(card.id) ? "visual/cardmarket-gem-matches.json" : null;
  if (!path) return null;
  if (!marketMatches.has(path)) {
    const request = fetch(path, { signal: AbortSignal.timeout(10000) }).then(response => {
      if (!response.ok) throw new Error("Cardmarket matches unavailable");
      return response.json();
    });
    marketMatches.set(path, request);
    request.catch(() => { if (marketMatches.get(path) === request) marketMatches.delete(path); });
  }
  const matches = await marketMatches.get(path).catch(() => null);
  return matches && Object.hasOwn(matches, card.id) ? matches[card.id] : null;
}

async function withMarketGuide(card, language) {
  const id = cardmarketId(card) || normalizeProductId(await matchedMarketProduct(card, language));
  if (!id) return card;
  const existingId = normalizeProductId(card.pricing?.cardmarket?.idProduct);
  if (existingId && existingId !== id) {
    card = { ...card, pricing: { ...card.pricing, cardmarket: undefined }, priceSnapshot: false };
  }
  if (!marketLink(card)) card = { ...card, marketUrl: productIdUrl(id) };
  if (!marketGuide) {
    const request = fetch("visual/cardmarket-prices.json", { cache: "no-cache", signal: AbortSignal.timeout(10000) })
      .then(response => {
        if (!response.ok) throw new Error("Price guide unavailable");
        return response.json();
      });
    marketGuide = request;
    request.catch(() => { if (marketGuide === request) marketGuide = null; });
  }
  const guide = await marketGuide.catch(() => null);
  if (!guide) return card;
  const existing = card.pricing?.cardmarket;
  const guideDate = Date.parse(guide.updated);
  if (!Number.isFinite(guideDate) || Date.parse(existing?.updated) > guideDate) return card;
  const [trend, reverse] = guide.prices?.[id] || [];
  return {
    ...card,
    priceSnapshot: validPrice(trend) || validPrice(reverse),
    pricing: { ...card.pricing, cardmarket: { idProduct: Number(id), updated: guide.updated, trend, "trend-holo": reverse } }
  };
}

function marketSearchLink(card) {
  return "https://www.cardmarket.com/en/Pokemon/Products/Search?" +
    new URLSearchParams({ searchString: card.nameEn || card.name });
}

function summaryMarketLink() {
  const link = element("a", "Cardmarket ↗", "summary-market");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.hidden = true;
  return link;
}

const summaryTasks = new WeakMap();
const summaryQueue = [];
let loadingSummaries = 0;
const summaryObserver = typeof IntersectionObserver === "function"
  ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        summaryObserver.unobserve(entry.target);
        const load = summaryTasks.get(entry.target);
        if (load) enqueueSummary(load);
      }
    }, { rootMargin: "80px" })
  : null;

function enqueueSummary(load) {
  if (load) summaryQueue.push(load);
  while (loadingSummaries < 4 && summaryQueue.length) {
    const next = summaryQueue.shift();
    ++loadingSummaries;
    Promise.resolve().then(next).finally(() => {
      --loadingSummaries;
      enqueueSummary();
    });
  }
}

function clearSummaries(container) {
  if (!summaryObserver) return;
  for (const node of container.querySelectorAll(".card-facts")) summaryObserver.unobserve(node);
}

function cardFacts(card, language, selectedVariant, externalLink) {
  const facts = element("span", "", "card-facts");
  const set = element("small", t("Set · {name}", { name: cardSetLabel(card) }));
  const number = element("small", t("Number · {number}", { number: cardNumberLabel(card) }));
  const price = element("strong", t("Checking price…"), "summary-price");
  const source = element("small");
  facts.append(set, number, price, source);
  const link = externalLink || summaryMarketLink();
  if (!externalLink) facts.append(link);
  const render = async detail => {
    set.textContent = t("Set · {name}", { name: cardSetLabel(detail) });
    number.textContent = t("Number · {number}", { number: cardNumberLabel(detail) });
    const href = cardmarketProductUrl(card.cardmarketUrl) || (selectedVariant === "noRarity" ? null : marketLink(detail));
    if (href?.startsWith("https://www.cardmarket.com/")) {
      link.href = href;
      link.textContent = "Cardmarket ↗";
      link.setAttribute("aria-label", t("View {name} on Cardmarket", { name: detail.name }));
      link.hidden = false;
    } else {
      link.href = marketSearchLink(detail);
      link.textContent = t("Search Cardmarket ↗");
      link.removeAttribute("aria-label");
      link.hidden = false;
    }
    const finishes = selectedVariant ? [selectedVariant] : offeredVariants(detail);
    const options = finishes.length ? finishes.map(variant => pricingVariant(card, variant)) : ["normal"];
    const quotesByFinish = options.flatMap(variant => quotes(detail, variant).map(quote => ({ ...quote, variant })));
    const priced = quotesByFinish.filter(quote => validPrice(quote.value));
    const original = priced.find(entry => entry.currency === "EUR") || priced[0];
    const quote = manualQuote(card) || await euroQuote(original);
    if (quote) {
      price.textContent = money(quote.value, quote.currency);
      const standard = detail.set?.id === "PMCG1" ? " · " + t(t("Standard print")) : "";
      source.textContent = !quote.variant ? quote.name : quote.name + standard + " · " + variants[quote.variant] +
        (detail.priceSnapshot && quote.updated ? " · " + quote.updated.slice(0, 10) : "") + fxLabel(quote);
    } else {
      price.textContent = original ? t("Exchange rate unavailable") : (pricingVariant(card, selectedVariant) !== "noRarity" && (marketLink(detail) || language === "zh-cn"))
        ? t("See market listing") : t("Price unavailable");
    }
  };
  const load = async () => {
    if (!facts.isConnected) return;
    const detail = card.localOnly ? card : await getCard(language, card.id).catch(() => card);
    const priced = await withMarketGuide(collectionMarketCard(detail, card), language);
    if (facts.isConnected) render(priced);
  };
  if (summaryObserver) {
    summaryTasks.set(facts, load);
    summaryObserver.observe(facts);
  } else {
    enqueueSummary(load);
  }
  return facts;
}

function renderPrices(container, card, variant) {
  container.replaceChildren();
  for (const quote of quotes(card, variant)) {
    if (card.priceSnapshot && quote.currency !== "EUR") continue;
    const row = element("div", "", "price");
    const label = element("span", quote.name);
    const date = quote.updated && new Date(quote.updated);
    const updated = date && Number.isFinite(date.getTime()) ? " · " + date.toLocaleDateString(interfaceLanguage) : "";
    label.append(element("small", quote.metric + updated));
    const amount = element("strong", validPrice(quote.value) ? t("Checking exchange rate…") : t("Unavailable"));
    row.append(label, amount);
    euroQuote(quote).then(converted => {
      amount.textContent = converted ? money(converted.value, "EUR")
        : validPrice(quote.value) ? t("Exchange rate unavailable") : t("Unavailable");
      if (converted?.fxDate) label.append(element("small", t("ECB FX {date}", { date: converted.fxDate })));
    });
    container.append(row);
  }
}

let marketCatalogue;

function catalogueSearch(field, productField, initialName) {
  const panel = element("details", "", "market-catalogue");
  panel.append(element("summary", t("Search Cardmarket catalogue")));
  const query = element("input");
  query.type = "search";
  query.maxLength = 150;
  query.value = initialName || "";
  query.placeholder = t("English card name or product ID");
  const label = element("label", query.placeholder);
  label.append(query);
  const status = element("small", "", "hint");
  status.setAttribute("role", "status");
  const results = element("ul", "", "market-catalogue-results");
  panel.append(label, status, results);

  let request = 0;
  async function search() {
    const current = ++request;
    const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    results.replaceChildren();
    status.textContent = "";
    if (!terms.length) return;
    status.textContent = t("Loading Cardmarket catalogue…");
    marketCatalogue ??= fetch("visual/cardmarket-catalogue.json", {
      cache: "no-cache", signal: AbortSignal.timeout(25000)
    }).then(response => {
      if (!response.ok) throw new Error("Catalogue unavailable");
      return response.json();
    }).catch(error => {
      marketCatalogue = null;
      throw error;
    });
    try {
      const products = await marketCatalogue;
      if (current !== request) return;
      const id = terms.length === 1 && normalizeProductId(terms[0]);
      const matches = products.filter(([productId, name]) => id
        ? String(productId) === id : terms.every(term => name.toLowerCase().includes(term)));
      const limit = 25;
      status.textContent = !matches.length ? t("No catalogue matches.") : matches.length > limit
        ? t("Showing 25 matches. Refine your search to see others.") : t("Verify the printing on Cardmarket before using its ID.");
      for (const [productId, name, expansion] of matches.slice(0, limit)) {
        const row = element("li");
        const link = element("a", name + " · ID " + productId + " ↗");
        link.href = productIdUrl(productId);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const choose = element("button", t("Use ID"));
        choose.type = "button";
        choose.setAttribute("aria-label", t("Use product ID {id}", { id: productId }));
        choose.addEventListener("click", () => {
          field.value = "";
          productField.value = String(productId);
          panel.open = false;
          productField.focus();
        });
        row.append(link, element("small", t("Expansion ID {id}", { id: expansion })), choose);
        results.append(row);
      }
    } catch {
      if (current === request) status.textContent = t("Could not load the catalogue. Change the search or reopen it to retry.");
    }
  }
  panel.addEventListener("toggle", () => { if (panel.open) search(); });
  query.addEventListener("input", search);
  query.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      search();
    }
  });
  return panel;
}

function marketFields(card) {
  const fields = element("fieldset", "", "market-fields");
  fields.append(element("legend", t("Edit Cardmarket link or price")));
  const field = element("input");
  field.type = "url";
  field.maxLength = 1000;
  field.setAttribute("aria-label", t("Cardmarket product URL"));
  field.placeholder = t("Cardmarket product URL");
  const message = element("small", t("Clear the manual price to use market quotes again. Clear the URL and ID to restore the default link."), "hint");
  message.setAttribute("role", "status");
  const productField = element("input");
  productField.inputMode = "numeric";
  productField.maxLength = 12;
  productField.placeholder = t("Cardmarket product ID");
  productField.setAttribute("aria-label", t("Cardmarket product ID"));
  const priceField = element("input");
  priceField.type = "number";
  priceField.inputMode = "decimal";
  priceField.min = "0";
  priceField.max = "1000000";
  priceField.step = "0.01";
  priceField.placeholder = t("Manual unit price (€)");
  priceField.setAttribute("aria-label", t("Manual unit price (€)"));
  for (const input of [field, productField, priceField]) {
    const label = element("label", input.placeholder);
    label.append(input);
    fields.append(label);
  }
  fields.append(catalogueSearch(field, productField, card.nameEn || card.name), message);
  const load = item => {
    const product = parseCardmarketProduct(item?.cardmarketUrl);
    field.value = product && !product.id ? product.url : "";
    productField.value = product?.id || "";
    priceField.value = validManualPrice(item?.manualPriceCents) ? (item.manualPriceCents / 100).toFixed(2) : "";
  };
  const read = () => {
    const value = field.value.trim();
    const product = parseCardmarketProduct(value);
    if (value && !product) {
      message.textContent = t("Enter a Cardmarket product page URL.");
      return;
    }
    const rawId = productField.value.trim();
    const id = normalizeProductId(rawId);
    if (rawId && !id) {
      message.textContent = t("Enter a valid Cardmarket product ID.");
      return;
    }
    if (id && product?.id && product.id !== id) {
      message.textContent = t("The product ID differs from the ID in the URL.");
      return;
    }
    const cardmarketUrl = id ? productIdUrl(id) : product?.url;
    const manualPriceCents = priceField.value ? Math.round(priceField.valueAsNumber * 100) : undefined;
    return { cardmarketUrl, manualPriceCents };
  };
  return { fields, load, read, message };
}

async function showCard(id, language, selectedVariant, scrollToDetail = false, item) {
  const request = ++active;
  $("detail").replaceChildren();
  status(t("Checking market prices…"));
  try {
    const card = await withMarketGuide(collectionMarketCard(await getCard(language, id), item), language);
    if (request !== active) return;
    status(t("Check the printing and finish before adding the card."));
    const top = element("div", "", "detail-top");
    const img = image(card, "high");
    if (img) {
      const artwork = element("a", "", "detail-artwork");
      artwork.href = img.src;
      artwork.target = "_blank";
      artwork.rel = "noopener noreferrer";
      artwork.setAttribute("aria-label", t("Open full-size card image for {name}", { name: card.name }));
      artwork.append(img);
      img.addEventListener("error", () => artwork.remove(), { once: true });
      top.append(artwork);
    }
    const info = element("div");
    info.append(element("h3", card.name), element("span", cardSetLabel(card) + " · " + cardNumberLabel(card), "card-meta"));
    if (card.rarity) info.append(element("span", card.rarity, "card-meta"));
    const label = element("label", t("Finish"));
    label.htmlFor = "variant";
    const select = element("select");
    select.id = "variant";
    const offered = offeredVariants(card);
    if (language === "zh-cn") {
      select.add(new Option(t("Unspecified"), "unspecified"));
      for (const key of ["normal", "holo", "reverse"]) select.add(new Option(variants[key], key));
    } else {
      for (const key of offered.length ? offered : ["normal"]) select.add(new Option(variants[key], key));
      if (language === "ja" && card.set?.id === "PMCG1") select.add(new Option(variants.noRarity, "noRarity"));
    }
    if ([...select.options].some(option => option.value === selectedVariant)) select.value = selectedVariant;

    info.append(label, select);
    top.append(info);
    const prices = element("div", "", "prices");
    const note = element("p", card.id === "vintage-promo-j115"
      ? t("Compare the copyright line and foil pattern to confirm the Ancient Mew printing before pricing.")
      : card.set?.id === "PMCG1"
      ? t("The Japanese Base Set guide price is for the standard printing. Confirm the rarity mark before using it.")
      : card.priceSnapshot
      ? t("Dated Cardmarket guide price. Confirm the printing and condition on the listing.")
      : language === "zh-tw"
      ? t("These reference prices may come from a Japanese listing. Check the listing language, finish, and condition.")
      : t("Prices are for ungraded cards and may vary by condition, language, and edition."), "hint");
    const addForm = element("form", "", "add-card-form");
    const quantity = quantityInput(1);
    quantity.id = "add-quantity";
    const quantityLabel = element("label", t("Quantity to add"));
    quantityLabel.htmlFor = quantity.id;
    const add = element("button", t("Add to collection"), "primary");
    const market = marketFields(card);
    const selectedEntry = () => collection.find(entry => entry.key === language + "/" + card.id + "/" + select.value);
    market.load(selectedEntry());
    addForm.append(market.fields, quantityLabel, quantity, add);
    addForm.addEventListener("submit", event => {
      event.preventDefault();
      const copies = quantity.valueAsNumber;
      if (!validQuantity(copies)) {
        status(t("Enter a whole quantity from 1 to 1,000,000."));
        return;
      }
      const key = language + "/" + card.id + "/" + select.value;
      const existing = selectedEntry();
      const settings = market.read();
      if (!settings) return;
      const qty = (existing?.qty || 0) + copies;
      if (!validQuantity(qty)) {
        status(t("This printing can have at most 1,000,000 copies in the collection."));
        return;
      }
      const entry = { ...collectionEntry(card, language, select.value, qty), ...settings };
      if (save(existing ? collection.map(item => item.key === key ? entry : item) : [...collection, entry])) {
        status(t("Added {qty} × {name} to {collection}.", { qty: copies, name: card.name, collection: profileLabel(currentProfile) }));
      }
    });
    const update = () => {
      const variant = pricingVariant(item, select.value);
      if (variant === "noRarity") {
        prices.replaceChildren(element("p", t("No verified price for this printing."), "hint"));
      } else if ((language !== "zh-cn" || cardmarketId(card)) && (!card.localOnly || card.pricing)) {
        renderPrices(prices, card, variant);
      } else {
        prices.replaceChildren();
      }
      const estimate = select.value === item?.variant && manualQuote(item);
      if (estimate) {
        const row = element("div", "", "price");
        row.append(element("span", estimate.name), element("strong", money(estimate.value, estimate.currency)));
        prices.prepend(row);
      }
      const direct = cardmarketProductUrl(item?.cardmarketUrl) || (select.value === "noRarity" ? null : marketLink(card));
      const link = element("a", direct ? t(card.marketLabel || "View on Cardmarket ↗") : t("Search Cardmarket ↗"));
      link.href = direct || marketSearchLink(card);
      if (language === "zh-cn" && !direct) {
        const alternative = element("a", t("Check prices on PikaQian ↗"));
        alternative.href = "https://pikaqian.com/search?" + new URLSearchParams({ q: card.nameEn || card.name });
        alternative.target = "_blank";
        alternative.rel = "noopener noreferrer";
        prices.append(alternative);
      }
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      prices.append(link);
    };
    select.addEventListener("change", () => {
      market.load(selectedEntry());
      update();
    });
    update();
    $("detail").append(top, prices, addForm, note);
    if (scrollToDetail) $("detail").scrollIntoView({ block: "nearest" });
  } catch {
    if (request === active) status(t("Could not load this printing. Select it again to retry."));
  }
}

function validQuantity(qty) {
  return Number.isInteger(qty) && qty >= 1 && qty <= 1000000;
}

function quantityInput(qty) {
  const input = element("input", "", "quantity-input");
  input.type = "number";
  input.min = "1";
  input.max = "1000000";
  input.step = "1";
  input.required = true;
  input.value = String(qty);
  return input;
}

function save(next, updateValues = true) {
  try {
    localStorage.setItem(profileStorage(currentProfile), JSON.stringify(next));
    collection = next;
    renderCollection();
    if (updateValues) refreshValues();
    return true;
  } catch {
    status(t("This browser could not save the collection. Check that local storage is available."));
    return false;
  }
}

function collectionEntry(card, language, variant, qty) {
  return {
    key: language + "/" + card.id + "/" + variant,
    language, id: card.id, name: card.name, set: card.set?.name || "", setId: cardSetId(card),
    localId: card.localId, image: card.image, printedNumber: card.printedNumber, pokedexNumber: card.pokedexNumber,
    variant, qty
  };
}

const bulkPanel = $("bulk-add");
const bulkSet = $("bulk-set");
const bulkList = $("bulk-list");
const bulkFilter = $("bulk-filter");
const bulkStatus = message => { $("bulk-status").textContent = message; };
let bulkRequest = 0;
let bulkSets = new Map();

async function loadBulkSets() {
  const request = ++bulkRequest;
  const language = $("language").value;
  bulkSets = new Map();
  bulkSet.replaceChildren();
  bulkList.replaceChildren();
  bulkRows = [];
  bulkFilter.parentElement.hidden = true;
  $("bulk-save").disabled = true;
  bulkStatus(t("Loading sets…"));
  try {
    const [cards, sets] = await Promise.all([
      catalogue(language).catch(async error => {
        const references = await referencesFor(language);
        if (!references.length) throw error;
        return references;
      }),
      language === "zh-cn" ? [] : api(language, "/sets").catch(() => [])
    ]);
    if (request !== bulkRequest) return;
    const byId = new Map(sets.map(set => [set.id, set]));
    for (const card of cards) {
      const id = cardSetId(card);
      if (!id || card.image?.includes("/tcgp/")) continue;
      const set = card.set || byId.get(id) || { id, name: id };
      const key = id + "/" + set.name;
      if (!bulkSets.has(key)) bulkSets.set(key, { name: set.name, cards: [] });
      bulkSets.get(key).cards.push({ ...card, set });
    }
    bulkSet.append(new Option(t("Choose a set"), ""));
    const gemPacks = element("optgroup");
    gemPacks.label = t("Chinese Gem Packs");
    if (language === "zh-cn") bulkSet.append(gemPacks);
    for (const [key, set] of [...bulkSets].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
      const group = language === "zh-cn" && /^CBB[1-7]C\//.test(key) ? gemPacks : bulkSet;
      group.append(new Option(set.name + " · " + set.cards.length, key));
    }
    bulkStatus(t("Set the quantity for each card you own, then add them together."));
  } catch {
    if (request === bulkRequest) bulkStatus(t("The card catalogue is unavailable. Try again in a moment."));
  }
}

bulkPanel.addEventListener("toggle", () => {
  if (bulkPanel.open && !bulkSets.size) loadBulkSets();
});
$("language").addEventListener("change", () => {
  ++bulkRequest;
  bulkSets.clear();
  if (bulkPanel.open) loadBulkSets();
});
let bulkRows = [];
bulkSet.addEventListener("change", () => {
  bulkList.replaceChildren();
  bulkRows = [];
  bulkFilter.value = "";
  const set = bulkSets.get(bulkSet.value);
  $("bulk-save").disabled = !set;
  bulkFilter.parentElement.hidden = !set;
  if (!set) return;
  for (const card of [...set.cards].sort((a, b) => a.localId.localeCompare(b.localId, undefined, { numeric: true }))) {
    const row = element("div", "", "bulk-row");
    const img = image(card);
    if (img) { img.loading = "lazy"; row.append(img); }
    const label = element("label", cardNumberLabel(card) + " · " + card.name);
    const qty = quantityInput(0);
    qty.min = "0";
    label.append(qty);
    const finish = element("select");
    finish.setAttribute("aria-label", t("Finish") + " · " + label.textContent);
    const offered = offeredVariants(card);
    const choices = $("language").value === "zh-cn" ? ["unspecified", "normal", "holo", "reverse"]
      : offered.length ? offered : ["normal"];
    if ($("language").value === "ja" && card.set.id === "PMCG1") choices.push("noRarity");
    for (const variant of choices) finish.add(new Option(variants[variant] || t("Unspecified"), variant));
    row.append(label, finish);
    bulkList.append(row);
    bulkRows.push({ card, qty, finish, row });
  }
});

bulkFilter.addEventListener("input", () => {
  const query = bulkFilter.value.normalize("NFKC").trim().toLowerCase();
  for (const { card, row } of bulkRows) {
    row.hidden = ![card.name, card.nameEn, cardNumberLabel(card)].some(value => value?.toLowerCase().includes(query));
  }
});

$("bulk-form").addEventListener("submit", event => {
  event.preventDefault();
  const language = $("language").value;
  const next = new Map(collection.map(card => [card.key, card]));
  let added = 0;
  for (const { card, qty, finish } of bulkRows) {
    if (qty.valueAsNumber === 0) continue;
    const entry = collectionEntry(card, language, finish.value, qty.valueAsNumber);
    const existing = next.get(entry.key);
    const total = (existing?.qty || 0) + entry.qty;
    if (!validQuantity(entry.qty) || !validQuantity(total)) {
      bulkStatus(t("This printing can have at most 1,000,000 copies in the collection."));
      return;
    }
    next.set(entry.key, existing ? { ...existing, qty: total } : entry);
    added += entry.qty;
  }
  if (!added) {
    bulkStatus(t("Enter a quantity for at least one card."));
    return;
  }
  if (save([...next.values()])) {
    for (const row of bulkRows) row.qty.value = "0";
    bulkStatus(t("Added {count} cards to {collection}.", { count: added, collection: profileLabel(currentProfile) }));
  }
});

const openCollectionSets = new Set();

let setCovers;

async function appendSetCover(summary, card) {
  const language = card.language === "de" ? "en" : card.language;
  if (!["ja", "en", "zh-cn"].includes(language)) return;
  setCovers ??= fetch("visual/set-covers.json?v=2").then(response => {
    if (!response.ok) throw new Error("Set covers unavailable");
    return response.json();
  }).catch(() => {
    setCovers = null;
    return {};
  });
  const covers = (await setCovers)[language];
  const name = (card.set || "").replace(/^\d{4} /, "").normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  const urls = covers?.[name] || covers?.[cardSetId(card).toLowerCase()];
  if (!urls?.length || !summary.isConnected) return;
  const cover = element("img");
  cover.alt = "";
  cover.loading = "lazy";
  let next = 0;
  const load = () => {
    if (next < urls.length) cover.src = urls[next++];
    else cover.remove();
  };
  cover.addEventListener("error", load);
  summary.prepend(cover);
  load();
}

function renderCollection() {
  const list = $("collection");
  clearSummaries(list);
  list.replaceChildren();
  const count = collection.reduce((sum, item) => sum + item.qty, 0);
  $("count").textContent = t(count === 1 ? "{count} CARD" : "{count} CARDS", { count });
  if (!count) list.append(element("p", t("Your vault is empty. Scan or search for a card to start your collection."), "empty"));
  const groups = new Map();
  for (const item of collection) {
    const setId = cardSetId(item);
    const key = item.language + "/" + (setId && setId !== "vintage-promos" ? setId : item.set || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [key, items] of [...groups].sort((a, b) => cardSetLabel(a[1][0]).localeCompare(cardSetLabel(b[1][0])))) {
    const section = element("details", "", "collection-set");
    const stateKey = currentProfile.id + "/" + key;
    section.open = openCollectionSets.has(stateKey);
    section.addEventListener("toggle", () => {
      if (section.open) openCollectionSets.add(stateKey);
      else openCollectionSets.delete(stateKey);
    });
    const summary = element("summary");
    appendSetCover(summary, items[0]);
    const heading = element("span", cardSetLabel(items[0]));
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    heading.append(element("small", items[0].language.toUpperCase() + " · " + t(count === 1 ? "{count} CARD" : "{count} CARDS", { count })));
    summary.append(heading);
    section.append(summary);
    list.append(section);
    for (const item of items) renderCollectionRow(section, item);
  }
}

function collectionMarketEditor(item) {
  const edit = element("details", "", "market-edit");
  const summary = element("summary", t("Edit Cardmarket link or price"));
  const form = element("form");
  const market = marketFields(item);
  market.load(item);
  form.append(market.fields, element("button", t("Save price settings")));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const settings = market.read();
    if (!settings) return;
    if (!save(collection.map(entry => entry.key === item.key ? { ...entry, ...settings } : entry))) {
      market.message.textContent = t("The browser could not save the price settings.");
    }
  });
  edit.append(summary, form);
  return edit;
}

function renderCollectionRow(section, item) {
  const row = element("div", "", "collection-row");
  const entry = element("div", "", "entry");
  const img = image(item);
  if (img) entry.append(img);
  const title = element("strong", item.name + " × " + item.qty);
  title.append(element("small", (variants[item.variant] || t("Unspecified")) + " · " + item.language.toUpperCase(), "card-meta"));
  title.append(cardFacts(item, item.language, item.variant));
  entry.append(title);
  const actions = element("div", "", "row-actions");
  const view = element("button", t("Check price"));
  view.addEventListener("click", () => {
    showMatches([], item.language, t("Checking market prices…"));
    lookupPanel.open = true;
    $("lookup-title").scrollIntoView({ block: "start" });
    showCard(item.id, item.language, item.variant, false, item);
  });
  const remove = element("button", t("Remove one"));
  remove.setAttribute("aria-label", t("Remove one {name}", { name: item.name }));
  remove.addEventListener("click", () => save(collection.flatMap(entry => {
    if (entry.key !== item.key) return [entry];
    return entry.qty > 1 ? [{ ...entry, qty: entry.qty - 1 }] : [];
  })));
  actions.append(view, remove);
  const edit = collectionMarketEditor(item);
  row.append(entry, actions, edit);
  section.append(row);
}

const vaultStatus = message => { $("vault-status").textContent = message; };

function openProfile(profile) {
  localStorage.setItem(profileKey + "-active", JSON.stringify(profile.id));
  currentProfile = profile;
  collection = readLocal(profileStorage(profile), []);
  $("vault-select").replaceChildren(...profiles.map(item => new Option(profileLabel(item), item.id)));
  $("vault-select").value = profile.id;
  renderCollection();
  refreshValues();
}

function createProfile(name, cards) {
  const profile = { name, id: crypto.randomUUID() };
  localStorage.setItem(profileStorage(profile), JSON.stringify(cards));
  localStorage.setItem(profileKey, JSON.stringify([...profiles, profile]));
  profiles.push(profile);
  openProfile(profile);
}

$("vault-select").addEventListener("change", event => {
  try {
    openProfile(profiles.find(profile => profile.id === event.target.value));
    vaultStatus(t("Opened {name}.", { name: profileLabel(currentProfile) }));
  } catch {
    $("vault-select").value = currentProfile.id;
    vaultStatus(t("The browser could not open this collection."));
  }
});

$("vault-create").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("vault-name").value.trim();
  if (!name) return;
  try {
    createProfile(name, []);
    $("vault-name").value = "";
    vaultStatus(t("Created {name}.", { name }));
  } catch { vaultStatus(t("The browser could not save the new collection.")); }
});

$("vault-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ format: "card-vault", version: 1, name: currentProfile.name, cards: collection }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = currentProfile.name.replace(/[\\/:*?"<>|]/g, "-") + ".card-vault.json";
  document.body.append(link);
  link.click();
  link.remove();
  vaultStatus(t("Download requested for {name}.", { name: profileLabel(currentProfile) }));
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("vault-import").addEventListener("click", () => $("vault-file").click());
$("vault-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error("File is too large");
    const data = JSON.parse(await file.text());
    if (data?.format !== "card-vault" || data.version !== 1 || !Array.isArray(data.cards) ||
      typeof data.name !== "string" || !data.name.trim() || data.name.length > 80) throw new Error("Invalid collection");
    const keys = new Set();
    const cards = data.cards.map(card => {
      if (!card || !Object.hasOwn(ocrLanguages, card.language) ||
        !(Object.hasOwn(variants, card.variant) || card.variant === "unspecified") ||
        !Number.isSafeInteger(card.qty) || card.qty < 1 || card.qty > 1000000 ||
        !["id", "name", "localId"].every(key => typeof card[key] === "string" && card[key].length > 0 && card[key].length <= 300)) throw new Error("Invalid card");
      const key = card.language + "/" + card.id + "/" + card.variant;
      if (keys.has(key)) throw new Error("Duplicate card");
      keys.add(key);
      const copy = { key, language: card.language, id: card.id, name: card.name, localId: card.localId, variant: card.variant, qty: card.qty };
      for (const field of ["set", "setId", "image", "printedNumber", "pokedexNumber"]) {
        if (typeof card[field] === "string" && card[field].length <= 1000) copy[field] = card[field];
      }
      const link = typeof card.cardmarketUrl === "string" && cardmarketProductUrl(card.cardmarketUrl);
      if (link) copy.cardmarketUrl = link;
      if (validManualPrice(card.manualPriceCents)) copy.manualPriceCents = card.manualPriceCents;
      return copy;
    });
    createProfile(data.name.trim(), cards);
    vaultStatus(t("Imported {name} as a separate collection.", { name: profileLabel(currentProfile) }));
  } catch { vaultStatus(t("Could not import this file. Choose a valid Card Vault collection file.")); }
});

let valueRequest = 0;
function addTotals(totals, row) {
  if (row.quote) totals.set(row.quote.currency, (totals.get(row.quote.currency) || 0) + row.cents * row.item.qty);
}
const totalsLabel = totals => [...totals].sort(([a], [b]) => a.localeCompare(b))
  .map(([currency, cents]) => money(cents / 100, currency)).join(" · ") || t("No quoted value");

async function refreshValues() {
  const request = ++valueRequest;
  const items = collection;
  const container = $("valuation");
  container.replaceChildren();
  $("value-status").textContent = items.length ? t("Checking market quotes…") : t("Add cards to see your collection value.");
  if (!items.length) return;
  const rows = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (request === valueRequest && cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      const detail = await withMarketGuide(collectionMarketCard(await getCard(item.language, item.id).catch(() => item), item), item.language);
      const quote = manualQuote(item) || await euroQuote(quotes(detail, pricingVariant(item, item.variant)).find(entry => validPrice(entry.value)));
      rows[index] = { item, detail, quote, cents: quote ? Math.round(quote.value * 100) : 0 };
    }
  }));
  if (request !== valueRequest) return;
  const groups = new Map();
  for (const row of rows) {
    const name = cardSetLabel(row.detail);
    const setId = row.detail.set?.id;
    const key = setId && setId !== "vintage-promos" ? setId : name;
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    groups.get(key).rows.push(row);

  }
  const updateTotal = () => {
    const total = new Map();
    let unquoted = 0;
    for (const row of rows) {
      addTotals(total, row);
      if (!row.quote) unquoted += row.item.qty;
    }
    $("value-status").textContent = totalsLabel(total) + " · " + t("{count} cards without a quote", { count: unquoted });
  };
  updateTotal();
  for (const group of [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const table = element("table");
    const caption = element("caption");
    const updateCaption = () => {
      const subtotal = new Map();
      for (const row of group.rows) addTotals(subtotal, row);
      caption.textContent = group.name + " · " + totalsLabel(subtotal);
    };
    updateCaption();
    table.append(caption);
    const header = element("tr");
    for (const label of ["Card", "Qty", "Unit price", "Subtotal", "Source / Date", "Actions"]) {
      const cell = element("th", t(label));
      cell.scope = "col";
      header.append(cell);
    }
    const head = element("thead");
    head.append(header);
    const body = element("tbody");
    for (const line of group.rows) {
      const { item, detail, quote, cents } = line;
      const row = element("tr");
      const label = item.name + " · " + cardNumberLabel(detail) + " · " + item.language.toUpperCase() + " · " + (variants[item.variant] || t("Unspecified"));
      const quantity = quantityInput(item.qty);
      quantity.setAttribute("aria-label", t("Quantity for {name}", { name: label + " · " + group.name }));
      const quantityCell = element("td");
      quantityCell.append(quantity);
      const subtotalLabel = qty => quote ? money(cents * qty / 100, quote.currency) : "—";
      const subtotalCell = element("td", subtotalLabel(item.qty));
      quantity.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          quantity.blur();
        }
      });
      quantity.addEventListener("change", () => {
        const qty = quantity.valueAsNumber;
        if (!validQuantity(qty)) {
          quantity.value = String(line.item.qty);
          vaultStatus(t("Enter a whole quantity from 1 to 1,000,000."));
          return;
        }
        if (qty === line.item.qty) return;
        const updated = { ...line.item, qty };
        if (!save(collection.map(card => card.key === item.key ? updated : card), false)) {
          quantity.value = String(line.item.qty);
          vaultStatus(t("The browser could not save the quantity."));
          return;
        }
        line.item = updated;
        subtotalCell.textContent = subtotalLabel(qty);
        updateCaption();
        updateTotal();
        vaultStatus(t("Saved quantity for {name}.", { name: item.name }));
      });
      const remove = element("button", t("Remove"));
      remove.type = "button";
      remove.setAttribute("aria-label", t("Remove all copies of {name} from this collection", { name: label }));
      remove.title = t("Remove this row and all its copies");
      remove.addEventListener("click", () => {
        if (save(collection.filter(card => card.key !== item.key))) {
          vaultStatus(t("Removed {name} from {collection}.", { name: item.name, collection: profileLabel(currentProfile) }));
        } else {
          vaultStatus(t("The browser could not remove this row."));
        }
      });
      const actions = element("td");
      actions.append(remove);
      const cardCell = element("td", label);
      const direct = item.variant === "noRarity" ? cardmarketProductUrl(item.cardmarketUrl) : marketLink(detail);
      const lookup = element("a", direct ? "Cardmarket ↗" : t("Search Cardmarket ↗"), "valuation-market");
      lookup.href = direct || marketSearchLink(detail);
      lookup.target = "_blank";
      lookup.rel = "noopener noreferrer";
      cardCell.append(lookup, collectionMarketEditor(item));
      row.append(cardCell, quantityCell,
        element("td", quote ? money(cents / 100, quote.currency) : t("Unavailable")),
        subtotalCell,
        element("td", quote ? quote.name + (quote.updated ? " · " + quote.updated.slice(0, 10) : "") + fxLabel(quote) : "—"), actions);
      body.append(row);
    }
    table.append(head, body);
    const scroll = element("div", "", "value-table");
    scroll.append(table);
    container.append(scroll);
  }
}

const collectionTabs = [$("cards-tab"), $("values-tab")];
function activateCollectionTab(tab) {
  for (const button of collectionTabs) {
    const selected = button === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(button.getAttribute("aria-controls")).hidden = !selected;
  }
}
for (const tab of collectionTabs) {
  tab.addEventListener("click", () => activateCollectionTab(tab));
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? collectionTabs[0] : event.key === "End" ? collectionTabs[1]
      : collectionTabs[1 - collectionTabs.indexOf(tab)];
    activateCollectionTab(next);
    next.focus();
  });
}

$("value-refresh").addEventListener("click", () => {
  cardDetails.clear();
  marketGuide = null;
  marketMatches.clear();
  usdRate = null;
  renderCollection();
  refreshValues();
});

try { openProfile(currentProfile); } catch {
  renderCollection();
  refreshValues();
  vaultStatus(t("Browser storage is unavailable."));
}


$("app-update").addEventListener("click", () => {
  const url = new URL(location.href);
  url.searchParams.set("update", Date.now().toString());
  location.replace(url);
});
