# Spécifications techniques — Engine Simulator

## 1. Vue d'ensemble

### 1.1 Objectif

Développer une application web mobile (PWA) qui simule le son d'un moteur thermique en temps réel, pilotée soit par les capteurs du téléphone (mode Live), soit par une interface virtuelle (mode Test).

### 1.2 Utilisateurs cibles

- Conducteurs de véhicules électriques souhaitant une expérience sonore
- Cyclistes (vélo électrique ou classique)
- Passionnés d'automobile pour le fun / démonstration
- Développeurs et testeurs du projet

### 1.3 Plateformes supportées

| Plateforme | Navigateur | Priorité |
|------------|-----------|----------|
| iOS | Safari | Haute |
| Android | Chrome | Haute |
| Desktop | Chrome / Firefox | Moyenne (mode Test uniquement) |

---

## 2. Spécifications fonctionnelles

### 2.1 Mode Live (capteurs)

**SF-LIVE-01** : L'application collecte la vitesse GPS via `Geolocation.watchPosition()` avec `enableHighAccuracy: true`.

**SF-LIVE-02** : L'application collecte l'accélération via `DeviceMotionEvent.acceleration` (ou `accelerationIncludingGravity` en fallback).

**SF-LIVE-03** : Les données GPS (~1Hz) et accéléromètre (~60Hz) sont fusionnées via un filtre de Kalman pour produire une estimation de vitesse et d'accélération à haute fréquence (~60Hz).

**SF-LIVE-04** : La vitesse fusionnée est convertie en RPM via le modèle de transmission :
```
RPM = (vitesse_ms × rapport_boîte × rapport_pont × 60) / (2π × rayon_roue)
```

**SF-LIVE-05** : L'accélération est mappée sur la position de l'accélérateur virtuel (accélération positive = gaz, négative = frein moteur).

**SF-LIVE-06** : Le passage des rapports est automatique, basé sur les seuils de RPM et le niveau de charge moteur.

**SF-LIVE-07** : L'application demande les permissions capteurs via un geste utilisateur (bouton "Démarrer") conformément aux exigences iOS 13+.

**SF-LIVE-08** : Un Screen Wake Lock empêche la mise en veille de l'écran.

### 2.2 Mode Test (interface)

**SF-TEST-01** : L'interface fournit un contrôle d'accélérateur (slider vertical ou zone tactile avec pression proportionnelle).

**SF-TEST-02** : L'interface fournit un contrôle de frein.

**SF-TEST-03** : L'utilisateur peut choisir entre boîte automatique et manuelle.

**SF-TEST-04** : En mode manuel, des boutons permettent de monter/descendre les rapports.

**SF-TEST-05** : Le simulateur physique calcule en temps réel :
- Le couple moteur à partir du RPM et de la position d'accélérateur
- La force de traction aux roues
- Les forces de résistance (aérodynamique, roulement)
- L'accélération résultante : `a = F_net / m_effective`
- La vitesse par intégration : `v += a × dt`
- Le RPM depuis la vitesse et le rapport engagé

**SF-TEST-06** : Le modèle physique tourne à 60-100 Hz minimum pour une simulation fluide.

### 2.3 Profils moteur

**SF-PROF-01** : L'application propose au minimum 6 profils moteur prédéfinis (voir README).

**SF-PROF-02** : Chaque profil définit :
| Paramètre | Description | Exemple |
|-----------|-------------|---------|
| `name` | Nom du profil | "Honda K20A VTEC" |
| `type` | Architecture | "inline-4", "v6", "v8-crossplane", "v8-flatplane" |
| `displacement` | Cylindrée (cc) | 1998 |
| `cylinders` | Nombre de cylindres | 4 |
| `aspiration` | Type d'aspiration | "na", "turbo", "turbo-diesel" |
| `idleRPM` | Régime de ralenti | 800 |
| `redlineRPM` | Régime max | 8600 |
| `peakTorque` | Couple max (Nm) | 206 |
| `peakTorqueRPM` | RPM au couple max | 7000 |
| `peakPower` | Puissance max (kW) | 162 |
| `peakPowerRPM` | RPM à la puissance max | 8000 |
| `torqueCurve` | Table RPM→couple | [[1000, 90], [2000, 130], ...] |
| `firingOrder` | Ordre d'allumage | [1, 3, 4, 2] |
| `gearRatios` | Rapports de boîte | [3.133, 2.045, 1.481, 1.161, 0.971] |
| `finalDrive` | Rapport de pont | 4.100 |
| `exhaustType` | Type d'échappement | "stock", "sport", "straight-pipe" |
| `turboConfig` | Config turbo (si applicable) | `{ spoolTime: 0.8, maxBoost: 1.2 }` |

**SF-PROF-03** : Les profils sont stockés en JSON et chargés au démarrage.

**SF-PROF-04** : L'utilisateur peut modifier les paramètres d'un profil (mode avancé, V2).

### 2.4 Synthèse sonore

**SF-AUDIO-01** : Le son du moteur est généré en temps réel via le Web Audio API.

**SF-AUDIO-02** : La synthèse utilise une approche additive (somme d'harmoniques) comme base :
- Fréquence fondamentale = `RPM / 60` (fréquence du vilebrequin)
- Harmoniques dominantes déterminées par le nombre de cylindres et l'architecture
- 20-30 harmoniques par défaut

**SF-AUDIO-03** : L'amplitude de chaque harmonique varie en fonction de :
- Le numéro de l'harmonique (décroissance spectrale)
- Le régime RPM
- La charge moteur (position d'accélérateur)
- Le type de moteur (V8 cross-plane vs flat-plane, etc.)

**SF-AUDIO-04** : Le son est filtré pour simuler l'échappement :
- Filtre passe-bas (coupure variable selon type d'échappement)
- Résonances (filtre peaking EQ)
- Convolution optionnelle avec une réponse impulsionnelle d'échappement

**SF-AUDIO-05** : Des micro-variations aléatoires sont ajoutées aux harmoniques (2-5% en amplitude, 0.1-0.5% en fréquence) pour éviter un son "électronique".

**SF-AUDIO-06** : Pour les profils turbo :
- Son de turbo (sifflement proportionnel à la pression de suralimentation)
- Blow-off valve (bruit lors du lâcher d'accélérateur sous boost)
- Turbo lag sonore (montée progressive du sifflement)

**SF-AUDIO-07** : Effets supplémentaires (V2+) :
- Crépitements à la décélération
- Rev-matching au rétrogradage
- Son d'admission
- Résonance de l'habitacle

### 2.5 Tableau de bord

**SF-DASH-01** : Affichage en temps réel des paramètres suivants :
| Indicateur | Unité | Source |
|-----------|-------|--------|
| Tachymètre (RPM) | tr/min | Modèle moteur |
| Vitesse | km/h | GPS fusionné ou simulation |
| Rapport engagé | 1-7 / N / R | Modèle transmission |
| Accélération | m/s² et G | Capteurs ou simulation |
| Position accélérateur | 0-100% | Interface ou capteurs |
| Pression turbo | bar | Modèle turbo (si applicable) |
| Puissance instantanée | kW / ch | Calculée : T × RPM × 2π/60 |

**SF-DASH-02** : Le tachymètre affiche une zone rouge à partir du régime redline.

**SF-DASH-03** : Un indicateur visuel montre le mode actif (Live / Test).

**SF-DASH-04** : Le tableau de bord est responsive et optimisé pour le mode paysage sur mobile.

---

## 3. Spécifications techniques

### 3.1 Architecture logicielle

L'application suit une architecture en couches :

```
┌─────────────────────────────────────────────────┐
│                  UI Layer                        │
│  (Dashboard, Controls, Profile Selector)         │
├─────────────────────────────────────────────────┤
│              Application Layer                   │
│  (Mode Manager, State Machine)                   │
├──────────────────┬──────────────────────────────┤
│   Input Layer    │        Output Layer           │
│  ┌────────────┐  │  ┌──────────────────────┐    │
│  │ GPS Reader │  │  │  Audio Engine         │    │
│  │ Accel Read │  │  │  (Web Audio API)      │    │
│  │ UI Controls│  │  │  ┌──────────────────┐ │    │
│  └─────┬──────┘  │  │  │ AudioWorklet     │ │    │
│        │         │  │  │ (Synth DSP)      │ │    │
│  ┌─────▼──────┐  │  │  └──────────────────┘ │    │
│  │ Sensor     │  │  │  ┌──────────────────┐ │    │
│  │ Fusion     │  │  │  │ Filter Chain     │ │    │
│  │ (Kalman)   │  │  │  │ (Exhaust sim)    │ │    │
│  └─────┬──────┘  │  │  └──────────────────┘ │    │
│        │         │  └──────────────────────┘    │
├────────▼─────────┴──────────────────────────────┤
│              Engine Model Layer                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Torque   │ │ Trans-   │ │ Vehicle          │ │
│  │ Model    │ │ mission  │ │ Dynamics         │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├─────────────────────────────────────────────────┤
│              Data Layer                          │
│  (Engine Profiles JSON, User Settings)           │
└─────────────────────────────────────────────────┘
```

### 3.2 Boucle principale

La boucle de simulation tourne via `requestAnimationFrame` (~60 Hz) ou un `setInterval` dédié (si découplage nécessaire) :

```
1. Lire les entrées (capteurs ou UI)
2. Mettre à jour le filtre de Kalman (mode Live)
3. Calculer les paramètres moteur (RPM, couple, charge)
4. Gérer les passages de rapports
5. Mettre à jour les paramètres audio (RPM → fréquences, charge → amplitudes)
6. Mettre à jour le tableau de bord
```

L'AudioWorklet tourne indépendamment dans son propre thread audio, recevant les paramètres via `AudioParam` ou `MessagePort`.

### 3.3 Interfaces clés

#### Profil moteur (TypeScript)

```typescript
interface EngineProfile {
  id: string;
  name: string;
  type: 'inline-4' | 'inline-6' | 'v6' | 'v8-crossplane' | 'v8-flatplane' | 'v10' | 'v12';
  displacement: number;        // cc
  cylinders: number;
  aspiration: 'na' | 'turbo' | 'turbo-diesel';

  // RPM
  idleRPM: number;
  redlineRPM: number;

  // Performance
  torqueCurve: [number, number][];  // [[rpm, torqueNm], ...]

  // Transmission
  gearRatios: number[];
  finalDrive: number;
  wheelRadius: number;          // meters

  // Audio
  firingOrder: number[];
  exhaustType: 'stock' | 'sport' | 'straight-pipe';
  harmonicProfile: HarmonicProfile;

  // Turbo (optional)
  turbo?: TurboConfig;

  // Vehicle (for test mode physics)
  vehicleMass: number;          // kg
  dragCoefficient: number;      // Cd
  frontalArea: number;          // m²
  rollingResistance: number;    // Crr
}

interface TurboConfig {
  maxBoostBar: number;          // bar
  spoolTimeSec: number;         // seconds (time constant)
  boostThresholdRPM: number;    // RPM where boost starts building
  hasBOV: boolean;
}

interface HarmonicProfile {
  numHarmonics: number;         // 20-30
  spectralRolloff: number;      // alpha (0.8-1.5)
  firingHarmonicBoost: number;  // dB boost for firing-order harmonics
  loadBrightness: number;       // how much throttle affects high harmonics
}
```

#### État du moteur

```typescript
interface EngineState {
  rpm: number;
  throttle: number;             // 0.0 - 1.0
  brake: number;                // 0.0 - 1.0
  gear: number;                 // 0 = neutral, 1-7 = gears
  speedMs: number;              // m/s
  accelerationMs2: number;      // m/s²
  torqueNm: number;             // current engine torque
  powerKw: number;              // current power
  boostBar: number;             // turbo boost (0 if NA)
  isShifting: boolean;
  clutchEngaged: boolean;
}
```

### 3.4 Performance requise

| Métrique | Cible |
|----------|-------|
| Fréquence de simulation | ≥ 60 Hz |
| Latence audio (input → son) | < 50 ms |
| Frame rate UI | ≥ 30 fps |
| Utilisation mémoire | < 50 MB |
| Consommation batterie | < 20% / heure (mode Live) |

### 3.5 Format des données capteurs

#### GPS (Geolocation API)

```typescript
interface GpsReading {
  timestamp: number;            // ms since epoch
  speedMs: number | null;       // m/s (null si indisponible)
  accuracy: number;             // meters
  heading: number | null;       // degrees (0-360, null si stationnaire)
  latitude: number;
  longitude: number;
}
```

#### Accéléromètre (DeviceMotion API)

```typescript
interface AccelReading {
  timestamp: number;            // ms (performance.now())
  x: number;                    // m/s² (latéral)
  y: number;                    // m/s² (longitudinal, selon montage)
  z: number;                    // m/s² (vertical)
  interval: number;             // ms entre les lectures
}
```

---

## 4. Cas d'utilisation détaillés

### UC-01 : Démarrage en mode Live

1. L'utilisateur ouvre l'application
2. L'utilisateur sélectionne un profil moteur
3. L'utilisateur appuie sur "Démarrer en mode Live"
4. L'application demande les permissions (géolocalisation + mouvement)
5. L'utilisateur accorde les permissions
6. L'AudioContext est initialisé (nécessite un geste utilisateur)
7. Le Screen Wake Lock est activé
8. Le son du moteur au ralenti démarre
9. L'utilisateur commence à rouler
10. Le son évolue en fonction de la vitesse et de l'accélération

### UC-02 : Démarrage en mode Test

1. L'utilisateur ouvre l'application
2. L'utilisateur sélectionne un profil moteur
3. L'utilisateur appuie sur "Mode Test"
4. L'AudioContext est initialisé
5. Le son du moteur au ralenti démarre
6. L'utilisateur utilise l'accélérateur virtuel
7. Le simulateur physique calcule RPM / vitesse
8. Le son évolue en conséquence
9. Les rapports passent automatiquement (ou manuellement)

### UC-03 : Changement de profil en cours de route

1. Le moteur est en fonctionnement (mode Live ou Test)
2. L'utilisateur ouvre le sélecteur de profil
3. Le son fait un fondu de 500ms vers le silence
4. Le nouveau profil est chargé
5. Les paramètres audio sont reconfigurés
6. Le son reprend avec un fondu de 500ms

### UC-04 : Perte de signal GPS (mode Live)

1. Le véhicule entre dans un tunnel
2. Le GPS ne fournit plus de données
3. L'application bascule en dead reckoning (accéléromètre seul)
4. Un indicateur visuel signale la perte GPS
5. L'incertitude augmente progressivement
6. À la sortie du tunnel, le GPS se recale
7. Le filtre de Kalman corrige la dérive

---

## 5. Contraintes et limites connues

### 5.1 Limites techniques

- **Fréquence GPS** : ~1 Hz max, insuffisant seul pour une réponse rapide
- **Dérive accéléromètre** : L'intégration dérive en 10-30 secondes sans recalage GPS
- **Axes accéléromètre** : Dépendent de l'orientation du téléphone — calibration nécessaire
- **Autoplay policy** : Le son ne peut démarrer qu'après un geste utilisateur
- **iOS vs Android** : Modèles de permissions différents pour DeviceMotion

### 5.2 Évolutions futures (V2+)

- Son basé sur des samples réels (crossfade par RPM)
- Enregistrement et partage de sessions
- Création de profils personnalisés avec éditeur de courbe
- Mode multijoueur (plusieurs téléphones synchronisés)
- Intégration OBD-II via Bluetooth pour données moteur réelles
- Son 3D (spatialisation binaurale)
