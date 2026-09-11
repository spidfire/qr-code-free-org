/*!
 * payloads.js — content types and the strings they encode into a QR code.
 * Part of https://github.com/spidfire/qr-code-free-org (Apache License 2.0)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRPayloads = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function s(v) { return (v == null ? '' : String(v)).trim(); }

  /** Escape a value for the WIFI: and MECARD-style semicolon formats. */
  function escSemi(v) { return s(v).replace(/([\\;,:"])/g, '\\$1'); }

  /** Escape a value for vCard / iCalendar text fields. */
  function escText(v) {
    return s(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  }

  function withScheme(url) {
    var v = s(url);
    if (!v) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
    if (/^\/\//.test(v)) return 'https:' + v;
    return 'https://' + v;
  }

  function digits(v) { return s(v).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, ''); }

  function query(pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      if (s(pairs[i][1])) out.push(pairs[i][0] + '=' + encodeURIComponent(s(pairs[i][1])));
    }
    return out.length ? '?' + out.join('&') : '';
  }

  function lines(arr) {
    return arr.filter(function (l) { return l; }).join('\r\n');
  }

  /** "2026-03-14" + "18:30" -> "20260314T183000"; date only -> "20260314". */
  function stamp(date, time) {
    var d = s(date).replace(/-/g, '');
    if (!d) return '';
    var t = s(time).replace(/:/g, '');
    if (!t) return d;
    while (t.length < 6) t += '0';
    return d + 'T' + t;
  }

  var icon = {
    link: '<path d="M9.5 14.5 14.5 9.5M8 12.5 6.6 14a3.8 3.8 0 0 0 5.4 5.4l1.4-1.4M16 11.5 17.4 10A3.8 3.8 0 0 0 12 4.6L10.6 6"/>',
    text: '<path d="M5 6h14M5 11h14M5 16h9"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    phone: '<path d="M6 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5 5L15 12l4 1.5v3A2 2 0 0 1 16.8 19C10 18.2 5.8 14 5 7.2A2 2 0 0 1 6 3.5Z"/>',
    sms: '<path d="M20 14a2 2 0 0 1-2 2H9l-4 3.5V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2Z"/><path d="M9 10h7M9 13h4"/>',
    whatsapp: '<path d="M4.5 19.5 5.8 16A7.6 7.6 0 1 1 8.7 18.6Z"/><path d="M9.5 9c0 3 2 4.8 4.6 5.4l.9-1.4 1.6.7c-.3 1.3-2 1.7-3.3 1.2-2.8-1-5-3.6-5.2-6.2C8 7.5 9 7 9.9 7.2Z"/>',
    wifi: '<path d="M3.5 8.5a13 13 0 0 1 17 0M6.5 12a9 9 0 0 1 11 0M9.5 15.5a5 5 0 0 1 5 0"/><circle cx="12" cy="19" r="1.2"/>',
    vcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M5.8 16.5a3.5 3.5 0 0 1 6.4 0M15 10h3.5M15 13.5h3.5"/>',
    event: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/><path d="M7.5 13h3v3h-3z"/>',
    geo: '<path d="M12 21c4-4.5 6-7.6 6-10.3A6 6 0 0 0 6 10.7C6 13.4 8 16.5 12 21Z"/><circle cx="12" cy="10.5" r="2.2"/>'
  };

  var types = [
    {
      id: 'url', label: 'Link', icon: icon.link,
      hint: 'Any https link: your website, a hosted PDF, a Google Maps place, an app store page, a video.',
      fields: [{ name: 'url', label: 'Website or file URL', type: 'text', placeholder: 'example.com/page', required: true, spellcheck: false }],
      build: function (v) { return withScheme(v.url); }
    },
    {
      id: 'text', label: 'Plain text', icon: icon.text,
      hint: 'Shown as text when scanned. Good for serial numbers, instructions or a short note.',
      fields: [{ name: 'text', label: 'Text', type: 'textarea', placeholder: 'Table 12 — ask staff for the wine list', required: true, rows: 3 }],
      build: function (v) { return s(v.text); }
    },
    {
      id: 'email', label: 'E-mail', icon: icon.mail,
      hint: 'Opens a pre-filled e-mail. Keep the body short — every character makes the code denser.',
      fields: [
        { name: 'to', label: 'To', type: 'email', placeholder: 'hello@example.com', required: true },
        { name: 'subject', label: 'Subject', type: 'text', placeholder: 'Quote request' },
        { name: 'body', label: 'Message', type: 'textarea', rows: 2, placeholder: 'Hi, I would like to…' }
      ],
      build: function (v) {
        if (!s(v.to)) return '';
        return 'mailto:' + s(v.to) + query([['subject', v.subject], ['body', v.body]]);
      }
    },
    {
      id: 'phone', label: 'Call', icon: icon.phone,
      hint: 'Use the international format (+31…) so the number works for visitors from anywhere.',
      fields: [{ name: 'number', label: 'Phone number', type: 'tel', placeholder: '+31 20 123 4567', required: true }],
      build: function (v) { return digits(v.number) ? 'tel:' + digits(v.number) : ''; }
    },
    {
      id: 'sms', label: 'SMS', icon: icon.sms,
      hint: 'Opens the messaging app with the number and text filled in.',
      fields: [
        { name: 'number', label: 'Phone number', type: 'tel', placeholder: '+31 6 1234 5678', required: true },
        { name: 'message', label: 'Message', type: 'textarea', rows: 2, placeholder: 'INFO' }
      ],
      build: function (v) {
        if (!digits(v.number)) return '';
        return 'SMSTO:' + digits(v.number) + ':' + s(v.message);
      }
    },
    {
      id: 'whatsapp', label: 'WhatsApp', icon: icon.whatsapp,
      hint: 'A wa.me link. The number must include the country code, without spaces or a leading zero.',
      fields: [
        { name: 'number', label: 'Phone number (with country code)', type: 'tel', placeholder: '+31612345678', required: true },
        { name: 'message', label: 'Pre-filled message', type: 'textarea', rows: 2, placeholder: 'Hi! I saw your poster…' }
      ],
      build: function (v) {
        var n = digits(v.number).replace(/^\+/, '');
        if (!n) return '';
        return 'https://wa.me/' + n + query([['text', v.message]]);
      }
    },
    {
      id: 'wifi', label: 'Wi-Fi', icon: icon.wifi,
      hint: 'Joins a network without typing the password. Works on iOS 11+, Android 10+ and most scanner apps.',
      fields: [
        { name: 'ssid', label: 'Network name (SSID)', type: 'text', placeholder: 'Cafe-Guest', required: true, spellcheck: false },
        { name: 'password', label: 'Password', type: 'text', placeholder: 'correct-horse-battery', spellcheck: false },
        {
          name: 'security', label: 'Security', type: 'select', value: 'WPA',
          options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP (old)'], ['nopass', 'Open — no password']]
        },
        { name: 'hidden', label: 'Hidden network', type: 'checkbox' }
      ],
      build: function (v) {
        if (!s(v.ssid)) return '';
        var sec = s(v.security) || 'WPA';
        var out = 'WIFI:T:' + sec + ';S:' + escSemi(v.ssid) + ';';
        if (sec !== 'nopass' && s(v.password)) out += 'P:' + escSemi(v.password) + ';';
        if (v.hidden) out += 'H:true;';
        return out + ';';
      }
    },
    {
      id: 'vcard', label: 'Contact card', icon: icon.vcard,
      hint: 'A vCard 3.0 business card. Fill in only what you need — every field adds data.',
      fields: [
        { name: 'first', label: 'First name', type: 'text', placeholder: 'Sam', required: true, half: true },
        { name: 'last', label: 'Last name', type: 'text', placeholder: 'Jansen', half: true },
        { name: 'org', label: 'Company', type: 'text', placeholder: 'Example BV', half: true },
        { name: 'title', label: 'Job title', type: 'text', placeholder: 'Bakker', half: true },
        { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+31 6 1234 5678', half: true },
        { name: 'email', label: 'E-mail', type: 'email', placeholder: 'sam@example.com', half: true },
        { name: 'url', label: 'Website', type: 'text', placeholder: 'example.com', spellcheck: false },
        { name: 'address', label: 'Address', type: 'text', placeholder: 'Kerkstraat 1, 1017 Amsterdam' },
        { name: 'note', label: 'Note', type: 'textarea', rows: 2, placeholder: 'Open Tue–Sat' }
      ],
      build: function (v) {
        if (!s(v.first) && !s(v.last) && !s(v.org)) return '';
        return lines([
          'BEGIN:VCARD',
          'VERSION:3.0',
          'N:' + escText(v.last) + ';' + escText(v.first) + ';;;',
          'FN:' + escText(s(v.first) + (s(v.last) ? ' ' + s(v.last) : '')),
          s(v.org) ? 'ORG:' + escText(v.org) : '',
          s(v.title) ? 'TITLE:' + escText(v.title) : '',
          s(v.phone) ? 'TEL;TYPE=CELL:' + s(v.phone) : '',
          s(v.email) ? 'EMAIL;TYPE=INTERNET:' + s(v.email) : '',
          s(v.url) ? 'URL:' + withScheme(v.url) : '',
          s(v.address) ? 'ADR;TYPE=WORK:;;' + escText(v.address) + ';;;;' : '',
          s(v.note) ? 'NOTE:' + escText(v.note) : '',
          'END:VCARD'
        ]);
      }
    },
    {
      id: 'event', label: 'Event', icon: icon.event,
      hint: 'Adds an entry to the calendar app. Times are read as the local time of the person scanning.',
      fields: [
        { name: 'summary', label: 'Title', type: 'text', placeholder: 'Open day', required: true },
        { name: 'start', label: 'Starts', type: 'date', half: true },
        { name: 'startTime', label: 'Start time', type: 'time', half: true },
        { name: 'end', label: 'Ends', type: 'date', half: true },
        { name: 'endTime', label: 'End time', type: 'time', half: true },
        { name: 'location', label: 'Location', type: 'text', placeholder: 'Kerkstraat 1, Amsterdam' },
        { name: 'description', label: 'Description', type: 'textarea', rows: 2, placeholder: 'Free entry, coffee included' }
      ],
      build: function (v) {
        if (!s(v.summary) || !s(v.start)) return '';
        var start = stamp(v.start, v.startTime);
        var end = stamp(v.end || v.start, v.endTime || v.startTime);
        var allDay = !s(v.startTime);
        return lines([
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'SUMMARY:' + escText(v.summary),
          allDay ? 'DTSTART;VALUE=DATE:' + start : 'DTSTART:' + start,
          allDay ? 'DTEND;VALUE=DATE:' + end : 'DTEND:' + end,
          s(v.location) ? 'LOCATION:' + escText(v.location) : '',
          s(v.description) ? 'DESCRIPTION:' + escText(v.description) : '',
          'END:VEVENT',
          'END:VCALENDAR'
        ]);
      }
    },
    {
      id: 'geo', label: 'Location', icon: icon.geo,
      hint: 'Coordinates with a dot as decimal separator. Right-click a spot in Google Maps to copy them.',
      fields: [
        { name: 'lat', label: 'Latitude', type: 'text', placeholder: '52.3676', required: true, half: true, spellcheck: false },
        { name: 'lng', label: 'Longitude', type: 'text', placeholder: '4.9041', required: true, half: true, spellcheck: false },
        {
          name: 'format', label: 'Open with', type: 'select', value: 'geo',
          options: [['geo', 'The phone’s own maps app (geo:)'], ['gmaps', 'Google Maps link']]
        }
      ],
      build: function (v) {
        var lat = s(v.lat).replace(',', '.'), lng = s(v.lng).replace(',', '.');
        if (!lat || !lng) return '';
        if (s(v.format) === 'gmaps') return 'https://www.google.com/maps?q=' + lat + ',' + lng;
        return 'geo:' + lat + ',' + lng;
      }
    }
  ];

  var byId = {};
  types.forEach(function (t) { byId[t.id] = t; });

  return {
    types: types,
    get: function (id) { return byId[id] || types[0]; },
    helpers: { withScheme: withScheme, escSemi: escSemi, escText: escText, digits: digits, stamp: stamp }
  };
});
