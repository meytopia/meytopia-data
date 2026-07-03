/* profile.js — page publique Meytopia : fiche joueur partageable (?p=Pseudo) + annuaire. */
(function () {
  'use strict';
  var SC = window.StatsCore;
  var BASE = 'https://raw.githubusercontent.com/meytopia/meytopia-data/stats/';
  var app = document.getElementById('app');
  var liveEl = document.getElementById('live');

  var METRICS = [
    { key: 'mobKills', emoji: '⚔️', label: 'Monstres tués', fmt: function (v) { return SC.fmtNum(v); } },
    { key: 'distTotM', emoji: '🥾', label: 'Distance parcourue', fmt: function (v) { return SC.fmtDist(v); } },
    { key: 'diamonds', emoji: '💎', label: 'Diamants minés', fmt: function (v) { return SC.fmtNum(v); } },
    { key: 'fishCaught', emoji: '🎣', label: 'Poissons pêchés', fmt: function (v) { return SC.fmtNum(v); } },
    { key: 'adv', emoji: '🏆', label: 'Succès', fmt: function (v) { return SC.fmtNum(v); } },
    { key: 'playerKills', emoji: '🗡️', label: 'Duels gagnés', fmt: function (v) { return SC.fmtNum(v); } },
    { key: 'deaths', emoji: '💀', label: 'Morts', fmt: function (v) { return SC.fmtNum(v); } },
    { key: 'noDeathMin', emoji: '🛡️', label: 'Temps de jeu sans mourir', title: 'depuis sa dernière mort', fmt: function (v) { return SC.fmtPlayTime(v); } },
    { key: 'elytraM', emoji: '🪽', label: 'Vol en élytre', fmt: function (v) { return SC.fmtDist(v); } }
  ];

  // #34 : avatar de secours LOCAL (carré neutre) si le service d'avatars ne répond pas — au lieu de
  // masquer l'image (qui laissait un trou et décalait la mise en page). data: est autorisé par la CSP.
  var AVATAR_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#241A40"/><rect x="2" y="3" width="4" height="2" fill="#3a2e5a"/><rect x="2" y="6" width="4" height="1" fill="#1B1430"/></svg>');
  function wireImgFallback() {
    // CSP script-src 'self' interdit onerror inline -> on branche le repli après rendu.
    app.querySelectorAll('img').forEach(function (im) {
      im.addEventListener('error', function () { im.src = AVATAR_FALLBACK; }, { once: true });
    });
  }
  // #32 : chaque vue met à jour le titre de l'onglet (partage/favoris plus clairs).
  function setTitle(suffix) { document.title = suffix ? (suffix + ' — Meytopia') : 'Meytopia — le serveur'; }
  function getParam(n) {
    try { return new URLSearchParams(location.search).get(n); } catch (e) { return null; }
  }
  function fetchJson(name) {
    // Conditionnel : le navigateur revalide (ETag) et ne re-télécharge que si le fichier a changé (304 sinon).
    return fetch(BASE + name, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
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

  function badge(rank, total) {
    var ord = rank === 1 ? '1ᵉʳ' : rank + 'ᵉ';
    var tip = total ? ' title="' + ord + ' sur ' + total + ' joueur' + (total > 1 ? 's' : '') + ' du serveur pour cette statistique."' : '';
    if (rank === 1) return '<span class="badge b1"' + tip + '>1ᵉʳ</span>';
    if (rank === 2) return '<span class="badge b2"' + tip + '>2ᵉ</span>';
    if (rank === 3) return '<span class="badge b3"' + tip + '>3ᵉ</span>';
    return '<span class="badge"' + tip + '>' + rank + 'ᵉ</span>';
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
    setTitle(name); // #32 : « Pseudo — Meytopia » dans l'onglet
    var head =
      '<div class="pcard">' +
      '<img src="' + SC.avatarUrl(s.uuid || name, 64) + '" alt="">' +
      '<div><div class="pname">' + SC.escapeHtml(name) + '</div><div class="ptitle">🌟 ' + title + '</div></div>' +
      '</div>';
    var tiles =
      '<div class="grid">' +
      stat(SC.fmtPlayTime(s.minutes || 0), 'temps de jeu (saison)') +
      (s.totalMin ? stat(SC.fmtPlayTime(s.totalMin), 'temps de jeu total') : '') +
      stat(SC.fmtNum(SC.daysPresent(data, name)), 'jours de présence') +
      stat(SC.fmtNum(s.sessions || 0), 'connexions au serveur') +
      stat(s.first ? SC.fmtDate(s.first) : '—', 'première venue') +
      '</div>';

    var rows = '';
    METRICS.forEach(function (m) {
      var info = SC.rankOf(data, m.key, name);
      if (!info) return;
      rows += '<div class="row"><span class="row-emoji">' + m.emoji + '</span>' +
        '<span class="row-lab"' + (m.title ? ' title="' + m.title + '"' : '') + '>' + m.label + '</span>' +
        '<span class="row-val">' + SC.escapeHtml(String(m.fmt(info.value))) + '</span>' +
        badge(info.rank, info.total) + '</div>';
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
      case 'totalPlayMinutes': return keys.reduce(function (a, n) { return a + ((seen[n] && seen[n].minutes) || 0); }, 0);
      case 'uniquePlayers': return keys.length;
      case 'peak': return (data && data.records && data.records.peakPlayers && data.records.peakPlayers.value) || 0;
      // toute autre métrique = somme de seen[].mc[metric] — même règle générique que le mod (aggMetric).
      default: return sumMc(metric);
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
      html += '<div class="section">📊 Le serveur en chiffres — depuis le début de Meytopia</div><div class="dir-stats">' +
        statRow.map(function (r) { return '<div class="dstat"><div class="dstat-v">' + r[0] + ' ' + SC.escapeHtml(r[1]) + '</div><div class="dstat-l">' + SC.escapeHtml(r[2]) + '</div></div>'; }).join('') + '</div>';
      var ms = SC.milestones(col);
      if (ms.length) html += '<div class="milestones">' + ms.map(function (m) { return '<span class="ms">✅ ' + SC.escapeHtml(m) + '</span>'; }).join('') + '</div>';
    }
    var bits = [];
    if (rec.peakPlayers && rec.peakPlayers.value) bits.push('👥 record ' + SC.fmtNum(rec.peakPlayers.value) + ' joueurs' + (rec.peakPlayers.day ? ' (' + SC.fmtDate(rec.peakPlayers.day) + ')' : ''));
    if (rec.longestSession && rec.longestSession.minutes) bits.push('🏃 plus longue session ' + SC.fmtPlayTime(rec.longestSession.minutes) + (rec.longestSession.player ? ' — ' + SC.escapeHtml(rec.longestSession.player) : ''));
    if (bits.length) html += '<div class="section">🏆 Records' + (season ? ' · Saison ' + season : '') + '</div><div class="muted" style="margin-bottom:6px">' + bits.join(' &nbsp;·&nbsp; ') + '</div>';
    // 7 — Mur des champions
    var champs = SC.champions(data);
    if (champs.length) {
      html += '<div class="section">🏅 Le mur des champions</div>' +
        '<div class="page-intro">Le meilleur joueur de chaque catégorie — depuis le début de Meytopia.</div><div class="hof">' +
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
      html += '<div class="section">🎯 Défis communautaires</div>' +
        '<div class="page-intro">Tout le serveur avance ensemble vers l’objectif. 🔒 Les récompenses (remises en jeu) sont réservées aux joueurs visibles : un joueur en mode privé (/meyprivacy) ne les reçoit pas tant qu’il est caché — <a href="?donnees=1">en savoir plus</a>.</div>' + active.map(function (c) {
        var cur = aggChallenge(data, c.metric);
        var pct = Math.max(0, Math.min(100, Math.round(cur / c.target * 100)));
        var done = cur >= c.target;
        var fmtV = function (m, v) {
          if (m === 'totalPlayMinutes') return SC.fmtPlayTime(v);
          if (m === 'distTotM' || m === 'elytraM') return SC.fmtDist(v);
          return SC.fmtNum(v); // #31 : nombres groupés comme le reste de la page (plus de « 10000 » à côté de « 10 000 »)
        };
        return '<div class="chal' + (done ? ' done' : '') + '"><div class="chal-head"><span>' + SC.escapeHtml(c.title || 'Défi') + '</span><span>' + SC.escapeHtml(fmtV(c.metric, Math.min(cur, c.target))) + ' / ' + SC.escapeHtml(fmtV(c.metric, c.target)) + (done ? ' ✓' : '') + '</span></div><div class="chal-bar"><div class="chal-fill" data-pct="' + pct + '"></div></div></div>';
      }).join('');
    }
    return html;
  }
  function renderDirectory(data, live, challenges) {
    setTitle(''); // #32 : « Meytopia — le serveur » (accueil/annuaire)
    var list = SC.players(data);
    var onlineNames = {};
    if (live && live.online && Array.isArray(live.players)) live.players.forEach(function (p) { if (p && p.name) onlineNames[p.name] = true; });
    var cards = list.map(function (p) {
      var on = onlineNames[p.name] ? '<span class="live-dot"></span>en ligne · ' : '';
      return '<a href="?p=' + encodeURIComponent(p.name) + '">' +
        '<img src="' + SC.avatarUrl(p.uuid || p.name, 32) + '" alt="">' +
        '<div style="min-width:0"><div class="n">' + SC.escapeHtml(p.name) + '</div>' +
        '<div class="t">' + on + SC.fmtPlayTime(p.minutes) + ' de jeu cette saison</div></div></a>';
    }).join('');
    var dir = list.length ? '<div class="section">Les joueurs de Meytopia</div><div class="dir">' + cards + '</div>'
      : '<div class="empty">Aucun joueur enregistré pour l’instant.</div>';
    var seasonsLink = '<div style="margin-top:16px"><a href="?saisons=1">📜 L’histoire des saisons →</a>' +
      ' &nbsp;·&nbsp; <a href="?donnees=1">🔐 Tes données (vie privée) →</a></div>';
    app.innerHTML = renderServerSummary(data, challenges) + dir + seasonsLink;
    wireImgFallback();
    app.querySelectorAll('.chal-fill').forEach(function (el) { el.style.width = (el.dataset.pct || 0) + '%'; });
  }

  var MAIN_BASE = 'https://raw.githubusercontent.com/meytopia/meytopia-data/main/';
  function fetchUrl(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  /* ── L'histoire des saisons (?saisons) ──
     Archives seasons/saison-N.json (écrites par la sonde à chaque clôture, même format que les stats).
     On n'affiche QUE les compteurs réellement saisonniers (minutes de saison, records de saison) —
     les stats mc des archives mélangent d'anciens formats, on ne s'y fie pas ici. */
  function seasonCard(title, d, isCurrent) {
    var srv = (d && d.server) || {};
    var rec = (d && d.records) || {};
    var pub = SC.pubKeys(d);
    var minutes = 0;
    pub.forEach(function (n) { minutes += (d.seen[n] && d.seen[n].minutes) || 0; });
    var from = srv.firstStartAt ? SC.fmtDate(srv.firstStartAt) : null;
    var to = srv.lastStopAt ? SC.fmtDate(srv.lastStopAt) : null;
    var period = isCurrent ? (from ? 'en cours depuis le ' + from : 'en cours') : (from && to ? 'du ' + from + ' au ' + to : (to ? 'terminée le ' + to : ''));
    var bits = [];
    bits.push(SC.fmtNum(pub.length) + ' joueur' + (pub.length > 1 ? 's' : ''));
    if (minutes) bits.push(SC.fmtPlayTime(minutes) + ' de jeu cumulé');
    if (rec.peakPlayers && rec.peakPlayers.value) bits.push('record ' + SC.fmtNum(rec.peakPlayers.value) + ' en simultané');
    if (rec.longestSession && rec.longestSession.minutes) bits.push('plus longue session ' + SC.fmtPlayTime(rec.longestSession.minutes) + (rec.longestSession.player ? ' (' + SC.escapeHtml(rec.longestSession.player) + ')' : ''));
    var top = null;
    pub.forEach(function (n) { var m = (d.seen[n] && d.seen[n].minutes) || 0; if (m > 0 && (!top || m > top.m)) top = { n: n, m: m }; });
    if (top) bits.push('👑 joueur le plus présent : ' + SC.escapeHtml(top.n) + ' (' + SC.fmtPlayTime(top.m) + ' de jeu)');
    return '<div class="chal' + (isCurrent ? ' done' : '') + '">' +
      '<div class="chal-head"><span>' + (isCurrent ? '⚔️ ' : '🏁 ') + SC.escapeHtml(title) + '</span><span>' + SC.escapeHtml(period) + '</span></div>' +
      '<div class="muted">' + (bits.length ? bits.join(' &nbsp;·&nbsp; ') : 'Aucune donnée conservée') + '</div></div>';
  }
  function renderSeasons(current) {
    setTitle("L'histoire des saisons"); // #32
    var season = (current.server && typeof current.server.season === 'number') ? current.server.season : 1;
    var nums = [];
    for (var i = season - 1; i >= 1; i--) nums.push(i);
    Promise.all(nums.map(function (n) { return fetchUrl(MAIN_BASE + 'seasons/saison-' + n + '.json'); })).then(function (archives) {
      var html = '<div class="section">📜 L’histoire de Meytopia</div>' +
        '<div class="page-intro">À chaque saison, le monde et les compteurs repartent de zéro — voici le résumé de chaque époque de Meytopia.</div>';
      html += seasonCard('Saison ' + season, current, true);
      nums.forEach(function (n, idx) {
        var d = archives[idx];
        // Saison sans archive (période de test purgée, ou saison d'avant la sonde) : on ne l'affiche pas —
        // une ligne « archive indisponible » n'apprendrait rien aux joueurs.
        if (d && d.seen) html += seasonCard('Saison ' + n, d, false);
      });
      html += '<div style="margin-top:18px"><a href="?">← Tous les joueurs</a></div>';
      app.innerHTML = html;
    });
  }

  /* ── Tes données (?donnees) ──
     Page d'information vie privée, en français simple : ce que le serveur enregistre, où c'est
     visible, combien de temps, et comment se retirer (/meyprivacy + retrait des archives).
     Page STATIQUE : ne dépend d'aucune donnée — elle s'affiche même si les stats sont en panne. */
  function renderDonnees() {
    setTitle('Tes données'); // #32
    function bloc(titre, corps) {
      return '<div class="section">' + titre + '</div><div class="muted" style="margin-bottom:6px">' + corps + '</div>';
    }
    var html = '<div class="section">🔐 Tes données sur Meytopia</div>' +
      '<div class="page-intro">Tout ce que le serveur enregistre sur toi, où c’est visible, et comment te retirer si tu le souhaites — en clair, sans surprise.</div>' +

      bloc('📋 Ce qui est enregistré',
        'Quand tu joues sur le serveur, la sonde enregistre : ton <b>pseudo Minecraft</b>, l’<b>identifiant de ton compte</b> (UUID, fourni par Minecraft), ton <b>temps de jeu</b> et tes <b>horaires de connexion</b>, et tes <b>statistiques de jeu</b> (monstres tués, distance parcourue, diamants minés, morts, succès…).<br>' +
        'Rien d’autre : <b>pas d’adresse IP, pas de messages du chat, pas d’e-mail</b> — le serveur ne les connaît même pas ici.') +

      bloc('👀 Où c’est visible',
        'Ces informations apparaissent sur <b>cette page publique</b> (annuaire, profils, classements), sur la <b>page Communauté du launcher</b>, et dans le <b>« en ligne en ce moment »</b> (temps réel). ' +
        'Les fichiers de données sont hébergés sur <b>GitHub, dans un dépôt public</b> : n’importe qui sur Internet peut donc les consulter, comme cette page.') +

      bloc('⏳ Combien de temps',
        'Les compteurs vivent le temps d’une <b>saison</b> : à chaque nouvelle saison, tout repart de zéro. La saison terminée peut être conservée en <b>archive complète</b> (c’est ce qui alimente « L’histoire des saisons »). ' +
        'En plus, une <b>sauvegarde quotidienne de secours</b> est conservée dans un espace <b>privé</b>, visible du seul administrateur (anti-perte) : elle n’est <b>pas publiée</b>, et elle aussi s’efface sur demande (voir plus bas).') +

      bloc('🕶️ Passer en privé — /meyprivacy',
        'Tape <b>/meyprivacy cacher</b> en jeu : tes stats disparaissent <b>immédiatement</b> des pages publiques, du launcher et du temps réel — tu n’es <b>ni listé, ni compté</b>. Tu peux continuer à jouer normalement.<br>' +
        '⚠️ <b>À savoir</b> : les récompenses des <b>défis communautaires</b> sont remises aux joueurs <b>visibles</b> uniquement. En privé, tu ne les reçois pas — le jeu te prévient si tu en rates une. ' +
        'Tape <b>/meyprivacy montrer</b> pour redevenir visible : tu recevras la récompense manquée à ta prochaine connexion.') +

      bloc('🗑️ Te retirer des archives',
        'Le mode privé agit sur le présent — mais les <b>archives des saisons passées</b> (publiques) peuvent encore mentionner ton pseudo, et les <b>sauvegardes privées de secours</b> gardent les jours déjà enregistrés. ' +
        'Si tu veux en être retiré, demande à l’administrateur (en jeu ou là où tu le contactes d’habitude) : il dispose d’un outil qui t’efface de toutes les archives publiques ET des sauvegardes privées, sans casser les stats des autres joueurs.') +

      '<div style="margin-top:18px"><a href="?">← Tous les joueurs</a></div>';
    app.innerHTML = html;
  }

  // ── Données mises en cache (une seule fois par visite) ──
  // #33 : la page « Tes données » est STATIQUE — on ne télécharge alors AUCUN fichier de stats.
  // Les autres vues partagent le même relevé : naviguer entre l'annuaire, un profil et les saisons
  // (#35, sans rechargement) ne refait pas d'aller-retour réseau.
  var cache = { loaded: false, data: null, live: null, challenges: null };
  function ensureStats() {
    if (cache.loaded) return Promise.resolve(cache);
    return Promise.all([fetchJson('stats-serveur.json'), fetchJson('live.json'), fetchUrl(MAIN_BASE + 'challenges.json')])
      .then(function (res) {
        cache.data = res[0]; cache.live = res[1]; cache.challenges = res[2];
        // On ne mémorise le relevé QUE s'il est exploitable : sans cette garde, une panne réseau
        // passagère au 1er chargement figerait cache.loaded=true avec data=null, et — comme la
        // navigation ne recharge plus la page (SPA) — TOUTE la session resterait sur « indisponible »
        // même serveur revenu. En cas d'échec, on laisse loaded=false → réessai à la navigation suivante.
        if (cache.data && cache.data.seen) cache.loaded = true;
        return cache;
      });
  }

  // Affiche la vue correspondant à l'URL courante (?p / ?saisons / ?donnees / annuaire).
  function route() {
    // « Tes données » : statique, aucune requête (elle s'affiche même stats en panne).
    if (getParam('donnees') != null) { renderDonnees(); return; }
    ensureStats().then(function (c) {
      renderLive(c.live);
      if (!c.data || !c.data.seen) {
        setTitle('');
        app.innerHTML = '<div class="empty">Statistiques indisponibles pour le moment.</div>';
        return;
      }
      var p = getParam('p');
      if (getParam('saisons') != null) renderSeasons(c.data);
      else if (p) renderProfile(c.data, p);
      else renderDirectory(c.data, c.live, c.challenges);
    });
  }

  // #35 : navigation interne sans rechargement — on capture les clics sur les liens « ?… » et on
  // change l'URL via l'historique, puis on ré-affiche. Retour/avance du navigateur gérés par popstate.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="?"]') : null;
    if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // laisse « ouvrir dans un nouvel onglet »
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '?') return;
    e.preventDefault();
    // « ? » seul = annuaire : on retire la query pour une URL propre.
    history.pushState(null, '', href === '?' ? location.pathname : href);
    window.scrollTo(0, 0);
    route();
  });
  window.addEventListener('popstate', route);

  route();
})();
