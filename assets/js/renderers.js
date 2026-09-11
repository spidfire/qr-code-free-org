/*!
 * renderers.js — draws a scene as SVG, canvas (PNG/JPG) or EPS.
 * Part of https://github.com/spidfire/qr-code-free-org (Apache License 2.0)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function n(value) {
    var r = Math.round(value * 1000) / 1000;
    return String(r === 0 ? 0 : r);
  }

  function escXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function visible(p) { return !!(p.fill || p.stroke); }

  /* ------------------------------------------------- text for PostScript/PDF */

  // Helvetica in EPS and PDF reaches Latin-1 only, so fold typographic
  // punctuation onto characters those encodings actually have.
  var PUNCTUATION = {
    '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201a': ',',
    '\u201c': '"', '\u201d': '"', '\u2026': '...', '\u2022': '\u00b7',
    '\u00a0': ' ', '\u2122': 'TM', '\u20ac': 'EUR', '\u2192': '->', '\u2713': 'v'
  };

  function toLatin1(str) {
    var out = '', replaced = 0;
    String(str).split('').forEach(function (ch) {
      var mapped = PUNCTUATION.hasOwnProperty(ch) ? PUNCTUATION[ch] : ch;
      for (var i = 0; i < mapped.length; i++) {
        if (mapped.charCodeAt(i) <= 0xff) out += mapped.charAt(i);
        else { out += '?'; replaced++; }
      }
    });
    return { text: out, replaced: replaced };
  }

  /** Literal string for PostScript and PDF: escaped, and pure ASCII on the wire. */
  function literal(str) {
    var out = '(';
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i), ch = str.charAt(i);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (code < 32 || code > 126) out += '\\' + ('00' + code.toString(8)).slice(-3);
      else out += ch;
    }
    return out + ')';
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  function defaultMeasure(str, size, weight) {
    return String(str).length * size * (weight === 'bold' ? 0.58 : 0.53);
  }

  var KAPPA = 0.5522847498;

  /* ----------------------------------------------------------------- SVG */

  function pathData(d) {
    var out = [], i = 0;
    while (i < d.length) {
      var cmd = d[i++];
      if (cmd === 'Z') { out.push('Z'); continue; }
      var count = cmd === 'C' ? 6 : 2;
      var nums = [];
      for (var k = 0; k < count; k++) nums.push(n(d[i++]));
      out.push(cmd + nums.join(' '));
    }
    return out.join('');
  }

  function toSVG(scene, options) {
    options = options || {};
    // `crop` ([x, y, w, h] in scene units) shows part of the drawing, for thumbnails.
    var box = options.crop || [0, 0, scene.width, scene.height];
    var scale = options.size ? options.size / box[2] : 1;
    var w = n(box[2] * scale), h = n(box[3] * scale);
    var out = [];

    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + w + '" height="' + h + '" viewBox="' + n(box[0]) + ' ' + n(box[1]) + ' ' + n(box[2]) + ' ' + n(box[3]) + '" ' +
      'role="img" aria-label="' + escXml(options.title || 'QR code') + '">');
    out.push('<title>' + escXml(options.title || 'QR code') + '</title>');
    if (options.description) out.push('<desc>' + escXml(options.description) + '</desc>');
    if (scene.bg) {
      out.push('<rect x="' + n(box[0]) + '" y="' + n(box[1]) + '" width="' + n(box[2]) +
        '" height="' + n(box[3]) + '" fill="' + scene.bg + '"/>');
    }

    scene.items.forEach(function (p) {
      if (!visible(p) && p.t !== 'image' && p.t !== 'text') return;
      var paint = p.stroke
        ? ' fill="none" stroke="' + p.stroke + '" stroke-width="' + n(p.lw || 1) + '"' +
          (p.cap ? ' stroke-linecap="' + p.cap + '"' : '')
        : ' fill="' + p.fill + '"';

      if (p.t === 'rect') {
        out.push('<rect x="' + n(p.x) + '" y="' + n(p.y) + '" width="' + n(p.w) + '" height="' + n(p.h) + '"' + paint + '/>');
      } else if (p.t === 'circle') {
        out.push('<circle cx="' + n(p.cx) + '" cy="' + n(p.cy) + '" r="' + n(p.r) + '"' + paint + '/>');
      } else if (p.t === 'path') {
        out.push('<path d="' + pathData(p.d) + '"' + paint + '/>');
      } else if (p.t === 'text' && p.str) {
        out.push('<text x="' + n(p.x) + '" y="' + n(p.y) + '" font-family="' + escXml(p.family) + '" font-size="' + n(p.size) +
          '" font-weight="' + (p.weight || 'normal') + '" fill="' + p.fill + '" text-anchor="middle" ' +
          'xml:space="preserve">' + escXml(p.str) + '</text>');
      } else if (p.t === 'image' && p.href) {
        out.push('<image x="' + n(p.x) + '" y="' + n(p.y) + '" width="' + n(p.w) + '" height="' + n(p.h) +
          '" preserveAspectRatio="xMidYMid meet" xlink:href="' + escXml(p.href) + '"/>');
      }
    });

    out.push('</svg>');
    return out.join('\n');
  }

  /* -------------------------------------------------------------- canvas */

  var imageCache = {};

  function loadImage(href) {
    if (imageCache[href]) return imageCache[href];
    imageCache[href] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image failed to load')); };
      img.src = href;
    });
    return imageCache[href];
  }

  function tracePath(ctx, d) {
    var i = 0;
    ctx.beginPath();
    while (i < d.length) {
      var cmd = d[i++];
      if (cmd === 'M') ctx.moveTo(d[i++], d[i++]);
      else if (cmd === 'L') ctx.lineTo(d[i++], d[i++]);
      else if (cmd === 'C') ctx.bezierCurveTo(d[i++], d[i++], d[i++], d[i++], d[i++], d[i++]);
      else if (cmd === 'Z') ctx.closePath();
    }
  }

  /** Draw a scene onto a canvas at `size` pixels wide. Resolves when images are in. */
  function draw(canvas, scene, size, options) {
    options = options || {};
    var scale = size / scene.width;
    canvas.width = Math.round(scene.width * scale);
    canvas.height = Math.round(scene.height * scale);

    var images = scene.items.filter(function (p) { return p.t === 'image' && p.href; });
    var waits = images.map(function (p) { return loadImage(p.href).catch(function () { return null; }); });

    return Promise.all(waits).then(function (loaded) {
      var ctx = canvas.getContext('2d');
      var map = {};
      images.forEach(function (p, i) { map[p.href] = loaded[i]; });

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      var background = options.background || scene.bg;
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, scene.width, scene.height);
      }

      scene.items.forEach(function (p) {
        if (p.stroke) {
          ctx.strokeStyle = p.stroke;
          ctx.lineWidth = p.lw || 1;
          ctx.lineCap = p.cap || 'butt';
          ctx.lineJoin = 'miter';
        }
        if (p.fill) ctx.fillStyle = p.fill;

        if (p.t === 'rect') {
          if (p.stroke) ctx.strokeRect(p.x, p.y, p.w, p.h);
          else if (p.fill) ctx.fillRect(p.x, p.y, p.w, p.h);
        } else if (p.t === 'circle') {
          ctx.beginPath();
          ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
          if (p.stroke) ctx.stroke(); else if (p.fill) ctx.fill();
        } else if (p.t === 'path') {
          tracePath(ctx, p.d);
          if (p.stroke) ctx.stroke(); else if (p.fill) ctx.fill();
        } else if (p.t === 'text' && p.str) {
          ctx.font = (p.weight || 'normal') + ' ' + p.size + 'px ' + p.family;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = p.fill;
          ctx.fillText(p.str, p.x, p.y);
        } else if (p.t === 'image' && map[p.href]) {
          var img = map[p.href];
          var ratio = Math.min(p.w / img.width, p.h / img.height);
          var iw = img.width * ratio, ih = img.height * ratio;
          ctx.drawImage(img, p.x + (p.w - iw) / 2, p.y + (p.h - ih) / 2, iw, ih);
        }
      });
      return canvas;
    });
  }

  /* ----------------------------------------------------------------- EPS */

  function psColour(hex) {
    var c = hexToRgb(hex);
    return n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + ' setrgbcolor';
  }

  function psString(str) {
    return literal(String(str).replace(/[\r\n]+/g, ' '));
  }

  function psPath(d) {
    var out = [], i = 0;
    out.push('newpath');
    while (i < d.length) {
      var cmd = d[i++];
      if (cmd === 'M') out.push(n(d[i++]) + ' ' + n(d[i++]) + ' moveto');
      else if (cmd === 'L') out.push(n(d[i++]) + ' ' + n(d[i++]) + ' lineto');
      else if (cmd === 'C') out.push(n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' curveto');
      else if (cmd === 'Z') out.push('closepath');
    }
    return out.join(' ');
  }

  /**
   * Vector EPS (PostScript Level 2). `size` is the width in PostScript points
   * (1 pt = 1/72 inch). Raster logos cannot be represented and are skipped.
   */
  function toEPS(scene, options) {
    options = options || {};
    var scale = (options.size || scene.width) / scene.width;
    var w = scene.width * scale, h = scene.height * scale;
    var skipped = 0, replaced = 0;
    var hasText = scene.items.some(function (p) { return p.t === 'text' && p.str; });
    var body = [];

    if (scene.bg) {
      body.push(psColour(scene.bg));
      body.push('newpath 0 0 moveto ' + n(scene.width) + ' 0 rlineto 0 ' + n(scene.height) +
        ' rlineto ' + n(-scene.width) + ' 0 rlineto closepath fill');
    }

    scene.items.forEach(function (p) {
      if (p.t === 'image') { skipped++; return; }
      if (p.t === 'text') {
        if (!p.str) return;
        var folded = toLatin1(p.str);
        replaced += folded.replaced;
        body.push(psColour(p.fill));
        body.push('gsave ' + n(p.x) + ' ' + n(p.y) + ' translate 1 -1 scale');
        body.push('/' + (p.weight === 'bold' ? 'QRFontBold' : 'QRFont') + ' findfont ' + n(p.size) + ' scalefont setfont');
        body.push(psString(folded.text) + ' dup stringwidth pop 2 div neg 0 moveto show grestore');
        return;
      }
      if (!visible(p)) return;

      body.push(psColour(p.stroke || p.fill));
      if (p.t === 'rect') {
        body.push('newpath ' + n(p.x) + ' ' + n(p.y) + ' moveto ' + n(p.w) + ' 0 rlineto 0 ' + n(p.h) +
          ' rlineto ' + n(-p.w) + ' 0 rlineto closepath');
      } else if (p.t === 'circle') {
        body.push('newpath ' + n(p.cx) + ' ' + n(p.cy) + ' ' + n(p.r) + ' 0 360 arc closepath');
      } else if (p.t === 'path') {
        body.push(psPath(p.d));
      }
      if (p.stroke) {
        body.push(n(p.lw || 1) + ' setlinewidth ' + (p.cap === 'square' ? '2' : '0') + ' setlinecap stroke');
      } else {
        body.push('fill');
      }
    });

    var eps = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      '%%Creator: qr-code-free.org (https://github.com/spidfire/qr-code-free-org)',
      '%%Title: ' + String(options.title || 'QR code').replace(/[\r\n]+/g, ' '),
      '%%CreationDate: ' + new Date().toISOString().slice(0, 10),
      '%%BoundingBox: 0 0 ' + Math.ceil(w) + ' ' + Math.ceil(h),
      '%%HiResBoundingBox: 0 0 ' + n(w) + ' ' + n(h),
      '%%LanguageLevel: 2',
      hasText ? '%%DocumentNeededResources: font Helvetica Helvetica-Bold' : '%%DocumentData: Clean7Bit',
      '%%EndComments',
      '%%BeginProlog',
      '/qrsave save def',
      // Helvetica ships with StandardEncoding, which has no accented characters.
      '/qrReencode {',
      '  findfont dup length dict begin',
      '    { 1 index /FID ne { def } { pop pop } ifelse } forall',
      '    /Encoding ISOLatin1Encoding def',
      '    currentdict',
      '  end definefont pop',
      '} bind def',
      '/QRFont /Helvetica qrReencode',
      '/QRFontBold /Helvetica-Bold qrReencode',
      '%%EndProlog',
      '%%Page: 1 1',
      'gsave',
      '0 ' + n(h) + ' translate ' + n(scale) + ' ' + n(-scale) + ' scale',
      '1 setlinejoin',
      // keep every mark inside the declared bounding box
      'newpath 0 0 moveto ' + n(scene.width) + ' 0 rlineto 0 ' + n(scene.height) +
        ' rlineto ' + n(-scene.width) + ' 0 rlineto closepath clip',
      body.join('\n'),
      'grestore',
      'showpage',
      'qrsave restore',
      '%%EOF',
      ''
    ].join('\n');

    return { eps: eps, skippedImages: skipped, simplifiedCharacters: replaced };
  }


  /* ----------------------------------------------------------------- PDF */

  function pdfColour(hex, stroke) {
    var c = hexToRgb(hex);
    return n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + ' ' + (stroke ? 'RG' : 'rg');
  }

  function pdfPath(d) {
    var out = [], i = 0;
    while (i < d.length) {
      var cmd = d[i++];
      if (cmd === 'M') out.push(n(d[i++]) + ' ' + n(d[i++]) + ' m');
      else if (cmd === 'L') out.push(n(d[i++]) + ' ' + n(d[i++]) + ' l');
      else if (cmd === 'C') out.push(n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' ' + n(d[i++]) + ' c');
      else if (cmd === 'Z') out.push('h');
    }
    return out.join(' ');
  }

  /** A circle as four Bezier arcs, because PDF has no circle operator. */
  function pdfCircle(cx, cy, r) {
    var k = KAPPA * r;
    return [
      n(cx - r) + ' ' + n(cy) + ' m',
      n(cx - r) + ' ' + n(cy - k) + ' ' + n(cx - k) + ' ' + n(cy - r) + ' ' + n(cx) + ' ' + n(cy - r) + ' c',
      n(cx + k) + ' ' + n(cy - r) + ' ' + n(cx + r) + ' ' + n(cy - k) + ' ' + n(cx + r) + ' ' + n(cy) + ' c',
      n(cx + r) + ' ' + n(cy + k) + ' ' + n(cx + k) + ' ' + n(cy + r) + ' ' + n(cx) + ' ' + n(cy + r) + ' c',
      n(cx - k) + ' ' + n(cy + r) + ' ' + n(cx - r) + ' ' + n(cy + k) + ' ' + n(cx - r) + ' ' + n(cy) + ' c h'
    ].join(' ');
  }

  /**
   * Vector PDF (1.4). `size` is the width in points (1 pt = 1/72 inch).
   * options.image = { data: Uint8Array (JPEG), width, height } embeds the logo,
   * already rasterised at the right aspect ratio by the caller.
   * options.measure(str, size, weight) gives text widths for centring; without it
   * an estimate is used, because PDF cannot measure text at draw time.
   */
  function toPDF(scene, options) {
    options = options || {};
    var scale = (options.size || scene.width) / scene.width;
    var width = scene.width * scale, height = scene.height * scale;
    var measure = options.measure || defaultMeasure;
    var image = options.image && options.image.data ? options.image : null;
    var replaced = 0, skipped = 0, usedImage = false;
    var ops = [];

    ops.push('q');
    ops.push(n(scale) + ' 0 0 ' + n(-scale) + ' 0 ' + n(height) + ' cm');   // scene units, y downwards
    ops.push('0 0 ' + n(scene.width) + ' ' + n(scene.height) + ' re W n');  // clip to the page
    ops.push('1 j');                                                        // round joins, as in SVG

    if (scene.bg) {
      ops.push(pdfColour(scene.bg, false));
      ops.push('0 0 ' + n(scene.width) + ' ' + n(scene.height) + ' re f');
    }

    scene.items.forEach(function (p) {
      if (p.t === 'image') {
        if (!image) { skipped++; return; }
        usedImage = true;
        ops.push('q ' + n(p.w) + ' 0 0 ' + n(-p.h) + ' ' + n(p.x) + ' ' + n(p.y + p.h) + ' cm /Im0 Do Q');
        return;
      }
      if (p.t === 'text') {
        if (!p.str) return;
        var folded = toLatin1(p.str);
        replaced += folded.replaced;
        var w = measure(p.str, p.size, p.weight);
        ops.push(pdfColour(p.fill, false));
        ops.push('q 1 0 0 -1 ' + n(p.x) + ' ' + n(p.y) + ' cm');
        ops.push('BT /' + (p.weight === 'bold' ? 'F1' : 'F2') + ' ' + n(p.size) + ' Tf ' +
          n(-w / 2) + ' 0 Td ' + literal(folded.text) + ' Tj ET');
        ops.push('Q');
        return;
      }
      if (!visible(p)) return;

      ops.push(pdfColour(p.stroke || p.fill, !!p.stroke));
      if (p.t === 'rect') ops.push(n(p.x) + ' ' + n(p.y) + ' ' + n(p.w) + ' ' + n(p.h) + ' re');
      else if (p.t === 'circle') ops.push(pdfCircle(p.cx, p.cy, p.r));
      else if (p.t === 'path') ops.push(pdfPath(p.d));

      if (p.stroke) ops.push(n(p.lw || 1) + ' w ' + (p.cap === 'square' ? '2' : '0') + ' J S');
      else ops.push('f');
    });
    ops.push('Q');

    var content = ops.join('\n') + '\n';
    var objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + n(width) + ' ' + n(height) + '] ' +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >>' +
        (usedImage ? ' /XObject << /Im0 7 0 R >>' : '') + ' >> /Contents 4 0 R >>',
      { dict: '<< /Length ' + content.length + ' >>', stream: content },
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    ];
    if (usedImage) {
      objects.push({
        dict: '<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + image.data.length + ' >>',
        stream: image.data
      });
    }

    var parts = [], length = 0, offsets = [];
    var add = function (part) {
      parts.push(part);
      length += typeof part === 'string' ? part.length : part.length;    // every string here is ASCII
    };

    add('%PDF-1.4\n');
    add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));           // marks the file as binary
    objects.forEach(function (object, index) {
      offsets.push(length);
      add((index + 1) + ' 0 obj\n');
      if (typeof object === 'string') {
        add(object + '\n');
      } else {
        add(object.dict + '\nstream\n');
        add(object.stream);
        add('\nendstream\n');
      }
      add('endobj\n');
    });

    var startxref = length;
    var xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (offset) {
      xref += ('0000000000' + offset).slice(-10) + ' 00000 n \n';
    });
    add(xref);
    add('trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Producer (qr-code-free.org) ' +
      '/Title ' + literal(toLatin1(options.title || 'QR code').text) + ' >>\n');
    add('startxref\n' + startxref + '\n%%EOF\n');

    var bytes = new Uint8Array(length), at = 0;
    parts.forEach(function (part) {
      if (typeof part === 'string') {
        for (var i = 0; i < part.length; i++) bytes[at++] = part.charCodeAt(i) & 0xff;
      } else {
        bytes.set(part, at);
        at += part.length;
      }
    });

    return { pdf: bytes, skippedImages: skipped, simplifiedCharacters: replaced };
  }

  return { toSVG: toSVG, toEPS: toEPS, toPDF: toPDF, draw: draw, pathData: pathData, toLatin1: toLatin1 };
});
