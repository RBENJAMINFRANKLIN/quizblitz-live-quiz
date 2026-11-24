# Blind Test Live (basé sur QuizBlitz)

Application de **blind test / quiz musical multijoueur en direct** pour soirées, bals, mariages, événements
d'entreprise et animations. L'animateur projette l'écran principal, les joueurs scannent un QR code et
répondent depuis leur téléphone, sans application ni compte. La musique est jouée **uniquement sur
l'ordinateur de l'animateur**, pour que tout le monde l'entende en même temps.

Entièrement **personnalisable sans toucher au code** : nom, logo, favicon, couleurs, textes (marque blanche),
depuis une interface d'administration.

Ce projet est une évolution de [QuizBlitz](https://github.com/RBENJAMINFRANKLIN/quizblitz-live-quiz) : le quiz
classique d'origine (9 types de questions, bibliothèque, rapports) reste disponible sur `/host`.

> 📸 Captures d'écran à ajouter dans `docs/media/` : accueil, administration, éditeur, lobby, morceau, révélation, téléphone, podium.

## Fonctionnalités

- **Administration** (`/admin`) sécurisée : tableau de bord, blind tests, parties en cours, historique, médias, paramètres.
- **Marque blanche** : nom public, nom court, slogan, organisateur, textes, logos, favicon, image d'accueil, 7 couleurs, thème clair/sombre/auto, arrondi des boutons, aperçu en direct, restauration du thème. Visible immédiatement par tous, sans redéploiement.
- **Blind tests** : manches, morceaux, 4 propositions, pochette, début et durée d'extrait, import/export JSON, duplication, archivage, préécoute avec ajustement du début, validation, brouillons.
- **Partie** : PIN, QR code direct vers la partie, lobby, avatars, verrouillage, exclusion, compte à rebours, extrait audio sur l'écran animateur (préchargement, fondus, volume), pause / reprise, relance d'un morceau, révélation (pochette, titre, artiste, année, répartition des réponses), classement avec progressions et séries, podium animé, rapport.
- **Téléphone** : mobile-first, pseudo validé, reconnexion automatique (veille, rafraîchissement, coupure réseau), résultat avec points, temps de réponse, série, rang et progression.
- **Fiabilité** : serveur autoritaire (points et temps calculés côté serveur), réponse jamais envoyée aux joueurs avant la révélation, parties enregistrées en base et **reprises après un redémarrage**, plusieurs parties simultanées.

## Prérequis

- **Node.js 22.13 ou plus récent** (SQLite intégré). Aucune dépendance npm.

## Installation et lancement en local

```bash
git clone https://github.com/RBENJAMINFRANKLIN/quizblitz-live-quiz.git
cd quizblitz-live-quiz
npm start                # ou : npm run dev (redémarre à chaque modification)
```

- Accueil : http://localhost:3000
- Administration : http://localhost:3000/admin
- Le terminal affiche aussi l'adresse Wi-Fi (`http://192.168.x.x:3000`) que les téléphones utiliseront ; le QR code l'utilise automatiquement.

### Compte administrateur

Au premier démarrage sans configuration, un compte `admin@example.com` est créé avec un **mot de passe
aléatoire affiché une seule fois dans le terminal**. Pour choisir le vôtre :

```bash
ADMIN_EMAIL=vous@exemple.fr ADMIN_PASSWORD="une-phrase-de-passe-longue" npm start
```

(PowerShell : `$env:ADMIN_PASSWORD="…"; npm start`). Voir `.env.example` pour toutes les variables.

## Prise en main en 5 minutes

1. **/admin** › connexion.
2. **Paramètres › Général** : nom (« Le Blind Test du Bal Pop' »), slogan. **Apparence** : logo, favicon, couleurs → aperçu → Enregistrer.
3. **Blind tests › Importer › Importer le blind test de démonstration** (3 mélodies libres de droits), ou **Nouveau blind test**.
4. **▶ Lancer** : l'écran animateur s'ouvre avec le QR code. Affichez-le sur le vidéoprojecteur, branchez le son.
5. Les joueurs scannent, choisissent un pseudo ; cliquez **Lancer ▶**. Pilotez avec la barre en bas de l'écran.

## Ajouter vos musiques

- **Médias › Fichiers audio › Téléverser** (MP3, M4A/AAC, OGG, WAV ; 25 Mo max), ou directement depuis l'éditeur (bouton ⬆ d'un morceau, ou « Ajouter plusieurs fichiers audio » : `Artiste - Titre.mp3` préremplit les champs).
- Ou déposez les fichiers dans `public/audio/` et utilisez `/audio/mon-fichier.mp3`, ou un lien `https://`.
- Les fichiers téléversés reçoivent un nom aléatoire : l'URL ne trahit jamais la réponse.
- ⚠️ N'utilisez que des musiques que vous avez le droit de diffuser (voir « Droits musicaux »).

## Format JSON

Voir [docs/FORMAT_BLIND_TEST.md](docs/FORMAT_BLIND_TEST.md) et l'exemple `public/exemples/blindtest-demo.json`.

## Tests

```bash
npm test         # 34 tests : unitaires, intégration (serveur réel), anciens tests du quiz classique
npm run lint
npm run build
```

Détails : [docs/TESTS.md](docs/TESTS.md).

## Déploiement (Vercel)

Vercel seul ne peut pas faire tourner un jeu temps réel avec état : le moteur tourne sur un **backend Node
persistant** (Railway, Fly.io ou Render avec disque) et **Vercel** sert le site et relaie les requêtes.
Procédure complète : [docs/DEPLOIEMENT_VERCEL.md](docs/DEPLOIEMENT_VERCEL.md).

## Architecture

```
server.js            serveur HTTP : pages (marque injectée), API REST, SSE, administration, machine à états
db.js                SQLite : comptes, sessions, quiz, rapports, paramètres, blind tests, médias, parties en cours
lib/settings.js      paramètres globaux / marque blanche (source unique), thème CSS, rendu des pages
lib/blindtest.js     format music-blind-test : validation, conversion en questions
lib/scoring.js       calcul des points (configurable)
lib/media.js         uploads sécurisés et pilote de stockage
lib/gamestore.js     instantanés des parties (reprise après redémarrage)
questions.js         types de questions (quiz classique et QCM)
views/               pages HTML (gabarits rendus par le serveur)
public/              JS / CSS / audio de démonstration (statiques)
scripts/             lint, build Vercel, génération de l'audio de démo
test/                tests automatisés
```

Documentation : [ANALYSE_TECHNIQUE](docs/ANALYSE_TECHNIQUE.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[PERSONNALISATION](docs/PERSONNALISATION.md) · [ADMINISTRATION](docs/ADMINISTRATION.md) ·
[FORMAT_BLIND_TEST](docs/FORMAT_BLIND_TEST.md) · [DEPLOIEMENT_VERCEL](docs/DEPLOIEMENT_VERCEL.md) ·
[TESTS](docs/TESTS.md) · [PLAN_EVOLUTION](docs/PLAN_EVOLUTION.md)

## Dépannage

| Problème | Solution |
|---|---|
| Les téléphones n'arrivent pas à se connecter en local | même Wi-Fi que l'ordinateur ; autoriser Node dans le pare-feu Windows ; utiliser l'adresse affichée dans le terminal (pas `localhost`) ; certains Wi-Fi publics isolent les appareils |
| Pas de son sur l'écran animateur | cliquer dans la page (règle d'autoplay) ou « Activer le son et reprendre » ; vérifier le volume de la barre de commandes et la sortie audio ; message d'erreur rouge = fichier introuvable ou format non lu par le navigateur |
| QR code absent | le script QR vient du CDN cdnjs : connexion Internet requise ; l'adresse et le PIN restent affichés |
| Partie bloquée | barre de commandes › 🛠 Débloquer (ne supprime rien) |
| Onglet animateur fermé | Admin › Parties en cours › Reprendre l'animation |
| Mot de passe admin perdu | définir `ADMIN_PASSWORD` et redémarrer |
| L'ancien nom s'affiche encore | rafraîchir la page (les écrans déjà ouverts ne se mettent pas à jour seuls) |

## Droits musicaux

La diffusion publique de musique (soirée, bal, événement) est soumise en France à déclaration auprès de la
**SACEM**, quel que soit le support. Ce dépôt ne contient **aucune musique protégée** : les extraits de
démonstration sont des mélodies originales synthétisées (`npm run demo:audio`). Vous êtes responsable des
fichiers que vous ajoutez.

## Licence et avertissement

Projet open source indépendant, dérivé de QuizBlitz. Il n'est **ni affilié, ni approuvé, ni lié à Kahoot!**
et ne contient aucun code, son, image, logo ou élément de marque de Kahoot! ; Kahoot! est une marque de son
propriétaire. Aucun fichier de licence n'est présent dans le dépôt d'origine : la licence reste à préciser
par son auteur avant toute réutilisation publique.
