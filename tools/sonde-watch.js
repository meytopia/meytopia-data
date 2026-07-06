#!/usr/bin/env node
/* Surveillance du serveur Meytopia (lancé par .github/workflows/sonde-watch.yml toutes les ~10 min).
   Lit live.json (branche stats, publié par la sonde toutes les 3 min) et décide :
   - online:false               → arrêt PROPRE (volontaire) : pas d'alerte, on ferme une éventuelle alerte ouverte
   - online:true + frais ≤15min → tout va bien : on ferme une éventuelle alerte ouverte (« rétabli »)
   - online:true + muet >15min  → panne présumée (crash/gel/coupure) : issue GitHub + message Discord
   L'issue ouverte sert d'état anti-spam (une seule alerte par panne) ET d'historique des pannes.
   Discord : optionnel (secret DISCORD_WEBHOOK) — sans lui, l'issue seule fait foi. */
'use strict';

const net = require('net');
const dns = require('dns').promises;
const fs = require('fs');

const REPO = process.env.GITHUB_REPOSITORY || 'meytopia/meytopia-data';
const TOKEN = process.env.GITHUB_TOKEN;
const WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const LABEL = 'sonde-alerte';
const TITLE = '🔴 Serveur injoignable';
const REMINDERS = [5, 15, 30, 60]; // rappels échelonnés (minutes) tant que le serveur reste injoignable

async function gh(pathname, opts = {}) {
  const res = await fetch('https://api.github.com' + pathname, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error('GitHub ' + res.status + ' sur ' + pathname);
  return res.status === 204 ? null : res.json();
}

async function discord(content) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) { console.log('Discord injoignable (non bloquant) :', e.message); }
}

async function openIssues() {
  const list = await gh(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=10`);
  return Array.isArray(list) ? list : [];
}
// Filtré par TITRE : le label est partagé avec l'alerte « site pas à jour » (garde Pages) —
// sans ce filtre, l'une serait prise pour l'autre.
async function openAlert() {
  return (await openIssues()).find((i) => i.title === TITLE) || null;
}

/* ── Garde GitHub Pages : le site (régie + pages publiques) doit suivre main ──
   Pages a déjà raté 4 déploiements en 24 h EN SILENCE (échec ou build coincé) : la page servait
   une vieille version sans que personne ne le sache. À chaque passage (10 min), on vérifie le
   dernier build ; raté/coincé/en retard → on RELANCE un build (le remède qui marche à chaque
   fois). Si ça dure malgré les relances (> 45 min de retard), une issue prévient l'admin.
   Best-effort : ce garde ne doit JAMAIS empêcher la surveillance de panne serveur de tourner. */
const PAGES_TITLE = '🔴 Site pas à jour (GitHub Pages en panne)';
async function checkPages() {
  try {
    const build = await gh(`/repos/${REPO}/pages/builds/latest`).catch(() => null);
    if (!build || !build.status) { console.log('Pages : état illisible — passage sans action.'); return; }
    const head = await gh(`/repos/${REPO}/commits/main`);
    const headAgeMin = Math.round((Date.now() - new Date(head.commit.committer.date).getTime()) / 60000);
    const buildAgeMin = Math.round((Date.now() - new Date(build.created_at).getTime()) / 60000);
    // 'queued' = en file (c'est AUSSI l'état d'un build coincé, et celui que renvoie notre relance) :
    // à traiter comme 'building', jamais comme sain.
    const enCours = build.status === 'building' || build.status === 'queued';
    const aJour = build.status === 'built' && build.commit === head.sha;
    const enRetard = build.status === 'built' && build.commit !== head.sha && headAgeMin > 15;
    const enPanne = build.status === 'errored' || (enCours && buildAgeMin > 10) || enRetard;
    const pagesIssue = (await openIssues()).find((i) => i.title === PAGES_TITLE) || null;
    // L'issue ne se ferme QUE quand le site sert VRAIMENT la dernière version — pas sur un simple
    // build en cours (qui peut encore échouer) : sinon flip-flop « reparti »/« cassé » et faux espoirs.
    if (aJour) {
      if (pagesIssue) {
        await gh(`/repos/${REPO}/issues/${pagesIssue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: '✅ Le site est reparti et sert la dernière version. Fin de l\'alerte.' }) });
        await gh(`/repos/${REPO}/issues/${pagesIssue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      }
      console.log('Pages : OK (à jour).');
      return;
    }
    if (!enPanne) {
      console.log(`Pages : en cours (${build.status}, il y a ${buildAgeMin} min) — on laisse finir.`);
      return;
    }
    console.log(`Pages : problème (status=${build.status}, build il y a ${buildAgeMin} min, dernier commit il y a ${headAgeMin} min) → relance d'un build.`);
    await gh(`/repos/${REPO}/pages/builds`, { method: 'POST' }).catch((e) => console.log('Relance refusée (non bloquant) :', e.message));
    // Durée RÉELLE de la panne : depuis combien de temps main n'est-il pas servi ? Le dernier build
    // ne suffit pas (chaque relance remettrait le chrono à zéro) : on regarde le dernier build RÉUSSI.
    let dureDepuisMin = headAgeMin;
    try {
      const builds = await gh(`/repos/${REPO}/pages/builds?per_page=10`);
      const ok = Array.isArray(builds) ? builds.find((b) => b && b.status === 'built') : null;
      if (ok && ok.commit === head.sha) dureDepuisMin = 0; // la dernière version est en fait déjà servie
    } catch (e) { /* estimation par headAgeMin conservée */ }
    // Toujours cassé depuis > 45 min malgré les relances des passages précédents → on prévient (une seule fois).
    if (!pagesIssue && dureDepuisMin > 45) {
      const body = [
        'La publication du site (GitHub Pages) échoue ou reste coincée depuis plus de 45 minutes,',
        'malgré les relances automatiques toutes les 10 minutes.',
        '',
        '**Conséquence** : la régie et les pages publiques servent une ANCIENNE version — les dernières publications ne sont pas visibles.',
        '**Rien à faire côté Meytopia** : c\'est la machinerie GitHub qui patine (vérifier https://www.githubstatus.com).',
        'Cette issue se fermera toute seule dès que le site sera reparti.',
      ].join('\n');
      const issue = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: PAGES_TITLE, body, labels: [LABEL] }) });
      await discord(`🟠 **Meytopia** — le site (régie/pages publiques) n'arrive plus à se mettre à jour depuis ${dureDepuisMin} min (panne GitHub Pages). Relances automatiques en cours. ${issue.html_url}`);
      console.log('Alerte site créée : #' + issue.number);
    }
  } catch (e) {
    console.log('Garde Pages en échec (non bloquant) :', e.message);
  }
}

function fmtParis(iso) {
  try { return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

/* ── Ping DIRECT du serveur (indépendant de la sonde) : protocole « Server List Ping » de Minecraft.
   Le serveur répond → en ligne. Refus / timeout / gel → hors ligne. net + dns natifs, zéro dépendance. ── */
function mcStatusPing(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { socket.destroy(); } catch { /* ignore */ } resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('connect', () => {
      try {
        const varint = (num) => { const out = []; let n = num >>> 0; do { let t = n & 0x7f; n >>>= 7; if (n) t |= 0x80; out.push(t); } while (n); return Buffer.from(out); };
        const hb = Buffer.from(host, 'utf8');
        const data = Buffer.concat([varint(0), varint(47), varint(hb.length), hb, Buffer.from([(port >> 8) & 0xff, port & 0xff]), varint(1)]);
        socket.write(Buffer.concat([varint(data.length), data])); // handshake (prochain état = status)
        socket.write(Buffer.concat([varint(1), varint(0)]));       // status request
      } catch { finish(false); }
    });
    socket.on('data', () => finish(true)); // le serveur nous répond → il est vivant
  });
}
async function serverReachable(host, port) {
  let target = host, tport = port || 25565;
  // meytopia.fr est SRV-only : on résout le SRV pour trouver l'hôte:port réel du serveur.
  try { const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`); if (srv && srv[0]) { target = srv[0].name; tport = srv[0].port; } }
  catch { /* pas de SRV : on tente host:port direct */ }
  // 3 essais (une seule réussite suffit) → pas de fausse alerte sur un aléa réseau du runner GitHub.
  for (let i = 0; i < 3; i++) {
    if (await mcStatusPing(target, tport, 5000)) return true;
    if (i < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
function serverConfig() {
  try { const l = JSON.parse(fs.readFileSync('launcher.json', 'utf8')); if (l && l.server && l.server.host) return { host: l.server.host, port: l.server.port || 25565 }; }
  catch { /* défaut ci-dessous */ }
  return { host: 'meytopia.fr', port: 25598 };
}
// État d'escalade rangé (invisible) dans le corps de l'issue d'alerte : quand la panne a commencé + paliers déjà notifiés.
const MARK_RE = /<!--\s*watch:\s*downSince=(\S+)\s+notified=([\d,]*)\s*-->/;
function parseState(body) { const m = MARK_RE.exec(body || ''); return m ? { downSince: m[1], notified: m[2] ? m[2].split(',').map(Number) : [] } : null; }
function marker(downSince, notified) { return `<!-- watch: downSince=${downSince} notified=${notified.join(',')} -->`; }
// Quels paliers de rappel sont dus MAINTENANT (dépassés et pas encore notifiés) ?
function dueReminders(downSinceIso, notified, nowMs) {
  const elapsed = Math.round((nowMs - new Date(downSinceIso).getTime()) / 60000);
  return { elapsed, due: REMINDERS.filter((t) => elapsed >= t && !(notified || []).includes(t)) };
}

async function main() {
  // Mode TEST du webhook (lancement manuel avec la case cochée) : on envoie un message d'essai et on
  // s'arrête là. Verdict CLAIR dans les logs Actions — pas de « catch » silencieux, contrairement aux
  // vraies alertes (non bloquantes). Sert à vérifier que le secret DISCORD_WEBHOOK est bon.
  if (process.env.TEST_DISCORD === 'true') {
    if (!WEBHOOK) { console.log('❌ TEST : le secret DISCORD_WEBHOOK est vide ou absent. Vérifie son nom EXACT dans Settings → Secrets → Actions.'); process.exit(1); }
    try {
      const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '🔔 **Meytopia** — test du webhook Discord réussi ! Si tu vois ce message, les alertes de panne du serveur arriveront bien ici. 🎉' }) });
      if (r.ok) { console.log('✅ TEST : message envoyé (HTTP ' + r.status + '). Regarde ton salon Discord.'); return; }
      console.log('❌ TEST : Discord a refusé (HTTP ' + r.status + '). L\'URL du webhook est peut-être invalide ou supprimée — recrée le webhook et recolle l\'URL dans le secret.'); process.exit(1);
    } catch (e) { console.log('❌ TEST : impossible de joindre Discord : ' + e.message); process.exit(1); }
  }

  // 0) Garde Pages (site à jour) — AVANT la lecture de live.json : même si la sonde n'a jamais
  //    publié, le site doit être surveillé. Best-effort, jamais bloquant.
  await checkPages();

  // 1) Ping DIRECT du serveur = source de vérité (ne dépend plus de la sonde). En plus, on lit
  //    live.json UNIQUEMENT pour savoir si un arrêt PROPRE a été signalé (libellé « éteint » vs « crash »).
  const { host, port } = serverConfig();
  const reachable = await serverReachable(host, port);
  let cleanStop = false;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/stats/live.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) { const live = await res.json(); cleanStop = !!(live && live.online === false); }
  } catch { /* live.json optionnel ici */ }

  const alert = await openAlert();
  console.log(`Ping ${host}:${port} → ${reachable ? 'EN LIGNE' : 'INJOIGNABLE'} · arrêt propre signalé : ${cleanStop} · alerte ouverte : ${alert ? '#' + alert.number : 'aucune'}`);

  // 2) Serveur EN LIGNE → on ferme une éventuelle alerte (« de retour »).
  if (reachable) {
    if (alert) {
      await gh(`/repos/${REPO}/issues/${alert.number}/comments`, { method: 'POST', body: JSON.stringify({ body: '✅ Le serveur répond à nouveau. Fin de l\'alerte.' }) });
      await gh(`/repos/${REPO}/issues/${alert.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      await discord('✅ **Meytopia est de retour !** Le serveur répond à nouveau.');
    }
    console.log('Serveur en ligne — rien à signaler.');
    return;
  }

  // 3) Serveur INJOIGNABLE, PREMIÈRE détection → alerte immédiate (« dès qu'il est off »).
  if (!alert) {
    const nowIso = new Date().toISOString();
    const body = [
      `Le serveur **${host}** ne répond plus (test de connexion direct).`,
      cleanStop ? 'La sonde signalait un **arrêt propre** — c\'est peut-être volontaire (maintenance).' : 'Aucun arrêt propre signalé → **crash / coupure présumé**.',
      '',
      'Je te préviens à nouveau si ça dure : **5 min, 15 min, 30 min, 1 h**.',
      'Cette issue se ferme toute seule dès que le serveur répond.',
      '',
      marker(nowIso, []),
    ].join('\n');
    const issue = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: TITLE, body, labels: [LABEL] }) });
    await discord(`${cleanStop ? '🟠' : '🔴'} **Meytopia ne répond plus.** ${cleanStop ? '(arrêt propre — volontaire ?)' : '(crash / coupure présumé)'} — rappels à 5, 15, 30 min et 1 h si ça dure. ${issue.html_url}`);
    console.log('Alerte créée : #' + issue.number);
    return;
  }

  // 4) Alerte DÉJÀ ouverte → rappel échelonné selon la durée d'indisponibilité (5/15/30 min, 1 h).
  const st = parseState(alert.body) || { downSince: alert.created_at, notified: [] };
  const { elapsed, due } = dueReminders(st.downSince, st.notified, Date.now());
  if (!due.length) { console.log(`Toujours injoignable (~${elapsed} min) — aucun nouveau palier de rappel.`); return; }
  const top = Math.max(...due);
  const label = top >= 60 ? `${Math.round(top / 60)} h` : `${top} min`;
  await discord(`⏰ **Meytopia** toujours injoignable depuis ~${label}. ${alert.html_url}`);
  const notified = Array.from(new Set(st.notified.concat(due))).sort((a, b) => a - b);
  const newBody = MARK_RE.test(alert.body || '') ? alert.body.replace(MARK_RE, marker(st.downSince, notified)) : ((alert.body || '') + '\n\n' + marker(st.downSince, notified));
  await gh(`/repos/${REPO}/issues/${alert.number}`, { method: 'PATCH', body: JSON.stringify({ body: newBody }) });
  await gh(`/repos/${REPO}/issues/${alert.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `⏰ Toujours injoignable depuis ~${label}.` }) });
  console.log(`Palier(s) ${due.join(', ')} min notifié(s).`);
}

if (require.main === module) {
  main().catch((e) => { console.error('sonde-watch en échec :', e.message); process.exit(1); });
}
module.exports = { mcStatusPing, serverReachable, parseState, marker, dueReminders, MARK_RE, REMINDERS };
