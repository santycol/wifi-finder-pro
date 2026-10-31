/* WiFi Finder Pro — Codificador QR propio (modo byte, UTF-8), sin dependencias.
   Basado en el algoritmo estándar ISO/IEC 18004. */
(function (global) {
  'use strict';
  var ECC = {
    L: [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    M: [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    Q: [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    H: [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  };
  var BLOCKS = {
    L: [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    M: [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    Q: [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    H: [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]
  };
  var FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  function bit(x, i) { return ((x >>> i) & 1) !== 0; }
  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver, ecl) { return Math.floor(rawModules(ver) / 8) - ECC[ecl][ver] * BLOCKS[ecl][ver]; }
  function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }
  function utf8(str) { return Array.from(new TextEncoder().encode(str)); }

  function encode(text, ecl) {
    ecl = ecl || 'M';
    var bytes = utf8(text), ver, cap;
    for (ver = 1; ver <= 40; ver++) {
      cap = dataCodewords(ver, ecl) * 8;
      var ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= cap) break;
    }
    if (ver > 40) throw new Error('Texto demasiado largo para un código QR');
    var bb = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); }
    push(4, 4); push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, cap - bb.length));
    push(0, (8 - bb.length % 8) % 8);
    for (var pad = 0xEC; bb.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
    var data = [];
    for (var i = 0; i < bb.length; i += 8) { var v = 0; for (var k = 0; k < 8; k++) v = (v << 1) | bb[i + k]; data.push(v); }

    // ECC + intercalado
    var nb = BLOCKS[ecl][ver], eccLen = ECC[ecl][ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen), blocks = [], p = 0;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(p, p + shortLen - eccLen + (i < nShort ? 0 : 1)); p += dat.length;
      var e = rsRemainder(dat, div); if (i < nShort) dat.push(0);
      blocks.push(dat.concat(e));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++) blocks.forEach(function (b, j) { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });

    var size = ver * 4 + 17, M = [], F = [];
    for (i = 0; i < size; i++) { M.push(new Array(size).fill(false)); F.push(new Array(size).fill(false)); }
    function setF(x, y, d) { M[y][x] = d; F[y][x] = true; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    function finder(x, y) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var al = [];
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      al = [6]; for (var pos = size - 7; al.length < na; pos -= step) al.splice(1, 0, pos);
    }
    al.forEach(function (ay, ii) { al.forEach(function (ax, jj) {
      if ((ii === 0 && jj === 0) || (ii === 0 && jj === al.length - 1) || (ii === al.length - 1 && jj === 0)) return;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }); });
    function format(mask) {
      var d = FORMAT_BITS[ecl] << 3 | mask, r = d;
      for (var i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var b = (d << 10 | r) ^ 0x5412;
      for (i = 0; i <= 5; i++) setF(8, i, bit(b, i));
      setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
      for (i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
      for (i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
      for (i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
      setF(8, size - 8, true);
    }
    format(0);
    if (ver >= 7) {
      var r = ver; for (i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vb = ver << 12 | r;
      for (i = 0; i < 18; i++) { var bt = bit(vb, i), a = size - 11 + i % 3, b2 = Math.floor(i / 3); setF(a, b2, bt); setF(b2, a, bt); }
    }
    // Colocar datos
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!F[y][x] && idx < all.length * 8) { M[y][x] = bit(all[idx >>> 3], 7 - (idx & 7)); idx++; }
      }
    }
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!F[y][x] && inv) M[y][x] = !M[y][x];
      }
    }
    function penalty() {
      var s = 0, dark = 0, y, x, run, c;
      for (y = 0; y < size; y++) { run = 1; for (x = 1; x <= size; x++) { if (x < size && M[y][x] === M[y][x - 1]) run++; else { if (run >= 5) s += run - 2; run = 1; } } }
      for (x = 0; x < size; x++) { run = 1; for (y = 1; y <= size; y++) { if (y < size && M[y][x] === M[y - 1][x]) run++; else { if (run >= 5) s += run - 2; run = 1; } } }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) s += 3; }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (M[y][x]) dark++;
      var total = size * size, k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      return s + Math.max(0, k) * 10;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) { applyMask(m); format(m); var pp = penalty(); if (pp < bestP) { bestP = pp; best = m; } applyMask(m); }
    applyMask(best); format(best);
    return { size: size, version: ver, modules: M };
  }

  function toSVG(qr, opts) {
    opts = opts || {}; var b = opts.border == null ? 4 : opts.border, n = qr.size + b * 2, path = '';
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++) if (qr.modules[y][x]) path += 'M' + (x + b) + ',' + (y + b) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">' +
      '<rect width="100%" height="100%" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }
  function toCanvas(qr, scale, border) {
    border = border == null ? 4 : border; scale = scale || 10;
    var n = (qr.size + border * 2) * scale, c = document.createElement('canvas'); c.width = c.height = n;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, n, n); g.fillStyle = '#000';
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++) if (qr.modules[y][x]) g.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
    return c;
  }
  var api = { encode: encode, toSVG: toSVG, toCanvas: toCanvas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.QR = api;
})(typeof window !== 'undefined' ? window : globalThis);
