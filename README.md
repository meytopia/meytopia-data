# meytopia-data

Dépôt de pilotage du **Meytopia Launcher** : le launcher lit ces fichiers à chaque démarrage.
Modifier un fichier ici = changement visible par tous les joueurs, sans mise à jour du launcher.

| Fichier | Rôle | Édité par |
|---|---|---|
| `launcher.json` | Config globale : maintenance, serveur, Discord, pointeur de modpack | Admins |
| `manifest.json` | Liste des fichiers du pack (chemin, taille, SHA-1, URL) | **Généré automatiquement** (P4/P9) — ne pas éditer à la main |
| `news.json` | Annonces affichées dans le launcher | Admins |
| `blocklist.json` | Fichiers interdits (lancement bloqué tant qu'ils sont présents) | Admins |
| `optional.json` | Catalogue de contenus approuvés (page Contenus) | Admins |
| `changelog.json` | Patchnotes launcher + modpack | Admins |
| `assets/` | Images des news | Admins |

## À compléter quand disponible
- `launcher.json → discordInvite` : lien d'invitation permanent du Discord.
- `launcher.json` et `manifest.json` → `loader.version` : version **exacte** de NeoForge du serveur
  (visible dans le nom du jar serveur, ex. `neoforge-21.1.95.jar` → `21.1.95`).

## Règles
- JSON strict : guillemets doubles, pas de virgule finale. Une erreur de syntaxe ici casse le
  launcher pour tout le monde — le panneau admin (phase P9) remplacera l'édition à la main.
- Les fichiers binaires du pack iront dans les **Releases** de ce dépôt (tag `pack-x.y.z`),
  envoyés automatiquement par le générateur de manifest.
- Formats détaillés : voir le cahier des charges, section 6.
