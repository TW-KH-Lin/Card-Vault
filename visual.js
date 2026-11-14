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

  function refineCardBounds(image, box) {
    // Look for strong vertical and horizontal edges near each side of the crop.
    const sample = document.createElement("canvas");
    const pad = .10;
    sample.width = 100;
    sample.height = 140;
    const left = Math.max(0, box.x - box.width * pad);
    const top = Math.max(0, box.y - box.height * pad);
    const w = Math.min(image.width - left, box.width * (1 + 2 * pad));
    const h = Math.min(image.height - top, box.height * (1 + 2 * pad));
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, left, top, w, h, 0, 0, 100, 140);
    const { data } = context.getImageData(0, 0, 100, 140);
    const grey = (x, y) => {
      const index = (y * 100 + x) * 4;
      return (data[index] + 2 * data[index + 1] + data[index + 2]) / 4;
    };
    function edge(expected, length, across, gradient) {
      let best = Math.max(0, Math.min(length - 1, expected));
      let score = 12;
      for (let position = Math.max(1, Math.round(expected - length * .15));
        position < Math.min(length - 1, expected + length * .15); position++) {
        let strength = 0;
        let count = 0;
        for (let cross = Math.round(across * .23); cross < across * .77; cross++) {
          strength += gradient(position, cross);
          count++;
        }
        strength = strength / count - Math.abs(position - expected) * .35;
        if (strength > score) { best = position; score = strength; }
      }
      return best;
    }
    const xEdge = x => edge((x - left) * 100 / w, 100, 140, (x, y) => Math.abs(grey(x + 1, y) - grey(x - 1, y)));
    const yEdge = y => edge((y - top) * 140 / h, 140, 100, (y, x) => Math.abs(grey(x, y + 1) - grey(x, y - 1)));
    const x0 = xEdge(box.x), x1 = xEdge(box.x + box.width);
    const y0 = yEdge(box.y), y1 = yEdge(box.y + box.height);
    const result = { x: left + x0 * w / 100, y: top + y0 * h / 140,
      width: (x1 - x0) * w / 100, height: (y1 - y0) * h / 140 };
    return Math.abs(result.width / result.height - ratio) < .17 ? result : box;
  }

  async function group(image, language, cards, current) {
    const layouts = [[2, 2, .12, .10], [2, 2, .05, .05], [2, 2, 0, 0], [2, 1, 0, 0], [1, 2, 0, 0], [3, 1, 0, 0], [1, 3, 0, 0]];
    let best = [];
    let bestScore = 0;
    for (const [columns, rows, insetX, insetY] of layouts) {
      if (!current()) return [];
      const cells = [];
      const width = image.width * (1 - 2 * insetX) / columns;
      const height = image.height * (1 - 2 * insetY) / rows;
      if (width / height < .35 || width / height > 1.2) continue;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
          canvas.getContext("2d").drawImage(image, image.width * insetX + column * width, image.height * insetY + row * height, width, height,
            0, 0, canvas.width, canvas.height);
          const bounds = { x: image.width * insetX + column * width, y: image.height * insetY + row * height, width, height };
          const match = await search(canvas, language, cards);
          let matches = match.filter(item => item.distance <= 24);
          if (!matches.length && columns === 2 && rows === 2 && insetX) {
            const centered = document.createElement("canvas");
            centered.width = Math.round(width * .9);
            centered.height = Math.round(centered.width / ratio);
            const x = image.width * insetX + column * width + width * .05;
            const y = image.height * insetY + row * height + (height - centered.height) / 2 - height * .07;
            centered.getContext("2d").drawImage(image, x, y, centered.width, centered.height,
              0, 0, centered.width, centered.height);
            matches = (await search(centered, language, cards)).filter(item => item.distance <= 24);
            if (matches.length) {
              cells.push({ canvas: centered, matches, bounds: { x, y, width: centered.width, height: centered.height } });
              continue;
            }
          }
          cells.push({ canvas, matches, bounds });
        }
      }
      const hits = cells.filter(cell => cell.matches.length);
      const score = hits.reduce((sum, cell) => sum + 29 - cell.matches[0].distance, 0) - (cells.length - hits.length) * 10;
      if (hits.length >= 2 && score > bestScore) {
        best = cells;
        bestScore = score;
      }
    }
    return best.map(cell => ({
      ...cell, bounds: refineCardBounds(image, cell.bounds)
    }));
  }

  return { search, group };
})();
