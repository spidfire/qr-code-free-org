/**
 * Tests for the QR encoder, the payload builders and the renderers.
 * No dependencies: run with `npm test` (node --test test/).
 *
 * The golden hashes below were locked in after the encoder was verified
 * module-for-module against an independent reference implementation across
 * all 40 symbol versions, all 4 error correction levels and all 8 masks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const QR = require(join(root, 'assets/js/qr.js'));
const Payloads = require(join(root, 'assets/js/payloads.js'));
const Scene = require(join(root, 'assets/js/scene.js'));
const Render = require(join(root, 'assets/js/renderers.js'));

const ECLS = ['L', 'M', 'Q', 'H'];
const sha = qr => createHash('sha256').update(Buffer.from(qr.modules)).digest('hex').slice(0, 16);

/* --------------------------------------------------------------- encoder */

test('capacity tables are internally consistent for every version', () => {
  for (let v = 1; v <= 40; v++) {
    let previous = Infinity;
    for (const ecl of ECLS) {
      const data = QR.dataCodewords(v, ecl);
      const total = QR.totalCodewords(v);
      assert.ok(data > 0 && data < total, `v${v}${ecl}: ${data} of ${total}`);
      assert.ok(data < previous, `v${v}${ecl}: stronger levels must carry less data`);
      previous = data;
    }
  }
  assert.equal(QR.totalCodewords(1), 26);
  assert.equal(QR.totalCodewords(40), 3706);
  assert.equal(QR.dataCodewords(1, 'L'), 19);
  assert.equal(QR.dataCodewords(1, 'H'), 9);
  assert.equal(QR.dataCodewords(40, 'L'), 2956);
  assert.equal(QR.dataCodewords(40, 'H'), 1276);
});

test('published character capacities are reproduced', () => {
  const byteCapacity = (v, ecl) => Math.floor((QR.dataCodewords(v, ecl) * 8 - 4 - (v <= 9 ? 8 : 16)) / 8);
  assert.equal(byteCapacity(1, 'L'), 17);
  assert.equal(byteCapacity(1, 'H'), 7);
  assert.equal(byteCapacity(10, 'M'), 213);
  assert.equal(byteCapacity(40, 'L'), 2953);
  assert.equal(byteCapacity(40, 'H'), 1273);
});

test('mode detection picks the most compact encoding', () => {
  assert.equal(QR.pickMode('12345'), 'numeric');
  assert.equal(QR.pickMode('HELLO WORLD'), 'alphanumeric');
  assert.equal(QR.pickMode('EXAMPLE.COM/MENU'), 'alphanumeric');
  assert.equal(QR.pickMode('example.com'), 'byte');
  assert.equal(QR.pickMode('héllo'), 'byte');
  // upper case URLs really are cheaper: same data, smaller symbol
  assert.ok(QR.encode('HTTP://EXAMPLE.COM/ABCDEFGHIJKLMNOP', { ecl: 'M', boost: false }).version <
    QR.encode('http://example.com/abcdefghijklmnop', { ecl: 'M', boost: false }).version);
});

test('golden symbols have not changed', () => {
  const golden = [
    ['HELLO WORLD', { ecl: 'Q', mask: 0 }, { version: 1, mask: 0, mode: 'alphanumeric', sha: 'e5395d7a0fb74b1e' }],
    ['https://qr-code-free.org', { ecl: 'M' }, { version: 2, mask: 4, mode: 'byte', sha: '8f4b1577b2475436' }],
    ['1234567890', { ecl: 'L' }, { version: 1, mask: 7, mode: 'numeric', sha: '144dadc4680fd066' }],
    ['WIFI:T:WPA;S:Cafe-Guest;P:correct-horse;;', { ecl: 'H' }, { version: 5, mask: 2, mode: 'byte', sha: '06003c347329d273' }],
    ['héllo wörld — ünïcode ✓ 日本語 🎉', { ecl: 'Q' }, { version: 4, mask: 7, mode: 'byte', sha: '05525996d376ac45' }],
    ['x'.repeat(900), { ecl: 'M' }, { version: 24, mask: 0, mode: 'byte', sha: '12b5c37adbaefb44' }],
    ['0'.repeat(2000), { ecl: 'L' }, { version: 20, mask: 0, mode: 'numeric', sha: '60ac8fcb1c6f9231' }],
    ['A'.repeat(1500), { ecl: 'H' }, { version: 36, mask: 2, mode: 'alphanumeric', sha: '1ec27dca0c54d93a' }]
  ];
  for (const [text, options, expected] of golden) {
    const qr = QR.encode(text, Object.assign({ boost: false }, options));
    assert.equal(qr.version, expected.version, text.slice(0, 20));
    assert.equal(qr.mask, expected.mask, text.slice(0, 20));
    assert.equal(qr.mode, expected.mode, text.slice(0, 20));
    assert.equal(sha(qr), expected.sha, text.slice(0, 20));
  }
});

test('function patterns sit where the standard puts them', () => {
  for (const version of [1, 2, 7, 23, 32, 40]) {
    const qr = QR.encode('x'.repeat(version), { minVersion: version, maxVersion: version, ecl: 'L', boost: false });
    const size = qr.size;
    assert.equal(size, version * 4 + 17);

    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const ring = x === 0 || x === 6 || y === 0 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          assert.equal(qr.get(ox + x, oy + y), ring || core, `v${version} finder at ${ox + x},${oy + y}`);
        }
      }
    }
    for (let i = 8; i < size - 8; i++) {
      assert.equal(qr.get(i, 6), i % 2 === 0, `v${version} horizontal timing at ${i}`);
      assert.equal(qr.get(6, i), i % 2 === 0, `v${version} vertical timing at ${i}`);
    }
    assert.equal(qr.get(8, size - 8), true, `v${version} dark module`);
  }
});

test('format information decodes back to the level and mask used', () => {
  const bch = (value, generator, bits) => {
    for (let i = bits - 1; i >= 0; i--) value = (value << 1) ^ (((value >>> (bits - 1)) & 1) * generator);
    return value & ((1 << bits) - 1);
  };
  for (const ecl of ECLS) {
    for (let mask = 0; mask < 8; mask++) {
      const qr = QR.encode('format check', { ecl, mask, boost: false });
      let bits = 0;
      for (let i = 0; i <= 5; i++) bits |= (qr.get(8, i) ? 1 : 0) << i;
      bits |= (qr.get(8, 7) ? 1 : 0) << 6;
      bits |= (qr.get(8, 8) ? 1 : 0) << 7;
      bits |= (qr.get(7, 8) ? 1 : 0) << 8;
      for (let i = 9; i < 15; i++) bits |= (qr.get(14 - i, 8) ? 1 : 0) << i;

      const raw = bits ^ 0x5412;
      const data = raw >>> 10;
      assert.equal(bch(data, 0x537, 10), raw & 0x3ff, 'BCH check digits');
      assert.equal(data & 7, mask, `mask in format bits (${ecl})`);
      assert.equal(data >>> 3, { L: 1, M: 0, Q: 3, H: 2 }[ecl], `level in format bits (${ecl})`);

      // the second copy must carry the same bits
      for (let i = 0; i < 8; i++) assert.equal(qr.get(qr.size - 1 - i, 8), ((bits >>> i) & 1) === 1);
      for (let i = 8; i < 15; i++) assert.equal(qr.get(8, qr.size - 15 + i), ((bits >>> i) & 1) === 1);
    }
  }
});

test('automatic boosting raises the level without growing the symbol', () => {
  const plain = QR.encode('https://example.com', { ecl: 'M', boost: false });
  const boosted = QR.encode('https://example.com', { ecl: 'M', boost: true });
  assert.equal(plain.version, boosted.version);
  assert.ok(ECLS.indexOf(boosted.ecl) >= ECLS.indexOf(plain.ecl));
});

test('too much data is rejected rather than silently truncated', () => {
  assert.throws(() => QR.encode('x'.repeat(3000), { ecl: 'H' }), /too much data/);
  assert.doesNotThrow(() => QR.encode('x'.repeat(2900), { ecl: 'L' }));
  assert.equal(QR.encode('', { ecl: 'M' }).version, 1);
});

/* -------------------------------------------------------------- payloads */

test('every content type declares what the form needs', () => {
  assert.equal(Payloads.types.length, 10);
  for (const type of Payloads.types) {
    assert.ok(type.id && type.label && type.icon && type.hint, type.id);
    assert.ok(type.fields.length > 0, type.id);
    assert.equal(typeof type.build, 'function', type.id);
    assert.equal(type.build({}), '', `${type.id} must stay empty until it has input`);
  }
});

test('links get a scheme, numbers get cleaned up', () => {
  assert.equal(Payloads.get('url').build({ url: 'example.com/a' }), 'https://example.com/a');
  assert.equal(Payloads.get('url').build({ url: 'http://example.com' }), 'http://example.com');
  assert.equal(Payloads.get('url').build({ url: '//example.com' }), 'https://example.com');
  assert.equal(Payloads.get('phone').build({ number: '+31 (20) 123-4567' }), 'tel:+31201234567');
  assert.equal(Payloads.get('whatsapp').build({ number: '+31 6 1234 5678' }), 'https://wa.me/31612345678');
  assert.equal(Payloads.get('geo').build({ lat: '52,3676', lng: '4.9041' }), 'geo:52.3676,4.9041');
});

test('wi-fi and vcard values are escaped', () => {
  const wifi = Payloads.get('wifi').build({ ssid: 'Cafe; Guest', password: 'a:b\\c"d,e', security: 'WPA', hidden: true });
  assert.equal(wifi, String.raw`WIFI:T:WPA;S:Cafe\; Guest;P:a\:b\\c\"d\,e;H:true;;`);
  assert.equal(Payloads.get('wifi').build({ ssid: 'Open', security: 'nopass', password: 'ignored' }), 'WIFI:T:nopass;S:Open;;');

  const vcard = Payloads.get('vcard').build({ first: 'Sam', last: 'Jansen', org: 'Example, BV', note: 'line1\nline2' });
  assert.match(vcard, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(vcard, /\r\nEND:VCARD$/);
  assert.match(vcard, /ORG:Example\\, BV/);
  assert.match(vcard, /NOTE:line1\\nline2/);
  assert.match(vcard, /FN:Sam Jansen/);
});

test('events use calendar timestamps, with all-day events as dates', () => {
  const timed = Payloads.get('event').build({ summary: 'Open day', start: '2026-03-14', startTime: '18:30', endTime: '21:00' });
  assert.match(timed, /DTSTART:20260314T183000/);
  assert.match(timed, /DTEND:20260314T210000/);
  const allDay = Payloads.get('event').build({ summary: 'Market', start: '2026-03-14' });
  assert.match(allDay, /DTSTART;VALUE=DATE:20260314/);
  assert.match(allDay, /DTEND;VALUE=DATE:20260314/);
});

test('payloads round-trip through the encoder', () => {
  const samples = [
    ['url', { url: 'example.com/a-fairly-long-path?utm_source=poster' }],
    ['email', { to: 'hello@example.com', subject: 'Quote & co', body: 'Hi\nthere' }],
    ['sms', { number: '+31612345678', message: 'INFO' }],
    ['wifi', { ssid: 'Cafe-Guest', password: 'correct-horse-battery', security: 'WPA' }],
    ['vcard', { first: 'Sam', last: 'Jansen', org: 'Example BV', phone: '+31612345678', email: 'sam@example.com', url: 'example.com' }],
    ['event', { summary: 'Open day', start: '2026-03-14', startTime: '18:30', location: 'Kerkstraat 1' }],
    ['text', { text: 'Table 12 — ask staff for the wine list' }]
  ];
  for (const [id, values] of samples) {
    const text = Payloads.get(id).build(values);
    assert.ok(text.length > 0, id);
    const qr = QR.encode(text, { ecl: 'M' });
    assert.ok(qr.size >= 21 && qr.size <= 177, id);
  }
});

/* ------------------------------------------------------ scene + renderers */

const encoded = QR.encode('https://qr-code-free.org', { ecl: 'Q' });

test('every frame produces a scene that contains the code', () => {
  assert.equal(Scene.frames.length, 12);
  for (const frame of Scene.frames) {
    const scene = Scene.build(encoded, {
      frame: { id: frame.id, text: 'SCAN ME', frameColor: '#4f46e5', textColor: '#ffffff' },
      moduleShape: 'pill', eyeShape: 'rounded', quiet: 4
    });
    const quietPx = 4 * scene.meta.unit;
    assert.ok(scene.width >= scene.meta.qrSize + quietPx * 2, frame.id);
    assert.ok(scene.height >= scene.width - 1, frame.id);
    assert.ok(scene.items.length > 40, frame.id);
    assert.equal(scene.meta.modules, encoded.size, frame.id);
    if (frame.label) {
      assert.ok(scene.items.some(i => i.t === 'text' && i.str === 'SCAN ME'), frame.id + ' caption');
    }
    for (const item of scene.items) {
      const x = item.x != null ? item.x : item.cx;
      if (x != null) assert.ok(Number.isFinite(x), frame.id + ' finite coordinates');
    }
  }
});

test('a caption is left out when there is no text', () => {
  const scene = Scene.build(encoded, { frame: { id: 'bottom', text: '' } });
  assert.equal(scene.items.filter(i => i.t === 'text').length, 0);
});

test('transparent scenes have no background fill', () => {
  assert.equal(Scene.build(encoded, { transparent: true }).bg, null);
  assert.equal(Scene.build(encoded, { transparent: false, bg: '#fdf6e3' }).bg, '#fdf6e3');
});

test('module and eye shapes all render', () => {
  for (const moduleShape of ['square', 'rounded', 'dots', 'pill']) {
    for (const eyeShape of ['square', 'rounded', 'circle', 'leaf']) {
      const scene = Scene.build(encoded, { moduleShape, eyeShape });
      const svg = Render.toSVG(scene, { size: 512 });
      assert.ok(svg.includes('</svg>'), `${moduleShape}/${eyeShape}`);
      assert.ok(!/NaN|undefined/.test(svg), `${moduleShape}/${eyeShape} clean output`);
    }
  }
});

test('SVG output is well formed and sized', () => {
  const scene = Scene.build(encoded, { frame: { id: 'ticket', text: 'MENU' }, logo: { href: 'data:image/png;base64,AAAA', scale: 0.2 } });
  const svg = Render.toSVG(scene, { size: 1024, title: 'QR code', description: 'test' });
  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(svg, /<svg [^>]*width="1024"/);
  assert.match(svg, /viewBox="0 0 [\d.]+ [\d.]+"/);
  assert.match(svg, /<title>QR code<\/title>/);
  assert.match(svg, /<image [^>]*xlink:href="data:image\/png;base64,AAAA"/);
  assert.equal((svg.match(/<svg/g) || []).length, 1);
  assert.equal((svg.match(/<\/svg>/g) || []).length, 1);
  assert.ok(!/NaN|undefined/.test(svg));
});

test('SVG escapes text that would break the markup', () => {
  const scene = Scene.build(encoded, { frame: { id: 'bottom', text: '<b>"A & B"</b>' } });
  const svg = Render.toSVG(scene, { size: 256 });
  assert.ok(svg.includes('&lt;b&gt;&quot;A &amp; B&quot;&lt;/b&gt;'));
  assert.ok(!svg.includes('<b>'));
});

test('EPS output is a valid clipped EPSF document', () => {
  const scene = Scene.build(encoded, { frame: { id: 'chip', text: 'SCAN ME (2)' }, moduleShape: 'dots', eyeShape: 'circle' });
  const { eps, skippedImages } = Render.toEPS(scene, { size: 512, title: 'QR code' });
  assert.match(eps, /^%!PS-Adobe-3\.0 EPSF-3\.0\n/);
  assert.match(eps, /%%BoundingBox: 0 0 512 \d+/);
  assert.match(eps, /%%HiResBoundingBox: 0 0 512(\.\d+)? [\d.]+/);
  assert.match(eps, /\nshowpage\n/);
  assert.match(eps, /%%EOF\n$/);
  assert.ok(eps.includes('clip'), 'clips to the bounding box');
  assert.equal(skippedImages, 0);

  const gsave = (eps.match(/\bgsave\b/g) || []).length;
  const grestore = (eps.match(/\bgrestore\b/g) || []).length;
  assert.equal(gsave, grestore, 'balanced gsave/grestore');
  assert.ok(!/NaN|undefined/.test(eps));

  // text with brackets must be escaped for PostScript
  assert.ok(eps.includes('(SCAN ME \\(2\\))'));
});

test('EPS reports a logo it cannot embed', () => {
  const scene = Scene.build(encoded, { logo: { href: 'data:image/png;base64,AAAA', scale: 0.2 } });
  assert.equal(Render.toEPS(scene, { size: 512 }).skippedImages, 1);
});

test('a cropped SVG zooms in without moving the artwork', () => {
  const scene = Scene.build(encoded, { moduleShape: 'dots' });
  const crop = [scene.meta.qrX, scene.meta.qrY, 9 * scene.meta.unit, 9 * scene.meta.unit];
  const svg = Render.toSVG(scene, { size: 120, crop });
  assert.match(svg, new RegExp(`viewBox="${crop[0]} ${crop[1]} ${crop[2]} ${crop[3]}"`));
  assert.match(svg, /<svg [^>]*width="120" height="120"/);
  // the background rect must cover the cropped window, not the original canvas
  assert.match(svg, new RegExp(`<rect x="${crop[0]}" y="${crop[1]}" width="${crop[2]}"`));
});

test('path data survives the trip to SVG', () => {
  assert.equal(Render.pathData(['M', 0, 0, 'L', 10, 0, 'Z']), 'M0 0L10 0Z');
  assert.equal(Render.pathData(['C', 1.0005, 2, 3, 4, 5, 6]), 'C1.001 2 3 4 5 6');
});
