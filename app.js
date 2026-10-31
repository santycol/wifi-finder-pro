/* WiFi Finder Pro — lógica de la aplicación (sin dependencias obligatorias). */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  /* ---------------- Toast y diálogos ---------------- */
  var toastTimer;
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2200);
  }
  var modalResolve = null;
  function modal(opts) {
    return new Promise(function (resolve) {
      var m = $('#modal');
      if (modalResolve) modalResolve(null);
      modalResolve = resolve;
      m.classList.toggle('full', !!opts.full);
      $('#modalTitle').textContent = opts.title || '';
      $('#modalTitle').hidden = !opts.title;
      var body = $('#modalBody'); body.innerHTML = '';
      if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
      var act = $('#modalActions'); act.innerHTML = '';
      (opts.actions || [{ label: 'Cerrar', value: null }]).forEach(function (a) {
        var b = h('<button class="btn ' + (a.cls || '') + '" type="button">' + esc(a.label) + '</button>');
        b.onclick = function () {
          var v = typeof a.value === 'function' ? a.value() : a.value;
          if (v === false) return; // mantener abierto
          closeModal(v);
        };
        act.appendChild(b);
      });
      m.hidden = false;
      var first = body.querySelector('input,select,textarea'); if (first) setTimeout(function () { first.focus(); }, 60);
    });
  }
  function closeModal(v) { $('#modal').hidden = true; var r = modalResolve; modalResolve = null; if (r) r(v); }
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(null); });
  function confirmBox(title, msg, okLabel, danger) {
    return modal({ title: title, body: '<p>' + msg + '</p>', actions: [{ label: 'Cancelar', value: null }, { label: okLabel || 'Aceptar', cls: danger ? 'danger' : 'primary', value: true }] })
      .then(function (v) { return v === true; });
  }
  function askPassword(title, msg) {
    var wrap = h('<form><p class="small">' + (msg || '') + '</p><input type="password" autocomplete="current-password" placeholder="Contraseña maestra"></form>');
    var input = wrap.querySelector('input');
    wrap.onsubmit = function (e) { e.preventDefault(); closeModal(input.value); };
    return modal({ title: title, body: wrap, actions: [{ label: 'Cancelar', value: null }, { label: 'Aceptar', cls: 'primary', value: function () { return input.value; } }] });
  }
  async function copyText(t, label) {
    try { await navigator.clipboard.writeText(t); toast((label || 'Texto') + ' copiado'); }
    catch (e) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
      var ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
      ta.remove(); toast(ok ? (label || 'Texto') + ' copiado' : 'No se pudo copiar');
    }
  }
  async function shareOrDownload(blob, filename, title) {
    var file;
    try { file = new File([blob], filename, { type: blob.type }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: title || filename }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return 'downloaded';
  }

  /* ---------------- Ojo para contraseñas ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.eye'); if (!b) return;
    var inp = document.getElementById(b.dataset.eye); if (!inp) return;
    var show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.classList.toggle('on', show);
  });

  /* ---------------- Navegación por pestañas ---------------- */
  var TABS = ['cerca', 'boveda', 'qr', 'seguridad', 'recuperar'];
  function route() {
    var t = (location.hash || '').slice(1); if (TABS.indexOf(t) < 0) t = LS.get('wfp.tab', 'cerca');
    if (TABS.indexOf(t) < 0) t = 'cerca';
    TABS.forEach(function (x) { $('#view-' + x).hidden = x !== t; });
    $$('#tabbar a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === t); });
    LS.set('wfp.tab', t);
    if (t === 'cerca' && map) setTimeout(function () { map.invalidateSize(); }, 50);
    if (t === 'qr' || t === 'seguridad') fillVaultSelects();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-goto]'); if (!g) return;
    location.hash = g.dataset.goto;
    if (g.dataset.scan) setTimeout(function () { $('#fileQR').click(); }, 150);
    if (g.dataset.add) setTimeout(function () { if (vault.key) editEntry(null); else toast('Primero desbloquea o crea tu bóveda'); }, 150);
  });

  /* ---------------- Estado de red e instalación ---------------- */
  function netStatus() { var p = $('#netStatus'); var on = navigator.onLine; p.textContent = on ? '● En línea' : '● Sin conexión'; p.classList.toggle('off', !on); }
  window.addEventListener('online', netStatus); window.addEventListener('offline', netStatus); netStatus();
  var standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !standalone && !LS.get('wfp.hideInstall', false)) $('#installHint').hidden = false;
  $('#installHintClose').onclick = function () { $('#installHint').hidden = true; LS.set('wfp.hideInstall', true); };
  $('#appVersion').textContent = 'Versión ' + VERSION + (standalone ? ' · instalada' : ' · en navegador');

  /* ---------------- Carga perezosa de librerías externas ---------------- */
  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res;
      s.onerror = function () { delete loaded[src]; rej(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  function loadCSS(href) { if (document.querySelector('link[href="' + href + '"]')) return; var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var JSQR_JS = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

  /* =========================================================
     1 y 4. Wi-Fi públicas cercanas (OpenStreetMap / Overpass)
     ========================================================= */
  var OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  var near = { center: null, items: [], filter: 'all' };
  var map = null, mapLayer = null;
  var TYPE = {
    cafe: 'Cafetería', restaurant: 'Restaurante', fast_food: 'Comida rápida', bar: 'Bar', pub: 'Bar', library: 'Biblioteca',
    hotel: 'Hotel', hostel: 'Hostal', motel: 'Motel', guest_house: 'Casa de huéspedes', townhall: 'Edificio público', community_centre: 'Centro comunitario',
    university: 'Universidad', college: 'Escuela', school: 'Escuela', fuel: 'Gasolinera', marketplace: 'Mercado', mall: 'Centro comercial',
    supermarket: 'Supermercado', bus_station: 'Estación de autobuses', station: 'Estación', ice_cream: 'Heladería', coworking_space: 'Coworking',
    internet_cafe: 'Cibercafé', bakery: 'Panadería', park: 'Parque', museum: 'Museo', cinema: 'Cine', hospital: 'Hospital', terminal: 'Terminal', airport: 'Aeropuerto',
    attraction: 'Atracción', information: 'Información turística', convenience: 'Tienda', books: 'Librería', fitness_centre: 'Gimnasio', food_court: 'Zona de comidas'
  };
  var PUBLIC_LIKELY = ['library', 'townhall', 'community_centre', 'park', 'bus_station', 'station', 'information', 'museum', 'university', 'terminal'];
  var ACCESS_LABEL = { free: 'Gratis', likely: 'Prob. gratis', customers: 'Clientes', paid: 'De pago', unknown: 'Sin datos' };

  function haversine(a, b, c, d) {
    var R = 6371000, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
    var k = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.sqrt(k));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }
  function setNearStatus(msg, isErr) { var s = $('#nearStatus'); s.innerHTML = msg; s.classList.toggle('err', !!isErr); }

  function classify(t) {
    var fee = (t['internet_access:fee'] || '').toLowerCase(), wifi = (t.wifi || '').toLowerCase();
    if (fee === 'no' || wifi === 'free') return 'free';
    if (fee === 'customers') return 'customers';
    if (fee === 'yes' || fee === 'paid') return 'paid';
    var kind = t.amenity || t.tourism || t.leisure || t.aeroway || t.public_transport || '';
    if (PUBLIC_LIKELY.indexOf(kind) >= 0) return 'likely';
    return 'unknown';
  }
  function parseElements(els, lat, lon) {
    var seen = {};
    return els.map(function (e) {
      var t = e.tags || {}, la = e.lat != null ? e.lat : (e.center && e.center.lat), lo = e.lon != null ? e.lon : (e.center && e.center.lon);
      if (la == null) return null;
      var kind = t.amenity || t.shop || t.tourism || t.leisure || t.office || t.aeroway || t.railway || t.public_transport || '';
      var name = t.name || t.brand || t.operator || (TYPE[kind] || 'Punto de acceso Wi-Fi');
      var addr = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || t['addr:full'] || '';
      return {
        id: e.type + '/' + e.id, name: name, lat: la, lon: lo, kind: kind, typeLabel: TYPE[kind] || (kind ? kind.replace(/_/g, ' ') : 'Lugar'),
        access: classify(t), ssid: t['internet_access:ssid'] || t['wifi:ssid'] || '', addr: addr, hours: t.opening_hours || '',
        web: t.website || t['contact:website'] || '', dist: haversine(lat, lon, la, lo)
      };
    }).filter(function (x) {
      if (!x) return false; var k = x.name + '|' + x.lat.toFixed(4) + x.lon.toFixed(4); if (seen[k]) return false; seen[k] = 1; return true;
    }).sort(function (a, b) { return a.dist - b.dist; });
  }
  async function fetchTimeout(url, opts, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || 25000);
    try { return await fetch(url, Object.assign({}, opts, { signal: ctl.signal })); } finally { clearTimeout(t); }
  }
  async function overpass(lat, lon, r) {
    var a = '(around:' + r + ',' + lat + ',' + lon + ')';
    var q = '[out:json][timeout:25];(nwr["internet_access"~"^(wlan|yes|wifi|public|terminal;wlan|wlan;terminal)$"]' + a +
      ';nwr["wifi"~"^(yes|free)$"]' + a + ';nwr["internet_access:fee"="no"]' + a + ';);out center tags 300;';
    var lastErr;
    for (var i = 0; i < OVERPASS.length; i++) {
      try {
        var res = await fetchTimeout(OVERPASS[i], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }, 30000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var j = await res.json(); return j.elements || [];
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Sin respuesta');
  }
  function getPosition() {
    return new Promise(function (res, rej) {
      if (!('geolocation' in navigator)) return rej({ code: -1 });
      navigator.geolocation.getCurrentPosition(function (p) { res(p.coords); }, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }
  var GEO_HELP = '<br>Para permitirla: en Safari toca <b>aA</b> → <b>Configuración del sitio web</b> → <b>Ubicación: Permitir</b>, y en <b>Ajustes → Privacidad y seguridad → Localización</b> activa la localización. <a href="#recuperar">Más ayuda</a>. También puedes escribir una dirección.';

  async function searchAt(lat, lon, label) {
    var r = +$('#radius').value;
    near.center = { lat: lat, lon: lon, label: label };
    setNearStatus('Buscando Wi-Fi en ' + fmtDist(r) + ' a la redonda…');
    try {
      var els = await overpass(lat, lon, r);
      near.items = parseElements(els, lat, lon);
      LS.set('wfp.lastNearby', { center: near.center, items: near.items, at: Date.now(), r: r });
      setNearStatus(near.items.length ? near.items.length + ' lugares con Wi-Fi cerca de ' + esc(label) + '.'
        : 'No hay lugares con Wi-Fi registrados en ' + fmtDist(r) + '. Prueba un radio mayor o <a href="https://maps.apple.com/?q=Wi-Fi%20gratis&sll=' + lat + ',' + lon + '" target="_blank" rel="noopener">busca en Apple Maps</a>.');
      renderNear();
    } catch (e) {
      var cached = LS.get('wfp.lastNearby', null);
      setNearStatus('No se pudo consultar el servidor de mapas (' + esc(e.message || 'error de red') + '). ' + (cached ? 'Mostrando la última búsqueda guardada.' : 'Revisa tu conexión e inténtalo de nuevo.'), true);
      if (cached) { near.center = cached.center; near.items = cached.items; renderNear(); }
    }
  }
  $('#btnLocate').onclick = async function () {
    var b = this; b.disabled = true; setNearStatus('Obteniendo tu ubicación…');
    try {
      var c = await getPosition();
      await searchAt(c.latitude, c.longitude, 'tu ubicación');
    } catch (e) {
      var msg = e && e.code === 1 ? 'Permiso de ubicación denegado.' + GEO_HELP
        : e && e.code === 3 ? 'La ubicación tardó demasiado. Sal al exterior o activa el Wi-Fi para mejorar la precisión.'
        : e && e.code === -1 ? 'Este navegador no ofrece ubicación.' : 'No se pudo obtener la ubicación.' + GEO_HELP;
      setNearStatus(msg, true);
    } finally { b.disabled = false; }
  };
  $('#formPlace').onsubmit = async function (e) {
    e.preventDefault(); var q = $('#placeQuery').value.trim(); if (!q) return;
    $('#placeQuery').blur(); setNearStatus('Buscando “' + esc(q) + '”…');
    try {
      var res = await fetchTimeout('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=' + encodeURIComponent(q), {}, 15000);
      var j = await res.json();
      if (!j.length) return setNearStatus('No encontré “' + esc(q) + '”. Prueba con más detalle (calle, ciudad).', true);
      await searchAt(+j[0].lat, +j[0].lon, j[0].display_name.split(',').slice(0, 2).join(','));
    } catch (err) { setNearStatus('No se pudo buscar la dirección. Revisa tu conexión.', true); }
  };
  $('#accessFilter').onclick = function (e) {
    var c = e.target.closest('.chip'); if (!c) return;
    near.filter = c.dataset.f; $$('#accessFilter .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); renderNear();
  };
  $('#showMap').onchange = function () { LS.set('wfp.showMap', this.checked); renderNear(); };
  $('#showMap').checked = LS.get('wfp.showMap', true);
  function passFilter(it) {
    var f = near.filter; if (f === 'all') return true;
    if (f === 'free') return it.access === 'free' || it.access === 'likely';
    return it.access === f;
  }
  function renderNear() {
    var counts = { all: near.items.length, free: 0, customers: 0, paid: 0, unknown: 0 };
    near.items.forEach(function (i) { if (i.access === 'free' || i.access === 'likely') counts.free++; else counts[i.access]++; });
    $$('#accessFilter .chip').forEach(function (c) { var n = counts[c.dataset.f]; c.innerHTML = esc(c.textContent.replace(/\s*\d+$/, '')) + (near.items.length ? '<span class="n">' + n + '</span>' : ''); });
    var list = $('#nearList'), items = near.items.filter(passFilter);
    if (!near.items.length) { list.innerHTML = ''; renderMap([]); return; }
    list.innerHTML = items.length ? '' : '<div class="empty">Ningún lugar con este filtro.</div>';
    items.slice(0, 150).forEach(function (it) {
      var dir = 'https://maps.apple.com/?daddr=' + it.lat + ',' + it.lon + '&dirflg=w&q=' + encodeURIComponent(it.name);
      var el = h('<div class="item"><div class="item-h"><div><div class="item-t">' + esc(it.name) + '</div><div class="item-s">' + esc(it.typeLabel) + ' · ' + fmtDist(it.dist) +
        (it.addr ? ' · ' + esc(it.addr) : '') + '</div>' + (it.ssid ? '<div class="item-s">Red: <b>' + esc(it.ssid) + '</b></div>' : '') +
        (it.hours ? '<div class="item-s">Horario: ' + esc(it.hours) + '</div>' : '') + '</div><span class="badge b-' + it.access + '">' + ACCESS_LABEL[it.access] + '</span></div>' +
        '<div class="item-a"><a class="btn sm" href="' + dir + '" target="_blank" rel="noopener">Cómo llegar</a>' +
        (it.web ? '<a class="btn sm" href="' + esc(/^https?:/i.test(it.web) ? it.web : 'https://' + it.web) + '" target="_blank" rel="noopener">Web</a>' : '') +
        '<button class="btn sm" data-save>Guardar red</button></div></div>');
      el.querySelector('[data-save]').onclick = function () {
        if (!vault.key) { location.hash = 'boveda'; toast('Desbloquea o crea tu bóveda para guardar'); return; }
        editEntry({ ssid: it.ssid, place: it.name + (it.addr ? ', ' + it.addr : ''), kind: 'publica', security: it.access === 'free' ? 'nopass' : 'WPA', notes: 'Pide la contraseña al personal si la tiene.' });
      };
      el.querySelector('.item-t').onclick = function () { if (map) { map.setView([it.lat, it.lon], 18); $('#map').scrollIntoView({ behavior: 'smooth' }); } };
      list.appendChild(el);
    });
    renderMap(items);
  }
  async function renderMap(items) {
    var box = $('#map');
    if (!$('#showMap').checked || !near.center) { box.hidden = true; return; }
    box.hidden = false;
    try { loadCSS(LEAFLET_CSS); await loadScript(LEAFLET_JS); }
    catch (e) { box.hidden = true; return; }
    if (!map) {
      map = L.map(box, { zoomControl: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      mapLayer = L.layerGroup().addTo(map);
    }
    mapLayer.clearLayers();
    var c = near.center, colors = { free: '#22c55e', likely: '#19c3a6', customers: '#2f8cff', paid: '#f5a524', unknown: '#94a3b8' };
    L.circleMarker([c.lat, c.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2f8cff', fillOpacity: 1 }).addTo(mapLayer).bindPopup('Centro de búsqueda');
    var pts = [[c.lat, c.lon]];
    items.forEach(function (it) {
      pts.push([it.lat, it.lon]);
      L.circleMarker([it.lat, it.lon], { radius: 7, color: '#0b1220', weight: 1.5, fillColor: colors[it.access], fillOpacity: .95 })
        .addTo(mapLayer).bindPopup('<b>' + esc(it.name) + '</b><br>' + esc(it.typeLabel) + ' · ' + ACCESS_LABEL[it.access] + '<br>' + fmtDist(it.dist));
    });
    setTimeout(function () { map.invalidateSize(); if (pts.length > 1) map.fitBounds(pts, { padding: [24, 24], maxZoom: 17 }); else map.setView(pts[0], 16); }, 30);
  }
  (function restoreNear() {
    var c = LS.get('wfp.lastNearby', null);
    if (c && c.items) { near.center = c.center; near.items = c.items; setNearStatus('Última búsqueda (' + new Date(c.at).toLocaleString('es') + '). Toca “Buscar cerca de mí” para actualizar.'); renderNear(); }
  })();

  /* =========================================================
     2 y 3. Bóveda cifrada (AES-GCM 256 + PBKDF2-SHA256)
     ========================================================= */
  var VKEY = 'wfp.vault', ITER = 310000;
  var vault = { key: null, entries: [], salt: null, idleTimer: null };
  var b64 = {
    enc: function (buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); },
    dec: function (str) { var s = atob(str), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  };
  async function deriveKey(pw, salt, iter) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealEnvelope(key, salt, data) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    return { app: 'WiFiFinderPro', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct), updated: new Date().toISOString() };
  }
  async function openEnvelope(env, pw) {
    var salt = b64.dec(env.salt), key = await deriveKey(pw, salt, env.iter || ITER);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(env.iv) }, key, b64.dec(env.ct));
    return { key: key, salt: salt, data: JSON.parse(new TextDecoder().decode(pt)) };
  }
  async function persistVault() {
    var env = await sealEnvelope(vault.key, vault.salt, { entries: vault.entries });
    if (!LS.set(VKEY, env)) toast('No se pudo guardar (almacenamiento lleno o bloqueado)', 3500);
  }
  function vaultView() {
    var has = !!LS.get(VKEY, null);
    $('#vaultSetup').hidden = has || !!vault.key;
    $('#vaultLocked').hidden = !has || !!vault.key;
    $('#vaultOpen').hidden = !vault.key;
    if (vault.key) renderVault();
    fillVaultSelects();
  }
  function lockVault(silent) {
    vault.key = null; vault.entries = []; vault.salt = null; clearTimeout(vault.idleTimer);
    $('#vaultList').innerHTML = ''; $('#unlockPw').value = ''; vaultView(); if (!silent) toast('Bóveda bloqueada');
  }
  function touchIdle() { clearTimeout(vault.idleTimer); if (vault.key) vault.idleTimer = setTimeout(function () { lockVault(); }, 5 * 60 * 1000); }
  ['click', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, touchIdle, { passive: true }); });
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenAt = Date.now();
    else if (vault.key && hiddenAt && Date.now() - hiddenAt > 60 * 1000) lockVault();
  });

  $('#formSetup').onsubmit = async function (e) {
    e.preventDefault();
    var a = $('#setupPw').value, b = $('#setupPw2').value;
    if (a.length < 8) return toast('Usa al menos 8 caracteres');
    if (a !== b) return toast('Las contraseñas no coinciden');
    if (!(window.crypto && crypto.subtle)) return toast('Tu navegador no admite cifrado (abre la app por https)', 4000);
    vault.salt = crypto.getRandomValues(new Uint8Array(16));
    vault.key = await deriveKey(a, vault.salt, ITER); vault.entries = [];
    await persistVault();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (x) {}
    $('#setupPw').value = $('#setupPw2').value = '';
    toast('Bóveda creada'); vaultView(); touchIdle();
  };
  $('#formUnlock').onsubmit = async function (e) {
    e.preventDefault();
    var btn = this.querySelector('button'); btn.disabled = true; btn.textContent = 'Descifrando…';
    try {
      var r = await openEnvelope(LS.get(VKEY), $('#unlockPw').value);
      vault.key = r.key; vault.salt = r.salt; vault.entries = r.data.entries || [];
      $('#unlockErr').hidden = true; $('#unlockPw').value = ''; vaultView(); touchIdle();
    } catch (err) { $('#unlockErr').hidden = false; }
    finally { btn.disabled = false; btn.textContent = 'Desbloquear'; }
  };
  $('#btnLock').onclick = function () { lockVault(); };
  $('#vaultSearch').oninput = renderVault;

  var KIND = { propia: 'Propia', autorizada: 'Autorizada', publica: 'Pública' };
  function renderVault() {
    var q = ($('#vaultSearch').value || '').toLowerCase(), list = $('#vaultList');
    var items = vault.entries.filter(function (e) { return !q || (e.ssid + ' ' + (e.place || '') + ' ' + (e.notes || '')).toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return a.ssid.localeCompare(b.ssid); });
    list.innerHTML = '';
    if (!vault.entries.length) { list.innerHTML = '<div class="empty">Aún no hay redes. Toca <b>+ Añadir red</b> o lee el QR de tu router.<br>Si olvidaste una contraseña, mira la pestaña <a href="#recuperar">Recuperar</a>.</div>'; return; }
    if (!items.length) { list.innerHTML = '<div class="empty">Sin resultados.</div>'; return; }
    items.forEach(function (en) {
      var st = en.security === 'nopass' ? null : analyzePassword(en.password || '', en.ssid);
      var el = h('<div class="item"><div class="item-h"><div><div class="item-t">' + esc(en.ssid) + '</div><div class="item-s">' +
        (en.security === 'nopass' ? 'Sin contraseña' : en.security === 'WEP' ? 'WEP' : 'WPA/WPA2/WPA3') + (en.hidden ? ' · oculta' : '') + (en.place ? ' · ' + esc(en.place) : '') + '</div>' +
        (en.notes ? '<div class="item-s">' + esc(en.notes) + '</div>' : '') + '</div><span class="badge ' + (en.kind === 'propia' ? 'b-own' : en.kind === 'publica' ? 'b-free' : 'b-customers') + '">' + (KIND[en.kind] || 'Propia') + '</span></div>' +
        (en.security !== 'nopass' ? '<div class="pwline"><span data-pw>••••••••••</span><button class="btn sm" data-show>Ver</button></div>' +
          '<div class="meter mt"><div style="width:' + st.score + '%;background:' + st.color + '"></div></div><div class="small">Contraseña ' + st.label.toLowerCase() + '</div>' : '') +
        '<div class="item-a">' + (en.security !== 'nopass' ? '<button class="btn sm" data-copy>Copiar</button>' : '') +
        '<button class="btn sm" data-qr>QR</button><button class="btn sm" data-sec>Analizar</button><button class="btn sm" data-edit>Editar</button><button class="btn sm danger" data-del>Eliminar</button></div></div>');
      var shown = false, pwSpan = el.querySelector('[data-pw]');
      if (pwSpan) el.querySelector('[data-show]').onclick = function () { shown = !shown; pwSpan.textContent = shown ? (en.password || '(vacía)') : '••••••••••'; this.textContent = shown ? 'Ocultar' : 'Ver'; };
      var cp = el.querySelector('[data-copy]'); if (cp) cp.onclick = function () { copyText(en.password || '', 'Contraseña'); };
      el.querySelector('[data-qr]').onclick = function () { loadQRForm(en); location.hash = 'qr'; };
      el.querySelector('[data-sec]').onclick = function () { loadSecForm(en); location.hash = 'seguridad'; };
      el.querySelector('[data-edit]').onclick = function () { editEntry(en); };
      el.querySelector('[data-del]').onclick = async function () {
        if (!(await confirmBox('Eliminar red', '¿Eliminar <b>' + esc(en.ssid) + '</b> de la bóveda?', 'Eliminar', true))) return;
        vault.entries = vault.entries.filter(function (x) { return x !== en; }); await persistVault(); renderVault(); fillVaultSelects();
      };
      list.appendChild(el);
    });
  }
  function editEntry(en) {
    var isNew = !en || !en.id; en = en || {};
    var f = h('<form autocomplete="off">' +
      '<label>Nombre de la red (SSID)<input name="ssid" required autocapitalize="off" autocorrect="off" spellcheck="false"></label>' +
      '<label>Contraseña<div class="pwwrap"><input name="password" id="edPw" type="password" autocapitalize="off" autocorrect="off" spellcheck="false"><button type="button" class="eye" data-eye="edPw" aria-label="Mostrar"></button></div></label>' +
      '<label>Seguridad<select name="security"><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">Sin contraseña</option></select></label>' +
      '<label>Tipo<select name="kind"><option value="propia">Propia (mi casa, mi negocio)</option><option value="autorizada">Autorizada (me la compartieron)</option><option value="publica">Pública de un local</option></select></label>' +
      '<label>Lugar<input name="place" placeholder="Casa, oficina, Café Central…"></label>' +
      '<label>Notas<input name="notes" placeholder="Opcional"></label>' +
      '<label class="lbl-inline"><input type="checkbox" name="hidden"> Red oculta</label></form>');
    ['ssid', 'password', 'place', 'notes'].forEach(function (k) { f.elements[k].value = en[k] || ''; });
    f.elements.security.value = en.security || 'WPA'; f.elements.kind.value = en.kind || 'propia'; f.elements.hidden.checked = !!en.hidden;
    f.onsubmit = function (e) { e.preventDefault(); };
    modal({ title: isNew ? 'Añadir red' : 'Editar red', body: f, actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', cls: 'primary', value: function () {
      var d = { ssid: f.elements.ssid.value.trim(), password: f.elements.password.value, security: f.elements.security.value, kind: f.elements.kind.value,
        place: f.elements.place.value.trim(), notes: f.elements.notes.value.trim(), hidden: f.elements.hidden.checked };
      if (!d.ssid) { toast('Escribe el nombre de la red'); return false; }
      if (d.security === 'WPA' && d.password && (d.password.length < 8 || d.password.length > 63) && !/^[0-9a-f]{64}$/i.test(d.password)) toast('Aviso: las claves WPA tienen entre 8 y 63 caracteres', 3500);
      return d;
    } }] }).then(async function (d) {
      if (!d) return;
      if (isNew) { d.id = crypto.getRandomValues(new Uint32Array(2)).join('-'); d.created = Date.now(); vault.entries.push(d); }
      else Object.assign(en, d, { updated: Date.now() });
      await persistVault(); renderVault(); fillVaultSelects(); toast('Guardado en la bóveda');
    });
  }
  $('#btnAddNet').onclick = function () { editEntry(null); };
  $('#btnScanToVault').onclick = function () { scanTarget = 'vault'; $('#fileQR').click(); };

  // Copias de seguridad
  $('#btnExport').onclick = async function () {
    var env = await sealEnvelope(vault.key, vault.salt, { entries: vault.entries });
    var blob = new Blob([JSON.stringify(env, null, 1)], { type: 'application/json' });
    var r = await shareOrDownload(blob, 'wifi-finder-boveda-' + new Date().toISOString().slice(0, 10) + '.json', 'Copia cifrada de WiFi Finder Pro');
    if (r === 'shared') toast('Copia cifrada lista'); else if (r === 'downloaded') toast('Copia descargada (revisa Descargas en Archivos)', 3500);
  };
  var importMode = 'merge';
  $('#btnImport').onclick = function () { importMode = 'merge'; $('#fileImport').click(); };
  $('#btnImportFirst').onclick = function () { importMode = 'restore'; $('#fileImport').click(); };
  $('#fileImport').onchange = async function () {
    var file = this.files[0]; this.value = ''; if (!file) return;
    var env; try { env = JSON.parse(await file.text()); if (!env.ct || !env.salt) throw 0; } catch (e) { return toast('Ese archivo no es una copia de WiFi Finder Pro', 3500); }
    var pw = await askPassword('Importar copia', 'Escribe la contraseña maestra con la que se creó esta copia.'); if (pw == null) return;
    var r; try { r = await openEnvelope(env, pw); } catch (e) { return toast('Contraseña incorrecta para esa copia', 3500); }
    var incoming = r.data.entries || [];
    if (importMode === 'restore' || !vault.key) {
      LS.set(VKEY, env); vault.key = r.key; vault.salt = r.salt; vault.entries = incoming;
      toast('Bóveda restaurada (' + incoming.length + ' redes). Tu contraseña maestra es la de la copia.', 4000);
    } else {
      var n = 0;
      incoming.forEach(function (x) { if (!vault.entries.some(function (y) { return y.ssid === x.ssid && y.password === x.password; })) { vault.entries.push(x); n++; } });
      await persistVault(); toast(n + ' redes nuevas importadas');
    }
    vaultView(); touchIdle();
  };
  $('#btnChangePw').onclick = async function () {
    var f = h('<form><input type="password" name="a" placeholder="Nueva contraseña maestra (mín. 8)" autocomplete="new-password"><input type="password" name="b" placeholder="Repite la nueva contraseña" autocomplete="new-password"></form>');
    f.onsubmit = function (e) { e.preventDefault(); };
    var pw = await modal({ title: 'Cambiar contraseña maestra', body: f, actions: [{ label: 'Cancelar', value: null }, { label: 'Cambiar', cls: 'primary', value: function () {
      if (f.elements.a.value.length < 8) { toast('Mínimo 8 caracteres'); return false; }
      if (f.elements.a.value !== f.elements.b.value) { toast('No coinciden'); return false; }
      return f.elements.a.value;
    } }] });
    if (!pw) return;
    vault.salt = crypto.getRandomValues(new Uint8Array(16)); vault.key = await deriveKey(pw, vault.salt, ITER);
    await persistVault(); toast('Contraseña maestra cambiada. Exporta una copia nueva.', 3500);
  };
  $('#btnWipe').onclick = async function () {
    if (!(await confirmBox('Borrar bóveda', 'Se eliminarán todas las redes guardadas en este dispositivo. Esta acción no se puede deshacer.', 'Borrar todo', true))) return;
    LS.del(VKEY); lockVault(true); toast('Bóveda borrada');
  };

  /* =========================================================
     6. Códigos QR para compartir Wi-Fi
     ========================================================= */
  function wifiEsc(s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); }
  function wifiString(ssid, pw, sec, hidden) {
    var s = 'WIFI:T:' + (sec === 'nopass' ? 'nopass' : sec) + ';S:' + wifiEsc(ssid) + ';';
    if (sec !== 'nopass') s += 'P:' + wifiEsc(pw) + ';';
    if (hidden) s += 'H:true;';
    return s + ';';
  }
  function parseWifi(str) {
    if (!/^WIFI:/i.test(str)) return null;
    var body = str.slice(5), out = {}, key = '', val = '', inKey = true, i = 0;
    for (; i < body.length; i++) {
      var c = body[i];
      if (c === '\\' && i + 1 < body.length) { (inKey ? (key += body[++i]) : (val += body[++i])); continue; }
      if (inKey && c === ':') { inKey = false; continue; }
      if (c === ';') { if (key) out[key.toUpperCase()] = val; key = ''; val = ''; inKey = true; continue; }
      if (inKey) key += c; else val += c;
    }
    if (key) out[key.toUpperCase()] = val;
    var t = (out.T || 'nopass').toUpperCase();
    return { ssid: out.S || '', password: out.P || '', security: t === 'WEP' ? 'WEP' : (t === 'NOPASS' || t === '' ? 'nopass' : 'WPA'), hidden: /^true$/i.test(out.H || '') };
  }
  var currentQR = null;
  function renderQR() {
    var ssid = $('#qrSsid').value, pw = $('#qrPw').value, sec = $('#qrSec').value, hid = $('#qrHidden').checked;
    $('#qrPw').disabled = sec === 'nopass';
    if (!ssid) { $('#qrCard').hidden = $('#qrActions').hidden = true; currentQR = null; return; }
    var text = wifiString(ssid, pw, sec, hid);
    try { var q = QR.encode(text, 'M'); } catch (e) { toast(e.message); return; }
    currentQR = { text: text, qr: q, ssid: ssid, pw: pw, sec: sec };
    $('#qrBox').innerHTML = QR.toSVG(q, { border: 2 });
    $('#qrCardSsid').textContent = ssid;
    $('#qrCardPw').textContent = pw;
    $('#qrCardPwRow').hidden = sec === 'nopass' || !$('#qrPrintPw').checked || !pw;
    $('#qrCard').hidden = $('#qrActions').hidden = false;
  }
  ['qrSsid', 'qrPw', 'qrSec', 'qrHidden', 'qrPrintPw'].forEach(function (id) { $('#' + id).addEventListener('input', renderQR); $('#' + id).addEventListener('change', renderQR); });
  $('#formQR').onsubmit = function (e) { e.preventDefault(); };
  function loadQRForm(en) {
    $('#qrSsid').value = en.ssid || ''; $('#qrPw').value = en.password || ''; $('#qrSec').value = en.security || 'WPA'; $('#qrHidden').checked = !!en.hidden; renderQR();
  }
  function cardCanvas() {
    var c = currentQR, scale = 12, qc = QR.toCanvas(c.qr, scale, 3), W = qc.width + 80, showPw = c.sec !== 'nopass' && $('#qrPrintPw').checked && c.pw;
    var H = qc.height + (showPw ? 210 : 160), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0f172a'; g.textAlign = 'center'; g.font = '800 44px -apple-system,Helvetica,Arial'; g.fillText('Wi-Fi', W / 2, 64);
    g.drawImage(qc, 40, 80);
    var y = qc.height + 120; g.font = '600 30px -apple-system,Helvetica,Arial'; g.fillText(fit(g, c.ssid, W - 60), W / 2, y);
    if (showPw) { g.font = '28px Menlo,monospace'; g.fillStyle = '#334155'; g.fillText(fit(g, c.pw, W - 60), W / 2, y + 46); }
    g.font = '22px -apple-system,Helvetica,Arial'; g.fillStyle = '#64748b'; g.fillText('Escanea con la cámara para conectarte', W / 2, H - 24);
    return cv;
    function fit(g2, s, max) { while (g2.measureText(s).width > max && s.length > 3) s = s.slice(0, -2) + '…'; return s; }
  }
  $('#btnQrShare').onclick = async function () {
    if (!currentQR) return;
    var cv = cardCanvas();
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
    var file; try { file = new File([blob], 'wifi-' + currentQR.ssid.replace(/[^\w-]+/g, '_') + '.png', { type: 'image/png' }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Wi-Fi ' + currentQR.ssid }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    modal({ title: 'Guardar imagen', body: '<p class="small">Mantén presionada la imagen y elige <b>Guardar en Fotos</b>.</p><img alt="QR Wi-Fi" style="width:100%;border-radius:12px" src="' + cv.toDataURL('image/png') + '">' });
  };
  $('#btnQrFull').onclick = function () {
    if (!currentQR) return;
    modal({ full: true, body: '<div style="text-align:center"><div style="font:800 28px -apple-system">' + esc(currentQR.ssid) + '</div>' +
      '<div style="max-width:min(92vw,70vh);margin:16px auto">' + QR.toSVG(currentQR.qr, { border: 2 }).replace('<svg ', '<svg style="width:100%;height:auto" ') + '</div>' +
      '<div style="color:#475569">Escanea con la cámara para conectarte</div></div>', actions: [{ label: 'Cerrar', value: null }] });
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); } catch (e) {}
  };
  $('#btnQrPrint').onclick = function () { try { window.print(); } catch (e) { toast('Usa Compartir → Imprimir'); } };
  $('#btnQrCopy').onclick = function () { if (currentQR) copyText(currentQR.text, 'Texto del QR'); };

  // Lector de QR desde foto
  var scanTarget = 'qr';
  $('#btnScanPhoto').onclick = function () { scanTarget = 'qr'; $('#fileQR').click(); };
  $('#fileQR').onchange = async function () {
    var file = this.files[0]; this.value = ''; if (!file) return;
    var out = $('#scanResult');
    if (scanTarget === 'qr') out.innerHTML = '<p class="small">Leyendo código…</p>';
    try {
      var text = await decodeQRFromFile(file);
      if (!text) throw new Error('No encontré un código QR en la foto. Acércate más y evita reflejos.');
      var w = parseWifi(text);
      if (!w) { out.innerHTML = '<div class="item mt"><div class="item-t">El QR no es de Wi-Fi</div><div class="item-s" style="word-break:break-all">' + esc(text) + '</div></div>'; if (scanTarget === 'vault') { location.hash = 'qr'; } return; }
      if (scanTarget === 'vault' && vault.key) { editEntry({ ssid: w.ssid, password: w.password, security: w.security, hidden: w.hidden, kind: 'propia', notes: 'Importada desde QR' }); return; }
      out.innerHTML = '';
      var el = h('<div class="item mt"><div class="item-t">' + esc(w.ssid) + '</div><div class="item-s">' + (w.security === 'nopass' ? 'Sin contraseña' : w.security) + (w.hidden ? ' · oculta' : '') + '</div>' +
        (w.security !== 'nopass' ? '<div class="pwline"><span>' + esc(w.password) + '</span></div>' : '') +
        '<div class="item-a">' + (w.security !== 'nopass' ? '<button class="btn sm" data-c>Copiar contraseña</button>' : '') + '<button class="btn sm" data-s>Guardar en bóveda</button><button class="btn sm" data-q>Crear QR</button></div></div>');
      var c = el.querySelector('[data-c]'); if (c) c.onclick = function () { copyText(w.password, 'Contraseña'); };
      el.querySelector('[data-s]').onclick = function () {
        if (!vault.key) { location.hash = 'boveda'; toast('Desbloquea o crea tu bóveda primero'); return; }
        editEntry({ ssid: w.ssid, password: w.password, security: w.security, hidden: w.hidden, kind: 'propia', notes: 'Importada desde QR' });
      };
      el.querySelector('[data-q]').onclick = function () { loadQRForm(w); window.scrollTo({ top: 0, behavior: 'smooth' }); };
      out.appendChild(el);
    } catch (e) {
      if (scanTarget === 'vault') toast(e.message, 4000);
      else out.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  };
  async function decodeQRFromFile(file) {
    var bmp = await loadImage(file);
    var maxSide = 1400, s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    var g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, cv.width, cv.height);
    if ('BarcodeDetector' in window) {
      try { var det = new BarcodeDetector({ formats: ['qr_code'] }); var r = await det.detect(cv); if (r.length) return r[0].rawValue; } catch (e) {}
    }
    try { await loadScript(JSQR_JS); } catch (e) { throw new Error('Para leer fotos se necesita conexión la primera vez (se descarga el lector).'); }
    var data = g.getImageData(0, 0, cv.width, cv.height);
    var res = window.jsQR(data.data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
    if (res) return res.data;
    if (s === 1 && Math.max(cv.width, cv.height) > 800) return null;
    // segundo intento a menor escala
    var c2 = document.createElement('canvas'), k = 800 / Math.max(bmp.width, bmp.height); c2.width = Math.round(bmp.width * k); c2.height = Math.round(bmp.height * k);
    var g2 = c2.getContext('2d'); g2.drawImage(bmp, 0, 0, c2.width, c2.height);
    var d2 = g2.getImageData(0, 0, c2.width, c2.height), r2 = window.jsQR(d2.data, c2.width, c2.height, { inversionAttempts: 'attemptBoth' });
    return r2 ? r2.data : null;
  }
  function loadImage(file) {
    if (window.createImageBitmap) return createImageBitmap(file).catch(function () { return viaImg(); });
    return viaImg();
    function viaImg() {
      return new Promise(function (res, rej) { var url = URL.createObjectURL(file), img = new Image(); img.onload = function () { res(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }; img.onerror = function () { rej(new Error('No se pudo abrir la imagen')); }; img.src = url; });
    }
  }

  /* =========================================================
     5. Análisis de seguridad
     ========================================================= */
  var COMMON = ['12345678', '123456789', '1234567890', 'password', 'password1', 'contraseña', 'contrasena', 'qwertyui', 'qwerty123', '11111111', '00000000', '88888888', '12341234',
    'abcd1234', 'iloveyou', 'internet', 'wifi1234', 'wifiwifi', 'admin123', 'administrator', 'welcome1', 'bienvenido', 'sunshine', 'princess', 'football', 'baseball', 'superman',
    '987654321', '87654321', '123123123', '1q2w3e4r', '1qaz2wsx', 'zxcvbnm1', 'asdfghjk', 'passw0rd', 'p@ssw0rd', 'teamo123', 'mexico123', 'familia1', 'micasa123', 'changeme',
    'letmein1', 'trustno1', 'starwars', 'dragon12', 'monkey12', 'master12', 'q1w2e3r4', 'aaaaaaaa', 'abc12345', '12345qwert', 'qwertyuiop'];
  var SEQS = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  function analyzePassword(pw, ssid) {
    var issues = [], len = [...pw].length, pool = 0, lower = pw.toLowerCase();
    if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10; if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
    var bits = len * Math.log2(Math.max(pool, 1));
    if (!pw) return { score: 0, bits: 0, label: 'Vacía', color: 'var(--bad)', issues: ['Sin contraseña'] };
    if (len < 8) issues.push('Menos de 8 caracteres (WPA exige 8 a 63)');
    if (COMMON.indexOf(lower) >= 0) { bits = Math.min(bits, 8); issues.push('Está en las listas de contraseñas más usadas'); }
    if (/^\d+$/.test(pw)) { bits *= 0.75; issues.push('Solo números'); }
    if (/(.)\1{2,}/.test(pw)) { bits *= 0.8; issues.push('Caracteres repetidos (aaa, 111)'); }
    var seqHit = SEQS.some(function (s) { for (var i = 0; i + 4 <= s.length; i++) { var sub = s.substr(i, 4); if (lower.indexOf(sub) >= 0 || lower.indexOf(sub.split('').reverse().join('')) >= 0) return true; } return false; });
    if (seqHit) { bits *= 0.75; issues.push('Contiene secuencias (1234, abcd, qwer)'); }
    if (/(19|20)\d{2}/.test(pw)) { bits *= 0.9; issues.push('Contiene un año (fácil de adivinar)'); }
    if (ssid && ssid.length >= 3 && lower.indexOf(ssid.toLowerCase().replace(/[\s_-]?(2\.?4g?|5g?)$/i, '')) >= 0) { bits *= 0.6; issues.push('Contiene el nombre de la red'); }
    if (/^[a-z]+\d{1,4}$/i.test(pw) && len < 14) { bits *= 0.8; issues.push('Patrón palabra + números'); }
    var score = Math.max(0, Math.min(100, Math.round(bits / 90 * 100)));
    var label = bits < 28 ? 'Muy débil' : bits < 40 ? 'Débil' : bits < 60 ? 'Aceptable' : bits < 80 ? 'Fuerte' : 'Muy fuerte';
    var color = bits < 28 ? 'var(--bad)' : bits < 40 ? '#f97316' : bits < 60 ? 'var(--warn)' : 'var(--ok)';
    return { score: score, bits: Math.round(bits), label: label, color: color, issues: issues };
  }
  var DEFAULT_SSID = /^(NETGEAR\d*|TP-?LINK[_-]|Linksys|D-?Link|dlink|ARRIS-|INFINITUM|Totalplay|IZZI-|MEGACABLE|HUAWEI-|Tenda_|xfinitywifi|ATT[\w]{3,4}$|SpectrumSetup|MySpectrumWiFi|Verizon_|MOVISTAR_|MiFibra-|Livebox-|Vodafone-|Claro_|CLARO|FiberHome|ZTE|Ubee|Fibertel|TELMEX|NETLIFE|ASUS|belkin|Sagemcom|Technicolor|HOME-[0-9A-F]{4}|WLAN_|Orange-|BTHub|SKY[0-9A-Z]{5}|VM[0-9]{6}|DIRECT-)/i;
  var Q_HOME = [
    { id: 'wps', t: '¿El WPS está desactivado?', h: 'En el panel del router: Wi-Fi → WPS. El PIN WPS se puede forzar en horas.', w: 12, good: 'si' },
    { id: 'admin', t: '¿Cambiaste la contraseña de administrador del router?', h: 'La clave para entrar a 192.168.x.x, no la del Wi-Fi.', w: 14, good: 'si' },
    { id: 'fw', t: '¿El firmware del router se actualizó en el último año?', h: 'Panel → Sistema / Administración → Actualizar firmware. Muchos lo hacen solos.', w: 12, good: 'si' },
    { id: 'remote', t: '¿La administración remota (desde Internet) está desactivada?', h: 'Panel → Administración → Acceso remoto / WAN.', w: 10, good: 'si' },
    { id: 'upnp', t: '¿UPnP está desactivado (o no lo necesitas)?', h: 'Lo usan consolas y algunas apps; abre puertos automáticamente.', w: 5, good: 'si' },
    { id: 'guest', t: '¿Usas una red de invitados para visitas o dispositivos IoT?', h: 'Separa cámaras, focos y TV de tus equipos personales.', w: 6, good: 'si' },
    { id: 'devices', t: '¿Revisaste que no haya dispositivos desconocidos conectados?', h: 'Panel → Dispositivos / DHCP / Clientes conectados.', w: 6, good: 'si' },
    { id: 'shared', t: '¿Compartiste la clave con personas que ya no deberían tenerla?', h: 'Exinquilinos, ex-empleados, vecinos… Si sí, cámbiala.', w: 8, good: 'no' },
    { id: 'privaddr', t: '¿Tu iPhone usa “Dirección Wi-Fi privada”?', h: 'Ajustes → Wi-Fi → ⓘ → Dirección Wi-Fi privada: Fija o Rotativa.', w: 3, good: 'si' }
  ];
  var Q_PUBLIC = [
    { id: 'verify', t: 'Confirmé el nombre exacto de la red con el personal', h: 'Evita “gemelos malvados”: redes falsas con nombres parecidos.', w: 18 },
    { id: 'https', t: 'Solo uso sitios y apps con HTTPS (candado)', h: 'Casi todas las apps modernas ya cifran; evita formularios sin candado.', w: 14 },
    { id: 'relay', t: 'Uso una VPN de confianza o iCloud Private Relay', h: 'Ajustes → [tu nombre] → iCloud → Relay privado (iCloud+).', w: 18 },
    { id: 'autojoin', t: 'Desactivé “Conectarse automáticamente” en esta red', h: 'Ajustes → Wi-Fi → ⓘ → Conectarse automáticamente.', w: 10 },
    { id: 'priv', t: 'Tengo activada la “Dirección Wi-Fi privada”', h: 'Ajustes → Wi-Fi → ⓘ → Dirección Wi-Fi privada: Rotativa.', w: 10 },
    { id: 'airdrop', t: 'AirDrop está en “Solo contactos” o desactivado', h: 'Ajustes → General → AirDrop.', w: 8 },
    { id: 'nobank', t: 'Evito banca y compras si no tengo VPN', h: 'O usa tus datos móviles para eso.', w: 10 },
    { id: 'forget', t: 'Olvidaré la red al terminar', h: 'Ajustes → Wi-Fi → ⓘ → Omitir esta red.', w: 6 },
    { id: 'update', t: 'Mi iPhone tiene la última versión de iOS', h: 'Ajustes → General → Actualización de software.', w: 6 }
  ];
  var secMode = 'home', answers = {};
  function renderQuestions() {
    var box = $('#secQuestions'); box.innerHTML = '';
    var homeOnly = $$('#formSec > label, #formSec > .hint, #pwMeter, #pwMeterText, #secVaultWrap');
    homeOnly.forEach(function (n) { n.style.display = secMode === 'home' ? '' : 'none'; });
    if (secMode === 'home') {
      box.appendChild(h('<h2 class="mt">Configuración del router</h2>'));
      Q_HOME.forEach(function (q) {
        var el = h('<div class="q"><div class="q-t">' + esc(q.t) + '</div><div class="q-o"><button type="button" data-v="si">Sí</button><button type="button" data-v="no">No</button><button type="button" data-v="ns">No sé</button></div><div class="q-h">' + esc(q.h) + '</div></div>');
        var cur = answers[q.id] || 'ns';
        $$('button', el).forEach(function (b) { b.classList.toggle('on', b.dataset.v === cur); b.onclick = function () { answers[q.id] = b.dataset.v; $$('button', el).forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
        box.appendChild(el);
      });
    } else {
      box.appendChild(h('<h2>Antes de usar una Wi-Fi pública</h2>'));
      Q_PUBLIC.forEach(function (q) {
        var el = h('<label class="check"><input type="checkbox" data-id="' + q.id + '"><span>' + esc(q.t) + '<small>' + esc(q.h) + '</small></span></label>');
        el.querySelector('input').checked = !!answers['p_' + q.id];
        el.querySelector('input').onchange = function () { answers['p_' + q.id] = this.checked; };
        box.appendChild(el);
      });
    }
  }
  $('#secMode').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return; secMode = b.dataset.m;
    $$('#secMode button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('#secResult').innerHTML = ''; renderQuestions();
  };
  function updateMeter() {
    var pw = $('#secPw').value, m = $('#pwMeter');
    if (!pw) { m.hidden = true; $('#pwMeterText').textContent = ''; return; }
    var a = analyzePassword(pw, $('#secSsid').value); m.hidden = false;
    m.firstElementChild.style.width = Math.max(4, a.score) + '%'; m.firstElementChild.style.background = a.color;
    $('#pwMeterText').textContent = a.label + ' · ~' + a.bits + ' bits de entropía' + (a.issues.length ? ' · ' + a.issues[0] : '');
  }
  $('#secPw').addEventListener('input', updateMeter); $('#secSsid').addEventListener('input', updateMeter);
  function loadSecForm(en) {
    secMode = 'home'; $$('#secMode button').forEach(function (x) { x.classList.toggle('on', x.dataset.m === 'home'); }); renderQuestions();
    $('#secSsid').value = en.ssid || ''; $('#secPw').value = en.password || '';
    $('#secType').value = en.security === 'nopass' ? 'open' : en.security === 'WEP' ? 'wep' : 'unknown';
    $('#secResult').innerHTML = ''; updateMeter();
  }
  var TYPE_SCORE = {
    wpa3: [100, 'ok', 'WPA3 Personal: el estándar más seguro para hogares.'],
    wpa23: [90, 'ok', 'Modo mixto WPA2/WPA3: muy bueno. Cuando todos tus equipos lo admitan, pasa a solo WPA3.'],
    wpa2: [78, 'ok', 'WPA2-AES es seguro con una contraseña fuerte. Si tu router ofrece WPA3, actívalo.'],
    wpa2tkip: [40, 'warn', 'TKIP es obsoleto y lento. Cambia a “WPA2-AES” o “WPA2/WPA3”. iOS lo marca como “Seguridad débil”.'],
    wpa: [20, 'bad', 'WPA (TKIP) está roto en la práctica. Cambia a WPA2-AES o WPA3 cuanto antes.'],
    wep: [3, 'bad', 'WEP se descifra en minutos. Cambia urgentemente a WPA2-AES o WPA3; si el router no lo permite, reemplázalo.'],
    open: [0, 'bad', 'Red abierta: cualquiera puede conectarse y ver tráfico sin cifrar. Activa WPA2/WPA3 con contraseña.'],
    ent: [95, 'ok', 'Enterprise (802.1X): cada usuario tiene sus credenciales. Excelente si está bien configurado.'],
    unknown: [50, 'info', 'No conocemos el tipo de seguridad. Revísalo en el panel del router (Wi-Fi → Seguridad).']
  };
  $('#formSec').onsubmit = function (e) {
    e.preventDefault();
    var res = secMode === 'home' ? analyzeHome() : analyzePublic();
    var col = res.score >= 80 ? 'var(--ok)' : res.score >= 60 ? 'var(--warn)' : res.score >= 40 ? '#f97316' : 'var(--bad)';
    var grade = res.score >= 90 ? 'A' : res.score >= 80 ? 'B' : res.score >= 65 ? 'C' : res.score >= 45 ? 'D' : 'F';
    var order = { bad: 0, warn: 1, info: 2, ok: 3 };
    res.findings.sort(function (a, b) { return order[a.lvl] - order[b.lvl]; });
    var el = h('<div class="card"><div class="score"><div class="ring" style="--p:' + res.score + ';--c:' + col + '"><div><b>' + grade + '</b><small>' + res.score + '/100</small></div></div>' +
      '<div><h2 style="margin:0">' + esc(res.title) + '</h2><div class="small">' + esc(res.summary) + '</div></div></div><div class="mt">' +
      res.findings.map(function (f) { return '<div class="finding"><span class="dot d-' + f.lvl + '"></span><div><b>' + esc(f.t) + '</b>' + (f.d ? '<p>' + esc(f.d) + '</p>' : '') + '</div></div>'; }).join('') +
      '</div><p class="small mt">Análisis orientativo basado en tus respuestas; no escanea la red. Nunca se envía nada fuera de tu iPhone.</p></div>');
    var r = $('#secResult'); r.innerHTML = ''; r.appendChild(el); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  function analyzeHome() {
    var f = [], ssid = $('#secSsid').value.trim(), type = $('#secType').value, pw = $('#secPw').value;
    var ts = TYPE_SCORE[type], typeScore = ts[0];
    f.push({ lvl: ts[1], t: 'Cifrado: ' + $('#secType').selectedOptions[0].textContent, d: ts[2] });
    var pwScore = 60;
    if (type === 'open') pwScore = 0;
    else if (type === 'ent') pwScore = 90;
    else if (pw) {
      var a = analyzePassword(pw, ssid); pwScore = a.score;
      f.push({ lvl: a.bits >= 60 ? 'ok' : a.bits >= 40 ? 'warn' : 'bad', t: 'Contraseña ' + a.label.toLowerCase() + ' (~' + a.bits + ' bits)',
        d: a.issues.length ? a.issues.join(' · ') + '. Usa 14+ caracteres o una frase de 4–5 palabras al azar.' : 'Buena longitud y variedad.' });
    } else f.push({ lvl: 'info', t: 'Contraseña no evaluada', d: 'Escríbela arriba para analizar su fortaleza (no sale de tu iPhone).' });
    if (ssid) {
      if (DEFAULT_SSID.test(ssid)) f.push({ lvl: 'warn', t: 'Nombre de red de fábrica', d: 'Revela la marca/modelo del router y sugiere que la configuración no se ha cambiado. Ponle un nombre propio sin datos personales.' });
      else if (/\b(depto|apto|casa|familia|calle|av\.?|[0-9]{3,})\b/i.test(ssid) || /[A-ZÁÉÍÓÚ][a-záéíóú]+ ?[A-ZÁÉÍÓÚ][a-záéíóú]+/.test(ssid)) f.push({ lvl: 'info', t: 'Revisa que el nombre no revele datos personales', d: 'Evita apellidos, número de departamento o dirección.' });
      else f.push({ lvl: 'ok', t: 'Nombre de red personalizado', d: '' });
    }
    var qScore = 0, qMax = 0;
    Q_HOME.forEach(function (q) {
      var v = answers[q.id] || 'ns'; qMax += q.w;
      var good = v === q.good, unknown = v === 'ns';
      qScore += good ? q.w : unknown ? q.w * 0.4 : 0;
      if (!good) f.push({ lvl: unknown ? 'info' : (q.w >= 10 ? 'bad' : 'warn'), t: unknown ? 'Por revisar: ' + q.t.replace(/[¿?]/g, '') : fixText(q.id), d: q.h });
      else f.push({ lvl: 'ok', t: okText(q.id), d: '' });
    });
    var score = Math.round(typeScore * 0.45 + pwScore * 0.25 + (qScore / qMax) * 100 * 0.30);
    if (type === 'open' || type === 'wep') score = Math.min(score, 20);
    if (type === 'wpa') score = Math.min(score, 40);
    return { score: score, title: score >= 80 ? 'Red bien protegida' : score >= 60 ? 'Protección aceptable' : score >= 40 ? 'Necesita mejoras' : 'Riesgo alto', summary: ssid ? 'Red “' + ssid + '”' : 'Tu red doméstica', findings: f };
  }
  function fixText(id) {
    return { wps: 'Desactiva WPS', admin: 'Cambia la contraseña de administrador del router', fw: 'Actualiza el firmware del router', remote: 'Desactiva la administración remota',
      upnp: 'Considera desactivar UPnP', guest: 'Crea una red de invitados', devices: 'Revisa los dispositivos conectados', shared: 'Cambia la clave del Wi-Fi: hay personas que no deberían tenerla',
      privaddr: 'Activa la Dirección Wi-Fi privada en tu iPhone' }[id];
  }
  function okText(id) {
    return { wps: 'WPS desactivado', admin: 'Contraseña de administrador personalizada', fw: 'Firmware al día', remote: 'Administración remota desactivada', upnp: 'UPnP bajo control',
      guest: 'Red de invitados en uso', devices: 'Dispositivos revisados', shared: 'La clave solo la tienen personas autorizadas', privaddr: 'Dirección Wi-Fi privada activa' }[id];
  }
  function analyzePublic() {
    var f = [], s = 0, max = 0;
    Q_PUBLIC.forEach(function (q) {
      max += q.w; var ok = !!answers['p_' + q.id]; if (ok) s += q.w;
      f.push(ok ? { lvl: 'ok', t: q.t, d: '' } : { lvl: q.w >= 14 ? 'bad' : 'warn', t: 'Pendiente: ' + q.t.charAt(0).toLowerCase() + q.t.slice(1), d: q.h });
    });
    var score = Math.round(s / max * 100);
    return { score: score, title: score >= 80 ? 'Listo para usarla' : score >= 50 ? 'Úsala con precaución' : 'Mejor usa tus datos móviles', summary: 'Wi-Fi pública', findings: f };
  }

  /* ---------------- Selectores “cargar de la bóveda” ---------------- */
  function fillVaultSelects() {
    [['#qrFromVault', '#qrFromVaultWrap'], ['#secFromVault', '#secVaultWrap']].forEach(function (p) {
      var sel = $(p[0]), wrap = $(p[1]);
      wrap.hidden = !vault.key || !vault.entries.length;
      if (wrap.hidden) return;
      if (p[0] === '#secFromVault' && secMode !== 'home') wrap.style.display = 'none';
      sel.innerHTML = '<option value="">Cargar una red de la bóveda…</option>' + vault.entries.map(function (e, i) { return '<option value="' + i + '">' + esc(e.ssid) + '</option>'; }).join('');
    });
  }
  $('#qrFromVault').onchange = function () { var en = vault.entries[+this.value]; if (en) loadQRForm(en); this.value = ''; };
  $('#secFromVault').onchange = function () { var en = vault.entries[+this.value]; if (en) loadSecForm(en); this.value = ''; };

  /* ---------------- Router (recuperar) ---------------- */
  function setRouter(ip) { ip = (ip || '').trim().replace(/^https?:\/\//, ''); $('#routerLink').href = 'http://' + (ip || '192.168.1.1'); }
  $('#routerIp').addEventListener('input', function () { setRouter(this.value); });
  $$('[data-ip]').forEach(function (c) { c.onclick = function () { $('#routerIp').value = c.dataset.ip; setRouter(c.dataset.ip); }; });

  /* ---------------- Inicio ---------------- */
  renderQuestions(); vaultView(); route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  // Exponer para pruebas
  window.__wfp = { analyzePassword: analyzePassword, wifiString: wifiString, parseWifi: parseWifi, classify: classify, version: VERSION };
})();
