#!/usr/bin/env node
/* ============================================================
 * Meytopia — packtool.js  (Vague C : composer le pack sans PC)
 * Lancé par le GitHub Action « Publier le pack » (publier-pack.yml).
 * Lit une requête JSON (env PACK_REQUEST), résout/télécharge les mods
 * (lien direct ou CurseForge), calcule sha1/taille, lit l'identité du
 * .jar, téléverse les NOUVEAUX fichiers sur une release pack-<version>,
 * puis régénère manifest.json / launcher.json / changelog.json.
 *
 * Publication INCRÉMENTALE : seuls les fichiers ajoutés/mis à jour sont
 * téléversés sur le nouveau tag ; les fichiers inchangés gardent leur URL.
 *
 * Sûr par défaut : DRY_RUN=true → simule tout, n'écrit/ne publie rien.
 *
 * Env : PACK_REQUEST (JSON requis), DRY_RUN ('true'/'false'),
 *       GH_TOKEN (pour gh), CURSEFORGE_API_KEY (optionnel), REPO (owner/name).
 * ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = process.env.REPO || 'meytopia/meytopia-data';
const DRY = String(process.env.DRY_RUN || 'true') !== 'false';
const CF_KEY = process.env.CURSEFORGE_API_KEY || '';

const log = (...a) => console.log('[packtool]', ...a);
function die(msg) { writeStatus('error', msg); console.error('[packtool] ERREUR :', msg); process.exit(1); }

/* ---------- helpers purs (testables) ---------- */
function bump(version, kind) {
  const p = String(version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  if (kind === 'minor') return `${p[0] || 0}.${(p[1] || 0) + 1}.0`;
  return `${p[0] || 0}.${p[1] || 0}.${(p[2] || 0) + 1}`;
}
function assetName(p) { return String(p).split('/').join('_'); }
function assetUrl(tag, p) { return `https://github.com/${REPO}/releases/download/${tag}/${assetName(p)}`; }
function parseCurseforge(item) {
  let slug = item.slug || null, fileId = item.fileId || null, projectId = item.projectId || null, category = item.category || null;
  if (item.url) {
    // Toute catégorie CurseForge (mc-mods, texture-packs, shaders, customization…), /files/<id> ou /download/<id>.
    const m = String(item.url).match(/curseforge\.com\/minecraft\/([^/]+)\/([^/]+)\/(?:files|download)\/(\d+)/i);
    if (m) { category = category || m[1]; slug = slug || m[2]; fileId = fileId || m[3]; }
  }
  return { slug, fileId, projectId, category };
}
// Dossier déduit de la catégorie CurseForge (défaut : mod).
function typeFromCategory(cat) {
  const c = String(cat || '').toLowerCase();
  if (c === 'texture-packs') return 'resourcepack';
  if (c === 'shaders') return 'shaderpack';
  return 'mod';
}
// .jar/.zip = archive ZIP → signature « PK ». Sinon (page HTML d'erreur renvoyée par CurseForge sur un
// lien direct, par ex.), on REFUSE : jamais de fichier bidon publié.
function looksLikeZip(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
    && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}
function forgeCdnUrl(fileId, fileName) {
  const s = String(fileId);
  return `https://edge.forgecdn.net/files/${s.slice(0, 4)}/${String(parseInt(s.slice(4), 10))}/${fileName}`;
}
// Fusionne la liste de fichiers selon le mode. currentFiles inchangé.
function applyMode(currentFiles, mode, added, removePaths) {
  const remove = new Set(removePaths || []);
  if (mode === 'replace') for (const f of currentFiles) if (String(f.path).startsWith('mods/')) remove.add(f.path);
  const addedPaths = new Set(added.map((a) => a.path));
  const kept = currentFiles.filter((f) => !remove.has(f.path) && !addedPaths.has(f.path));
  return kept.concat(added);
}

/* ---------- réseau / IO (intégration) ---------- */
async function httpGetJson(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}
async function downloadBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`téléchargement ${res.status} : ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }
function readModInfo(buf) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buf);
    const e = zip.getEntry('META-INF/neoforge.mods.toml') || zip.getEntry('META-INF/mods.toml');
    if (!e) return null;
    const t = e.getData().toString('utf8');
    const id = (t.match(/modId\s*=\s*"([^"]+)"/) || [])[1];
    const name = (t.match(/displayName\s*=\s*"([^"]+)"/) || [])[1];
    if (id && name) return { id, name };
    return null;
  } catch { return null; }
}
async function resolveItem(item) {
  // Une URL curseforge.com n'est JAMAIS un fichier direct téléchargeable (page web protégée / 403) : on
  // passe TOUJOURS par l'API CurseForge — que le "source" soit "curseforge" OU un lien direct collé.
  const isCf = item.source === 'curseforge' || /curseforge\.com\/minecraft\//i.test(item.url || '');
  if (isCf) {
    const cf = parseCurseforge(item);
    if (!cf.fileId) throw new Error('CurseForge : numéro de fichier introuvable dans l\'URL (attendu .../download/<numéro> ou .../files/<numéro>)');
    if (!CF_KEY) throw new Error('CurseForge : clé API manquante (secret CURSEFORGE_API_KEY). Ajoute-la au dépôt, ou colle un lien de téléchargement DIRECT (Modrinth, finissant par .zip/.jar).');
    let modId = cf.projectId;
    if (!modId && cf.slug) {
      const r = await httpGetJson(`https://api.curseforge.com/v1/mods/search?gameId=432&slug=${encodeURIComponent(cf.slug)}`, { 'x-api-key': CF_KEY, Accept: 'application/json' });
      modId = r.data && r.data[0] && r.data[0].id;
    }
    if (!modId) throw new Error('CurseForge : projet introuvable (slug ' + cf.slug + ')');
    const fr = await httpGetJson(`https://api.curseforge.com/v1/mods/${modId}/files/${cf.fileId}`, { 'x-api-key': CF_KEY, Accept: 'application/json' });
    const file = fr.data;
    const dl = file.downloadUrl || forgeCdnUrl(file.id, file.fileName);
    return { url: dl, fileName: file.fileName, type: item.type || typeFromCategory(cf.category) };
  }
  // Lien direct (Modrinth, CDN, site auteur) : l'URL https doit pointer sur le FICHIER lui-même.
  if (!/^https:\/\//.test(item.url || '')) throw new Error('lien direct : URL https requise');
  const fileName = (item.path ? String(item.path).split('/').pop() : decodeURIComponent(String(item.url).split('/').pop().split('?')[0]));
  return { url: item.url, fileName, type: item.type || 'mod' };
}

let statusWritten = null;
function writeStatus(state, message, extra) {
  statusWritten = { state, message: message || '', at: new Date().toISOString(), ...(extra || {}) };
  try { fs.writeFileSync('pack-status.json', JSON.stringify(statusWritten, null, 2) + '\n'); } catch { /* ignore */ }
}
function gh(args) { return execFileSync('gh', args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
function ensureRelease(tag) {
  try { gh(['release', 'view', tag, '--repo', REPO]); }
  catch { gh(['release', 'create', tag, '--repo', REPO, '--title', tag, '--notes', 'Assets du modpack Meytopia ' + tag]); }
}

/* ---------- orchestration ---------- */
function slugify(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item'; }

// Mode « catalogue optionnel » : résout chaque item (CurseForge / direct), téléverse les fichiers sur la
// release optional-catalog, et met à jour optional.json (le launcher les propose en installation 1-clic).
async function runOptional(items) {
  if (!items.length) die('aucun contenu optionnel fourni');
  const TYPE_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shaderpack: 'shaderpacks' };
  const tag = 'optional-catalog';
  let opt = { items: [] };
  try { opt = JSON.parse(fs.readFileSync('optional.json', 'utf8')); } catch { /* nouveau */ }
  opt.items = Array.isArray(opt.items) ? opt.items : [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opt-'));
  const uploads = [];
  const added = [];
  for (const item of items) {
    const r = await resolveItem(item); // gère CurseForge (clé API) ET lien direct
    log('↓', r.fileName, '←', r.url.slice(0, 80));
    const buf = await downloadBuffer(r.url);
    if (!looksLikeZip(buf)) throw new Error(`« ${r.fileName} » n'est pas un .zip/.jar valide (le lien renvoie une page web). CurseForge : ajoute la clé API, ou colle un lien direct (Modrinth).`);
    const type = (item.type && TYPE_DIRS[item.type]) ? item.type : (r.type || 'mod');
    const oext = type === 'mod' ? '.jar' : '.zip';
    let ofn = String(r.fileName || '').trim() || ('fichier' + oext);
    if (!new RegExp('\\' + oext + '$', 'i').test(ofn)) ofn = ofn.replace(/\.(jar|zip)$/i, '') + oext;
    const p = TYPE_DIRS[type] + '/' + ofn;
    const info = readModInfo(buf);
    const name = item.name || (info && info.name) || ofn;
    let id = item.id || (slugify(name) + '-' + type), base = id, k = 2;
    while (opt.items.some((x) => x.id === id && !(x.file && x.file.path === p))) id = base + '-' + (k++);
    opt.items = opt.items.filter((x) => !(x.file && x.file.path === p)); // remplace un doublon (même fichier)
    opt.items.push({ id, name, type, file: { path: p, url: assetUrl(tag, p), sha1: sha1(buf), size: buf.length } });
    added.push(name);
    const local = path.join(tmp, assetName(p));
    fs.writeFileSync(local, buf);
    uploads.push(local);
  }
  const summary = { target: 'optional', added, total: opt.items.length };
  log('plan catalogue :', JSON.stringify(summary));
  if (DRY) { writeStatus('dry-run', 'Simulation catalogue : ' + added.join(', '), { summary }); return; }
  ensureRelease(tag);
  for (const local of uploads) { log('⇪ upload', path.basename(local)); gh(['release', 'upload', tag, local, '--repo', REPO, '--clobber']); }
  fs.writeFileSync('optional.json', JSON.stringify(opt, null, 2) + '\n');
  writeStatus('ok', 'Catalogue mis à jour : ' + added.join(', '), { summary });
  log('✔ optional.json mis à jour — le workflow va committer.');
}

async function main() {
  if (require.main !== module) return; // import = tests, ne pas exécuter
  let req;
  try { req = JSON.parse(process.env.PACK_REQUEST || ''); }
  catch { die('PACK_REQUEST illisible (JSON attendu)'); }
  const mode = req.mode || 'add';
  if (!['add', 'replace', 'update'].includes(mode)) die('mode inconnu : ' + mode);
  const items = Array.isArray(req.items) ? req.items : [];
  if (req.target === 'optional') { await runOptional(items); return; } // catalogue optionnel (ne touche pas au pack)
  if (mode !== 'update' && !items.length && mode !== 'replace') die('aucun mod fourni');
  log(`mode=${mode} items=${items.length} dry_run=${DRY}`);

  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const oldFiles = Array.isArray(manifest.files) ? manifest.files.slice() : []; // capturé avant réécriture (pour la blocklist auto)
  const launcher = JSON.parse(fs.readFileSync('launcher.json', 'utf8'));
  const oldVersion = (launcher.modpack && launcher.modpack.version) || manifest.version || '1.0.0';
  const newVersion = bump(oldVersion, req.bump === 'minor' || mode === 'replace' ? 'minor' : 'patch');
  const tag = 'pack-' + newVersion;

  // 1) Résoudre + télécharger chaque item → entrée de manifeste
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
  const added = [];
  const uploads = [];
  const seenPaths = new Set();
  // Dossier de destination selon le type d'item : mod (.jar) → mods/, resourcepack/shaderpack
  // (.zip) → leur dossier — le launcher les installe pareil ET les active tout seul (0.33.0+).
  const MAIN_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shaderpack: 'shaderpacks' };
  const EXT = { mod: '.jar', resourcepack: '.zip', shaderpack: '.zip' };
  const addFile = (fileName, buf, item) => {
    const type = (item && item.type) || 'mod';
    const dir = MAIN_DIRS[type] || 'mods';
    // Garde-fou : on ne publie QUE de vraies archives (.jar/.zip = ZIP). Un lien qui renvoie une page web
    // (CurseForge bloque les liens directs → HTML) est REFUSÉ, jamais publié en douce.
    if (!looksLikeZip(buf)) throw new Error(`« ${fileName} » n'est pas un .zip/.jar valide (le lien renvoie une page web, pas le fichier). CurseForge : ajoute la clé API, ou colle un lien de téléchargement DIRECT (Modrinth).`);
    // Bonne extension garantie (un nom sans extension, ex. un numéro CurseForge, casserait le mod/pack côté joueur).
    let nm = String(fileName || '').trim() || ('fichier' + EXT[type]);
    if (!new RegExp('\\' + EXT[type] + '$', 'i').test(nm)) nm = nm.replace(/\.(jar|zip)$/i, '') + EXT[type];
    const p = (item && item.path) || (dir + '/' + nm);
    if (seenPaths.has(p)) { log('… doublon ignoré :', p); return; }
    seenPaths.add(p);
    const info = dir === 'mods' ? readModInfo(buf) : null; // pas de méta de mod dans un .zip de textures
    const entry = { path: p, sha1: sha1(buf), size: buf.length, url: assetUrl(tag, p) };
    if (info) entry.mod = info;
    if (item && item.version) entry.version = String(item.version);
    added.push(entry);
    const local = path.join(tmp, assetName(p));
    fs.writeFileSync(local, buf);
    uploads.push(local);
  };
  for (const item of items) {
    if (item.source === 'zip') {
      // Archive .zip contenant TOUS les mods : URL http OU fichier LOCAL (réassemblé par le workflow).
      const src = item.url || '';
      let zipBuf = null;
      if (/^https?:\/\//.test(src)) {
        log('↓ archive', src.slice(0, 80));
        for (let attempt = 1; attempt <= 5 && !zipBuf; attempt++) {
          try { zipBuf = await downloadBuffer(src); }
          catch (e) {
            if (attempt === 5) throw e;
            log('  archive pas encore disponible (essai ' + attempt + '/5)…');
            await new Promise((r) => setTimeout(r, 4000));
          }
        }
      } else {
        if (!src || !fs.existsSync(src)) throw new Error('archive .zip locale introuvable : ' + src);
        log('📦 archive locale', src);
        zipBuf = fs.readFileSync(src);
      }
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(zipBuf);
      let n = 0;
      for (const e of zip.getEntries()) {
        if (e.isDirectory) continue;
        const parts = e.entryName.split('/');
        const base = parts.pop();
        const folders = parts.map((s) => s.toLowerCase());
        if (/\.jar$/i.test(base)) { addFile(base, e.getData(), null); n++; continue; }
        // Dossiers resourcepacks/ et shaderpacks/ dans l'archive : les .zip y sont ajoutés au pack
        // (installés ET activés automatiquement par le launcher chez les joueurs).
        if (/\.zip$/i.test(base)) {
          if (folders.includes('resourcepacks')) { addFile(base, e.getData(), { type: 'resourcepack' }); n++; }
          else if (folders.includes('shaderpacks')) { addFile(base, e.getData(), { type: 'shaderpack' }); n++; }
        }
      }
      if (!n) throw new Error('archive .zip : aucun fichier de pack trouvé (.jar, ou .zip sous resourcepacks/ / shaderpacks/) dans ' + item.url);
      log('  →', n, 'fichier(s) extraits de l\'archive');
    } else {
      const r = await resolveItem(item);
      log('↓', r.fileName, '←', r.url.slice(0, 80));
      const buf = await downloadBuffer(r.url);
      addFile(r.fileName, buf, { ...item, type: r.type });
    }
  }

  // 2) Calculer le nouveau set de fichiers
  const removePaths = [];
  if (Array.isArray(req.removes)) removePaths.push(...req.removes);
  for (const it of items) if (it.replaces) removePaths.push(it.replaces);
  const newFiles = applyMode(manifest.files || [], mode, added, removePaths);

  const summary = { mode, version: newVersion, added: added.map((a) => a.path), removedApprox: removePaths.length || (mode === 'replace' ? 'tous les mods/' : 0), total: newFiles.length };
  log('plan :', JSON.stringify(summary));

  if (DRY) { writeStatus('dry-run', 'Simulation : aucun changement publié.', { summary }); log('DRY_RUN → rien de publié.'); return; }

  // 3) Publier les assets neufs sur la release du nouveau tag
  ensureRelease(tag);
  for (const local of uploads) { log('⇪ upload', path.basename(local)); gh(['release', 'upload', tag, local, '--repo', REPO, '--clobber']); }

  // 4) Régénérer les JSON
  manifest.version = newVersion;
  manifest.files = newFiles;
  manifest.generatedAt = new Date().toISOString();
  launcher.modpack = launcher.modpack || {};
  launcher.modpack.version = newVersion;
  const changelog = JSON.parse(fs.readFileSync('changelog.json', 'utf8'));
  changelog.entries = Array.isArray(changelog.entries) ? changelog.entries : [];
  const chId = 'modpack-' + newVersion;
  changelog.entries = changelog.entries.filter((e) => e.id !== chId);
  const changes = [];
  if (added.length) changes.push((mode === 'replace' ? 'Pack reconstruit : ' : 'Ajout/maj : ') + added.map((a) => (a.mod && a.mod.name) || a.path.split('/').pop()).join(', '));
  if (removePaths.length) changes.push('Retrait : ' + removePaths.map((p) => p.split('/').pop()).join(', '));
  if (!changes.length) changes.push('Mise à jour du pack.');
  changelog.entries.unshift({ id: chId, target: 'modpack', version: newVersion, date: new Date().toISOString().slice(0, 10), title: 'Modpack ' + newVersion, changes });

  fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync('launcher.json', JSON.stringify(launcher, null, 2) + '\n');
  // Blocklist auto : les mods RETIRÉS (présents avant, absents du nouveau pack) sont supprimés chez les
  // joueurs qui les avaient déjà ; les mods (ré)ajoutés sont retirés de la blocklist (anti-suppression).
  const newPaths = new Set(newFiles.map((f) => f.path));
  const addedShas = new Set(added.filter((a) => a.sha1).map((a) => String(a.sha1).toLowerCase()));
  const removedFiles = oldFiles.filter((f) => f && String(f.path).startsWith('mods/') && !newPaths.has(f.path) && f.sha1);
  let bl = {};
  try { bl = JSON.parse(fs.readFileSync('blocklist.json', 'utf8')); } catch { bl = {}; }
  bl.entries = Array.isArray(bl.entries) ? bl.entries : [];
  bl.entries = bl.entries.filter((e) => !(e && e.match && e.match.sha1 && addedShas.has(String(e.match.sha1).toLowerCase())));
  for (const f of removedFiles) {
    const sha = String(f.sha1).toLowerCase();
    if (!bl.entries.some((e) => e && e.match && e.match.sha1 && String(e.match.sha1).toLowerCase() === sha)) {
      bl.entries.push({ match: { sha1: f.sha1 }, scope: [String(f.path).split('/')[0] || 'mods'], reason: 'Retiré (remplacement du pack)' });
    }
  }
  fs.writeFileSync('blocklist.json', JSON.stringify(bl, null, 2) + '\n');
  if (removedFiles.length) log('blocklist : +' + removedFiles.length + ' mod(s) retiré(s) → supprimés chez les joueurs');

  fs.writeFileSync('changelog.json', JSON.stringify(changelog, null, 2) + '\n');
  writeStatus('ok', 'Pack publié : ' + newVersion, { summary });
  log('✔ pack', newVersion, 'prêt — le workflow va committer les JSON.');
}

main().catch((e) => die(e.message || String(e)));

module.exports = { bump, assetName, assetUrl, parseCurseforge, typeFromCategory, looksLikeZip, forgeCdnUrl, applyMode };
