#!/usr/bin/env node
/* Surveillance du serveur Meytopia (lancé par .github/workflows/sonde-watch.yml toutes les ~10 min).
   Lit live.json (branche stats, publié par la sonde toutes les 3 min) et décide :
   - online:false               → arrêt PROPRE (volontaire) : pas d'alerte, on ferme une éventuelle alerte ouverte
   - online:true + frais ≤15min → tout va bien : on ferme une éventuelle alerte ouverte (« rétabli »)
   - online:true + muet >15min  → panne présumée (crash/gel/coupure) : issue GitHub + message Discord
   L'issue ouverte sert d'état anti-spam (une seule alerte par panne) ET d'historique des pannes.
   Discord : optionnel (secret DISCORD_WEBHOOK) — sans lui, l'issue seule fait foi. */
'use strict';

const REPO = process.env.GITHUB_REPOSITORY || 'meytopia/meytopia-data';
const TOKEN = process.env.GITHUB_TOKEN;
const WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const STALE_MIN = 15; // la sonde bat toutes les 3 min → 5 battements manqués = panne présumée
const LABEL = 'sonde-alerte';
const TITLE = '🔴 Serveur injoignable (sonde muette)';

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

async function openAlert() {
  const list = await gh(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=5`);
  return Array.isArray(list) && list.length ? list[0] : null;
}

function fmtParis(iso) {
  try { return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

(async () => {
  // 1) Lire live.json (cache-buster : raw.githubusercontent cache ~5 min)
  let live = null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/stats/live.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) live = await res.json();
  } catch (e) { /* réseau/branche absente → traité ci-dessous */ }

  if (!live || !live.updatedAt) {
    console.log('live.json indisponible ou sans updatedAt — la sonde n\'a peut-être jamais publié. Aucune action.');
    return;
  }

  const ageMin = Math.round((Date.now() - new Date(live.updatedAt).getTime()) / 60000);
  const alert = await openAlert();
  console.log(`live.json : online=${live.online} · dernier battement il y a ${ageMin} min · alerte ouverte : ${alert ? '#' + alert.number : 'aucune'}`);

  // 2) Serveur éteint PROPREMENT → jamais d'alerte ; on solde une éventuelle panne passée.
  if (live.online === false) {
    if (alert) {
      await gh(`/repos/${REPO}/issues/${alert.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ Le serveur a été arrêté proprement (dernier battement : ${fmtParis(live.updatedAt)}). Fin de l'alerte.` }) });
      await gh(`/repos/${REPO}/issues/${alert.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      await discord(`✅ **Meytopia** — fin d'alerte : le serveur a été arrêté proprement.`);
    }
    return;
  }

  // 3) Sonde fraîche → tout va bien ; on ferme une éventuelle alerte (« rétabli »).
  if (ageMin <= STALE_MIN) {
    if (alert) {
      await gh(`/repos/${REPO}/issues/${alert.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ Rétabli : la sonde publie à nouveau (dernier battement : ${fmtParis(live.updatedAt)}).` }) });
      await gh(`/repos/${REPO}/issues/${alert.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      await discord(`✅ **Meytopia est de retour !** Le serveur répond à nouveau.`);
    }
    return;
  }

  // 4) Panne présumée : dernier état « en ligne » mais plus aucun battement depuis > 15 min.
  if (alert) { console.log('Panne déjà signalée (#' + alert.number + ') — pas de re-notification.'); return; }
  const body = [
    `La sonde n'a plus publié depuis **${ageMin} min** alors que le dernier état du serveur était **en ligne**.`,
    ``,
    `- Dernier battement : ${fmtParis(live.updatedAt)} (Europe/Paris)`,
    `- Causes possibles : crash du serveur, gel (freeze), coupure réseau/hébergeur, panne GitHub côté sonde.`,
    ``,
    `Cette issue se fermera automatiquement dès que la sonde publiera à nouveau (ou après un arrêt propre).`,
  ].join('\n');
  const issue = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: TITLE, body, labels: [LABEL] }) });
  await discord(`🔴 **Meytopia ne répond plus !** Aucun battement de la sonde depuis ${ageMin} min (dernier état : en ligne). Détails : ${issue.html_url}`);
  console.log('Alerte créée : #' + issue.number);
})().catch((e) => { console.error('sonde-watch en échec :', e.message); process.exit(1); });
