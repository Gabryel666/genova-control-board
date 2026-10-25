# Design — pourquoi un plugin Hermes qui contient un plugin Stream Deck

Ce document garde le raisonnement. Il explique les décisions, les modes de défaillance
attendus et ce qui reste à faire. Les commandes sont dans le README.

## Le problème

Un plugin Stream Deck est un dossier que l'application Stream Deck lit au démarrage. Il vit
sur la machine de l'utilisateur, pas dans Hermes. Distribué seul, il impose deux
installations (le board d'un côté, la configuration de l'autre), deux versions à tenir
synchronisées, et il ne sait rien de l'installation Hermes qu'il pilote.

Le board parle à l'API HTTP du dashboard. Cette API change avec les versions d'Hermes. Un
board installé seul peut donc devenir silencieusement inadapté : la touche s'affiche, mais
le point d'entrée qu'elle appelle n'existe plus.

## La décision

Le dépôt **est** un plugin Hermes ; le board est son contenu (`assets/`). Installer le
plugin Hermes installe donc la version du board qui correspond à ce que ce plugin sait
vérifier.

Conséquences voulues :

- **Une seule chose à installer** côté Hermes, et un seul numéro de version à suivre.
- **Le board n'a pas besoin de Node pour être installé** : `assets/` est commité, l'outil
  d'installation ne fait que copier des fichiers.
- **La compatibilité devient mesurable** : le plugin Hermes connaît la liste des points
  d'entrée que le board utilise et peut les sonder sur la machine réelle.

## Invariants

1. **Ne jamais détruire ce qu'on n'a pas créé.** Si le dossier `com.genova.control-board.sdPlugin`
   existe avec un manifeste d'un autre UUID, l'installation refuse et ne touche à rien.
2. **Sauvegarder avant d'écraser.** Copie datée dans `StreamDeck/Backups/genova-control-board/`.
3. **Ne jamais annoncer un succès non vérifié.** Après copie : manifeste relu, bundle
   présent, application relancée et PID constaté. Une relance ratée est rapportée comme
   ratée — c'est arrivé pendant la mise au point, et le taire aurait été le pire des
   comportements.
4. **Les chemins Windows ne passent jamais par `/mnt/...`.** PowerShell et `Start-Process`
   ne savent pas ouvrir un chemin WSL : il faut convertir en `C:\...` avant l'appel.
5. **La sortie des outils Windows est décodée en tolérant.** `tasklist.exe` parle UTF-16LE
   quand on l'appelle depuis WSL ; une lecture texte naïve casse au premier octet nul.

## Modes de défaillance et réponses

| Situation | Ce que fait le plugin | Ce qu'il ne fait pas |
|---|---|---|
| Pas de Stream Deck sur la machine | dit lequel des trois emplacements a été cherché, et propose `target_dir` | inventer un dossier |
| Stream Deck installé mais fermé | installe quand même, signale l'application non lancée | prétendre que le board est chargé |
| Portail d'authentification sur le dashboard | les points d'entrée ouverts répondent, les autres sont listés comme nécessitant un jeton | demander un mot de passe au hasard |
| Gateway arrêté | le dit, avec l'erreur réseau | attendre indéfiniment |
| Version embarquée plus récente que l'installée | `status` le signale, `install` met à jour avec sauvegarde | mettre à jour en silence |

## Ce qui a été vérifié, et comment

- `hermes plugins validate .` : manifeste, chargement, `register()` exécuté en isolation,
  outils déclarés == outils enregistrés, scan de sécurité.
- `hermes plugins doctor .` : 2 outils enregistrés, contrats runtime réels.
- `board.status()` sur une vraie machine : détection WSL, dossier Stream Deck trouvé,
  versions comparées, jeton de session découvert, **les 7 points d'entrée sondés et OK**.
- `board.install()` deux fois : une fois dans un dossier temporaire contenant une ancienne
  version (sauvegarde créée, 28 fichiers copiés), une fois sur la vraie installation
  (sauvegarde datée + Stream Deck relancé et PID constaté).
- Refus testé : dossier occupé par un autre UUID → aucune modification.
- Côté board : client de l'API exercé sur le vrai gateway (y compris un déclenchement de
  tâche cron qui a réellement tourné), tuiles SVG contrôlées visuellement, manifeste
  validé par `streamdeck validate`, plugin chargé par l'application.

## Idées pour la suite (non implémentées)

- **Pousser la configuration** : Stream Deck garde ses réglages globaux dans son propre
  stockage. Si un jour il devient inscriptible, l'outil pourrait y écrire l'adresse du
  gateway au lieu de laisser un champ à remplir.
- **Surveillance de dérive** : un hook au démarrage de session pourrait comparer la version
  d'Hermes aux points d'entrée attendus et prévenir avant que le board ne devienne aveugle.
- **Touches supplémentaires** : profils, voix live, déclenchement de blueprint. Chacune doit
  rester un consommateur du même client d'API — pas un deuxième client.
- **Mise à jour du board depuis Hermes** : `install` est déjà idempotent ; un `hermes plugins
  update` suivi de l'outil suffit, il n'y a rien d'autre à construire.
