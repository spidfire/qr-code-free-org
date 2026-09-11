/*!
 * qr.js — minimal, dependency-free QR Code encoder (ISO/IEC 18004).
 * Part of https://github.com/spidfire/qr-code-free-org
 * Copyright the qr-code-free.org contributors. Licensed under the Apache License 2.0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- tables */

  // Error correction codewords per block, indexed [ecl][version]. Index 0 unused.
  var ECC_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };

  // Number of error correction blocks, indexed [ecl][version]. Index 0 unused.
  var NUM_BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };

  var ECL_ORDER = ['L', 'M', 'Q', 'H'];
  var ECL_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  /* ------------------------------------------------------------- GF(256) */

  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // Generator polynomial of the given degree; index 0 holds the highest degree term.
  function genPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1);
      for (var n = 0; n < next.length; n++) next[n] = 0;
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function remainder(data, poly) {
    var ecc = new Uint8Array(poly.length - 1);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ ecc[0];
      ecc.copyWithin(0, 1);
      ecc[ecc.length - 1] = 0;
      for (var j = 0; j < ecc.length; j++) ecc[j] ^= gmul(poly[j + 1], factor);
    }
    return ecc;
  }

  /* ----------------------------------------------------------- capacities */

  function rawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function totalCodewords(version) { return Math.floor(rawDataModules(version) / 8); }

  function dataCodewords(version, ecl) {
    return totalCodewords(version) - ECC_PER_BLOCK[ecl][version] * NUM_BLOCKS[ecl][version];
  }

  /* ----------------------------------------------------------- bit stream */

  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.push = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  /* --------------------------------------------------------------- modes */

  var MODE = {
    numeric: { bits: 1, ccBits: [10, 12, 14] },
    alphanumeric: { bits: 2, ccBits: [9, 11, 13] },
    byte: { bits: 4, ccBits: [8, 16, 16] }
  };

  function charCountBits(mode, version) {
    var i = version <= 9 ? 0 : (version <= 26 ? 1 : 2);
    return MODE[mode].ccBits[i];
  }

  function toUtf8(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var out = [], encoded = unescape(encodeURIComponent(text));
    for (var i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i));
    return new Uint8Array(out);
  }

  function pickMode(text) {
    if (/^[0-9]*$/.test(text)) return 'numeric';
    for (var i = 0; i < text.length; i++) if (ALPHANUMERIC.indexOf(text.charAt(i)) < 0) return 'byte';
    return 'alphanumeric';
  }

  // Payload bit length, excluding mode indicator and character count.
  function payloadBits(mode, text, bytes) {
    if (mode === 'numeric') {
      var groups = Math.floor(text.length / 3), rest = text.length % 3;
      return groups * 10 + (rest === 0 ? 0 : rest === 1 ? 4 : 7);
    }
    if (mode === 'alphanumeric') return Math.floor(text.length / 2) * 11 + (text.length % 2) * 6;
    return bytes.length * 8;
  }

  function writePayload(buf, mode, text, bytes) {
    var i;
    if (mode === 'numeric') {
      for (i = 0; i + 3 <= text.length; i += 3) buf.push(parseInt(text.substr(i, 3), 10), 10);
      var rest = text.length - i;
      if (rest > 0) buf.push(parseInt(text.substr(i), 10), rest === 1 ? 4 : 7);
    } else if (mode === 'alphanumeric') {
      for (i = 0; i + 2 <= text.length; i += 2) {
        buf.push(ALPHANUMERIC.indexOf(text.charAt(i)) * 45 + ALPHANUMERIC.indexOf(text.charAt(i + 1)), 11);
      }
      if (i < text.length) buf.push(ALPHANUMERIC.indexOf(text.charAt(i)), 6);
    } else {
      for (i = 0; i < bytes.length; i++) buf.push(bytes[i], 8);
    }
  }

  /* ----------------------------------------------------------- codewords */

  function buildCodewords(text, version, ecl, mode, bytes) {
    var buf = new BitBuffer();
    buf.push(MODE[mode].bits, 4);
    buf.push(mode === 'byte' ? bytes.length : text.length, charCountBits(mode, version));
    writePayload(buf, mode, text, bytes);

    var capacity = dataCodewords(version, ecl) * 8;
    var bits = buf.bits;
    if (bits.length > capacity) throw new Error('data does not fit the chosen version');

    for (var t = 0; t < 4 && bits.length < capacity; t++) bits.push(0);   // terminator
    while (bits.length % 8 !== 0) bits.push(0);                          // byte align

    var data = new Uint8Array(dataCodewords(version, ecl));
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
      data[i / 8] = byte;
    }
    for (var p = bits.length / 8, pad = 0; p < data.length; p++, pad++) {
      data[p] = pad % 2 === 0 ? 0xec : 0x11;                             // pad codewords
    }
    return data;
  }

  function addEccAndInterleave(data, version, ecl) {
    var numBlocks = NUM_BLOCKS[ecl][version];
    var eccLen = ECC_PER_BLOCK[ecl][version];
    var raw = totalCodewords(version);
    var shortBlocks = numBlocks - raw % numBlocks;
    var shortLen = Math.floor(raw / numBlocks) - eccLen;
    var poly = genPoly(eccLen);

    var blocks = [], offset = 0;
    for (var i = 0; i < numBlocks; i++) {
      var len = shortLen + (i < shortBlocks ? 0 : 1);
      var chunk = data.subarray(offset, offset + len);
      offset += len;
      blocks.push({ data: chunk, ecc: remainder(chunk, poly) });
    }

    var result = new Uint8Array(raw), k = 0, j;
    for (i = 0; i <= shortLen; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].data.length) result[k++] = blocks[j].data[i];
    }
    for (i = 0; i < eccLen; i++) {
      for (j = 0; j < blocks.length; j++) result[k++] = blocks[j].ecc[i];
    }
    return result;
  }

  /* -------------------------------------------------------------- matrix */

  function Matrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.reserved = new Uint8Array(this.size * this.size);
  }
  Matrix.prototype.get = function (x, y) { return this.modules[y * this.size + x]; };
  Matrix.prototype.set = function (x, y, dark) { this.modules[y * this.size + x] = dark ? 1 : 0; };
  Matrix.prototype.setFunction = function (x, y, dark) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.set(x, y, dark);
    this.reserved[y * this.size + x] = 1;
  };
  Matrix.prototype.isReserved = function (x, y) { return this.reserved[y * this.size + x] === 1; };

  function alignmentPositions(version) {
    if (version === 1) return [];
    var numAlign = Math.floor(version / 7) + 2;
    var size = version * 4 + 17;
    var step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function drawFunctionPatterns(m) {
    var size = m.size, i, j;

    for (i = 0; i < size; i++) {                                   // timing patterns
      m.setFunction(6, i, i % 2 === 0);
      m.setFunction(i, 6, i % 2 === 0);
    }

    var finders = [[3, 3], [size - 4, 3], [3, size - 4]];          // finders + separators
    for (var f = 0; f < finders.length; f++) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          m.setFunction(finders[f][0] + dx, finders[f][1] + dy, dist !== 2 && dist !== 4);
        }
      }
    }

    var align = alignmentPositions(m.version);                     // alignment patterns
    for (i = 0; i < align.length; i++) {
      for (j = 0; j < align.length; j++) {
        var corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
        if (corner) continue;
        for (var ay = -2; ay <= 2; ay++) {
          for (var ax = -2; ax <= 2; ax++) {
            m.setFunction(align[i] + ax, align[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
          }
        }
      }
    }

    drawFormatBits(m, 'M', 0);                                     // reserve, real value later
    drawVersionBits(m);
  }

  function bchRemainder(value, generator, bits) {
    for (var i = bits - 1; i >= 0; i--) {
      value = (value << 1) ^ (((value >>> (bits - 1)) & 1) * generator);
    }
    return value & ((1 << bits) - 1);
  }

  function drawFormatBits(m, ecl, mask) {
    var data = (ECL_FORMAT_BITS[ecl] << 3) | mask;
    var rem = bchRemainder(data, 0x537, 10);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var size = m.size, i;
    var bit = function (n) { return ((bits >>> n) & 1) === 1; };

    for (i = 0; i <= 5; i++) m.setFunction(8, i, bit(i));
    m.setFunction(8, 7, bit(6));
    m.setFunction(8, 8, bit(7));
    m.setFunction(7, 8, bit(8));
    for (i = 9; i < 15; i++) m.setFunction(14 - i, 8, bit(i));

    for (i = 0; i < 8; i++) m.setFunction(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) m.setFunction(8, size - 15 + i, bit(i));
    m.setFunction(8, size - 8, true);                              // always dark module
  }

  function drawVersionBits(m) {
    if (m.version < 7) return;
    var rem = bchRemainder(m.version, 0x1f25, 12);
    var bits = (m.version << 12) | rem;
    for (var i = 0; i < 18; i++) {
      var bit = ((bits >>> i) & 1) === 1;
      var a = m.size - 11 + (i % 3), b = Math.floor(i / 3);
      m.setFunction(a, b, bit);
      m.setFunction(b, a, bit);
    }
  }

  function drawCodewords(m, codewords) {
    var size = m.size, i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!m.isReserved(x, y) && i < codewords.length * 8) {
            m.set(x, y, ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1);
            i++;
          }
        }
      }
    }
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
    function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
  ];

  function applyMask(m, mask) {
    for (var y = 0; y < m.size; y++) {
      for (var x = 0; x < m.size; x++) {
        if (!m.isReserved(x, y) && MASKS[mask](x, y)) m.set(x, y, !m.get(x, y));
      }
    }
  }

  var FINDER_RUN = [1, 0, 1, 1, 1, 0, 1];

  function penalty(m) {
    var size = m.size, score = 0, dark = 0, x, y;

    // N1: runs of five or more same-coloured modules in a row or column.
    for (y = 0; y < size; y++) {
      var rowRun = 1, colRun = 1;
      for (x = 1; x < size; x++) {
        rowRun = m.get(x, y) === m.get(x - 1, y) ? rowRun + 1 : 1;
        if (rowRun === 5) score += 3; else if (rowRun > 5) score += 1;
        colRun = m.get(y, x) === m.get(y, x - 1) ? colRun + 1 : 1;
        if (colRun === 5) score += 3; else if (colRun > 5) score += 1;
      }
    }

    // N2: 2x2 blocks of one colour.
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var v = m.get(x, y);
        if (v === m.get(x + 1, y) && v === m.get(x, y + 1) && v === m.get(x + 1, y + 1)) score += 3;
      }
    }

    // N3: finder-like 1:1:3:1:1 patterns with four light modules beside them.
    var hasPattern = function (read, at) {
      for (var i = 0; i < 7; i++) if (read(at + i) !== FINDER_RUN[i]) return false;
      var before = true, after = true;
      for (i = 1; i <= 4; i++) {
        if (read(at - i) !== 0) before = false;
        if (read(at + 6 + i) !== 0) after = false;
      }
      return before || after;
    };
    for (y = 0; y < size; y++) {
      var row = (function (yy) { return function (i) { return (i < 0 || i >= size) ? 0 : m.get(i, yy); }; })(y);
      var col = (function (xx) { return function (i) { return (i < 0 || i >= size) ? 0 : m.get(xx, i); }; })(y);
      for (x = 0; x <= size - 7; x++) {
        if (hasPattern(row, x)) score += 40;
        if (hasPattern(col, x)) score += 40;
      }
    }

    // N4: deviation from an even balance of dark and light modules.
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m.get(x, y)) dark++;
    var percent = dark * 100 / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  /* ----------------------------------------------------------------- api */

  function fits(text, bytes, mode, version, ecl) {
    return 4 + charCountBits(mode, version) + payloadBits(mode, text, bytes) <= dataCodewords(version, ecl) * 8;
  }

  /**
   * Encode text into a QR symbol.
   * options: { ecl: 'L'|'M'|'Q'|'H', minVersion, maxVersion, mask, boost }
   * returns { version, size, ecl, mask, mode, get(x, y), modules }
   */
  function encode(text, options) {
    options = options || {};
    var ecl = ECL_FORMAT_BITS.hasOwnProperty(options.ecl) ? options.ecl : 'M';
    var minVersion = Math.max(1, Math.min(40, options.minVersion || 1));
    var maxVersion = Math.max(minVersion, Math.min(40, options.maxVersion || 40));
    text = String(text == null ? '' : text);

    var mode = pickMode(text);
    var bytes = mode === 'byte' ? toUtf8(text) : new Uint8Array(0);

    var version = 0;
    for (var v = minVersion; v <= maxVersion; v++) {
      if (fits(text, bytes, mode, v, ecl)) { version = v; break; }
    }
    if (!version) {
      throw new Error('too much data for a QR code at error correction level ' + ecl);
    }

    if (options.boost !== false) {                                 // free robustness upgrade
      for (var e = ECL_ORDER.length - 1; e > ECL_ORDER.indexOf(ecl); e--) {
        if (fits(text, bytes, mode, version, ECL_ORDER[e])) { ecl = ECL_ORDER[e]; break; }
      }
    }

    var codewords = addEccAndInterleave(buildCodewords(text, version, ecl, mode, bytes), version, ecl);
    var m = new Matrix(version);
    drawFunctionPatterns(m);
    drawCodewords(m, codewords);

    var mask = options.mask;
    if (typeof mask !== 'number' || mask < 0 || mask > 7) {
      var best = Infinity;
      mask = 0;
      for (var k = 0; k < 8; k++) {
        applyMask(m, k);
        drawFormatBits(m, ecl, k);
        var p = penalty(m);
        if (p < best) { best = p; mask = k; }
        applyMask(m, k);                                           // undo (xor is its own inverse)
      }
    }
    applyMask(m, mask);
    drawFormatBits(m, ecl, mask);

    return {
      version: version,
      size: m.size,
      ecl: ecl,
      mask: mask,
      mode: mode,
      modules: m.modules,
      get: function (x, y) { return m.get(x, y) === 1; }
    };
  }

  return {
    encode: encode,
    dataCodewords: dataCodewords,
    totalCodewords: totalCodewords,
    pickMode: pickMode,
    /** Largest number of characters of `text`'s mode that fits at each level. */
    capacityBits: function (version, ecl) { return dataCodewords(version, ecl) * 8; }
  };
});
