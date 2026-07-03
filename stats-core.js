/* stats-core.js — fonctions PURES partagées (page publique Meytopia).
   Sans DOM, sans dépendances. Lit le format v5 (intervalles) publié par le mod serveur. */
(function (root) {
  'use strict';
  var PARIS = 'Europe/Paris';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPlayTime(min) {
    min = Math.max(0, Math.round(min || 0));
    var h = Math.floor(min / 60);
    return h ? (h + ' h ' + String(min % 60).padStart(2, '0')) : (min + ' min');
  }
  function fmtDist(m) {
    m = Math.round(m || 0);
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';
  }
  // Nombre en français : séparateur de milliers « 12 345 » (espace insécable) — lisibilité (#31).
  function fmtNum(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    return Math.round(v).toLocaleString('fr-FR');
  }
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: PARIS });
    } catch (e) { return iso || '—'; }
  }
  function fmtAgo(iso) {
    try {
      var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
      if (s < 90) return 'à l’instant';
      var m = Math.round(s / 60);
      if (m < 90) return 'il y a ' + m + ' min';
      var h = Math.round(m / 60);
      if (h < 36) return 'il y a ' + h + ' h';
      return 'il y a ' + Math.round(h / 24) + ' j';
    } catch (e) { return ''; }
  }

  // Nombre de jours distincts où le joueur a au moins une session.
  function daysPresent(data, name) {
    var n = 0, days = (data && data.days) || {};
    for (var k in days) {
      if (!Object.prototype.hasOwnProperty.call(days, k)) continue;
      var ses = days[k] && days[k].ses;
      if (ses && Array.isArray(ses[name]) && ses[name].length) n++;
    }
    return n;
  }

  // Confidentialité : un joueur est « privé » si son UUID est dans data.priv (commande /meyprivacy).
  function isPrivate(data, uuid) {
    try { return !!(data && data.priv && uuid && data.priv[uuid] === true); } catch (e) { return false; }
  }
  // Pseudos PUBLICS uniquement (exclut les joueurs privés) — base de tous les affichages publics.
  function pubKeys(data) {
    var seen = (data && data.seen) || {};
    return Object.keys(seen).filter(function (n) { return !isPrivate(data, seen[n] && seen[n].uuid); });
  }

  // Rang du joueur pour une clé de seen[].mc (joueurs privés exclus). Renvoie {rank,total,value} ou null.
  function rankOf(data, key, name) {
    var seen = (data && data.seen) || {};
    var arr = pubKeys(data).map(function (n) {
      var s = seen[n];
      return { n: n, v: (s && s.mc && typeof s.mc[key] === 'number') ? s.mc[key] : null };
    }).filter(function (x) { return x.v != null && x.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    var idx = arr.findIndex(function (x) { return x.n === name; });
    return idx < 0 ? null : { rank: idx + 1, total: arr.length, value: arr[idx].v };
  }

  // Rang du joueur par temps de jeu total (joueurs privés exclus).
  function playtimeRank(data, name) {
    var seen = (data && data.seen) || {};
    var arr = pubKeys(data).map(function (n) { return { n: n, m: (seen[n] && seen[n].minutes) || 0 }; })
      .sort(function (a, b) { return b.m - a.m; });
    var idx = arr.findIndex(function (x) { return x.n === name; });
    return idx < 0 ? null : { rank: idx + 1, total: arr.length };
  }

  // Liste des joueurs PUBLICS triés par temps de jeu décroissant.
  function players(data) {
    var seen = (data && data.seen) || {};
    return pubKeys(data).map(function (n) {
      var s = seen[n] || {};
      return { name: n, uuid: s.uuid || null, minutes: s.minutes || 0, first: s.first || null, last: s.last || null };
    }).sort(function (a, b) { return b.minutes - a.minutes; });
  }

  function avatarUrl(uuidOrName, size) {
    return 'https://mc-heads.net/avatar/' + encodeURIComponent(uuidOrName || 'steve') + '/' + (size || 32);
  }

  // Agrégat collectif (joueurs privés exclus via pubKeys)
  function collective(data) {
    var seen = (data && data.seen) || {}, keys = pubKeys(data);
    var c = { mobs: 0, distM: 0, diamonds: 0, fish: 0, minutes: 0, players: keys.length };
    keys.forEach(function (n) {
      var s = seen[n] || {}, mc = s.mc || {};
      c.minutes += s.minutes || 0;
      c.mobs += mc.mobKills || 0;
      c.distM += (typeof mc.distTotM === 'number' ? mc.distTotM : (mc.distM || 0));
      c.diamonds += mc.diamonds || 0;
      c.fish += mc.fishCaught || 0;
    });
    return c;
  }
  function milestones(c) {
    var out = [];
    function pick(val, paliers, fmt) { var best = null; for (var i = 0; i < paliers.length; i++) if (val >= paliers[i]) best = paliers[i]; if (best != null) out.push(fmt(best)); }
    pick(Math.floor(c.minutes / 60), [50, 100, 250, 500, 1000, 2500, 5000, 10000], function (v) { return '🎮 ' + v.toLocaleString('fr-FR') + ' h de jeu cumulées'; });
    pick(c.mobs, [1000, 5000, 10000, 50000, 100000], function (v) { return '⚔️ ' + v.toLocaleString('fr-FR') + ' monstres terrassés'; });
    pick(c.diamonds, [100, 500, 1000, 5000], function (v) { return '💎 ' + v.toLocaleString('fr-FR') + ' diamants minés'; });
    pick(Math.floor(c.distM / 1000), [100, 500, 1000, 5000, 40075], function (v) { return '🥾 ' + v.toLocaleString('fr-FR') + ' km parcourus'; });
    return out;
  }
  function champions(data) {
    var seen = (data && data.seen) || {}, keys = pubKeys(data);
    var cats = [
      { emoji: '👑', label: 'Le plus assidu', get: function (s) { return s.minutes || 0; }, fmt: function (v) { return fmtPlayTime(v); } },
      { emoji: '⚔️', label: 'Tueur de monstres', get: function (s) { return (s.mc && s.mc.mobKills) || 0; }, fmt: function (v) { return fmtNum(v) + ' mobs'; } },
      { emoji: '🥾', label: 'Grand voyageur', get: function (s) { return (s.mc && (s.mc.distTotM || s.mc.distM)) || 0; }, fmt: function (v) { return fmtDist(v); } },
      { emoji: '💎', label: 'Mineur de diamant', get: function (s) { return (s.mc && s.mc.diamonds) || 0; }, fmt: function (v) { return fmtNum(v) + ' 💎'; } },
      { emoji: '🎣', label: 'Pêcheur', get: function (s) { return (s.mc && s.mc.fishCaught) || 0; }, fmt: function (v) { return fmtNum(v) + ' poissons'; } },
      { emoji: '🏆', label: 'Chasseur de succès', get: function (s) { return (s.mc && s.mc.adv) || 0; }, fmt: function (v) { return fmtNum(v) + ' succès'; } }
    ];
    var out = [];
    cats.forEach(function (cat) {
      var best = null;
      keys.forEach(function (n) { var s = seen[n] || {}; var v = cat.get(s); if (v > 0 && (!best || v > best.v)) best = { name: n, uuid: s.uuid, v: v }; });
      if (best) out.push({ emoji: cat.emoji, label: cat.label, name: best.name, uuid: best.uuid, value: cat.fmt(best.v) });
    });
    return out;
  }

  // ── Décodage du format v5 (intervalles) → { slots[1440], presence } ──
  // SOURCE UNIQUE (page publique + launcher + régie). Tout changement de format v5 se fait ICI seulement.
  var UP_MERGE_GAP_SEC = 300; // micro-coupures serveur <= 5 min ignorées à l'affichage
  function mergeUp(up, gapSec) {
    var xs = (Array.isArray(up) ? up : [])
      .filter(function (iv) { return Array.isArray(iv) && iv.length >= 2 && iv[1] > iv[0]; })
      .map(function (iv) { return [iv[0], iv[1]]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!xs.length) return [];
    var out = [xs[0].slice()];
    for (var i = 1; i < xs.length; i++) {
      var last = out[out.length - 1];
      if (xs[i][0] - last[1] <= gapSec) { last[1] = Math.max(last[1], xs[i][1]); }
      else { out.push(xs[i].slice()); }
    }
    return out;
  }
  function deriveIntervalsDay(d) {
    var slots = new Array(1440).fill(null);
    var span = function (iv, fn) {
      if (!Array.isArray(iv) || iv.length < 2) return;
      var m0 = Math.max(0, Math.floor(iv[0] / 60));
      var m1 = Math.min(1439, Math.floor((iv[1] - 1) / 60));
      for (var m = m0; m <= m1; m++) fn(m);
    };
    var up = mergeUp(d.up, UP_MERGE_GAP_SEC);
    up.forEach(function (iv) { span(iv, function (m) { if (slots[m] === null) slots[m] = 0; }); });
    var presence = {};
    if (d.ses && typeof d.ses === 'object') {
      Object.keys(d.ses).forEach(function (name) {
        var arr = d.ses[name]; var idx = [];
        if (Array.isArray(arr)) arr.forEach(function (iv) { span(iv, function (m) { slots[m] = (slots[m] || 0) + 1; idx.push(m); }); });
        presence[name] = idx;
      });
    }
    // superset : ses (utilisé par le launcher) + cr (utilisé par la régie) → une seule impl. sert les deux.
    return { slots: slots, presence: presence, perf: d.perf || null, up: up, ses: d.ses || {}, cr: Array.isArray(d.cr) ? d.cr : [] };
  }
  var ISO_DAY = /^\d{4}-\d{2}-\d{2}$/; // sécurité : on ne garde que des clés de date bien formées (les clés sont réinjectées en HTML par les consommateurs → anti-injection)
  function normalizeStatsData(data) {
    if (!data || !data.days) return data;
    var out = {}; for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k]; }
    out.days = {};
    Object.keys(data.days).forEach(function (day) {
      if (!ISO_DAY.test(day)) return;
      var d = data.days[day];
      if (d && (Array.isArray(d.up) || (d.ses && typeof d.ses === 'object'))) { out.days[day] = deriveIntervalsDay(d); return; }
      var isCompact = d && d.s && typeof d.s === 'object' && !Array.isArray(d.s);
      if (!isCompact) { out.days[day] = d; return; }
      var slots = new Array(1440).fill(null);
      Object.keys(d.s).forEach(function (min) { var i = Number(min); if (i >= 0 && i < 1440) slots[i] = d.s[min]; });
      var presence = {};
      if (d.p && typeof d.p === 'object') {
        Object.keys(d.p).forEach(function (name) {
          var ranges = d.p[name]; var indices = [];
          if (Array.isArray(ranges)) ranges.forEach(function (r) { if (Array.isArray(r) && r.length === 2) { for (var i = r[0]; i <= r[1]; i++) indices.push(i); } });
          presence[name] = indices;
        });
      }
      out.days[day] = { slots: slots, presence: presence };
    });
    return out;
  }

  root.StatsCore = {
    PARIS: PARIS, escapeHtml: escapeHtml, fmtPlayTime: fmtPlayTime, fmtDist: fmtDist,
    fmtNum: fmtNum, fmtDate: fmtDate, fmtAgo: fmtAgo, daysPresent: daysPresent, rankOf: rankOf,
    playtimeRank: playtimeRank, players: players, avatarUrl: avatarUrl, isPrivate: isPrivate,
    pubKeys: pubKeys, collective: collective, milestones: milestones, champions: champions,
    UP_MERGE_GAP_SEC: UP_MERGE_GAP_SEC, mergeUp: mergeUp, deriveIntervalsDay: deriveIntervalsDay,
    normalizeStatsData: normalizeStatsData
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = root.StatsCore; } // pour les tests Node
})(typeof window !== 'undefined' ? window : globalThis);
