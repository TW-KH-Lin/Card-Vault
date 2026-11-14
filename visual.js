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
          fetch("visual/" + language + "." + extension, { cache: "no-cache", signal: AbortSignal.timeout(15000) })));
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
    let mean = 0, redMean = 0, blueMean = 0;
    for (let index = 0; index < weights.length; index++) {
      const src = offset + index * channels;
      const dest = start + index * 3;
      const red = pixels[src], green = pixels[src + 1], blue = pixels[src + 2];
      const luma = (red * 54 + green * 183 + blue * 19) >> 8;
      output[dest] = luma;
      output[dest + 1] = red - luma;
      output[dest + 2] = blue - luma;
      mean += luma * weights[index];
      redMean += output[dest + 1] * weights[index];
      blueMean += output[dest + 2] * weights[index];
    }
    mean = Math.round(mean / weightTotal);
    redMean = Math.round(redMean / weightTotal);
    blueMean = Math.round(blueMean / weightTotal);
    for (let i = start; i < start + size; i += 3) {
      output[i] -= mean;
      output[i + 1] -= redMean;
      output[i + 2] -= blueMean;
    }
    return output;
  }

  function artworkDistance(query, reference, offset) {
    let total = 0;
    let count = 0;
    const anchor = 43 * 3;
    for (let row = 2; row <= 6; row++) {
      for (let column = 2; column <= 8; column++) {
        const pos = (row * width + column) * 3;
        for (let channel = 0; channel < 3; channel++) {
          const a = query[pos + channel] - query[anchor + channel];
          const b = reference[offset + pos + channel] - reference[offset + anchor + channel];
          total += Math.abs(a - b) * (channel === 0 ? .7 : .35);
        }
        count++;
      }
    }
    return total / count;
  }

  function distance(query, reference, offset, limit) {
    let total = 0;
    const cutoff = limit * weightTotal;
    for (const index of pixelOrder) {
      const pos = index * 3;
      const ref = offset + pos;
      total += weights[index] * (
        0.7 * Math.abs(query[pos] - reference[ref]) +
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
    // Average each fingerprint cell over its area. Canvas interpolation alone
    // can miss artwork detail when reducing a large phone photo to 10 × 14.
    const sample = document.createElement("canvas");
    const scale = Math.min(1, 360 / Math.max(image.width, image.height));
    sample.width = Math.max(1, Math.round(image.width * scale));
    sample.height = Math.max(1, Math.round(image.height * scale));
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#888";
    ctx.fillRect(0, 0, sample.width, sample.height);
    ctx.drawImage(image, 0, 0, sample.width, sample.height);
    const { data } = ctx.getImageData(0, 0, sample.width, sample.height);
    const scaleX = sample.width / image.width;
    const scaleY = sample.height / image.height;
    const query = [];
    const add = (crop, penalty) => {
      const pixels = new Uint8ClampedArray(size);
      for (let row = 0; row < height; row++) {
        const top = Math.floor((crop.y + row * crop.height / height) * scaleY);
        const bottom = Math.min(sample.height, Math.ceil((crop.y + (row + 1) * crop.height / height) * scaleY));
        for (let column = 0; column < width; column++) {
          const left = Math.floor((crop.x + column * crop.width / width) * scaleX);
          const right = Math.min(sample.width, Math.ceil((crop.x + (column + 1) * crop.width / width) * scaleX));
          let red = 0, green = 0, blue = 0;
          for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) {
              const offset = (y * sample.width + x) * 4;
              red += data[offset];
              green += data[offset + 1];
              blue += data[offset + 2];
            }
          }
          const count = (bottom - top) * (right - left);
          const index = (row * width + column) * 3;
          pixels[index] = red / count;
          pixels[index + 1] = green / count;
          pixels[index + 2] = blue / count;
        }
      }
      const signature = describe(pixels, 0, 3);
      let contrast = 0;
      for (let i = 0; i < signature.length; i += 3) contrast += Math.abs(signature[i]);
      if (contrast / weights.length >= 8) query.push({ signature, penalty });
    };
    const full = { x: 0, y: 0, width: image.width, height: image.height };
    if (Math.abs(image.width / image.height - ratio) < .11) add(full, 0);
    for (const fraction of [1, .88, .75, .62]) add(centerCrop(image, fraction), 1 + (1 - fraction) * 2);
    for (const crop of edgeCrops(image)) add(crop, 2);
    // Holders and surrounding surfaces can obscure the card edges.
    for (const fraction of [.65, .70, .75, .80]) {
      const crop = centerCrop(image, fraction);
      for (const dx of [-.035, 0, .035]) {
        for (const dy of [-.07, -.035, 0, .035]) {
          add({ ...crop, x: crop.x + image.width * dx, y: crop.y + image.height * dy }, 2);
        }
      }
    }
    // On graded slabs the label is above the card, so a centered crop often cuts it off.
    if (image.width / image.height < .66) {
      for (const fraction of [.74, .81, .88]) {
        const cropWidth = image.width * fraction;
        const cropHeight = cropWidth / ratio;
        for (const center of [.58, .61, .64]) {
          const y = image.height * center - cropHeight / 2;
          if (y < 0 || y + cropHeight > image.height) continue;
          add({ x: (image.width - cropWidth) / 2, y, width: cropWidth, height: cropHeight }, 2);
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
      const gem = language === "zh-cn" && /^CBB[1-7]C-/.test(card.id);
      for (const query of queries) {
        const penalty = query.penalty + languagePenalty;
        const limit = Math.min(best, maxDistance) - penalty;
        best = Math.min(best, distance(query.signature, descriptors, offset, limit) + penalty);
        if (gem && query.penalty <= 1.5) {
          best = Math.min(best, artworkDistance(query.signature, descriptors, offset) + penalty + 4);
        }
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

  function cardBoundaries(image) {
    const sample = document.createElement("canvas");
    const scale = 260 / Math.max(image.width, image.height);
    const w = sample.width = Math.round(image.width * scale);
    const h = sample.height = Math.round(image.height * scale);
    if (w < 40 || h < 40) return [];
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, w, h);
    const { data } = context.getImageData(0, 0, w, h);
    function gradient(a, b) {
      return (Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) +
        Math.abs(data[a + 2] - data[b + 2])) / 3;
    }
    const vertical = new Float32Array(w);
    const horizontal = new Float32Array(h);
    const xLines = Array.from({ length: w }, () => new Float32Array(h + 1));
    const yLines = Array.from({ length: h }, () => new Float32Array(w + 1));
    for (let x = 1; x < w - 1; x++) {
      for (let y = 1; y < h - 1; y++) {
        const i = (y * w + x) * 4;
        const dx = gradient(i - 4, i + 4);
        const dy = gradient(i - 4 * w, i + 4 * w);
        xLines[x][y + 1] = xLines[x][y] + (dx > dy ? Math.min(dx, 75) : 0);
        yLines[y][x + 1] = yLines[y][x] + (dy > dx ? Math.min(dy, 75) : 0);
      }
    }
    for (let x = 1; x < w - 1; x++) vertical[x] = xLines[x][h - 1] / h;
    for (let y = 1; y < h - 1; y++) horizontal[y] = yLines[y][w - 1] / w;
    const xs = peaks(vertical);
    const ys = peaks(horizontal);
    const boxes = [];
    for (const left of xs) for (const right of xs) {
      const width = right - left;
      if (width < w * .12 || left < 1 || right >= w - 1) continue;
      for (const top of ys) for (const bottom of ys) {
        const height = bottom - top;
        if (height < h * .12 || top < 1 || bottom >= h - 1 || Math.abs(width / height - ratio) > .11) continue;
        const x1 = left + Math.round(width * .12), x2 = right - Math.round(width * .12);
        const y1 = top + Math.round(height * .12), y2 = bottom - Math.round(height * .12);
        const strengths = [
          (xLines[left][y2] - xLines[left][y1]) / (y2 - y1),
          (xLines[right][y2] - xLines[right][y1]) / (y2 - y1),
          (yLines[top][x2] - yLines[top][x1]) / (x2 - x1),
          (yLines[bottom][x2] - yLines[bottom][x1]) / (x2 - x1)
        ];
        if (Math.min(...strengths) < 6) continue;
        const score = strengths.reduce((sum, n) => sum + n, 0) + Math.min(...strengths) * 4 -
          Math.abs(width / height - ratio) * 100;
        boxes.push({ x: left / scale, y: top / scale, width: width / scale, height: height / scale, score });
      }
    }
    return boxes.sort((a, b) => b.score - a.score);
  }

  function overlap(a, b) {
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return width * height / Math.min(a.width * a.height, b.width * b.height);
  }

  function crop(image, box) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(box.width);
    canvas.height = Math.round(box.height);
    canvas.getContext("2d").drawImage(image, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function group(image, language, cards, current) {
    const boundaries = cardBoundaries(image);
    const detected = [];
    let attempted = 0;
    for (const bounds of boundaries) {
      if (!current()) return [];
      if (detected.some(cell => overlap(cell.bounds, bounds) > .25)) continue;
      if (++attempted > 26 || detected.length >= 12) break;
      const canvas = crop(image, bounds);
      const matches = (await search(canvas, language, cards)).filter(item => item.distance <= 24);
      if (matches.length) detected.push({ canvas, bounds, matches });
    }
    return detected.sort((a, b) => {
      const row = a.bounds.y - b.bounds.y;
      return Math.abs(row) < Math.min(a.bounds.height, b.bounds.height) * .35 ? a.bounds.x - b.bounds.x : row;
    });

  }

  return { search, group };
})();
