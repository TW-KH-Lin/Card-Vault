"use strict";

// The reference index stores a 10 × 14 RGB thumbnail fingerprint per card.
const visualSearch = (() => {
  const width = 10;
  const height = 14;
  const size = width * height * 3;
  const ratio = 63 / 88;
  const indexes = new Map();
  const weights = Array.from({ length: width * height }, (_, i) => {
    const row = Math.floor(i / width);
    const column = i % width;
    const art = row >= 2 && row <= 7 && column > 0 && column < width - 1;
    return art ? 2 : 1;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const pixelOrder = [...weights.keys()].sort((a, b) => weights[b] - weights[a]);

  async function loadIndex(language) {
    if (!indexes.has(language)) {
      const request = (async () => {
        const responses = await Promise.all(["json", "bin"].map(extension =>
          fetch("visual/" + language + "." + extension + "?v=1", { signal: AbortSignal.timeout(15000) })));
        if (responses.some(response => !response.ok)) throw new Error("Image index unavailable");
        const [ids, bytes] = await Promise.all([responses[0].json(), responses[1].arrayBuffer()]);
        if (bytes.byteLength !== ids.length * size) throw new Error("Invalid image index");
        const rgb = new Uint8Array(bytes);
        const descriptors = new Int16Array(rgb.length);
        for (let offset = 0; offset < rgb.length; offset += size) describe(rgb, offset, 3, descriptors);
        return { ids, descriptors };
      })();
      indexes.set(language, request);
      request.catch(() => indexes.delete(language));
    }
    return indexes.get(language);
  }

  function describe(pixels, offset, channels, output = new Int16Array(size)) {
    const start = output.length === size ? 0 : offset;
    let mean = 0;
    for (let index = 0; index < weights.length; index++) {
      const src = offset + index * channels;
      const dest = start + index * 3;
      const red = pixels[src], green = pixels[src + 1], blue = pixels[src + 2];
      const luma = (red * 54 + green * 183 + blue * 19) >> 8;
      output[dest] = luma;
      output[dest + 1] = red - luma;
      output[dest + 2] = blue - luma;
      mean += luma * weights[index];
    }
    mean = Math.round(mean / weightTotal);
    for (let i = start; i < start + size; i += 3) output[i] -= mean;
    return output;
  }

  function distance(query, reference, offset, limit) {
    let total = 0;
    const cutoff = limit * weightTotal;
    for (const index of pixelOrder) {
      const pos = index * 3;
      const ref = offset + pos;
      total += weights[index] * (
        Math.abs(query[pos] - reference[ref]) +
        .45 * Math.abs(query[pos + 1] - reference[ref + 1]) +
        .40 * Math.abs(query[pos + 2] - reference[ref + 2])
      );
      if (total > cutoff) return Infinity;
    }
    return total / weightTotal;
  }

  function centerCrop(image, fraction = 1) {
    const height = Math.min(image.height, image.width / ratio) * fraction;
    const width = height * ratio;
    return { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height };
  }

  function peaks(profile) {
    const ordered = [...profile.keys()].slice(2, -2).sort((a, b) => profile[b] - profile[a]);
    const positions = [0, profile.length - 1];
    for (const position of ordered) {
      if (positions.every(previous => Math.abs(previous - position) >= 5)) positions.push(position);
      if (positions.length === 13) break;
    }
    return positions.sort((a, b) => a - b);
  }

  // Find a card-shaped rectangle in an upright photo with margins around the card.
  function edgeCrops(image) {
    const sample = document.createElement("canvas");
    const scale = 180 / Math.max(image.width, image.height);
    sample.width = Math.round(image.width * scale);
    sample.height = Math.round(image.height * scale);
    if (sample.width < 25 || sample.height < 25) return [];
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, sample.width, sample.height);
    const { data } = ctx.getImageData(0, 0, sample.width, sample.height);
    const grey = Float32Array.from({ length: sample.width * sample.height }, (_, i) => {
      const p = i * 4;
      return (data[p] * .25 + data[p + 1] * .55 + data[p + 2] * .20);
    });
    const vertical = new Float32Array(sample.width);
    const horizontal = new Float32Array(sample.height);
    for (let y = 2; y < sample.height - 2; y++) {
      for (let x = 2; x < sample.width - 2; x++) {
        const p = y * sample.width + x;
        vertical[x] += Math.abs(grey[p + 1] - grey[p - 1]) / sample.height;
        horizontal[y] += Math.abs(grey[p + sample.width] - grey[p - sample.width]) / sample.width;
      }
    }
    const xs = peaks(vertical);
    const ys = peaks(horizontal);
    const candidates = [];
    for (const left of xs) for (const right of xs) {
      const w = right - left;
      if (w < Math.min(sample.width, sample.height * ratio) * .48) continue;
      for (const top of ys) for (const bottom of ys) {
        const h = bottom - top;
        if (h < sample.height * .30 || Math.abs(w / h - ratio) > .065) continue;
        const strength = vertical[left] + vertical[right] + horizontal[top] + horizontal[bottom];
        candidates.push({ x: left / scale, y: top / scale, width: w / scale, height: h / scale, strength });
      }
    }
    return candidates.sort((a, b) => b.strength - a.strength).slice(0, 4);
  }

  function queryDescriptors(image) {
    const sample = document.createElement("canvas");
    sample.width = width;
    sample.height = height;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    const query = [];
    const add = (source, crop, penalty) => {
      ctx.fillStyle = "#888";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      const signature = describe(ctx.getImageData(0, 0, width, height).data, 0, 4);
      let contrast = 0;
      for (let i = 0; i < signature.length; i += 3) contrast += Math.abs(signature[i]);
      if (contrast / weights.length >= 8) query.push({ signature, penalty });
    };
    const full = { x: 0, y: 0, width: image.width, height: image.height };
    if (Math.abs(image.width / image.height - ratio) < .11) add(image, full, 0);
    for (const fraction of [1, .88, .75, .62]) add(image, centerCrop(image, fraction), 1 + (1 - fraction) * 2);
    for (const crop of edgeCrops(image)) add(image, crop, 2);
    // On graded slabs the label is above the card, so a centered crop often cuts it off.
    if (image.width / image.height < .66) {
      for (const fraction of [.74, .81, .88]) {
        const cropWidth = image.width * fraction;
        const cropHeight = cropWidth / ratio;
        for (const center of [.58, .61, .64]) {
          const y = image.height * center - cropHeight / 2;
          if (y < 0 || y + cropHeight > image.height) continue;
          add(image, { x: (image.width - cropWidth) / 2, y, width: cropWidth, height: cropHeight }, 2);
        }
      }
    }
    return query;
  }

  async function search(image, language, cards) {
    const indexLanguage = ["de", "ja", "zh-tw", "zh-cn"].includes(language) ? language : "en";
    const sourceLanguages = indexLanguage === "de" ? ["de", "en"] : [indexLanguage];
    const available = new Map(cards.map(card => [card.id, card]));
    const queries = queryDescriptors(image);
    if (!queries.length) return [];
    const results = new Map();
    let maxDistance = 28;
    const ranked = () => [...results.values()].sort((a, b) => a.distance - b.distance);
    function compare(card, descriptors, offset, languagePenalty) {
      let best = Infinity;
      for (const query of queries) {
        const penalty = query.penalty + languagePenalty;
        const limit = Math.min(best, maxDistance) - penalty;
        best = Math.min(best, distance(query.signature, descriptors, offset, limit) + penalty);
      }
      if (best <= maxDistance && best < (results.get(card.id)?.distance ?? Infinity)) {
        results.set(card.id, { card, distance: best });
        maxDistance = Math.min(maxDistance, best + 8);
      }
    }
    for (const card of cards) {
      const fingerprints = card.fingerprints ?? (card.fingerprint ? [card.fingerprint] : []);
      for (const fingerprint of fingerprints) {
        const pixels = Uint8Array.from(atob(fingerprint), value => value.charCodeAt(0));
        if (pixels.length === size) compare(card, describe(pixels, 0, 3), 0, 0);
      }
    }
    for (const sourceLanguage of sourceLanguages) {
      const source = await loadIndex(sourceLanguage).catch(() => null);
      if (!source) continue;
      const { ids, descriptors } = source;
      for (let index = 0; index < ids.length; index++) {
        const card = available.get(ids[index]);
        if (card) compare(card, descriptors, index * size, sourceLanguage === language ? 0 : 1);
      }
      const [first, second] = ranked();
      if (first?.distance < 10 && (!second || second.distance - first.distance > 3)) break;
    }
    const ordered = ranked();
    if (!ordered.length) return [];
    return ordered.filter(match => match.distance <= ordered[0].distance + 8).slice(0, 8);
  }

  return { search };
})();
