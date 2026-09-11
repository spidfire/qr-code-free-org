/*!
 * scene.js — turns a QR matrix plus styling options into a resolution independent
 * list of drawing primitives, so PNG, JPG, SVG and EPS all draw the exact same picture.
 * Part of https://github.com/spidfire/qr-code-free-org (Apache License 2.0)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRScene = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var U = 8;                       // drawing units per QR module
  var KAPPA = 0.5522847498;        // circle-to-bezier constant
  var FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

  /* ------------------------------------------------------------- geometry */

  function normRadii(r, w, h) {
    var a = typeof r === 'number' ? [r, r, r, r] : r.slice();
    var max = Math.min(w, h) / 2;
    for (var i = 0; i < 4; i++) a[i] = Math.max(0, Math.min(a[i], max));
    return a;
  }

  /** Rounded rectangle as a path command list. radii: number or [tl, tr, br, bl]. */
  function rrect(x, y, w, h, r) {
    var a = normRadii(r, w, h), k = KAPPA;
    var d = ['M', x + a[0], y];
    d.push('L', x + w - a[1], y);
    if (a[1]) d.push('C', x + w - a[1] + a[1] * k, y, x + w, y + a[1] - a[1] * k, x + w, y + a[1]);
    d.push('L', x + w, y + h - a[2]);
    if (a[2]) d.push('C', x + w, y + h - a[2] + a[2] * k, x + w - a[2] + a[2] * k, y + h, x + w - a[2], y + h);
    d.push('L', x + a[3], y + h);
    if (a[3]) d.push('C', x + a[3] - a[3] * k, y + h, x, y + h - a[3] + a[3] * k, x, y + h - a[3]);
    d.push('L', x, y + a[0]);
    if (a[0]) d.push('C', x, y + a[0] - a[0] * k, x + a[0] - a[0] * k, y, x + a[0], y);
    d.push('Z');
    return d;
  }

  function path(d, style) {
    var p = { t: 'path', d: d };
    for (var k in style) if (style.hasOwnProperty(k)) p[k] = style[k];
    return p;
  }

  /** Rough text width, used for layout. Deliberately format independent. */
  function textWidth(str, size, weight) {
    return String(str).length * size * (weight === 'bold' ? 0.58 : 0.53);
  }

  function fitSize(str, size, available, weight) {
    var w = textWidth(str, size, weight);
    return w > available && w > 0 ? size * available / w : size;
  }

  /* --------------------------------------------------------------- frames */

  // Each frame gets `c` (context) and returns primitives. `c.pad` is claimed space
  // around the QR block; `behind` draws under the QR, `front` over it.
  var FRAMES = [
    {
      id: 'none', name: 'None',
      pad: function () { return [0, 0, 0, 0]; },
      draw: function () { return {}; }
    },
    {
      id: 'bottom', name: 'Caption below',
      label: true, needsPlate: true,
      pad: function (c) { return [c.p, c.p, c.p + c.bar, c.p]; },
      draw: function (c) {
        return {
          behind: [path(rrect(0, 0, c.w, c.h, c.p * 1.4), { fill: c.frame })],
          front: [c.captionText(c.h - c.p - c.bar / 2, c.frame === c.plate ? c.text : c.text)]
        };
      }
    },
    {
      id: 'top', name: 'Caption above',
      label: true, needsPlate: true,
      pad: function (c) { return [c.p + c.bar, c.p, c.p, c.p]; },
      draw: function (c) {
        return {
          behind: [path(rrect(0, 0, c.w, c.h, c.p * 1.4), { fill: c.frame })],
          front: [c.captionText(c.p + c.bar / 2)]
        };
      }
    },
    {
      id: 'panel', name: 'Card on a panel',
      label: true,
      pad: function (c) { return [c.p * 1.6, c.p * 1.6, c.p * 1.6 + c.bar, c.p * 1.6]; },
      draw: function (c) {
        return {
          behind: [
            path(rrect(0, 0, c.w, c.h, c.p * 1.8), { fill: c.frame }),
            path(rrect(c.p * 0.9, c.p * 0.9, c.w - c.p * 1.8, c.qs + c.p * 1.4, c.p), { fill: c.plate })
          ],
          front: [c.captionText(c.h - c.p * 1.6 - c.bar / 2)]
        };
      }
    },
    {
      id: 'outline', name: 'Thin outline',
      label: true,
      pad: function (c) { return [c.p * 1.5, c.p * 1.5, c.p * 1.5 + c.bar, c.p * 1.5]; },
      draw: function (c) {
        var lw = c.qs * 0.016;
        return {
          behind: [
            path(rrect(0, 0, c.w, c.h, c.p * 1.4), { fill: c.plate }),
            path(rrect(lw, lw, c.w - lw * 2, c.h - lw * 2, c.p * 1.2), { stroke: c.frame, lw: lw })
          ],
          front: [c.captionText(c.h - c.p * 1.5 - c.bar / 2, c.frame)]
        };
      }
    },
    {
      id: 'chip', name: 'Label on the border',
      label: true,
      pad: function (c) { return [c.p * 1.4, c.p * 1.4, c.p * 1.4 + c.bar * 0.5, c.p * 1.4]; },
      draw: function (c) {
        var lw = c.qs * 0.018;
        var size = fitSize(c.labelText, c.bar * 0.46, c.w * 0.62, 'bold');
        var cw = textWidth(c.labelText, size, 'bold') + size * 1.6;
        var ch = size * 2;
        var cy = c.h - c.p * 1.4 - c.bar * 0.5;
        return {
          behind: [
            path(rrect(0, 0, c.w, c.h - ch / 2 - c.p * 0.2, c.p * 1.2), { fill: c.plate }),
            path(rrect(lw, lw, c.w - lw * 2, c.h - ch / 2 - c.p * 0.2 - lw * 2, c.p), { stroke: c.frame, lw: lw })
          ],
          front: [
            path(rrect((c.w - cw) / 2, cy - ch / 2, cw, ch, ch / 2), { fill: c.frame }),
            { t: 'text', x: c.w / 2, y: cy + size * 0.35, str: c.labelText, size: size, fill: c.text, weight: 'bold', family: FONT, align: 'center' }
          ]
        };
      }
    },
    {
      id: 'arrow', name: 'Arrow to the code',
      label: true,
      pad: function (c) { return [c.p + c.bar * 1.45, c.p, c.p, c.p]; },
      draw: function (c) {
        var barH = c.bar;
        var tip = c.bar * 0.42;
        var bw = Math.min(c.w, Math.max(c.w * 0.62, textWidth(c.labelText, barH * 0.5, 'bold') + barH));
        var bx = (c.w - bw) / 2;
        return {
          behind: [
            path(rrect(bx, c.p * 0.4, bw, barH, barH * 0.28), { fill: c.frame }),
            path(['M', c.w / 2 - tip, c.p * 0.4 + barH, 'L', c.w / 2 + tip, c.p * 0.4 + barH,
              'L', c.w / 2, c.p * 0.4 + barH + tip * 1.1, 'Z'], { fill: c.frame })
          ],
          front: [c.captionText(c.p * 0.4 + barH / 2)]
        };
      }
    },
    {
      id: 'brackets', name: 'Corner brackets',
      label: true,
      pad: function (c) { return [c.p * 1.2, c.p * 1.2, c.p * 1.2 + c.bar, c.p * 1.2]; },
      draw: function (c) {
        var lw = c.qs * 0.028, len = c.qs * 0.16, o = lw / 2;
        var bw = c.w, bh = c.h - c.bar;
        var corner = function (x, y, sx, sy) {
          return path(['M', x + sx * len, y + o * sy * 0 + (sy > 0 ? o : -o),
            'L', x + sx * o, y + (sy > 0 ? o : -o), 'L', x + sx * o, y + sy * len],
            { stroke: c.frame, lw: lw, cap: 'square' });
        };
        return {
          behind: [],
          front: [
            corner(0, 0, 1, 1), corner(bw, 0, -1, 1),
            corner(0, bh, 1, -1), corner(bw, bh, -1, -1),
            c.captionText(c.h - c.bar / 2 + c.p * 0.2, c.frame)
          ]
        };
      }
    },
    {
      id: 'bubble', name: 'Speech bubble',
      label: true,
      pad: function (c) { return [c.p * 1.3 + c.bar, c.p * 1.3, c.p * 1.3 + c.bar * 0.55, c.p * 1.3]; },
      draw: function (c) {
        var bodyH = c.h - c.bar * 0.55;
        var tailW = c.qs * 0.13, tailX = c.w * 0.26;
        return {
          behind: [
            path(rrect(0, 0, c.w, bodyH, c.p * 2), { fill: c.frame }),
            path(['M', tailX, bodyH - 2, 'L', tailX + tailW, bodyH - 2,
              'L', tailX + tailW * 0.25, bodyH + c.bar * 0.55, 'Z'], { fill: c.frame }),
            path(rrect(c.p * 1.3, c.p * 1.3 + c.bar, c.qs, c.qs, c.p * 0.6), { fill: c.plate })
          ],
          front: [c.captionText(c.p * 1.3 + c.bar / 2)]
        };
      }
    },
    {
      id: 'ticket', name: 'Ticket',
      label: true,
      pad: function (c) { return [c.p * 1.5, c.p * 1.5, c.p * 1.5 + c.bar * 1.15, c.p * 1.5]; },
      draw: function (c) {
        var notchY = c.h - c.p * 1.5 - c.bar * 1.15;
        var nr = c.qs * 0.05;
        var dash = [];
        var y = notchY, step = c.qs * 0.05;
        for (var x = nr * 1.6; x < c.w - nr * 1.6; x += step * 2) {
          dash.push(path(['M', x, y, 'L', Math.min(x + step, c.w - nr * 1.6), y], { stroke: c.frame, lw: c.qs * 0.008 }));
        }
        return {
          behind: [path(rrect(0, 0, c.w, c.h, c.p * 1.3), { fill: c.plate }),
            path(rrect(c.qs * 0.012, c.qs * 0.012, c.w - c.qs * 0.024, c.h - c.qs * 0.024, c.p * 1.2), { stroke: c.frame, lw: c.qs * 0.024 })],
          front: dash.concat([
            { t: 'circle', cx: 0, cy: notchY, r: nr, fill: c.outside },
            { t: 'circle', cx: c.w, cy: notchY, r: nr, fill: c.outside },
            c.captionText(c.h - c.p * 1.5 - c.bar * 0.55, c.frame)
          ])
        };
      }
    },
    {
      id: 'phone', name: 'Phone',
      label: true,
      pad: function (c) { return [c.p * 2.6, c.p * 2.2, c.p * 2.2 + c.bar * 1.5, c.p * 2.2]; },
      draw: function (c) {
        var r = c.qs * 0.11;
        var notchW = c.w * 0.3, notchH = c.p * 1.1;
        return {
          behind: [
            path(rrect(0, 0, c.w, c.h, r), { fill: c.frame }),
            path(rrect(c.p * 0.6, c.p * 1.7, c.w - c.p * 1.2, c.h - c.p * 2.3, r * 0.62), { fill: c.plate })
          ],
          front: [
            path(rrect((c.w - notchW) / 2, c.p * 0.45, notchW, notchH, notchH / 2), { fill: c.plate }),
            c.captionText(c.h - c.p * 2.2 - c.bar * 0.75, c.frame)
          ]
        };
      }
    },
    {
      id: 'ribbon', name: 'Ribbon',
      label: true,
      pad: function (c) { return [c.p, c.p * 1.8, c.p + c.bar * 1.1, c.p * 1.8]; },
      draw: function (c) {
        var size = fitSize(c.labelText, c.bar * 0.5, c.w * 0.8, 'bold');
        var rh = c.bar;
        var ry = c.h - c.p - rh * 1.05;
        var fold = c.bar * 0.32;
        return {
          behind: [path(rrect(0, 0, c.w, c.h, c.p * 1.2), { fill: c.plate })],
          front: [
            path(['M', 0, ry + fold, 'L', fold, ry, 'L', c.w - fold, ry, 'L', c.w, ry + fold,
              'L', c.w, ry + rh - fold, 'L', c.w - fold, ry + rh, 'L', fold, ry + rh,
              'L', 0, ry + rh - fold, 'Z'], { fill: c.frame }),
            { t: 'text', x: c.w / 2, y: ry + rh / 2 + size * 0.35, str: c.labelText, size: size, fill: c.text, weight: 'bold', family: FONT, align: 'center' }
          ]
        };
      }
    }
  ];

  var frameById = {};
  FRAMES.forEach(function (f) { frameById[f.id] = f; });

  /* -------------------------------------------------------------- modules */

  function inFinder(x, y, size) {
    return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  }

  function modulePrims(qr, shape, fill, ox, oy, skipFinders) {
    var out = [], size = qr.size, x, y;
    var dark = function (px, py) {
      if (px < 0 || py < 0 || px >= size || py >= size) return false;
      if (skipFinders && inFinder(px, py, size)) return false;
      return qr.get(px, py);
    };

    if (shape === 'dots' || shape === 'rounded') {
      for (y = 0; y < size; y++) {
        for (x = 0; x < size; x++) {
          if (!dark(x, y)) continue;
          if (shape === 'dots') {
            out.push({ t: 'circle', cx: ox + (x + 0.5) * U, cy: oy + (y + 0.5) * U, r: U * 0.46, fill: fill });
          } else {
            out.push(path(rrect(ox + x * U, oy + y * U, U, U, U * 0.3), { fill: fill }));
          }
        }
      }
      return out;
    }

    // square / pill: merge horizontal runs so exports stay small and print clean
    for (y = 0; y < size; y++) {
      x = 0;
      while (x < size) {
        if (!dark(x, y)) { x++; continue; }
        var start = x;
        while (x < size && dark(x, y)) x++;
        var w = (x - start) * U;
        if (shape === 'pill') {
          out.push(path(rrect(ox + start * U, oy + y * U, w, U, U * 0.5), { fill: fill }));
        } else {
          out.push({ t: 'rect', x: ox + start * U, y: oy + y * U, w: w, h: U, fill: fill });
        }
      }
    }
    return out;
  }

  function eyePrims(qr, style, fill, ox, oy) {
    var out = [], size = qr.size;
    var centres = [[0, 0], [size - 7, 0], [0, size - 7]];

    centres.forEach(function (c) {
      var x = ox + c[0] * U, y = oy + c[1] * U;
      var ring = { stroke: fill, lw: U };
      var ball = { fill: fill };
      if (style === 'circle') {
        out.push({ t: 'circle', cx: x + 3.5 * U, cy: y + 3.5 * U, r: 3 * U, stroke: fill, lw: U });
        out.push({ t: 'circle', cx: x + 3.5 * U, cy: y + 3.5 * U, r: 1.5 * U, fill: fill });
      } else if (style === 'rounded') {
        out.push(path(rrect(x + U * 0.5, y + U * 0.5, U * 6, U * 6, U * 2), ring));
        out.push(path(rrect(x + U * 2, y + U * 2, U * 3, U * 3, U * 0.9), ball));
      } else if (style === 'leaf') {
        out.push(path(rrect(x + U * 0.5, y + U * 0.5, U * 6, U * 6, [U * 2.6, 0, U * 2.6, 0]), ring));
        out.push(path(rrect(x + U * 2, y + U * 2, U * 3, U * 3, [U * 1.3, 0, U * 1.3, 0]), ball));
      } else {
        out.push({ t: 'rect', x: x + U * 0.5, y: y + U * 0.5, w: U * 6, h: U * 6, stroke: fill, lw: U });
        out.push({ t: 'rect', x: x + U * 2, y: y + U * 2, w: U * 3, h: U * 3, fill: fill });
      }
    });
    return out;
  }

  /* ---------------------------------------------------------------- build */

  /**
   * Build a scene from an encoded QR symbol.
   * opts: { moduleShape, eyeShape, fg, bg, transparent, quiet, frame:{id,text,frameColor,textColor},
   *         logo:{href, scale, plate} }
   */
  function build(qr, opts) {
    opts = opts || {};
    var fg = opts.fg || '#111111';
    var bg = opts.bg || '#ffffff';
    var transparent = !!opts.transparent;
    var quiet = opts.quiet == null ? 4 : Math.max(0, Math.min(16, opts.quiet));
    var moduleShape = opts.moduleShape || 'square';
    var eyeShape = opts.eyeShape || 'square';
    var frameOpts = opts.frame || { id: 'none' };
    var frame = frameById[frameOpts.id] || frameById.none;

    var qs = (qr.size + quiet * 2) * U;                       // QR block incl. quiet zone
    var plate = transparent ? '#ffffff' : bg;

    var ctx = {
      qs: qs, p: qs * 0.05, bar: qs * 0.17, U: U,
      frame: frameOpts.frameColor || '#111111',
      text: frameOpts.textColor || '#ffffff',
      plate: plate, fg: fg,
      outside: transparent ? null : bg,
      labelText: frameOpts.text == null ? '' : String(frameOpts.text)
    };

    var pad = frame.pad(ctx);                                 // [top, right, bottom, left]
    var width = qs + pad[1] + pad[3];
    var height = qs + pad[0] + pad[2];
    var qx = pad[3], qy = pad[0];

    ctx.w = width; ctx.h = height; ctx.qx = qx; ctx.qy = qy;
    ctx.captionText = function (centreY, colour) {
      var avail = width * 0.86;
      var size = fitSize(ctx.labelText, ctx.bar * 0.5, avail, 'bold');
      return {
        t: 'text', x: width / 2, y: centreY + size * 0.35, str: ctx.labelText,
        size: size, fill: colour || ctx.text, weight: 'bold', family: FONT, align: 'center'
      };
    };

    var items = [];
    var drawn = frame.draw(ctx) || {};
    (drawn.behind || []).forEach(function (p) { items.push(p); });

    // Frames that flood the canvas with the frame colour need a light panel
    // under the code; the others paint their own, or leave it to the background.
    if (frame.needsPlate) items.push({ t: 'rect', x: qx, y: qy, w: qs, h: qs, fill: plate });

    var ox = qx + quiet * U, oy = qy + quiet * U;
    var customEyes = eyeShape !== 'square' || moduleShape !== 'square';
    items = items.concat(modulePrims(qr, moduleShape, fg, ox, oy, customEyes));
    if (customEyes) items = items.concat(eyePrims(qr, eyeShape, fg, ox, oy));

    if (opts.logo && opts.logo.href) {
      var scale = Math.max(0.08, Math.min(0.3, opts.logo.scale || 0.2));
      var lw = qr.size * U * scale;
      var lx = ox + (qr.size * U - lw) / 2, ly = oy + (qr.size * U - lw) / 2;
      if (opts.logo.plate !== false) {
        var g = U * 0.9;
        items.push(path(rrect(lx - g, ly - g, lw + g * 2, lw + g * 2, U * 1.2), { fill: plate }));
      }
      items.push({ t: 'image', x: lx, y: ly, w: lw, h: lw, href: opts.logo.href });
    }

    (drawn.front || []).forEach(function (p) {
      if (p.t === 'text' && !ctx.labelText) return;           // no caption, no text
      items.push(p);
    });

    return {
      width: width, height: height,
      bg: transparent ? null : bg,
      items: items,
      meta: {
        unit: U, quiet: quiet, modules: qr.size, version: qr.version,
        ecl: qr.ecl, mask: qr.mask, mode: qr.mode,
        qrX: ox, qrY: oy, qrSize: qr.size * U,
        hasImage: !!(opts.logo && opts.logo.href)
      }
    };
  }

  return { build: build, frames: FRAMES, UNIT: U, rrect: rrect };
});
