/**
 * Generates the static images the page references:
 *   assets/og-image.png     social preview card (1200x630)
 *   apple-touch-icon.png    home screen icon (180x180)
 *   favicon.svg             vector favicon
 *
 * Everything is drawn from scratch with a tiny PNG writer and a 5x7 pixel font,
 * so the build needs nothing but Node.  Run: node tools/make-images.mjs
 *
 * Part of https://github.com/spidfire/qr-code-free-org (Apache License 2.0)
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const QR = require(join(root, 'assets/js/qr.js'));

/* ------------------------------------------------------------ PNG writing */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

class Bitmap {
  constructor(width, height, fill = [255, 255, 255]) {
    this.w = width; this.h = height;
    this.px = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.px[i * 3] = fill[0]; this.px[i * 3 + 1] = fill[1]; this.px[i * 3 + 2] = fill[2];
    }
  }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }
  rect(x, y, w, h, c) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, c);
  }
  roundRect(x, y, w, h, r, c) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = Math.min(Math.max(dx, r), w - r), cy = Math.min(Math.max(dy, r), h - r);
        if ((dx - cx) ** 2 + (dy - cy) ** 2 <= r * r) this.set(x + dx, y + dy, c);
      }
    }
  }
  toPNG() {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;                                   // filter: none
      this.px.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8-bit RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0))
    ]);
  }
}

/* ------------------------------------------------------------- pixel font */

const GLYPHS = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.###.',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####',
  3: '####.|....#|....#|.###.|....#|....#|####.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.',
  7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  '-': '.....|.....|.....|.###.|.....|.....|.....',
  ':': '.....|..##.|..##.|.....|..##.|..##.|.....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '·': '.....|.....|..##.|..##.|.....|.....|.....'
};

function textWidth(str, scale) { return str.length * 6 * scale - scale; }

function drawText(bmp, str, x, y, scale, colour) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const glyph = GLYPHS[ch] || GLYPHS[' '];
    glyph.split('|').forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '#') bmp.rect(cx + rx * scale, y + ry * scale, scale, scale, colour);
      }
    });
    cx += 6 * scale;
  }
  return cx;
}

/* ---------------------------------------------------------------- drawing */

function drawQr(bmp, text, x, y, size, quiet, fg, bg) {
  const qr = QR.encode(text, { ecl: 'M' });
  const total = qr.size + quiet * 2;
  const unit = Math.floor(size / total);
  const offset = Math.round((size - unit * total) / 2);
  bmp.rect(x, y, size, size, bg);
  for (let my = 0; my < qr.size; my++) {
    for (let mx = 0; mx < qr.size; mx++) {
      if (!qr.get(mx, my)) continue;
      bmp.rect(x + offset + (mx + quiet) * unit, y + offset + (my + quiet) * unit, unit, unit, fg);
    }
  }
  return qr;
}

const INK = [12, 16, 28];
const WHITE = [255, 255, 255];
const ACCENT = [139, 140, 247];
const MUTED = [150, 160, 190];

/* og-image.png */
{
  const bmp = new Bitmap(1200, 630, [11, 15, 25]);
  bmp.rect(0, 0, 1200, 8, [99, 102, 241]);

  // soft blocks in the background, echoing a QR grid
  for (let i = 0; i < 26; i++) {
    const gx = 1200 - ((i * 37) % 260) - 40, gy = 470 + ((i * 53) % 130);
    bmp.roundRect(gx, gy, 18, 18, 4, [18, 24, 41]);
  }

  bmp.roundRect(64, 105, 420, 420, 26, WHITE);
  drawQr(bmp, 'https://qr-code-free.org', 84, 125, 380, 3, INK, WHITE);

  let x = 536;
  drawText(bmp, 'QR-CODE-FREE', x, 152, 6, WHITE);
  drawText(bmp, '.ORG', x + textWidth('QR-CODE-FREE', 6) + 6, 152, 6, ACCENT);
  drawText(bmp, 'FREE QR CODE GENERATOR', x, 230, 4, WHITE);
  drawText(bmp, 'NO SIGN-UP · NO TRACKING', x, 290, 3, MUTED);
  drawText(bmp, 'NOTHING IS UPLOADED', x, 330, 3, MUTED);

  bmp.roundRect(x, 390, 560, 4, 2, [30, 38, 62]);
  drawText(bmp, 'PNG · JPG · SVG · EPS', x, 425, 3, WHITE);
  drawText(bmp, 'FRAMES · COLOURS · LOGOS', x, 465, 3, WHITE);
  drawText(bmp, 'OPEN SOURCE · APACHE-2.0', x, 540, 3, ACCENT);

  writeFileSync(join(root, 'assets/og-image.png'), bmp.toPNG());
  console.log('assets/og-image.png       1200x630');
}

/* apple-touch-icon.png */
{
  const size = 180;
  const bmp = new Bitmap(size, size, [79, 70, 229]);
  bmp.roundRect(0, 0, size, size, 40, [79, 70, 229]);
  bmp.roundRect(18, 18, 144, 144, 18, WHITE);
  drawQr(bmp, 'qr-code-free.org', 24, 24, 132, 2, [16, 24, 40], WHITE);
  writeFileSync(join(root, 'apple-touch-icon.png'), bmp.toPNG());
  console.log('apple-touch-icon.png      180x180');
}

/* favicon.svg */
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="qr-code-free.org">
  <rect width="32" height="32" rx="7" fill="#4f46e5"/>
  <g fill="#fff">
    <path d="M6 6h8v8H6V6Zm2.2 2.2v3.6h3.6V8.2H8.2Z"/>
    <path d="M18 6h8v8h-8V6Zm2.2 2.2v3.6h3.6V8.2h-3.6Z"/>
    <path d="M6 18h8v8H6v-8Zm2.2 2.2v3.6h3.6v-3.6H8.2Z"/>
    <path d="M18 18h3.2v3.2H18V18Zm4.8 0H26v2h-3.2v-2ZM18 22.8h3.2V26H18v-3.2Zm4.8 1.6H26V26h-3.2v-1.6Z"/>
  </g>
</svg>
`;
  writeFileSync(join(root, 'favicon.svg'), svg);
  console.log('favicon.svg');
}
