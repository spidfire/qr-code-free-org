/**
 * Executes the generated EPS with a small interpreter for the PostScript subset
 * the renderer emits. This catches the two things that silently break an EPS —
 * an unbalanced operand or graphics stack, and marks outside the bounding box —
 * neither of which is visible by reading the file.
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

function runPostScript(eps) {
  const tokens = [];
  // The prolog only defines the Latin-1 font aliases, with dictionary operators
  // this interpreter deliberately does not model; the drawing body is what matters.
  const withoutProlog = eps.replace(/%%BeginProlog[\s\S]*?%%EndProlog/, '');
  const source = withoutProlog.split('\n').filter(line => !line.startsWith('%')).join('\n');
  const pattern = /\((?:\\.|[^\\)])*\)|\/[A-Za-z0-9-]+|[^\s]+/g;
  let match;
  while ((match = pattern.exec(source))) tokens.push(match[0]);

  const errors = [];
  // The prolog is skipped above, so seed the one name the body uses from it.
  const dict = { qrsave: { save: true } };
  const stack = [];
  const graphicsStack = [];
  const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let colour = [0, 0, 0], lineWidth = 1, font = null, fontSize = 12;
  let current = null, path = [], clip = null;
  let painted = 0, fills = 0, strokes = 0, texts = 0;

  const apply = (x, y) => ({ x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f });
  const grow = (point, pad = 0) => {
    let x0 = point.x - pad, y0 = point.y - pad, x1 = point.x + pad, y1 = point.y + pad;
    if (clip) {
      x0 = Math.max(x0, clip.x0); y0 = Math.max(y0, clip.y0);
      x1 = Math.min(x1, clip.x1); y1 = Math.min(y1, clip.y1);
      if (x1 < x0 || y1 < y0) return;
    }
    bbox.x0 = Math.min(bbox.x0, x0); bbox.y0 = Math.min(bbox.y0, y0);
    bbox.x1 = Math.max(bbox.x1, x1); bbox.y1 = Math.max(bbox.y1, y1);
  };
  const pop = (name, count = 1) => {
    if (stack.length < count) {
      errors.push(`stack underflow at ${name}: wanted ${count}, had ${stack.length}`);
      return new Array(count).fill(0);
    }
    return stack.splice(stack.length - count, count);
  };

  for (const token of tokens) {
    const number = parseFloat(token);
    if (Number.isFinite(number) && !/^[a-zA-Z]/.test(token)) { stack.push(number); continue; }
    if (token.startsWith('(')) { stack.push({ str: token.slice(1, -1) }); continue; }
    if (token.startsWith('/')) { stack.push({ name: token.slice(1) }); continue; }

    switch (token) {
      case 'newpath': path = []; current = null; break;
      case 'moveto': { const [x, y] = pop('moveto', 2); current = { x, y }; path.push(apply(x, y)); break; }
      case 'lineto': { const [x, y] = pop('lineto', 2); current = { x, y }; path.push(apply(x, y)); break; }
      case 'rlineto': {
        const [dx, dy] = pop('rlineto', 2);
        if (!current) { errors.push('rlineto without a current point'); break; }
        current = { x: current.x + dx, y: current.y + dy };
        path.push(apply(current.x, current.y));
        break;
      }
      case 'curveto': {
        const p = pop('curveto', 6);
        path.push(apply(p[0], p[1]), apply(p[2], p[3]), apply(p[4], p[5]));
        current = { x: p[4], y: p[5] };
        break;
      }
      case 'arc': {
        const [cx, cy, r, from, to] = pop('arc', 5);
        for (let angle = from; angle <= to; angle += 15) {
          path.push(apply(cx + r * Math.cos(angle * Math.PI / 180), cy + r * Math.sin(angle * Math.PI / 180)));
        }
        current = { x: cx + r, y: cy };
        break;
      }
      case 'closepath': break;
      case 'fill':
        if (!path.length) errors.push('fill with an empty path');
        path.forEach(p => grow(p));
        painted++; fills++; path = []; current = null;
        break;
      case 'stroke': {
        if (!path.length) errors.push('stroke with an empty path');
        const pad = Math.abs(lineWidth * ctm.a) / 2;
        path.forEach(p => grow(p, pad));
        painted++; strokes++; path = []; current = null;
        break;
      }
      case 'clip': {
        if (!path.length) { errors.push('clip with an empty path'); break; }
        const xs = path.map(p => p.x), ys = path.map(p => p.y);
        clip = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        path = []; current = null;
        break;
      }
      case 'setrgbcolor': {
        const c = pop('setrgbcolor', 3);
        if (c.some(v => v < 0 || v > 1)) errors.push('colour component out of range: ' + c.join(' '));
        colour = c;
        break;
      }
      case 'setlinewidth': lineWidth = pop('setlinewidth')[0]; break;
      case 'setlinecap': {
        const cap = pop('setlinecap')[0];
        if (![0, 1, 2].includes(cap)) errors.push('invalid line cap ' + cap);
        break;
      }
      case 'setlinejoin': pop('setlinejoin'); break;
      case 'gsave': graphicsStack.push({ ctm: { ...ctm }, colour, lineWidth }); break;
      case 'grestore':
        if (!graphicsStack.length) errors.push('grestore without a matching gsave');
        else { const saved = graphicsStack.pop(); ctm = saved.ctm; colour = saved.colour; lineWidth = saved.lineWidth; }
        break;
      case 'translate': {
        const [x, y] = pop('translate', 2);
        ctm.e += ctm.a * x + ctm.c * y;
        ctm.f += ctm.b * x + ctm.d * y;
        break;
      }
      case 'scale': {
        const [sx, sy] = pop('scale', 2);
        ctm.a *= sx; ctm.b *= sx; ctm.c *= sy; ctm.d *= sy;
        break;
      }
      case 'findfont': {
        const requested = pop('findfont')[0];
        font = requested && requested.name;
        if (!font) errors.push('findfont without a font name');
        break;
      }
      case 'scalefont': fontSize = pop('scalefont')[0]; break;
      case 'setfont': if (!font) errors.push('setfont before findfont'); break;
      case 'stringwidth': {
        const value = pop('stringwidth')[0];
        if (!value || value.str === undefined) { errors.push('stringwidth on something that is not a string'); stack.push(0, 0); break; }
        if (!font) errors.push('stringwidth before setfont');
        stack.push(value.str.length * fontSize * 0.55, 0);
        break;
      }
      case 'show': {
        const value = pop('show')[0];
        if (!value || value.str === undefined) { errors.push('show on something that is not a string'); break; }
        if (!font) errors.push('show before setfont');
        const width = value.str.length * fontSize * 0.55;
        grow(apply(-width / 2, -fontSize * 0.85));
        grow(apply(width / 2, fontSize * 0.25));
        painted++; texts++;
        break;
      }
      case 'dup':
        if (!stack.length) errors.push('dup on an empty stack');
        else stack.push(stack[stack.length - 1]);
        break;
      case 'pop': pop('pop'); break;
      case 'div': { const [a, b] = pop('div', 2); stack.push(a / b); break; }
      case 'neg': { const [a] = pop('neg'); stack.push(-a); break; }
      case 'def': {
        const [key, value] = pop('def', 2);
        if (!key || !key.name) errors.push('def without a name');
        else dict[key.name] = value;
        break;
      }
      case 'save': stack.push({ save: true }); break;
      case 'restore': pop('restore'); break;
      case 'showpage': break;
      default:
        if (Object.prototype.hasOwnProperty.call(dict, token)) stack.push(dict[token]);
        else if (/^[a-zA-Z]/.test(token)) errors.push('operator this renderer should not emit: ' + token);
    }
  }

  if (graphicsStack.length) errors.push(`${graphicsStack.length} gsave(s) never restored`);
  if (stack.length) errors.push(`operand stack not empty at the end: ${stack.length} item(s)`);
  return { errors, bbox, painted, fills, strokes, texts };
}

const FORBIDDEN = ['initgraphics', 'initclip', 'initmatrix', 'setpagedevice', 'erasepage',
  'copypage', 'grestoreall', 'cleardictstack', 'exitserver', 'quit'];

function cases() {
  const out = [];
  for (const frame of Scene.frames) out.push({ frame: frame.id, moduleShape: 'square', eyeShape: 'square' });
  for (const moduleShape of ['square', 'rounded', 'dots', 'pill']) out.push({ frame: 'ticket', moduleShape, eyeShape: 'circle' });
  for (const eyeShape of ['square', 'rounded', 'circle', 'leaf']) out.push({ frame: 'phone', moduleShape: 'pill', eyeShape });
  out.push({ frame: 'bottom', moduleShape: 'square', eyeShape: 'square', text: 'Brackets (and a \\ backslash)' });
  out.push({ frame: 'chip', moduleShape: 'dots', eyeShape: 'leaf', transparent: true });
  return out;
}

for (const options of cases()) {
  const label = `${options.frame}/${options.moduleShape}/${options.eyeShape}${options.transparent ? ' (transparent)' : ''}`;
  test('EPS executes cleanly and stays inside its bounding box: ' + label, () => {
    const qr = QR.encode('https://qr-code-free.org/' + options.frame, { ecl: 'Q' });
    const scene = Scene.build(qr, {
      frame: { id: options.frame, text: options.text || 'SCAN ME', frameColor: '#1d4ed8', textColor: '#ffffff' },
      moduleShape: options.moduleShape, eyeShape: options.eyeShape,
      fg: '#0b1020', bg: '#fffaf0', transparent: !!options.transparent
    });
    const { eps } = Render.toEPS(scene, { size: 480, title: 'QR code' });
    const result = runPostScript(eps);

    assert.deepEqual(result.errors, [], label);
    assert.ok(result.painted > 50, `${label}: only ${result.painted} marks painted`);

    const declared = /%%HiResBoundingBox: 0 0 ([\d.]+) ([\d.]+)/.exec(eps);
    assert.ok(declared, label + ': no HiResBoundingBox');
    const width = parseFloat(declared[1]), height = parseFloat(declared[2]);
    const slack = 0.75;                                    // rounding in the emitted numbers
    assert.ok(result.bbox.x0 >= -slack && result.bbox.y0 >= -slack, `${label}: marks before the origin ${JSON.stringify(result.bbox)}`);
    assert.ok(result.bbox.x1 <= width + slack, `${label}: marks past the right edge (${result.bbox.x1} > ${width})`);
    assert.ok(result.bbox.y1 <= height + slack, `${label}: marks past the bottom edge (${result.bbox.y1} > ${height})`);

    for (const operator of FORBIDDEN) {
      assert.ok(!new RegExp('\\b' + operator + '\\b').test(eps), `${label}: EPS must not use ${operator}`);
    }
  });
}

test('the EPS prolog sets up Latin-1 fonts and saves state', () => {
  const scene = Scene.build(QR.encode('prolog', { ecl: 'M' }), { frame: { id: 'bottom', text: 'CAFÉ' } });
  const { eps } = Render.toEPS(scene, { size: 300 });
  const prolog = /%%BeginProlog([\s\S]*?)%%EndProlog/.exec(eps)[1];
  assert.match(prolog, /\/qrsave save def/);
  assert.match(prolog, /\/Encoding ISOLatin1Encoding def/);
  assert.match(prolog, /\/QRFont \/Helvetica qrReencode/);
  assert.match(prolog, /\/QRFontBold \/Helvetica-Bold qrReencode/);
  assert.equal((prolog.match(/\bbegin\b/g) || []).length, (prolog.match(/\bend\b/g) || []).length);
  assert.match(eps, /qrsave restore/);
});

test('EPS scales to the requested point size', () => {
  const scene = Scene.build(QR.encode('scale check', { ecl: 'M' }), {});
  for (const size of [72, 283.5, 512, 1000]) {
    const { eps } = Render.toEPS(scene, { size });
    const box = /%%HiResBoundingBox: 0 0 ([\d.]+) ([\d.]+)/.exec(eps);
    assert.ok(Math.abs(parseFloat(box[1]) - size) < 0.01, `width for size ${size}`);
    const result = runPostScript(eps);
    assert.deepEqual(result.errors, [], 'size ' + size);
    assert.ok(result.bbox.x1 <= size + 0.75 && result.bbox.x1 > size * 0.9, `artwork fills the box at ${size}`);
  }
});
