# Publier le pack (sans toucher au PC)

Le workflow **« Publier le pack »** (`.github/workflows/publier-pack.yml`) assemble le modpack
depuis des **liens** (lien direct `.jar` ou **CurseForge**), crée la release, et régénère
`manifest.json` / `launcher.json` / `changelog.json`. Aucun fichier ne transite par le navigateur :
la régie envoie juste une requête, GitHub fait le travail.

Publication **incrémentale** : seuls les mods ajoutés/mis à jour sont téléversés sur le nouveau
tag `pack-x.y.z` ; les fichiers inchangés gardent leur URL (pas de re-upload du pack entier).

## Pré-requis (une seule fois)

1. **Déclenchement depuis la régie (Vague C2)** : le jeton collé dans la régie doit être un
   **Personal Access Token *classic* avec le scope `repo`** (il inclut la permission Actions
   nécessaire à `workflow_dispatch`). Un fine-grained limité à « Contents » ne suffit pas.
   → https://github.com/settings/tokens → *Generate new token (classic)* → cocher **repo**.

2. **CurseForge** (seulement si tu ajoutes des mods CurseForge) : générer une clé API CurseForge
   (gratuite) sur https://console.curseforge.com/ puis l'ajouter dans le dépôt :
   *Settings → Secrets and variables → Actions → New repository secret* →
   nom **`CURSEFORGE_API_KEY`**, valeur = la clé. (Les liens directs `.jar` n'en ont pas besoin.)

## Tester maintenant (sans la régie)

Onglet **Actions** du dépôt → **Publier le pack** → *Run workflow* :
- **request** = un JSON (voir ci-dessous),
- **dry_run** = **true** (laisse coché pour une simulation sûre la première fois).

En `dry_run`, le workflow télécharge/calcule tout et affiche le **plan** dans les logs, mais
**ne publie ni ne committe rien**. Mets `dry_run=false` pour publier pour de vrai.

## Format de la requête

```jsonc
// Ajouter des mods (lien direct + CurseForge)
{
  "mode": "add",
  "items": [
    { "source": "url", "url": "https://example.com/mon-mod-1.2.3.jar", "version": "1.2.3" },
    { "source": "curseforge", "url": "https://www.curseforge.com/minecraft/mc-mods/jei/files/6543210" }
  ]
}

// Mettre à jour un mod (manuel) : retire l'ancien, ajoute le nouveau
{
  "mode": "update",
  "items": [
    { "source": "url", "url": "https://example.com/sodium-0.6.2.jar", "replaces": "mods/sodium-0.6.0.jar" }
  ]
}

// Remplacer TOUT le pack (tous les mods/ actuels sont retirés, remplacés par cette liste ;
// les fichiers non-mods comme config/ sont conservés)
{
  "mode": "replace",
  "items": [
    { "source": "curseforge", "url": ".../files/111" },
    { "source": "url", "url": "https://.../autre.jar" }
  ]
}
```

Champs d'un item : `source` (`"url"` ou `"curseforge"`), `url`, et en option `path`
(emplacement, défaut `mods/<nom du fichier>`), `version`, `replaces` (chemin du mod remplacé).

## Sécurité

- `dry_run=true` par défaut : on simule avant de publier.
- `replace` est **destructif** (retire tous les mods actuels) — à confirmer dans la régie (Vague C2).
- Les JSON régénérés sont **revalidés** par `valider.js` avant le commit (garde-fou CI).
