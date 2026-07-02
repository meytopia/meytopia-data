#!/usr/bin/env node
// ============================================================
// Meytopia — valider.js (Lot 3, K3)
// Garde-fou : vérifie les 6 JSON du dépôt avant que le launcher
// (et donc les joueurs) ne les voie. Lancé par la CI à chaque
// push (.github/workflows/valider.yml) ou à la main :
//   node valider.js
// Code retour 0 = tout bon, sinon liste des problèmes.
// ============================================================
'use strict';
const fs = require('fs');

const problems = [];
const err = (file, msg) => problems.push(`${file} : ${msg}`);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isBool = (v) => typeof v === 'boolean';
const isInt = (v) => Number.isInteger(v);
const isHttps = (v) => isStr(v) && /^https:\/\//.test(v);
const isHex = (v) => isStr(v) && /^#[0-9A-Fa-f]{6}$/.test(v);
const isSha1 = (v) => isStr(v) && /^[0-9a-fA-F]{40}$/.test(v);
const isDate = (v) => isStr(v) && !Number.isNaN(Date.parse(v));
const isSemver = (v) => isStr(v) && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v);
const isStrictSemver = (v) => isStr(v) && /^\d+\.\d+\.\d+$/.test(v);

function load(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
  catch { err(file, 'fichier introuvable'); return null; }
  try { return JSON.parse(raw); }
  catch (e) { err(file, `JSON invalide — ${e.message}`); return null; }
}

/* ── launcher.json ── */
function checkLauncher() {
  const f = 'launcher.json';
  const d = load(f);
  if (!d) return;
  const m = d.maintenance;
  if (!m || typeof m !== 'object') err(f, 'maintenance manquant');
  else {
    if (!isBool(m.active)) err(f, 'maintenance.active doit être un booléen');
    if (m.message !== undefined && typeof m.message !== 'string') err(f, 'maintenance.message doit être une chaîne');
    if (m.scheduledAt !== undefined && m.scheduledAt !== null && !isDate(m.scheduledAt)) err(f, 'maintenance.scheduledAt doit être une date ISO ou null');
  }
  const s = d.server;
  if (!s || typeof s !== 'object') err(f, 'server manquant');
  else {
    if (!isStr(s.host)) err(f, 'server.host manquant');
    if (!isInt(s.port) || s.port < 1 || s.port > 65535) err(f, 'server.port doit être un port valide');
    if (s.name !== undefined && !isStr(s.name)) err(f, 'server.name doit être une chaîne non vide');
    if (s.statusIntervalS !== undefined && (!isInt(s.statusIntervalS) || s.statusIntervalS < 1)) err(f, 'server.statusIntervalS doit être un entier ≥ 1');
  }
  if (d.discordInvite !== undefined && !isHttps(d.discordInvite)) err(f, 'discordInvite doit être une URL https');
  const p = d.modpack;
  if (!p || typeof p !== 'object') err(f, 'modpack manquant');
  else {
    if (!isSemver(p.version)) err(f, `modpack.version invalide (${p.version})`);
    if (!isStr(p.mcVersion)) err(f, 'modpack.mcVersion manquant');
    if (!p.loader || !isStr(p.loader.type) || !isStr(p.loader.version)) err(f, 'modpack.loader.type / version manquants');
    if (!isHttps(p.manifestUrl)) err(f, 'modpack.manifestUrl doit être une URL https');
  }
  if (d.minLauncherVersion !== undefined && !isStrictSemver(d.minLauncherVersion)) err(f, `minLauncherVersion doit être X.Y.Z (${d.minLauncherVersion})`);
  if (d.gate !== undefined) {
    if (!isDate(d.gate.openAt)) err(f, 'gate.openAt doit être une date ISO');
    if (d.gate.title !== undefined && !isStr(d.gate.title)) err(f, 'gate.title doit être une chaîne non vide');
    if (d.gate.message !== undefined && typeof d.gate.message !== 'string') err(f, 'gate.message doit être une chaîne');
  }
  if (d.theme !== undefined && d.theme.accent !== undefined && !isHex(d.theme.accent)) err(f, `theme.accent doit être #RRGGBB (${d.theme && d.theme.accent})`);
  const e = d.event;
  if (e !== undefined) {
    if (!isStr(e.id) || !isStr(e.title) || !isStr(e.message)) err(f, 'event.id / title / message requis');
    if (e.startsAt !== undefined && !isDate(e.startsAt)) err(f, 'event.startsAt doit être une date ISO');
    if (e.endsAt !== undefined && !isDate(e.endsAt)) err(f, 'event.endsAt doit être une date ISO');
    if (e.color !== undefined && !isHex(e.color)) err(f, 'event.color doit être #RRGGBB');
    if (e.url !== undefined && !isHttps(e.url)) err(f, 'event.url doit être une URL https');
  }
}

/* ── news.json ── */
function checkNews() {
  const f = 'news.json';
  const d = load(f);
  if (!d) return;
  if (!Array.isArray(d.news)) { err(f, 'clé news (tableau) manquante'); return; }
  const ids = new Set();
  d.news.forEach((n, i) => {
    const w = `news[${i}]`;
    if (!isStr(n.id)) err(f, `${w}.id manquant`);
    else if (ids.has(n.id)) err(f, `id en double : ${n.id}`);
    else ids.add(n.id);
    if (!isStr(n.title)) err(f, `${w}.title manquant`);
    if (!isStr(n.body)) err(f, `${w}.body manquant`);
    if (!isDate(n.date)) err(f, `${w}.date doit être une date ISO`);
    if (n.tags !== undefined && (!Array.isArray(n.tags) || n.tags.some((t) => !isStr(t)))) err(f, `${w}.tags doit être un tableau de chaînes`);
  });
}

/* ── changelog.json ── */
function checkChangelog() {
  const f = 'changelog.json';
  const d = load(f);
  if (!d) return;
  if (!Array.isArray(d.entries)) { err(f, 'clé entries (tableau) manquante'); return; }
  const ids = new Set();
  d.entries.forEach((e, i) => {
    const w = `entries[${i}]`;
    if (!isStr(e.id)) err(f, `${w}.id manquant`);
    else if (ids.has(e.id)) err(f, `id en double : ${e.id}`);
    else ids.add(e.id);
    if (e.target !== 'launcher' && e.target !== 'modpack') err(f, `${w}.target doit être launcher ou modpack`);
    if (!isSemver(e.version)) err(f, `${w}.version invalide`);
    if (!isDate(e.date)) err(f, `${w}.date doit être une date ISO`);
    if (!isStr(e.title)) err(f, `${w}.title manquant`);
    if (!Array.isArray(e.changes) || e.changes.length === 0 || e.changes.some((c) => !isStr(c))) err(f, `${w}.changes doit être un tableau non vide de chaînes`);
  });
}

/* ── blocklist.json / optional.json ── */
function checkSimpleList(f, key) {
  const d = load(f);
  if (!d) return;
  if (!Array.isArray(d[key])) err(f, `clé ${key} (tableau) manquante`);
}

/* ── blocklist.json : chaque règle doit cibler UN critère précis (une règle trop large bloquerait tout le monde) ── */
function checkBlocklist() {
  const f = 'blocklist.json';
  const d = load(f);
  if (!d) return;
  if (!Array.isArray(d.entries)) { err(f, 'clé entries (tableau) manquante'); return; }
  const okScopes = ['mods', 'resourcepacks', 'shaderpacks'];
  d.entries.forEach((en, i) => {
    const w = `entries[${i}]`;
    if (!en || typeof en !== 'object') { err(f, `${w} doit être un objet`); return; }
    const mt = en.match;
    if (!mt || typeof mt !== 'object') { err(f, `${w}.match requis`); return; }
    const keys = ['contains', 'fileName', 'sha1'].filter((k) => mt[k] !== undefined);
    if (keys.length !== 1) err(f, `${w}.match doit avoir exactement un critère (contains, fileName ou sha1)`);
    else {
      if (mt.contains !== undefined && !(isStr(mt.contains) && mt.contains.trim().length >= 2)) err(f, `${w}.match.contains doit faire au moins 2 caractères`);
      if (mt.fileName !== undefined && !isStr(mt.fileName)) err(f, `${w}.match.fileName ne peut pas être vide`);
      if (mt.sha1 !== undefined && !isSha1(mt.sha1)) err(f, `${w}.match.sha1 doit faire 40 caractères hexadécimaux`);
    }
    if (en.scope !== undefined && (!Array.isArray(en.scope) || en.scope.length === 0 || en.scope.some((x) => !okScopes.includes(x)))) err(f, `${w}.scope doit lister mods / resourcepacks / shaderpacks`);
  });
}

/* ── manifest.json ── */
function checkManifest() {
  const f = 'manifest.json';
  const d = load(f);
  if (!d) return;
  if (!isSemver(d.version)) err(f, `version invalide (${d.version})`);
  if (!Array.isArray(d.files)) { err(f, 'files doit être un tableau'); return; }
  if (d.files.length === 0) { console.log('ℹ️  manifest.json : pack vide (0 fichier) — autorisé, à recomposer.'); return; }
  const paths = new Set();
  d.files.forEach((x, i) => {
    const w = `files[${i}]`;
    if (!isStr(x.path)) err(f, `${w}.path manquant`);
    else {
      if (x.path.split('/').includes('..') || x.path.startsWith('/') || x.path.includes('\\')) err(f, `${w}.path suspect (${x.path})`);
      if (paths.has(x.path)) err(f, `path en double : ${x.path}`);
      paths.add(x.path);
    }
    if (!isSha1(x.sha1)) err(f, `${w}.sha1 doit faire 40 caractères hexadécimaux`);
    if (!Number.isFinite(x.size) || x.size < 0) err(f, `${w}.size doit être un nombre positif`);
    if (!isHttps(x.url)) err(f, `${w}.url doit être une URL https`);
    if (x.mod !== undefined && (!isStr(x.mod.id) || !isStr(x.mod.name))) err(f, `${w}.mod.id / name manquants`);
  });
}

/* ── challenges.json (optionnel : absent = pas de défis) ── */
function checkChallenges() {
  const f = 'challenges.json';
  if (!fs.existsSync(f)) return;
  const d = load(f);
  if (!d) return;
  if (!Array.isArray(d.challenges)) { err(f, 'challenges doit être une liste'); return; }
  const ok = ['mobKills', 'diamonds', 'fishCaught', 'totalPlayMinutes', 'uniquePlayers', 'peak', 'distTotM', 'adv', 'elytraM', 'playerKills'];
  const ids = new Set();
  const reItem = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
  d.challenges.forEach((c, i) => {
    const w = `défi ${i + 1}`;
    if (!c || !isStr(c.title)) err(f, `${w} : titre requis`);
    if (!c || !ok.includes(c.metric)) err(f, `${w} : métrique invalide (${ok.join(', ')})`);
    if (!c || !(Number.isFinite(c.target) && c.target > 0)) err(f, `${w} : cible doit être un nombre > 0`);
    if (c && c.id != null) { if (ids.has(c.id)) err(f, `identifiant en double : ${c.id}`); else ids.add(c.id); }
    if (c && c.from != null && !isDate(c.from)) err(f, `${w} : date de début invalide`);
    if (c && c.to != null && !isDate(c.to)) err(f, `${w} : date de fin invalide`);
    if (c && c.grant != null) {
      if (typeof c.grant !== 'object' || Array.isArray(c.grant)) { err(f, `${w} : grant doit être un objet`); }
      else {
        if (c.id == null) err(f, `${w} : un défi avec récompense en jeu (grant) doit avoir un id`);
        if (c.grant.items != null) {
          if (!Array.isArray(c.grant.items)) err(f, `${w} : grant.items doit être une liste`);
          else c.grant.items.forEach((it, j) => {
            if (!it || !isStr(it.id) || !reItem.test(it.id)) err(f, `${w}, objet ${j + 1} : id invalide (ex. minecraft:diamond)`);
            if (!it || !(Number.isFinite(it.count) && it.count > 0)) err(f, `${w}, objet ${j + 1} : count doit être > 0`);
          });
        }
      }
    }
  });
}

/* ── items.json (optionnel : généré par /meysonde items) ── */
function checkItems() {
  const f = 'items.json';
  if (!fs.existsSync(f)) return;
  const d = load(f);
  if (!d) return;
  if (!Array.isArray(d.items)) { err(f, 'items doit être une liste'); return; }
  const bad = d.items.filter((x) => typeof x !== 'string' || !x.includes(':'));
  if (bad.length) err(f, `${bad.length} entrée(s) d'objet invalide(s) (attendu « namespace:objet »)`);
}

/* ── Cohérence croisée : la version du pack doit être LA MÊME partout ──
   (manifest.json = liste des fichiers, launcher.json = version annoncée aux joueurs ;
   une divergence = deux versions différentes affichées dans le launcher) */
function checkCrossVersions() {
  const man = load('manifest.json');
  const lch = load('launcher.json');
  if (!man || !lch || !lch.modpack) return; // les erreurs de structure sont déjà signalées par ailleurs
  if (man.version !== lch.modpack.version) {
    err('manifest.json', `version (${man.version}) différente de launcher.json modpack.version (${lch.modpack.version}) — les joueurs verraient deux versions`);
  }
}

checkLauncher();
checkNews();
checkChangelog();
checkBlocklist();
if (fs.existsSync('optional.json')) checkSimpleList('optional.json', 'items');
checkManifest();
checkChallenges();
checkItems();
checkCrossVersions();

if (problems.length === 0) {
  console.log('✔ Fichiers JSON valides. Les joueurs peuvent dormir tranquilles.');
  process.exit(0);
}
console.error(`✖ ${problems.length} problème(s) détecté(s) :\n`);
for (const p of problems) console.error('  - ' + p);
process.exit(1);
