/* profile.js — page publique Meytopia : fiche joueur partageable (?p=Pseudo) + annuaire. */
(function () {
  'use strict';
  var SC = window.StatsCore;
  var BASE = 'https://raw.githubusercontent.com/meytopia/meytopia-data/stats/';
  var app = document.getElementById('app');
  var liveEl = document.getElementById('live');

  var METRICS = [
    { key: 'mobKills', emoji: '⚔️', label: 'Monstres tués', fmt: function (v) { return v; } },
    { key: 'distTotM', emoji: '🥾', label: 'Distance parcourue', fmt: function (v) { return SC.fmtDist(v); } },
    { key: 'diamonds', emoji: '💎', label: 'Diamants minés', fmt: function (v) { return v; } },
    { key: 'fishCaught', emoji: '🎣', label: 'Poissons pêchés', fmt: function (v) { return v; } },
    { key: 'adv', emoji: '🏆', label: 'Succès', fmt: function (v) { return v; } },
    { key: 'playerKills', emoji: '🗡️', label: 'Duels gagnés', fmt: function (v) { return v; } },
    { key: 'deaths', emoji: '💀', label: 'Morts', fmt: function (v) { return v; } },
    { key: 'noDeathMin', emoji: '🛡️', label: 'Série sans mourir', fmt: function (v) { return SC.fmtPlayTime(v); } },
    { key: 'elytraM', emoji: '🪽', label: 'Vol en élytre', fmt: function (v) { return SC.fmtDist(v); } }
  ];

  function wireImgFallback() {
    // CSP script-src 'self' interdit onerror inline -> on masque les avatars cassés après rendu.
    app.querySelectorAll('img').forEach(function (im) { im.addEventListener('error', function () { im.style.visibility = 'hidden'; }); });
  }
  function getParam(n) {
    try { return new URLSearchParams(location.search).get(n); } catch (e) { return null; }
  }
  function fetchJson(name) {
    return fetch(BASE + name + '?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function renderLive(live) {
    if (!live) { liveEl.textContent = ''; return; }
    var fresh = live.updatedAt && (Date.now() - new Date(live.updatedAt).getTime() < 5 * 60 * 1000);
    if (fresh && live.online) {
      var c = typeof live.count === 'number' ? live.count : (live.players || []).length;
      liveEl.innerHTML = '<span class="live-dot"></span>' + c + ' en ligne';
    } else {
      liveEl.textContent = 'serveur hors ligne';
    }
  }

  function badge(rank) {
    if (rank === 1) return '<span class="badge b1">1ᵉʳ</span>';
    if (rank === 2) return '<span class="badge b2">2ᵉ</span>';
    if (rank === 3) return '<span class="badge b3">3ᵉ</span>';
    return '<span class="badge">' + rank + 'ᵉ</span>';
  }

  function renderProfile(data, name) {
    var seen = (data && data.seen) || {};
    var s = seen[name];
    if (!s) {
      app.innerHTML = '<div class="empty">Joueur « ' + SC.escapeHtml(name) + ' » introuvable.<br><a href="?">← Tous les joueurs</a></div>';
      return;
    }
    if (SC.isPrivate(data, s.uuid)) {
      app.innerHTML = '<div class="empty">🔒 Ce joueur a choisi de garder ses stats privées.<br><a href="?">← Tous les joueurs</a></div>';
      return;
    }
    var pr = SC.playtimeRank(data, name);
    var title = pr ? (pr.rank === 1 ? 'Vétéran nº1 du serveur' : (pr.rank + 'ᵉ joueur le plus assidu')) : 'Membre de Meytopia';
    var head =
      '<div class="pcard">' +
      '<img src="' + SC.avatarUrl(s.uuid || name, 64) + '" alt="">' +
      '<div><div class="pname">' + SC.escapeHtml(name) + '</div><div class="ptitle">🌟 ' + title + '</div></div>' +
      '</div>';
    var tiles =
      '<div class="grid">' +
      stat(SC.fmtPlayTime(s.minutes || 0), 'temps de jeu') +
      stat(String(SC.daysPresent(data, name)), 'jours de présence') +
      stat(String(s.sessions || 0), 'sessions') +
      stat(s.first ? SC.fmtDate(s.first) : '—', 'première venue') +
      '</div>';

    var rows = '';
    METRICS.forEach(function (m) {
      var info = SC.rankOf(data, m.key, name);
      if (!info) return;
      rows += '<div class="row"><span class="row-emoji">' + m.emoji + '</span>' +
        '<span class="row-lab">' + m.label + '</span>' +
        '<span class="row-val">' + SC.escapeHtml(String(m.fmt(info.value))) + '</span>' +
        badge(info.rank) + '</div>';
    });
    var board = rows ? ('<div class="section">🎮 Classements en jeu</div>' + rows) : '';

    var share =
      '<div class="share"><button type="button" id="share-btn">🔗 Copier le lien de ce profil</button></div>';

    app.innerHTML = head + tiles + board + share +
      '<div style="margin-top:18px"><a href="?">← Tous les joueurs</a></div>';

    wireImgFallback();
    var btn = document.getElementById('share-btn');
    if (btn) btn.addEventListener('click', function () {
      var url = location.origin + location.pathname + '?p=' + encodeURIComponent(name);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { btn.textContent = '✓ Lien copié !'; }, function () { btn.textContent = url; });
      } else { btn.textContent = url; }
    });
  }

  function stat(val, lab) {
    return '<div class="stat"><div class="stat-val">' + SC.escapeHtml(String(val)) + '</div><div class="stat-lab">' + SC.escapeHtml(lab) + '</div></div>';
  }

  function aggChallenge(data, metric) {
    // Total communautaire anonyme publié par la sonde (inclut les joueurs privés) → barre = déclenchement réel.
    if (data && data.agg && typeof data.agg[metric] === 'number') return data.agg[metric];
    var seen = (data && data.seen) ? data.seen : {};
    var keys = Object.keys(seen).filter(function (n) { return !SC.isPrivate(data, seen[n] && seen[n].uuid); }); // exclut les joueurs privés
    function sumMc(k) { return keys.reduce(function (a, n) { var s = seen[n]; return a + ((s && s.mc && typeof s.mc[k] === 'number') ? s.mc[k] : 0); }, 0); }
    switch (metric) {
      case 'mobKills': return sumMc('mobKills');
      case 'diamonds': return sumMc('diamonds');
      case 'fishCaught': return sumMc('fishCaught');
      case 'totalPlayMinutes': return keys.reduce(function (a, n) { return a + ((seen[n] && seen[n].minutes) || 0); }, 0);
      case 'uniquePlayers': return keys.length;
      case 'peak': return (data && data.records && data.records.peakPlayers && data.records.peakPlayers.value) || 0;
      default: return 0;
    }
  }
  function renderServerSummary(data, challenges) {
    var season = (data.server && typeof data.server.season === 'number') ? data.server.season : null;
    var rec = data.records || {};
    var html = '';
    // 1 + 2 — Le serveur en chiffres + jalons collectifs
    var col = SC.collective(data);
    if (col.players) {
      var km = Math.round(col.distM / 1000);
      var earth = col.distM / 1000 / 40075;
      var statRow = [
        ['🎮', SC.fmtPlayTime(col.minutes), 'de jeu cumulé'],
        ['⚔️', col.mobs.toLocaleString('fr-FR'), 'monstres tués'],
        ['🥾', km.toLocaleString('fr-FR') + ' km', earth >= 0.1 ? earth.toFixed(1) + '× la Terre' : 'parcourus'],
        ['💎', col.diamonds.toLocaleString('fr-FR'), 'diamants']
      ];
      html += '<div class="section">📊 Le serveur en chiffres</div><div class="dir-stats">' +
        statRow.map(function (r) { return '<div class="dstat"><div class="dstat-v">' + r[0] + ' ' + SC.escapeHtml(r[1]) + '</div><div class="dstat-l">' + SC.escapeHtml(r[2]) + '</div></div>'; }).join('') + '</div>';
      var ms = SC.milestones(col);
      if (ms.length) html += '<div class="milestones">' + ms.map(function (m) { return '<span class="ms">✅ ' + SC.escapeHtml(m) + '</span>'; }).join('') + '</div>';
    }
    var bits = [];
    if (rec.peakPlayers && rec.peakPlayers.value) bits.push('👥 record ' + rec.peakPlayers.value + ' joueurs' + (rec.peakPlayers.day ? ' (' + SC.fmtDate(rec.peakPlayers.day) + ')' : ''));
    if (rec.longestSession && rec.longestSession.minutes) bits.push('🏃 plus longue session ' + SC.fmtPlayTime(rec.longestSession.minutes) + (rec.longestSession.player ? ' — ' + SC.escapeHtml(rec.longestSession.player) : ''));
    if (bits.length) html += '<div class="section">🏆 Records' + (season ? ' · Saison ' + season : '') + '</div><div class="muted" style="margin-bottom:6px">' + bits.join(' &nbsp;·&nbsp; ') + '</div>';
    // 7 — Mur des champions
    var champs = SC.champions(data);
    if (champs.length) {
      html += '<div class="section">🏅 Le mur des champions</div><div class="hof">' +
        champs.map(function (cc) {
          return '<div class="hof-card"><div class="hof-cat">' + cc.emoji + ' ' + SC.escapeHtml(cc.label) + '</div>' +
            '<div class="hof-name"><img src="' + SC.avatarUrl(cc.uuid || cc.name, 24) + '" alt="">' + SC.escapeHtml(cc.name) + '</div>' +
            '<div class="hof-val">' + SC.escapeHtml(cc.value) + '</div></div>';
        }).join('') + '</div>';
    }
    var list = (challenges && Array.isArray(challenges.challenges)) ? challenges.challenges : [];
    var now = Date.now();
    var active = list.filter(function (c) { return c && c.target > 0 && (!c.from || new Date(c.from).getTime() <= now) && (!c.to || new Date(c.to).getTime() >= now); });
    if (active.length) {
      html += '<div class="section">🎯 Défis communautaires</div>' + active.map(function (c) {
        var cur = aggChallenge(data, c.metric);
        var pct = Math.max(0, Math.min(100, Math.round(cur / c.target * 100)));
        var done = cur >= c.target;
        var fmtV = function (m, v) { return m === 'totalPlayMinutes' ? SC.fmtPlayTime(v) : String(v); };
        return '<div class="chal' + (done ? ' done' : '') + '"><div class="chal-head"><span>' + SC.escapeHtml(c.title || 'Défi') + '</span><span>' + SC.escapeHtml(fmtV(c.metric, Math.min(cur, c.target))) + ' / ' + SC.escapeHtml(fmtV(c.metric, c.target)) + (done ? ' ✓' : '') + '</span></div><div class="chal-bar"><div class="chal-fill" data-pct="' + pct + '"></div></div></div>';
      }).join('');
    }
    return html;
  }
  function renderDirectory(data, live, challenges) {
    var list = SC.players(data);
    var onlineNames = {};
    if (live && live.online && Array.isArray(live.players)) live.players.forEach(function (p) { if (p && p.name) onlineNames[p.name] = true; });
    var cards = list.map(function (p) {
      var on = onlineNames[p.name] ? '<span class="live-dot"></span>en ligne · ' : '';
      return '<a href="?p=' + encodeURIComponent(p.name) + '">' +
        '<img src="' + SC.avatarUrl(p.uuid || p.name, 32) + '" alt="">' +
        '<div style="min-width:0"><div class="n">' + SC.escapeHtml(p.name) + '</div>' +
        '<div class="t">' + on + SC.fmtPlayTime(p.minutes) + '</div></div></a>';
    }).join('');
    var dir = list.length ? '<div class="section">Les joueurs de Meytopia</div><div class="dir">' + cards + '</div>'
      : '<div class="empty">Aucun joueur enregistré pour l’instant.</div>';
    app.innerHTML = renderServerSummary(data, challenges) + dir;
    wireImgFallback();
    app.querySelectorAll('.chal-fill').forEach(function (el) { el.style.width = (el.dataset.pct || 0) + '%'; });
  }

  var MAIN_BASE = 'https://raw.githubusercontent.com/meytopia/meytopia-data/main/';
  function fetchUrl(url) {
    return fetch(url + '?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  Promise.all([fetchJson('stats-serveur.json'), fetchJson('live.json'), fetchUrl(MAIN_BASE + 'challenges.json')]).then(function (res) {
    var data = res[0], live = res[1], challenges = res[2];
    renderLive(live);
    if (!data || !data.seen) {
      app.innerHTML = '<div class="empty">Statistiques indisponibles pour le moment.</div>';
      return;
    }
    var p = getParam('p');
    if (p) renderProfile(data, p);
    else renderDirectory(data, live, challenges);
  });
})();
