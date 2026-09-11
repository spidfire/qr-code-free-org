/**
 * Tests for the PDF export. A PDF that looks fine as text can still be rejected
 * by a reader, so these checks walk the cross-reference table and the stream
 * lengths the way a parser does.
 *
 * No dependencies: run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const QR = require(join(root, 'assets/js/qr.js'));
const Scene = require(join(root, 'assets/js/scene.js'));
const Render = require(join(root, 'assets/js/renderers.js'));

const encoded = QR.encode('https://qr-code-free.org', { ecl: 'Q' });
const text = bytes => Buffer.from(bytes).toString('latin1');

function parse(pdf) {
  const body = text(pdf);
  const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(body);
  assert.ok(startxref, 'no startxref at the end of the file');

  const offset = Number(startxref[1]);
  assert.equal(body.slice(offset, offset + 4), 'xref', 'startxref does not point at the xref table');

  const header = /xref\n0 (\d+)\n/.exec(body.slice(offset));
  const count = Number(header[1]);
  const entries = [];
  let at = offset + header[0].length + 20;               // after the free entry for object 0
  for (let i = 1; i < count; i++) {
    const entry = body.substr(at + (i - 1) * 20, 20);
    assert.match(entry, /^\d{10} \d{5} n \n$/, `malformed xref entry ${i}: ${JSON.stringify(entry)}`);
    entries.push(Number(entry.slice(0, 10)));
  }
  const size = /\/Size (\d+)/.exec(body.slice(offset));
  assert.equal(Number(size[1]), count, 'trailer /Size disagrees with the xref table');
  return { body, entries, count };
}

test('PDF structure is one a parser can follow', () => {
  const scene = Scene.build(encoded, { frame: { id: 'bottom', text: 'SCAN ME', frameColor: '#1d4ed8' } });
  const { pdf } = Render.toPDF(scene, { size: 283.46, title: 'QR code' });
  const { body, entries } = parse(pdf);

  assert.ok(body.startsWith('%PDF-1.4\n'), 'PDF header');
  assert.equal(pdf[9], 0x25, 'binary marker comment');
  assert.ok(pdf[10] > 127, 'binary marker must contain high bytes');

  entries.forEach((offset, index) => {
    assert.equal(body.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`,
      `xref entry ${index + 1} points at the wrong place`);
  });

  assert.match(body, /\/Type \/Catalog/);
  assert.match(body, /\/Type \/Pages/);
  assert.match(body, /\/MediaBox \[0 0 283.46 [\d.]+\]/);
  assert.match(body, /\/BaseFont \/Helvetica-Bold/);
  assert.match(body, /\(SCAN ME\) Tj/);
  assert.ok(body.endsWith('%%EOF\n'));
});

test('declared stream lengths match the bytes actually written', () => {
  const scene = Scene.build(encoded, { moduleShape: 'dots', eyeShape: 'circle', frame: { id: 'chip', text: 'MENU' } });
  const { pdf } = Render.toPDF(scene, { size: 400 });
  const body = text(pdf);
  const pattern = /\/Length (\d+) >>\nstream\n/g;
  let match, checked = 0;
  while ((match = pattern.exec(body))) {
    const start = match.index + match[0].length;
    const declared = Number(match[1]);
    assert.equal(body.slice(start + declared, start + declared + 11), '\nendstream\n'.slice(0, 11),
      'stream does not end where /Length says it does');
    checked++;
  }
  assert.ok(checked >= 1, 'no streams found');
});

test('graphics state in the content stream is balanced', () => {
  for (const frame of Scene.frames) {
    const scene = Scene.build(encoded, {
      frame: { id: frame.id, text: 'SCAN ME' }, moduleShape: 'pill', eyeShape: 'leaf'
    });
    const body = text(Render.toPDF(scene, { size: 300 }).pdf);
    const content = body.slice(body.indexOf('stream\n'), body.indexOf('\nendstream'));
    const open = (content.match(/(^|\n)q(\n|$)/g) || []).length;
    const close = (content.match(/(^|\n)Q(\n|$)/g) || []).length;
    assert.equal(open, close, `${frame.id}: ${open} q against ${close} Q`);
    assert.ok(/re W n/.test(content), frame.id + ': artwork is not clipped to the page');
    assert.ok(!/NaN|undefined/.test(content), frame.id + ': bad numbers in the content stream');
  }
});

test('a logo is embedded as a JPEG XObject, and reported when missing', () => {
  const scene = Scene.build(encoded, { logo: { href: 'data:image/png;base64,AAAA', scale: 0.2 } });

  const without = Render.toPDF(scene, { size: 300 });
  assert.equal(without.skippedImages, 1, 'without image data the logo is skipped');
  assert.ok(!text(without.pdf).includes('/XObject'));

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const withLogo = Render.toPDF(scene, { size: 300, image: { data: jpeg, width: 64, height: 64 } });
  const body = text(withLogo.pdf);
  assert.equal(withLogo.skippedImages, 0);
  assert.match(body, /\/Subtype \/Image/);
  assert.match(body, /\/Filter \/DCTDecode/);
  assert.match(body, /\/Width 64 \/Height 64/);
  assert.match(body, /\/Im0 Do/);
  assert.ok(body.includes(text(jpeg)), 'the JPEG bytes survive unchanged');
  parse(withLogo.pdf);                                   // offsets still line up with a binary stream
});

test('captions are centred with the measurements the caller supplies', () => {
  const scene = Scene.build(encoded, { frame: { id: 'bottom', text: 'WIDE CAPTION' } });
  const wide = text(Render.toPDF(scene, { size: 300, measure: () => 200 }).pdf);
  const narrow = text(Render.toPDF(scene, { size: 300, measure: () => 20 }).pdf);
  assert.match(wide, /-100 0 Td/);
  assert.match(narrow, /-10 0 Td/);
});

test('text outside Latin-1 is folded rather than corrupting the file', () => {
  const scene = Scene.build(encoded, { frame: { id: 'bottom', text: 'CAFÉ — ПРИВЕТ “x”' } });
  const result = Render.toPDF(scene, { size: 300 });
  const body = text(result.pdf);
  assert.ok(result.simplifiedCharacters > 0, 'characters it cannot show are reported');
  assert.match(body, /\(CAF\\311 - \?+ "x"\) Tj/);        // É as octal, dash and quotes folded
  parse(result.pdf);
});

test('the whole file is ASCII when there is no image, so byte offsets are stable', () => {
  const { pdf } = Render.toPDF(Scene.build(encoded, { frame: { id: 'ribbon', text: 'É' } }), { size: 300 });
  const nonAscii = Array.from(pdf.slice(15)).filter(b => b > 0x7e);   // past the binary marker
  assert.equal(nonAscii.length, 0, 'only the binary marker may exceed ASCII');
});

test('EPS and PDF agree on what they could not represent', () => {
  const scene = Scene.build(encoded, {
    frame: { id: 'bottom', text: 'ЖЖ' },
    logo: { href: 'data:image/png;base64,AAAA', scale: 0.2 }
  });
  const eps = Render.toEPS(scene, { size: 300 });
  const pdf = Render.toPDF(scene, { size: 300 });
  assert.equal(eps.skippedImages, 1);
  assert.equal(pdf.skippedImages, 1);
  assert.equal(eps.simplifiedCharacters, 2);
  assert.equal(pdf.simplifiedCharacters, 2);
});

test('EPS re-encodes Helvetica so accents survive', () => {
  const scene = Scene.build(encoded, { frame: { id: 'bottom', text: 'CAFÉ' } });
  const { eps, simplifiedCharacters } = Render.toEPS(scene, { size: 300 });
  assert.equal(simplifiedCharacters, 0);
  assert.match(eps, /ISOLatin1Encoding/);
  assert.match(eps, /\/QRFontBold findfont/);
  assert.match(eps, /\(CAF\\311\)/);
  assert.ok(!/[^\x00-\x7f]/.test(eps), 'EPS stays ASCII on the wire');
});
