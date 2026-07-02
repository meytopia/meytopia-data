#!/usr/bin/env node
/* « La rétro du lundi » — résumé automatique de la semaine écoulée, publié dans news.json.
   Lancé chaque lundi matin par .github/workflows/retro-lundi.yml (et testable à la main :
   node tools/retro-lundi.js <chemin-stats.json>). N'utilise QUE les données déjà publiques
   du fichier de stats (les joueurs privés n'y figurent pas) et ne nomme personne.
   Semaine vide (0 minute, 0 joueur) => rien n'est publié. */
'use strict';
const fs = require('fs');
const path = require('path');

/** Les 7 jours PLEINS précédant nowIso (AAAA-MM-JJ), du plus ancien au plus récent. */
function weekDays(nowIso) {
  const d = new Date(nowIso.slice(0, 10) + 'T00:00:00Z');
  const out = [];
  for (let i = 7; i >= 1; i--) {
    const x = new Date(d.getTime() - i * 86400000);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

/** Construit l'actu de la rétro, ou null si la semaine est vide. */
function buildRetro(stats, nowIso) {
  if (!stats || typeof stats !== 'object') return null;
  const days = (stats.days && typeof stats.days === 'object') ? stats.days : {};
  const win = weekDays(nowIso);
  let minutes = 0;
  const players = new Set();
  for (const day of win) {
    const dd = days[day];
    const ses = dd && dd.ses && typeof dd.ses === 'object' ? dd.ses : null;
    if (!ses) continue;
    for (const name of Object.keys(ses)) {
      const ivs = ses[name];
      if (!Array.isArray(ivs)) continue;
      let sec = 0;
      for (const iv of ivs) {
        if (Array.isArray(iv) && iv.length >= 2 && iv[1] > iv[0]) sec += iv[1] - iv[0];
      }
      if (sec > 0) { players.add(name); minutes += Math.round(sec / 60); }
    }
  }
  if (minutes <= 0 || players.size === 0) return null; // semaine vide : pas d'actu
  // Nouveaux joueurs : première venue dans la fenêtre (données publiques uniquement).
  let nouveaux = 0;
  const seen = (stats.seen && typeof stats.seen === 'object') ? stats.seen : {};
  for (const name of Object.keys(seen)) {
    const first = seen[name] && typeof seen[name].first === 'string' ? seen[name].first.slice(0, 10) : null;
    if (first && first >= win[0] && first <= win[win.length - 1]) nouveaux++;
  }
  // Record de pic battu cette semaine ? (anonyme)
  const pk = stats.records && stats.records.peakPlayers;
  const pic = (pk && typeof pk.day === 'string' && pk.day >= win[0] && pk.day <= win[win.length - 1] && pk.value > 0) ? pk.value : 0;
  const h = Math.floor(minutes / 60);
  const bits = [];
  bits.push((h >= 1 ? h + ' h' : minutes + ' min') + ' de jeu cumulées par ' + players.size + ' joueur' + (players.size > 1 ? 's' : ''));
  if (nouveaux > 0) bits.push(nouveaux + (nouveaux > 1 ? ' nouveaux venus' : ' nouveau venu') + ' découvrir Meytopia');
  if (pic > 0) bits.push('record battu : ' + pic + ' joueurs en même temps 🎆');
  const monday = nowIso.slice(0, 10);
  return {
    id: 'retro-' + monday,
    title: '📅 La rétro du lundi',
    body: 'Cette semaine sur Meytopia : ' + bits.join(' · ') + '. Merci à tous, et bonne semaine !',
    date: monday,
    tags: ['retro'],
  };
}

/** Insère l'actu en tête (sans doublon d'id), garde 30 actus max. Renvoie true si modifié. */
function applyRetro(newsDoc, entry) {
  if (!entry || !newsDoc || !Array.isArray(newsDoc.news)) return false;
  if (newsDoc.news.some((n) => n && n.id === entry.id)) return false; // déjà publiée (re-run)
  newsDoc.news.unshift(entry);
  while (newsDoc.news.length > 30) newsDoc.news.pop();
  return true;
}

module.exports = { buildRetro, applyRetro, weekDays };

if (require.main === module) {
  const statsPath = process.argv[2];
  if (!statsPath || !fs.existsSync(statsPath)) {
    console.log('rétro : pas de fichier de stats — rien à publier.');
    process.exit(0);
  }
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  const entry = buildRetro(stats, new Date().toISOString());
  if (!entry) {
    console.log('rétro : semaine vide — rien à publier.');
    process.exit(0);
  }
  const newsPath = path.join(__dirname, '..', 'news.json');
  const doc = JSON.parse(fs.readFileSync(newsPath, 'utf8'));
  if (!applyRetro(doc, entry)) {
    console.log('rétro : déjà publiée cette semaine — rien à faire.');
    process.exit(0);
  }
  fs.writeFileSync(newsPath, JSON.stringify(doc, null, 2) + '\n');
  console.log('rétro publiée : ' + entry.body);
}
