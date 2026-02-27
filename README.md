# Engine Simulator

Simulateur de moteur thermique en temps réel pour véhicules électriques, vélos et autres engins silencieux.

Application web mobile qui génère un son de moteur réaliste basé sur les capteurs du téléphone (GPS + accéléromètre) ou via une interface de pilotage manuelle.

## Concept

L'idée est simple : redonner une dimension sonore à la conduite de véhicules électriques. Le simulateur modélise un moteur thermique complet (régime, couple, boîte de vitesses) et synthétise le son correspondant en temps réel via le Web Audio API.

### Deux modes de fonctionnement

| Mode | Description | Usage |
|------|-------------|-------|
| **Live** | Les données proviennent des capteurs du téléphone (GPS pour la vitesse, accéléromètre pour l'accélération). Le moteur s'adapte en temps réel au comportement du véhicule. | En roulage réel |
| **Test** | Le moteur est piloté depuis l'interface : accélérateur, frein, passage de rapports. La vitesse et l'accélération sont calculées par le simulateur physique. | Développement, démonstration, amusement |

### Profils moteur

Plusieurs profils prédéfinis avec des caractéristiques distinctes :

| Profil | Type | Cylindrée | Architecture | RPM max |
|--------|------|-----------|--------------|---------|
| Honda K20A | 4 cyl. atmo VTEC | 2.0L | Inline-4 | 8 600 |
| Toyota 2GR-FE | V6 atmo | 3.5L | V6 60° | 6 500 |
| Ford Coyote 5.0 | V8 atmo | 5.0L | V8 90° cross-plane | 7 500 |
| BMW B58 | 6 cyl. turbo | 3.0L | Inline-6 | 7 000 |
| Ferrari F136 | V8 atmo flat-plane | 4.5L | V8 90° flat-plane | 9 000 |
| VW 2.0 TDI | 4 cyl. turbo diesel | 2.0L | Inline-4 | 5 000 |

Chaque profil définit : courbe de couple, type d'aspiration (atmo/turbo), architecture (nombre de cylindres, vilebrequin), type d'échappement, boîte de vitesses associée.

### Tableau de bord

Interface simplifiée affichant en temps réel :
- Tachymètre (RPM) avec zone rouge
- Vitesse (km/h)
- Rapport engagé
- Accélération instantanée (m/s² et G)
- Position de l'accélérateur
- Pression de turbo (si applicable)
- Mode actuel (Live / Test)

## Architecture technique

Voir les documents détaillés dans `/docs` :

- **[Spécifications techniques](docs/SPECS.md)** — Spécifications fonctionnelles et techniques complètes
- **[Architecture MDA](docs/ARCHITECTURE.md)** — Architecture Model-Driven (CIM, PIM, PSM)
- **[Étude des algorithmes](docs/ALGORITHMS.md)** — Algorithmes de synthèse sonore, fusion de capteurs, modélisation moteur

## Stack technique envisagée

- **Frontend** : Application web (PWA) — React/Vue ou vanilla JS
- **Audio** : Web Audio API avec AudioWorklet pour la synthèse temps réel
- **Capteurs** : Geolocation API (GPS/vitesse), DeviceMotion API (accéléromètre)
- **Persistance** : LocalStorage / IndexedDB pour les profils utilisateur
- **Déploiement** : PWA installable, HTTPS obligatoire (requis par les APIs capteurs)

## Déploiement sur GitHub Pages

1. **Settings → Pages** du dépôt : dans **Build and deployment**, mettre **Source** à **« GitHub Actions »** (pas « Deploy from a branch »). Sinon le site sert le code source et les assets (CSS/JS) renvoient des 404.

2. À chaque push sur `main`, le workflow build + déploie. URL : `https://<user>.github.io/engineSimulator/`.

En local : `make build` puis `make preview` pour tester le build.

## Contraintes

- **HTTPS obligatoire** : Les APIs Geolocation et DeviceMotion nécessitent un contexte sécurisé
- **Permission utilisateur** : iOS 13+ requiert un geste utilisateur pour activer les capteurs de mouvement
- **Latence audio** : Le Web Audio API offre une latence acceptable (~10-50ms) avec `latencyHint: 'interactive'`
- **Batterie** : Le GPS est énergivore — prévoir un mode économie avec fréquence réduite
- **Screen Wake Lock** : Nécessaire pour empêcher la mise en veille en mode Live

## Licence

À définir.
