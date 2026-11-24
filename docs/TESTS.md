# Tests

Aucune dépendance : le lanceur de tests intégré à Node (`node:test`) est utilisé.

```bash
npm test                 # tout (≈ 1 min)
npm run test:unit        # tests unitaires (< 1 s)
npm run test:integration # serveur réel + anciens tests API
npm run lint             # syntaxe de tous les fichiers JS + absence de marque codée en dur
npm run build            # lint + génération de .vercel/output (avec BACKEND_URL)
```

Les tests d'intégration démarrent `server.js` sur un port libre avec un dossier de données temporaire :
ils n'ont pas besoin d'un serveur lancé à la main et ne touchent pas `data/`.

## Couverture

### `test/unit.test.js`
- Scoring : réponse immédiate (1000), à mi-temps (750), juste avant la fin, après la fin (plafond bas 500), horodatage falsifié / négatif, bonus de série et plafond, configuration bornée.
- Format blind test : exemple valide, titre manquant, bonne réponse hors propositions, doublons, URL audio dangereuse, nombre de propositions, type incorrect, identifiants générés et uniques, conversion en questions (la réponse n'est que dans le bloc de révélation, jamais dans la vue publique).
- Paramètres : validation des couleurs / arrondi / thème / nom obligatoire / URL d'image, échappement HTML du nom, injection du thème, du favicon et des métadonnées, couleur de texte lisible.
- Médias : détection de signature (PNG, JPEG, MP3, OGG, M4A, ICO), refus SVG / HTML / mauvais type / extension trompeuse / taille, requêtes Range.
- Instantané de partie : aller-retour sans objets d'exécution.

### `test/integration.test.js`
- Accès admin refusé sans session, mauvais mot de passe, en-tête CSRF exigé, cookie HttpOnly + SameSite=Strict.
- En-têtes de sécurité (CSP, nosniff), gabarits HTML non servis bruts, aucun secret dans les pages.
- Paramètres : lecture publique sans champs internes, renommage, couleurs, refus d'une couleur invalide, refus sans session, **nouveau nom visible sur toutes les pages publiques sans « QuizBlitz »**, manifeste, restauration du thème.
- Logo : upload, refus SVG et faux fichier, favicon ICO, application sur l'accueil, **remplacement avec suppression de l'ancien fichier**, refus de supprimer un fichier utilisé, refus d'un média inexistant.
- Blind tests : refus d'un blind test invalide (détails), création, modification, duplication, archivage, export, ré-import sans écrasement, suppression.
- Partie : création réservée à l'admin, PIN à 6 chiffres, lien QR `/join/<pin>` → `/play?pin=…`, clé animateur vérifiée, pseudos invalides refusés (vide, 1 caractère, balises), doublon refusé.
- Morceau 1 : audio envoyé à l'animateur seulement (+ préchargement du suivant), aucune donnée de réponse chez les joueurs avant la révélation, rejoindre en cours refusé si désactivé, **pause** (réponses refusées) et reprise, points falsifiés ignorés, double réponse refusée, distribution des réponses, score plafonné, plus rapide = plus de points, carte du morceau à la révélation.
- Classement avec progression, masquer le classement, **rafraîchissement de l'animateur**, **reconnexion d'un joueur**.
- **Redémarrage du backend** en pleine partie : partie, joueurs, scores et minuteurs restaurés ; relance d'un morceau ; série ; fin de partie, podium et rapport enregistré.
- **Deux parties simultanées** isolées (même pseudo autorisé, clés et jetons propres à chaque partie).
- **Expiration** : une partie expirée n'est pas restaurée ; les paramètres survivent aux redémarrages.

### `test/legacy.test.js`
Exécute les tests d'origine `test/e2e.js` et `test/features.js` (quiz classique : 9 types de questions,
comptes, bibliothèque, rapports, CSV) contre un serveur neuf, pour garantir l'absence de régression.

## Non couvert automatiquement

- **Test navigateur de bout en bout (Playwright)** : non ajouté, pour ne pas introduire de dépendance lourde.
  L'interface a été vérifiée manuellement dans un navigateur (accueil, connexion admin, import, éditeur et
  préécoute, apparence, lobby, morceau avec lecture audio, révélation, classement, reprise après
  rafraîchissement). Un scénario Playwright est proposé dans `PLAN_EVOLUTION.md`.
- Lecture audio réelle sur iPhone / Android (l'audio n'est joué que sur l'écran animateur).
- Déploiement réel sur Vercel et sur un hébergeur backend.
