# Personnalisation (marque blanche)

Tout se règle dans **Administration > Paramètres**, sans toucher au code, sans commit, sans build et sans
redéploiement. Les réglages sont enregistrés dans la base du backend (table `app_settings`) : ils sont
identiques sur tous les appareils, pour tous les joueurs, et survivent aux redémarrages et redéploiements.

## Ce qui est personnalisable

| Réglage | Écran admin | Où il apparaît |
|---|---|---|
| Nom public | Général | titre de l'onglet, accueil, lobby, écrans d'attente, podium, admin, page 404, métadonnées de partage, manifeste |
| Nom court | Général | titres d'onglet (« Jouer · Nom court »), barre du téléphone, icône d'écran d'accueil mobile |
| Slogan | Général | accueil, lobby, aperçus de partage |
| Organisateur / marque | Général | page d'accueil |
| Texte près du QR code | Général | lobby |
| Texte d'accueil | Général | page d'accueil |
| Langue par défaut | Général | attribut de langue du manifeste (interface en français) |
| Logo principal | Apparence | accueil, lobby, téléphone (connexion), admin, podium, page 404 |
| Logo pour fond sombre | Apparence | réservé aux écrans sombres (repli sur le logo principal) |
| Favicon | Apparence | onglet du navigateur, manifeste |
| Image d'accueil | Apparence | page d'accueil, image de partage (`og:image`) |
| 7 couleurs, thème, arrondi | Apparence | toutes les pages (variables CSS) |

Sans logo, le nom public est affiché en texte (« word mark »).

## Couleurs et variables CSS

Le serveur injecte dans chaque page un bloc `<style id="brand-theme">` :

| Variable | Réglage |
|---|---|
| `--color-primary` | couleur principale (boutons principaux) |
| `--color-secondary` | couleur secondaire (dégradé du fond) |
| `--color-accent` | couleur d'accentuation (slogan, minuteur, mises en avant) |
| `--color-background` | fond |
| `--color-surface` | cartes |
| `--color-text` / `--color-text-muted` | texte des cartes |
| `--button-radius` | arrondi des boutons |

Les couleurs de texte posées sur un fond (`--on-bg`, `--accent-ink`…) sont calculées automatiquement pour rester
lisibles. L'aperçu signale un contraste insuffisant entre texte et cartes. Les 4 couleurs des réponses
(triangle rouge, losange bleu, rond jaune, carré vert) restent fixes : elles servent de repère commun entre
l'écran principal et les téléphones.

**Thème** : « Sombre » utilise les couleurs telles quelles ; « Clair » dérive un fond clair de la couleur
principale ; « Automatique » suit le réglage de l'appareil.

« **Restaurer le thème par défaut** » remet couleurs, thème et arrondi d'origine, sans toucher au nom, aux logos ni aux textes.

## Logos et images

- Formats : PNG, JPEG, WebP (2 Mo max) ; favicon PNG ou ICO (512 Ko max).
- Le type réel est vérifié à partir du contenu du fichier (signature), pas du nom. L'extension doit correspondre.
- **SVG refusé** : un SVG peut contenir du script ; plutôt que d'embarquer un nettoyeur complexe, la V1 le refuse.
- Fichiers stockés sous un nom aléatoire, servis avec un type fixe, `nosniff` et une CSP `sandbox` : un fichier téléversé ne peut jamais être exécuté.
- Remplacer ou retirer un logo puis enregistrer supprime l'ancien fichier s'il n'est plus utilisé ailleurs. Une image téléversée puis abandonnée sans enregistrer reste visible comme « inutilisée » dans **Médias**, où elle peut être supprimée.
- Pas de redimensionnement automatique en V1 (aucune dépendance d'image) : préparez un logo d'environ 800 px de large.

## Aperçu

La page Apparence affiche en direct, avant enregistrement : logo, nom, slogan, carte, bouton principal et
secondaire, un lobby (QR + PIN) et un écran de téléphone.

## Cache : quand le changement est-il visible ?

- Pages HTML : `Cache-Control: no-cache` → revalidées à chaque visite, donc **immédiat** pour un nouveau visiteur ou un rafraîchissement.
- `/api/public/settings` : 15 s de cache.
- Médias : cache d'un an, mais chaque nouveau fichier a une nouvelle URL, donc jamais d'ancien logo servi.
- Les écrans déjà ouverts (lobby en cours) gardent l'ancienne marque jusqu'à leur rafraîchissement.

## Utiliser l'application pour plusieurs événements

Une installation = une identité à la fois. Pour enchaîner les événements, changez simplement les réglages
avant chaque soirée. Pour plusieurs marques **simultanées**, déployez une instance backend par marque
(chacune avec son `DATA_DIR`) ; l'évolution multi-marques est décrite dans `PLAN_EVOLUTION.md`.
