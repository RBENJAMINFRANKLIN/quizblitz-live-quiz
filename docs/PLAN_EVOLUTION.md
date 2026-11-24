# Plan d'évolution

Priorités proposées après le MVP, de la plus utile à la plus ambitieuse.

## Court terme

1. **Télécommande animateur** : une vue `/host/remote` sur le téléphone de l'animateur (mêmes droits via la clé de partie), affichant le morceau en cours et le suivant, pendant que l'écran projeté reste sans indice.
2. **Enchaînement automatique** optionnel en utilisant `revealDuration` et `scoreboardDuration` (déjà dans le format).
3. **Test Playwright** : admin qui renomme et change le logo, animateur, 3 joueurs, 2 morceaux, classement, podium (navigateurs pilotés en parallèle, audio silencieux).
4. **Traduction complète** de l'éditeur de quiz classique (`/host`, `/library`, `/reports`) encore partiellement en anglais, et sélecteur de langue utilisant `defaultLanguage`.
5. **Redimensionnement des images** téléversées (logo, pochettes) côté navigateur avant envoi (canvas), sans dépendance serveur.
6. Utiliser le **logo pour fond sombre** automatiquement en thème clair/sombre.

## Moyen terme : nouveaux modes de jeu

Le format prévoit `answerMode` et `questionType` :
- `free-text` : saisie libre, comparaison tolérante (accents, casse, articles) — le type `typeanswer` existant fournit déjà la fonction `canon`.
- Réponses multiples artiste + titre (points partiels).
- `buzzer` : premier à buzzer, validation par l'animateur.
- `teams` : équipes choisies au lobby, score d'équipe.
- Questions bonus (points doublés : le champ `points: 'double'` existe déjà dans le moteur).

## Infrastructure

- **Pilotes de stockage objet** (`lib/media.js`) : Cloudflare R2 / S3 (signature SigV4), Vercel Blob, Supabase Storage. URL publiques non signées à nom aléatoire, ou URL signées longues renouvelées à chaque morceau.
- **Plusieurs instances** : publier les messages des parties via Redis pub/sub ou Ably et prendre un verrou par partie ; la persistance des instantanés existe déjà.
- **100 % serverless** (si un jour nécessaire) : état des parties dans Postgres/Redis, transitions calculées à la lecture depuis les horodatages (déjà la logique utilisée par `armTimers`), diffusion par Ably / Supabase Realtime.
- **Multi-marques** : `app_settings` par organisation et sélection par domaine.
- Postgres en option pour les hébergeurs sans disque.

## Qualité

- Rapports spécifiques blind test (morceaux les mieux / moins bien reconnus).
- Statistiques de joueurs connectés en temps réel dans le tableau de bord (rafraîchissement automatique).
- Journal d'audit des actions admin.
