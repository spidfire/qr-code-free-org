/*!
 * app.js — the user interface of qr-code-free.org
 * Part of https://github.com/spidfire/qr-code-free-org (Apache License 2.0)
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('work');

  var state = {
    type: 'url',
    values: {},
    ecl: 'auto',
    quiet: 4,
    moduleShape: 'square',
    eyeShape: 'square',
    fg: '#101828',
    bg: '#ffffff',
    transparent: false,
    frame: { id: 'none', text: '', frameColor: '#4f46e5', textColor: '#ffffff' },
    logo: { href: '', scale: 0.2, plate: true },
    exportSize: 1024,
    fileName: 'qr-code',
    format: 'png'
  };

  var current = null;        // { text, qr, scene }

  var MODULE_SHAPES = [
    { id: 'square', name: 'Square' },
    { id: 'rounded', name: 'Rounded' },
    { id: 'dots', name: 'Dots' },
    { id: 'pill', name: 'Pill' }
  ];
  var EYE_SHAPES = [
    { id: 'square', name: 'Square' },
    { id: 'rounded', name: 'Rounded' },
    { id: 'circle', name: 'Circle' },
    { id: 'leaf', name: 'Leaf' }
  ];
  var PALETTE = [
    { name: 'Classic', fg: '#101828', bg: '#ffffff' },
    { name: 'Indigo', fg: '#312e81', bg: '#ffffff' },
    { name: 'Forest', fg: '#14532d', bg: '#f0fdf4' },
    { name: 'Wine', fg: '#7f1d1d', bg: '#fff7ed' },
    { name: 'Navy on cream', fg: '#0b2447', bg: '#fdf6e3' },
    { name: 'Deep purple', fg: '#4c1d95', bg: '#f5f3ff' },
    { name: 'High visibility', fg: '#111111', bg: '#fde047' },
    { name: 'Teal', fg: '#0f3f3f', bg: '#e6fffa' }
  ];
  // `probe` marks a bitmap format whose availability depends on the browser:
  // a browser that cannot encode it silently hands back a PNG, so we check.
  var FORMATS = [
    { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', kind: 'bitmap',
      note: 'Sharp and universal — the safe choice for screens, documents and e-mail.' },
    { id: 'jpg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg', kind: 'bitmap', opaque: true,
      note: 'Only when something insists on JPG: no transparency, and softer module edges.' },
    { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', kind: 'bitmap', probe: true,
      note: 'The same picture as PNG at roughly a third of the size. For your own website.' },
    { id: 'avif', label: 'AVIF', ext: 'avif', mime: 'image/avif', kind: 'bitmap', probe: true,
      note: 'The smallest file of the lot. Not every app can open it yet.' },
    { id: 'svg', label: 'SVG', ext: 'svg', mime: 'image/svg+xml;charset=utf-8', kind: 'vector',
      note: 'Vector: scales to any size and stays editable. Best for print and large formats.' },
    { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf', kind: 'vector', document: true,
      note: 'Vector, with the caption as real text and your logo embedded. What print shops ask for.' },
    { id: 'eps', label: 'EPS', ext: 'eps', mime: 'application/postscript', kind: 'vector', document: true,
      note: 'Vector for older print workflows. A bitmap logo cannot be stored in EPS.' }
  ];

  var ECL_INFO = { L: 'recovers about 7%', M: 'recovers about 15%', Q: 'recovers about 25%', H: 'recovers about 30%' };
  var LOGO_BUDGET = { L: 0.03, M: 0.08, Q: 0.15, H: 0.2 };

  /* ------------------------------------------------------------- utilities */

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k) && attrs[k] != null) node.setAttribute(k, attrs[k]);
    if (html != null) node.innerHTML = html;
    return node;
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function luminance(hex) {
    var c = hexToRgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrast(a, b) {
    var l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function values() {
    if (!state.values[state.type]) state.values[state.type] = {};
    return state.values[state.type];
  }

  function styleOpts(override) {
    var o = {
      moduleShape: state.moduleShape, eyeShape: state.eyeShape,
      fg: state.fg, bg: state.bg, transparent: state.transparent,
      quiet: state.quiet, frame: state.frame,
      logo: state.logo.href ? state.logo : null
    };
    for (var k in override) if (override.hasOwnProperty(k)) o[k] = override[k];
    return o;
  }

  function svgDataUrl(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /** Does this browser really encode `mime`, or does it quietly return a PNG? */
  function canEncode(mime) {
    try {
      var probe = document.createElement('canvas');
      probe.width = probe.height = 4;
      return probe.toDataURL(mime).indexOf('data:' + mime) === 0;
    } catch (e) {
      return false;
    }
  }

  function format() {
    for (var i = 0; i < FORMATS.length; i++) if (FORMATS[i].id === state.format) return FORMATS[i];
    return FORMATS[0];
  }

  /** Background to paint before drawing, for formats that cannot hold an alpha channel. */
  function flattenTo(fmt) {
    return fmt.opaque && state.transparent ? '#ffffff' : null;
  }

  /** Vector width in points: the chosen pixel size read at 300 dpi. */
  function vectorPoints() { return state.exportSize * 72 / 300; }

  function fileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function dataUrlBytes(url) {
    var base64 = url.slice(url.indexOf(',') + 1);
    if (url.indexOf(';base64') < 0) return decodeURIComponent(base64).length;
    return Math.round(base64.length * 3 / 4) - (base64.slice(-2) === '==' ? 2 : base64.slice(-1) === '=' ? 1 : 0);
  }

  /** Widths from the browser's own Helvetica, so PDF captions centre like the preview. */
  function measureText(str, size, weight) {
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.font = (weight || 'normal') + ' ' + size + 'px Helvetica, Arial, sans-serif';
    var width = ctx.measureText(str).width;
    ctx.restore();
    return width;
  }

  /**
   * Rasterise the logo for the PDF, flattened onto the colour that sits behind it.
   * PDF gets a JPEG, which has no transparency — the same plate the scene draws.
   */
  function logoForPdf(scene) {
    var prim = null;
    scene.items.forEach(function (p) { if (p.t === 'image' && p.href) prim = p; });
    if (!prim) return Promise.resolve(null);

    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var wide = 512;
        var plate = document.createElement('canvas');
        plate.width = wide;
        plate.height = Math.max(1, Math.round(wide * prim.h / prim.w));
        var g = plate.getContext('2d');
        g.fillStyle = state.transparent ? '#ffffff' : state.bg;
        g.fillRect(0, 0, plate.width, plate.height);
        var ratio = Math.min(plate.width / img.width, plate.height / img.height);
        var w = img.width * ratio, h = img.height * ratio;
        g.drawImage(img, (plate.width - w) / 2, (plate.height - h) / 2, w, h);
        plate.toBlob(function (blob) {
          if (!blob) { resolve(null); return; }
          var reader = new FileReader();
          reader.onload = function () {
            resolve({ data: new Uint8Array(reader.result), width: plate.width, height: plate.height });
          };
          reader.onerror = function () { resolve(null); };
          reader.readAsArrayBuffer(blob);
        }, 'image/jpeg', 0.92);
      };
      img.onerror = function () { resolve(null); };
      img.src = prim.href;
    });
  }

  /* ----------------------------------------------------------- type picker */

  function buildTypePicker() {
    var host = $('type-picker');
    QRPayloads.types.forEach(function (type) {
      var btn = el('button', {
        type: 'button', class: 'type-btn', role: 'radio',
        'aria-checked': type.id === state.type ? 'true' : 'false',
        'data-type': type.id, tabindex: type.id === state.type ? '0' : '-1'
      }, '<svg viewBox="0 0 24 24" aria-hidden="true">' + type.icon + '</svg><span>' + type.label + '</span>');
      btn.addEventListener('click', function () { selectType(type.id); });
      host.appendChild(btn);
    });

    host.addEventListener('keydown', function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      var ids = QRPayloads.types.map(function (t) { return t.id; });
      var next = (ids.indexOf(state.type) + keys[e.key] + ids.length) % ids.length;
      selectType(ids[next]);
      host.querySelector('[data-type="' + ids[next] + '"]').focus();
    });
  }

  function selectType(id) {
    state.type = id;
    Array.prototype.forEach.call($('type-picker').children, function (btn) {
      var on = btn.getAttribute('data-type') === id;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.setAttribute('tabindex', on ? '0' : '-1');
    });
    buildFields();
    render();
  }

  /* ---------------------------------------------------------------- fields */

  function buildFields() {
    var type = QRPayloads.get(state.type);
    var host = $('fields');
    var store = values();
    host.innerHTML = '';
    host.className = 'fields' + (type.fields.some(function (f) { return f.half; }) ? ' two-col' : '');
    $('type-hint').textContent = type.hint || '';

    type.fields.forEach(function (field, index) {
      if (store[field.name] === undefined) store[field.name] = field.value || (field.type === 'checkbox' ? false : '');
      var id = 'f-' + type.id + '-' + field.name;
      var wrap = el('label', { class: 'field' + (field.half ? '' : ' full'), for: id });

      if (field.type === 'checkbox') {
        wrap.className = 'check' + (field.half ? '' : ' full');
        var box = el('input', { type: 'checkbox', id: id });
        box.checked = !!store[field.name];
        box.addEventListener('change', function () { store[field.name] = box.checked; render(); });
        wrap.appendChild(box);
        wrap.appendChild(el('span', null, field.label));
        host.appendChild(wrap);
        return;
      }

      wrap.appendChild(el('span', { class: 'label' }, field.label));
      var input;
      if (field.type === 'textarea') {
        input = el('textarea', { id: id, rows: field.rows || 3, placeholder: field.placeholder || '' });
        input.value = store[field.name];
      } else if (field.type === 'select') {
        input = el('select', { id: id });
        field.options.forEach(function (opt) {
          var o = el('option', { value: opt[0] }, opt[1]);
          if (store[field.name] === opt[0]) o.selected = true;
          input.appendChild(o);
        });
      } else {
        input = el('input', {
          type: field.type, id: id, placeholder: field.placeholder || '',
          autocomplete: 'off', spellcheck: field.spellcheck === false ? 'false' : null,
          maxlength: field.type === 'text' || field.type === 'tel' ? 1000 : null
        });
        input.value = store[field.name];
      }
      if (index === 0) input.setAttribute('autofocus', '');
      var onInput = function () { store[field.name] = input.value; schedule(); };
      input.addEventListener('input', onInput);
      input.addEventListener('change', onInput);
      wrap.appendChild(input);
      host.appendChild(wrap);
    });
  }

  /* ------------------------------------------------------------------ tabs */

  function buildTabs() {
    var tabs = Array.prototype.slice.call($('design-tabs').querySelectorAll('button'));
    function activate(name) {
      tabs.forEach(function (btn) {
        var on = btn.getAttribute('data-tab') === name;
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.setAttribute('tabindex', on ? '0' : '-1');
        $('tab-' + btn.getAttribute('data-tab')).hidden = !on;
      });
    }
    tabs.forEach(function (btn, i) {
      btn.addEventListener('click', function () { activate(btn.getAttribute('data-tab')); });
      btn.addEventListener('keydown', function (e) {
        var delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        var next = tabs[(i + delta + tabs.length) % tabs.length];
        activate(next.getAttribute('data-tab'));
        next.focus();
      });
    });
  }

  /* --------------------------------------------------------- style pickers */

  var sampleQr = null;
  function sample() {
    if (!sampleQr) sampleQr = QR.encode('QR-CODE-FREE.ORG', { ecl: 'L', boost: false });
    return sampleQr;
  }

  // `crop` is 'centre' or 'eye': zoom the thumbnail in on the part that changes,
  // otherwise the difference between shapes is invisible at 62 pixels.
  function miniSvg(overrides, size, quiet, crop) {
    var scene = QRScene.build(sample(), styleOpts(Object.assign({
      quiet: quiet == null ? 1 : quiet, logo: null
    }, overrides)));
    var options = { size: size, title: '' };
    if (crop) {
      var meta = scene.meta, span = 9 * meta.unit;
      options.crop = crop === 'eye'
        ? [meta.qrX - meta.unit, meta.qrY - meta.unit, span, span]
        : [meta.qrX + (meta.modules / 2 - 4.5) * meta.unit, meta.qrY + (meta.modules / 2 - 4.5) * meta.unit, span, span];
    }
    return svgDataUrl(QRRender.toSVG(scene, options));
  }

  function buildPicker(host, items, getPreview, currentId, onPick, label) {
    host.innerHTML = '';
    items.forEach(function (item) {
      var btn = el('button', {
        type: 'button', class: 'swatch-btn', role: 'radio',
        'aria-checked': item.id === currentId ? 'true' : 'false',
        'data-id': item.id, tabindex: item.id === currentId ? '0' : '-1',
        title: item.name
      });
      btn.appendChild(el('img', { src: getPreview(item), alt: '', width: 62, height: 62 }));
      btn.appendChild(el('span', null, item.name));
      btn.addEventListener('click', function () { onPick(item.id); });
      host.appendChild(btn);
    });
    host.setAttribute('aria-label', label);
  }

  function markPicker(host, id, attribute) {
    Array.prototype.forEach.call(host.children, function (btn) {
      var on = btn.getAttribute(attribute || 'data-id') === id;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.setAttribute('tabindex', on ? '0' : '-1');
    });
  }

  function refreshPickers() {
    buildPicker($('frame-picker'), QRScene.frames, function (f) {
      return miniSvg({ frame: { id: f.id, text: 'SCAN ME', frameColor: state.frame.frameColor, textColor: state.frame.textColor } }, 150, 2);
    }, state.frame.id, pickFrame, 'Frame');

    buildPicker($('module-picker'), MODULE_SHAPES, function (s) {
      return miniSvg({ moduleShape: s.id, frame: { id: 'none' } }, 120, 1, 'centre');
    }, state.moduleShape, function (id) {
      state.moduleShape = id;
      markPicker($('module-picker'), id);
      render();
    }, 'Module shape');

    buildPicker($('eye-picker'), EYE_SHAPES, function (s) {
      return miniSvg({ eyeShape: s.id, frame: { id: 'none' } }, 120, 1, 'eye');
    }, state.eyeShape, function (id) {
      state.eyeShape = id;
      markPicker($('eye-picker'), id);
      render();
    }, 'Corner eye shape');
  }

  function pickFrame(id) {
    state.frame.id = id;
    var frame = QRScene.frames.filter(function (f) { return f.id === id; })[0];
    if (frame && frame.label && !state.frame.text) {
      state.frame.text = 'SCAN ME';
      $('frame-text').value = 'SCAN ME';
    }
    markPicker($('frame-picker'), id);
    $('frame-controls').hidden = id === 'none';
    render();
  }

  function buildPalette() {
    var host = $('palette');
    PALETTE.forEach(function (p) {
      var btn = el('button', {
        type: 'button', title: p.name + ' — contrast ' + contrast(p.fg, p.bg).toFixed(1) + ':1',
        'aria-label': p.name, style: 'background:' + p.bg
      });
      btn.appendChild(el('span', { style: 'background:' + p.fg }));
      btn.addEventListener('click', function () {
        state.fg = p.fg; state.bg = p.bg;
        $('fg-color').value = p.fg; $('bg-color').value = p.bg;
        refreshPickers();
        render();
      });
      host.appendChild(btn);
    });
  }

  /* --------------------------------------------------------- format picker */

  function buildFormatPicker() {
    var host = $('format-picker');
    var available = FORMATS.filter(function (f) { return !f.probe || canEncode(f.mime); });
    host.innerHTML = '';
    available.forEach(function (fmt) {
      var btn = el('button', {
        type: 'button', class: 'format-btn', role: 'radio', 'data-format': fmt.id,
        'aria-checked': fmt.id === state.format ? 'true' : 'false',
        tabindex: fmt.id === state.format ? '0' : '-1',
        title: fmt.note
      }, fmt.label);
      btn.addEventListener('click', function () { selectFormat(fmt.id); });
      host.appendChild(btn);
    });

    host.addEventListener('keydown', function (e) {
      var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      var ids = available.map(function (f) { return f.id; });
      var next = ids[(ids.indexOf(state.format) + step + ids.length) % ids.length];
      selectFormat(next);
      host.querySelector('[data-format="' + next + '"]').focus();
    });
  }

  function selectFormat(id) {
    state.format = id;
    markPicker($('format-picker'), id, 'data-format');
    $('download-format').textContent = format().label;
    render();
  }

  /* ------------------------------------------------------------- rendering */

  /**
   * Produce the actual file for the chosen format.
   * Resolves to { blob, bytes, notes } — `notes` lists anything the format lost.
   */
  function buildFile(scene, fmt, size) {
    var notes = [];
    if (fmt.kind === 'bitmap') {
      return QRRender.draw(canvas, scene, size, { background: flattenTo(fmt) }).then(function () {
        if (fmt.opaque && state.transparent) notes.push('JPG cannot store transparency, so the background was filled with white');
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            resolve({ blob: blob, bytes: blob ? blob.size : 0, notes: notes });
          }, fmt.mime, 0.92);
        });
      });
    }

    if (fmt.id === 'svg') {
      var svg = QRRender.toSVG(scene, {
        size: size, title: 'QR code',
        description: 'Generated with qr-code-free.org — https://github.com/spidfire/qr-code-free-org'
      });
      var blob = new Blob([svg], { type: fmt.mime });
      return Promise.resolve({ blob: blob, bytes: blob.size, notes: notes, text: svg });
    }

    if (fmt.id === 'eps') {
      var eps = QRRender.toEPS(scene, { size: vectorPoints(), title: 'QR code' });
      if (eps.skippedImages) notes.push('EPS holds vectors only, so the bitmap logo was left out — use PDF or SVG for that');
      if (eps.simplifiedCharacters) notes.push('some characters in the caption are not in Helvetica and were replaced');
      var epsBlob = new Blob([eps.eps], { type: fmt.mime });
      return Promise.resolve({ blob: epsBlob, bytes: epsBlob.size, notes: notes, text: eps.eps });
    }

    return logoForPdf(scene).then(function (image) {
      var pdf = QRRender.toPDF(scene, { size: vectorPoints(), title: 'QR code', measure: measureText, image: image });
      if (image && !state.logo.plate) notes.push('the logo sits on the background colour in PDF, because PDF images cannot be transparent here');
      if (pdf.simplifiedCharacters) notes.push('some characters in the caption are not in Helvetica and were replaced');
      var pdfBlob = new Blob([pdf.pdf], { type: fmt.mime });
      return { blob: pdfBlob, bytes: pdfBlob.size, notes: notes };
    });
  }

  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 130);
  }

  function setDownloadsEnabled(on) {
    $('download').disabled = !on;
  }

  function showEmpty(message) {
    current = null;
    $('preview').hidden = true;
    $('preview-empty').hidden = false;
    $('preview-empty').textContent = message;
    $('report').hidden = true;
    setDownloadsEnabled(false);
    updateCalculator();
  }

  function render() {
    var type = QRPayloads.get(state.type);
    var text;
    try {
      text = type.build(values()) || '';
    } catch (e) {
      text = '';
    }
    if (!text) {
      showEmpty('Fill in the form and your QR code appears here.');
      return;
    }

    var qr;
    try {
      qr = QR.encode(text, state.ecl === 'auto' ? { ecl: 'M', boost: true } : { ecl: state.ecl, boost: false });
    } catch (e) {
      showEmpty('That is too much data for one QR code (' + text.length + ' characters). Shorten the text, or lower the error correction level under Advanced.');
      return;
    }

    var scene = QRScene.build(qr, styleOpts());
    current = { text: text, qr: qr, scene: scene };

    previewSource(scene)
      .then(function (preview) {
        if (!current || current.scene !== scene) return;
        var img = $('preview');
        img.src = preview.src;
        img.width = preview.width;
        img.height = preview.height;
        img.alt = 'QR code for ' + (text.length > 90 ? text.slice(0, 90) + '…' : text);
        img.hidden = false;
        $('preview-empty').hidden = true;
        $('preview-wrap').classList.toggle('preview--alpha', state.transparent && !flattenTo(format()));
        setDownloadsEnabled(true);
        describeFormat(preview);
      })
      .catch(function () {
        showEmpty('The preview could not be drawn. If you added a logo, try a PNG or JPG image.');
      });

    updateReport();
    updateCalculator();
  }

  /** Draw the file the chosen format would produce; documents fall back to PNG. */
  function previewSource(scene) {
    var fmt = format();
    var size = Math.min(1400, Math.max(640, state.exportSize));

    if (fmt.id === 'svg') {
      var svg = QRRender.toSVG(scene, { size: size, title: 'QR code' });
      return Promise.resolve({
        src: svgDataUrl(svg), width: size, height: Math.round(size * scene.height / scene.width),
        bytes: new Blob([svg]).size, showing: fmt
      });
    }

    var mime = fmt.kind === 'bitmap' ? fmt.mime : 'image/png';
    return QRRender.draw(canvas, scene, size, { background: flattenTo(fmt) }).then(function () {
      var url = canvas.toDataURL(mime, 0.92);
      return {
        src: url, width: canvas.width, height: canvas.height, bytes: dataUrlBytes(url),
        showing: fmt.kind === 'bitmap' ? fmt : FORMATS[0]
      };
    });
  }

  function describeFormat(preview) {
    var fmt = format();
    if (fmt.kind === 'bitmap') {
      note(fmt.label + ' · ' + preview.width + ' × ' + preview.height + ' px · ' + fmt.note);
    } else if (fmt.id === 'svg') {
      note('SVG · vector, shown at ' + preview.width + ' px · ' + fmt.note);
    } else {
      var cm = (vectorPoints() / 72 * 2.54).toFixed(1);
      note(fmt.label + ' · vector, ' + cm + ' cm wide and scalable · no browser shows ' + fmt.label +
        ' inline, so the preview above is the PNG.');
    }
  }

  /* ---------------------------------------------------------------- report */

  function updateReport() {
    if (!current) return;
    var qr = current.qr, text = current.text;
    var bg = state.transparent ? '#ffffff' : state.bg;
    var ratio = contrast(state.fg, bg);
    // same rule as the calculator: 0.4 mm per module, quiet zone included, never under 2 cm
    var minWidthMm = Math.max((qr.size + state.quiet * 2) * 0.4, 20);
    var list = $('report-list');
    var warnings = $('warnings');

    var tag = function (kind, label) { return '<span class="tag tag--' + kind + '">' + label + '</span>'; };
    var rows = [
      ['Content', text.length + ' characters · ' + qr.mode + ' mode'],
      ['Symbol', 'version ' + qr.version + ' · ' + qr.size + '×' + qr.size + ' modules'],
      ['Error correction', qr.ecl + ' — ' + ECL_INFO[qr.ecl]],
      ['Contrast', ratio.toFixed(1) + ':1 ' + tag(ratio >= 4 ? 'ok' : ratio >= 3 ? 'warn' : 'bad', ratio >= 4 ? 'good' : ratio >= 3 ? 'tight' : 'too low')],
      ['Never print below', Math.ceil(minWidthMm) + ' mm wide']
    ];
    list.innerHTML = rows.map(function (r) {
      return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
    }).join('');

    var notes = [];
    if (ratio < 3) {
      notes.push(['bad', 'The contrast between your code and its background is ' + ratio.toFixed(1) + ':1. Below 3:1 many scanners give up — pick a darker colour for the modules.']);
    } else if (ratio < 4) {
      notes.push(['warn', 'Contrast of ' + ratio.toFixed(1) + ':1 works on a good phone in good light, but little else. 4:1 or more is a safer target.']);
    }
    if (luminance(state.fg) > luminance(bg)) {
      notes.push(['warn', 'Your code is lighter than its background. Inverted codes fail on plenty of older scanners; swap the two colours if you can.']);
    }
    if (state.logo.href) {
      var coverage = state.logo.scale * state.logo.scale;
      var budget = LOGO_BUDGET[qr.ecl];
      if (coverage > budget) {
        notes.push([coverage > budget * 1.6 ? 'bad' : 'warn', 'The logo covers about ' + Math.round(coverage * 100) +
          '% of the code, which is a lot at level ' + qr.ecl + '. Make it smaller, or set error correction to ' +
          (qr.ecl === 'H' ? 'H and shrink the logo' : 'Q or H') + ' under Advanced.']);
      }
    }
    if (state.quiet < 4) {
      notes.push(['warn', 'A quiet zone of ' + state.quiet + ' modules is below the standard of 4. Scanners use that empty margin to find the code.']);
    }
    if (qr.version >= 20) {
      notes.push(['warn', 'This is a dense code (version ' + qr.version + ', ' + qr.size + ' modules). Shorten the content or print it larger: each module needs to stay at least 0.4 mm.']);
    }
    if (state.moduleShape === 'dots') {
      notes.push(['ok', 'Dot shaped modules look good but lose a little contrast at small sizes. Print this one a size up, or keep squares for anything under 3 cm.']);
    }
    if (!notes.length) {
      notes.push(['ok', 'No problems found. Print it at the size the calculator below suggests and test it with two different phones.']);
    }

    warnings.innerHTML = notes.map(function (nt) {
      return '<li class="' + nt[0] + '">' + nt[1] + '</li>';
    }).join('');
    $('report').hidden = false;
  }

  /* ------------------------------------------------------------ calculator */

  var UNIT_MM = { cm: 10, m: 1000, in: 25.4, ft: 304.8 };

  function fmt(mm, imperial) {
    if (imperial) return (mm / 25.4).toFixed(mm / 25.4 < 10 ? 1 : 0) + ' inch';
    if (mm >= 1000) return (mm / 1000).toFixed(2).replace(/\.?0+$/, '') + ' m';
    if (mm >= 10) return (mm / 10).toFixed(mm / 10 < 10 ? 1 : 0).replace(/\.0$/, '') + ' cm';
    return Math.round(mm) + ' mm';
  }

  function updateCalculator() {
    var unit = $('calc-unit').value;
    var raw = parseFloat($('calc-distance').value);
    var out = $('calc-out');
    if (!(raw > 0)) { out.innerHTML = '<p class="hint">Enter a scanning distance.</p>'; return; }

    var imperial = unit === 'in' || unit === 'ft';
    var distanceMm = raw * UNIT_MM[unit];
    var minMm = Math.max(distanceMm / 10, 20);
    var comfortMm = Math.max(distanceMm / 8, 25);

    var html = '<div><span class="calc-big">' + fmt(minMm, imperial) + ' wide</span> ' +
      '<span class="hint">minimum, using the 10:1 rule</span></div>' +
      '<div class="calc-line"><span>Comfortable (8:1), for walk-by or poor light</span><strong>' + fmt(comfortMm, imperial) + '</strong></div>';

    if (current) {
      var modules = current.qr.size;
      var withQuiet = modules + state.quiet * 2;
      var moduleMm = minMm / withQuiet;
      var ok = moduleMm >= 0.4;
      html += '<div class="calc-line"><span>Your code (' + modules + '×' + modules + ' modules) at that width</span><strong>' +
        moduleMm.toFixed(2) + ' mm per module ' + (ok ? '✓' : '— too fine') + '</strong></div>';
      html += '<div class="calc-line"><span>Smallest size this code should ever be printed</span><strong>' +
        fmt(Math.max(withQuiet * 0.4, 20), imperial) + '</strong></div>';   // matches the scan report
      if (!ok) {
        html += '<p class="hint">At this distance the modules fall under 0.4 mm. Print it larger, or shorten the content so the code needs fewer modules.</p>';
      }
    } else {
      html += '<p class="hint">Make a code above and this also tells you how fine its modules become at that size.</p>';
    }
    out.innerHTML = html;
  }

  /* ------------------------------------------------------------- downloads */

  function safeName() {
    var name = (state.fileName || 'qr-code').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return name || 'qr-code';
  }

  function saveBlob(blob, extension) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = safeName() + '.' + extension;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function note(message) {
    $('download-note').textContent = message;
  }

  function download() {
    if (!current) return;
    var fmt = format();
    var button = $('download');
    button.disabled = true;
    note('Preparing the ' + fmt.label + '…');

    buildFile(current.scene, fmt, state.exportSize)
      .then(function (file) {
        if (!file.blob) throw new Error('no file');
        saveBlob(file.blob, fmt.ext);
        var message = 'Saved ' + safeName() + '.' + fmt.ext + ' · ' + fileSize(file.bytes);
        if (file.notes.length) message += ' — ' + file.notes.join('; ') + '.';
        note(message);
      })
      .catch(function () {
        note('That file could not be created. Try another format, or a smaller export size.');
      })
      .then(function () {
        button.disabled = false;   // the preview image holds its own data, so leave it alone
      });
  }

  function wireDownloads() {
    $('download').addEventListener('click', download);
  }

  /* ----------------------------------------------------------- form wiring */

  function wireControls() {
    $('frame-text').addEventListener('input', function () {
      state.frame.text = this.value;
      schedule();
    });
    $('frame-color').addEventListener('input', function () {
      state.frame.frameColor = this.value;
      refreshPickers();
      schedule();
    });
    $('frame-text-color').addEventListener('input', function () {
      state.frame.textColor = this.value;
      refreshPickers();
      schedule();
    });
    $('fg-color').addEventListener('input', function () {
      state.fg = this.value;
      refreshPickers();
      schedule();
    });
    $('bg-color').addEventListener('input', function () {
      state.bg = this.value;
      refreshPickers();
      schedule();
    });
    $('transparent').addEventListener('change', function () {
      state.transparent = this.checked;
      render();
    });
    $('ecl').addEventListener('change', function () {
      state.ecl = this.value;
      render();
    });
    $('quiet').addEventListener('input', function () {
      state.quiet = parseInt(this.value, 10);
      $('quiet-out').textContent = state.quiet + (state.quiet === 1 ? ' module' : ' modules');
      schedule();
    });
    $('export-size').addEventListener('change', function () {
      state.exportSize = parseInt(this.value, 10);
      render();
    });
    $('file-name').addEventListener('input', function () { state.fileName = this.value; });

    $('logo-scale').addEventListener('input', function () {
      state.logo.scale = parseInt(this.value, 10) / 100;
      $('logo-scale-out').textContent = this.value + '%';
      schedule();
    });
    $('logo-plate').addEventListener('change', function () {
      state.logo.plate = this.checked;
      render();
    });
    $('logo-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.logo.href = String(reader.result);
        $('logo-preview').src = state.logo.href;
        $('logo-preview').hidden = false;
        $('logo-remove').hidden = false;
        render();
      };
      reader.readAsDataURL(file);
    });
    $('logo-remove').addEventListener('click', function () {
      state.logo.href = '';
      $('logo-file').value = '';
      $('logo-preview').hidden = true;
      this.hidden = true;
      render();
    });

    $('calc-distance').addEventListener('input', updateCalculator);
    $('calc-unit').addEventListener('change', updateCalculator);
  }

  /* ------------------------------------------------------------------ init */

  function init() {
    buildTypePicker();
    buildFields();
    buildTabs();
    buildFormatPicker();
    buildPalette();
    refreshPickers();
    wireControls();
    wireDownloads();
    $('frame-controls').hidden = state.frame.id === 'none';
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
