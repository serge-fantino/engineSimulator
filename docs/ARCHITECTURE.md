# Architecture MDA — Engine Simulator

Architecture Model-Driven (MDA) du simulateur de moteur thermique, structurée en trois niveaux d'abstraction : CIM (modèle métier indépendant), PIM (modèle indépendant de la plateforme), et PSM (modèle spécifique à la plateforme).

---

## 1. CIM — Computation Independent Model (Modèle métier)

Le CIM décrit le domaine métier sans aucune considération technique.

### 1.1 Entités métier

```
┌─────────────────────────────────────────────────────────────┐
│                      DOMAINE MÉTIER                         │
│                                                             │
│  ┌───────────┐     pilote      ┌──────────────┐            │
│  │ Conducteur├────────────────►│   Véhicule    │            │
│  └───────────┘                 └──────┬───────┘            │
│                                       │                     │
│                                 est équipé de               │
│                                       │                     │
│                           ┌───────────┼───────────┐         │
│                           ▼           ▼           ▼         │
│                    ┌──────────┐ ┌──────────┐ ┌─────────┐   │
│                    │  Moteur  │ │  Boîte   │ │Échapp.  │   │
│                    │thermique │ │ vitesses │ │         │   │
│                    └────┬─────┘ └──────────┘ └─────────┘   │
│                         │                                   │
│                    produit                                   │
│                         │                                   │
│                    ┌────▼─────┐                              │
│                    │   Son    │                              │
│                    │  moteur  │                              │
│                    └──────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Processus métier

#### Processus P1 : Conduite réelle (mode Live)

```
Le conducteur conduit son véhicule (électrique/vélo).
→ Le véhicule se déplace à une certaine vitesse.
→ Le véhicule accélère ou décélère.
→ Un moteur thermique virtuel est associé au véhicule.
→ Le moteur adapte son régime à la vitesse.
→ La boîte de vitesses sélectionne le rapport approprié.
→ Le moteur produit un son correspondant à son régime et sa charge.
→ Le conducteur entend le son via le haut-parleur.
```

#### Processus P2 : Simulation (mode Test)

```
L'utilisateur manipule des commandes virtuelles (accélérateur, frein, rapports).
→ Le moteur virtuel réagit aux commandes.
→ Les caractéristiques physiques (vitesse, accélération) sont simulées.
→ Le moteur produit un son correspondant.
→ Un tableau de bord affiche les paramètres en temps réel.
```

### 1.3 Règles métier

| ID | Règle |
|----|-------|
| RM-01 | Le régime moteur est déterminé par la vitesse du véhicule et le rapport de boîte engagé |
| RM-02 | Le couple disponible dépend du régime moteur et de la position d'accélérateur |
| RM-03 | Le son du moteur est fonction du régime, de la charge, du nombre de cylindres et du type d'échappement |
| RM-04 | Les rapports de boîte montent quand le régime approche la zone rouge |
| RM-05 | Les rapports descendent quand le régime tombe trop bas ou lors d'un freinage |
| RM-06 | Un moteur turbo présente un temps de réponse (turbo lag) entre la demande et la fourniture de suralimentation |
| RM-07 | Le blow-off valve se déclenche au lâcher d'accélérateur sous pression de suralimentation |
| RM-08 | Le régime ne peut pas descendre en-dessous du ralenti ni dépasser la zone rouge |

---

## 2. PIM — Platform Independent Model (Modèle indépendant de la plateforme)

Le PIM décrit la solution logicielle sans référence à une technologie spécifique.

### 2.1 Architecture en couches

```
┌─────────────────────────────────────────────────────────────────┐
│                    COUCHE PRÉSENTATION                           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Dashboard    │  │  Controls    │  │  Profile Selector     │ │
│  │  View         │  │  View        │  │  View                 │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
├─────────┼──────────────────┼─────────────────────┼──────────────┤
│         │    COUCHE APPLICATION (Orchestration)   │              │
│         ▼                  ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Mode Manager                             ││
│  │  ┌─────────────┐              ┌─────────────┐              ││
│  │  │  Live Mode   │              │  Test Mode   │              ││
│  │  │  Controller  │              │  Controller  │              ││
│  │  └──────┬──────┘              └──────┬──────┘              ││
│  └─────────┼────────────────────────────┼──────────────────────┘│
├─────────────┼────────────────────────────┼──────────────────────┤
│             │    COUCHE DOMAINE (Métier)  │                      │
│             ▼                            ▼                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Engine Model                            │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │ Torque      │  │ Transmission │  │ Vehicle        │  │  │
│  │  │ Calculator  │  │ Model        │  │ Dynamics       │  │  │
│  │  │             │  │              │  │ (test mode)    │  │  │
│  │  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │  │
│  │         └────────────────┼──────────────────┘            │  │
│  │                          ▼                                │  │
│  │                 ┌─────────────────┐                       │  │
│  │                 │  Engine State   │                       │  │
│  │                 │  (rpm, torque,  │                       │  │
│  │                 │   gear, speed)  │                       │  │
│  │                 └────────┬────────┘                       │  │
│  └──────────────────────────┼────────────────────────────────┘  │
├──────────────────────────────┼──────────────────────────────────┤
│                              │   COUCHE INFRASTRUCTURE          │
│                              ▼                                  │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │ Sensor         │  │ Audio           │  │ Storage          │ │
│  │ Adapter        │  │ Synthesizer     │  │ Adapter          │ │
│  │                │  │                 │  │                  │ │
│  │ ┌────────────┐ │  │ ┌─────────────┐ │  │ ┌──────────────┐ │ │
│  │ │GPS Reader  │ │  │ │Harmonic Gen │ │  │ │Profile Store │ │ │
│  │ │Accel Reader│ │  │ │Filter Chain │ │  │ │Settings Store│ │ │
│  │ │Sensor Fusion│ │  │ │Turbo Layer │ │  │ └──────────────┘ │ │
│  │ └────────────┘ │  │ │Effects      │ │  └──────────────────┘ │
│  └────────────────┘  │ └─────────────┘ │                       │
│                      └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Composants PIM

#### 2.2.1 Mode Manager

**Responsabilité** : Orchestrer le fonctionnement global selon le mode sélectionné.

**Interface** :
```
ModeManager
  + setMode(mode: 'live' | 'test'): void
  + start(): void
  + stop(): void
  + getMode(): string
  + onStateUpdate(callback: (state: EngineState) => void): void
```

**Machine à états** :
```
         ┌────────────────────────────┐
         │                            │
    ┌────▼─────┐   start()    ┌──────┴──────┐
    │  IDLE    ├─────────────►│  RUNNING    │
    │          │◄─────────────┤             │
    └──────────┘   stop()     └─────────────┘
                                    │
                              switchMode()
                                    │
                              ┌─────▼─────┐
                              │ SWITCHING │
                              │ (fade out │
                              │  / in)    │
                              └─────┬─────┘
                                    │
                                    ▼
                              ┌───────────┐
                              │  RUNNING  │
                              │ (new mode)│
                              └───────────┘
```

#### 2.2.2 Engine Model

**Responsabilité** : Calculer l'état du moteur à chaque pas de temps.

**Sous-composants** :

| Composant | Rôle |
|-----------|------|
| TorqueCalculator | Interpoler la courbe de couple, appliquer le facteur d'accélérateur |
| TransmissionModel | Calculer RPM ↔ vitesse, gérer les passages de rapports |
| VehicleDynamics | Simuler les forces et l'accélération (mode Test uniquement) |
| TurboModel | Simuler le lag turbo et la pression de suralimentation |

**Flux de données (mode Live)** :
```
Capteurs → [vitesse, accélération]
  → TransmissionModel.speedToRPM(vitesse, rapport)
  → TorqueCalculator.getTorque(RPM, accélération_mappée_sur_throttle)
  → TurboModel.update(RPM, throttle, dt)
  → EngineState mis à jour
  → AudioSynthesizer.update(EngineState)
```

**Flux de données (mode Test)** :
```
UI → [throttle, brake, gear_command]
  → TorqueCalculator.getTorque(RPM, throttle)
  → VehicleDynamics.computeAcceleration(torque, gear, speed)
  → Intégration: speed += accel * dt
  → TransmissionModel.speedToRPM(speed, gear)
  → TurboModel.update(RPM, throttle, dt)
  → EngineState mis à jour
  → AudioSynthesizer.update(EngineState)
```

#### 2.2.3 Sensor Adapter

**Responsabilité** : Abstraire l'accès aux capteurs physiques.

**Interface** :
```
SensorAdapter
  + requestPermissions(): Promise<boolean>
  + startTracking(): void
  + stopTracking(): void
  + onSpeedUpdate(callback: (speedMs: number, accuracy: number) => void)
  + onAccelerationUpdate(callback: (accelMs2: Vector3) => void)
  + isGpsAvailable(): boolean
```

**Sous-composant : SensorFusion (filtre de Kalman)**
```
SensorFusion
  + predict(dt: number): void
  + updateGps(speedMs: number): void
  + updateAccelerometer(accelMs2: number): void
  + getSpeed(): number
  + getAcceleration(): number
```

#### 2.2.4 Audio Synthesizer

**Responsabilité** : Générer le son du moteur en temps réel.

**Interface** :
```
AudioSynthesizer
  + initialize(profile: EngineProfile): void
  + start(): void
  + stop(): void
  + update(state: EngineState): void
  + setProfile(profile: EngineProfile): void
  + setVolume(volume: number): void
```

**Architecture interne** :
```
                    ┌─────────────────────────────────┐
                    │       Audio Synthesizer          │
                    │                                  │
  EngineState ─────►│  ┌─────────────────────────────┐│
  (rpm, throttle,   │  │   Harmonic Generator        ││
   gear, boost)     │  │   (AudioWorklet)             ││
                    │  │                              ││
                    │  │   f_n = n × RPM/60           ││
                    │  │   A_n = f(n, throttle, type) ││
                    │  └──────────┬──────────────────┘│
                    │             │                    │
                    │  ┌──────────▼──────────────────┐│
                    │  │   Exhaust Filter Chain       ││
                    │  │   (LPF + Peaking EQ)         ││
                    │  └──────────┬──────────────────┘│
                    │             │                    │
                    │  ┌──────────▼──────────────────┐│
                    │  │   Turbo Layer (optionnel)    ││
                    │  │   (Oscillator + BPF + BOV)   ││
                    │  └──────────┬──────────────────┘│
                    │             │                    │
                    │  ┌──────────▼──────────────────┐│
                    │  │   Noise Layer               ││
                    │  │   (Combustion noise)         ││
                    │  └──────────┬──────────────────┘│
                    │             │                    │
                    │  ┌──────────▼──────────────────┐│
                    │  │   Master Gain + Limiter      ││
                    │  └──────────┬──────────────────┘│
                    │             │                    │
                    └─────────────┼────────────────────┘
                                  │
                                  ▼
                            Audio Output
```

### 2.3 Diagramme de séquence — Mode Live

```
Utilisateur     UI          ModeManager    SensorAdapter    EngineModel    AudioSynth
    │            │               │               │               │              │
    │──select ──►│               │               │               │              │
    │  profile   │               │               │               │              │
    │            │──loadProfile─►│               │               │              │
    │            │               │───────────────────────────────►│──init()─────►│
    │            │               │               │               │              │
    │──"Start"─►│               │               │               │              │
    │            │──start('live')►│               │               │              │
    │            │               │──requestPerms─►│               │              │
    │            │               │◄──granted──────│               │              │
    │            │               │               │──startTrack──►│              │
    │            │               │                               │──start()───►│
    │            │               │                               │              │
    │            │               │          ┌────Loop 60Hz───────┤              │
    │            │               │          │    │               │              │
    │            │               │          │ GPS│──updateGps───►│              │
    │            │               │          │    │               │              │
    │            │               │          │Accel──updateAccel─►│              │
    │            │               │          │    │               │              │
    │            │               │          │    │──getSpeed()──►│              │
    │            │               │          │    │──getAccel()──►│              │
    │            │               │          │    │               │──compute───►│
    │            │               │          │    │               │  state      │
    │            │               │          │    │               │──update()──►│
    │            │               │          │    │               │     (audio  │
    │            │               │          │    │               │      params)│
    │            │◄──────────────────────────────updateDashboard─│              │
    │            │               │          └────────────────────┤              │
```

### 2.4 Modèle de données PIM

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  EngineProfile   │     │   EngineState     │     │  AudioParams     │
├─────────────────┤     ├──────────────────┤     ├──────────────────┤
│ id              │     │ rpm              │     │ fundamentalHz    │
│ name            │     │ throttle         │     │ harmonicAmps[]   │
│ cylinders       │     │ brake            │     │ exhaustCutoffHz  │
│ type            │     │ gear             │     │ exhaustResonanceHz│
│ aspiration      │     │ speedMs          │     │ turboFreqHz      │
│ torqueCurve[]   │     │ accelerationMs2  │     │ turboAmplitude   │
│ gearRatios[]    │     │ torqueNm         │     │ noiseLevel       │
│ finalDrive      │     │ powerKw          │     │ masterGain       │
│ exhaustType     │     │ boostBar         │     └──────────────────┘
│ turboConfig?    │     │ isShifting       │
│ vehicleParams   │     │ gpsAvailable     │
└─────────────────┘     └──────────────────┘
```

---

## 3. PSM — Platform Specific Model (Modèle spécifique à la plateforme)

Le PSM décrit l'implémentation concrète avec les technologies choisies.

### 3.1 Choix technologiques

| Aspect | Technologie | Justification |
|--------|-------------|---------------|
| Runtime | Navigateur Web (PWA) | Portabilité maximale (iOS + Android), pas de store |
| Langage | TypeScript | Typage fort, maintenabilité |
| Framework UI | Vanilla TS ou Preact | Léger, performance critique sur mobile |
| Audio | Web Audio API + AudioWorklet | Seule option pour audio temps réel dans le navigateur |
| Capteurs | Geolocation API + DeviceMotion API | APIs standard W3C |
| Build | Vite | Bundling rapide, support TS natif |
| Stockage | localStorage + IndexedDB | Persistance locale sans backend |
| Déploiement | GitHub Pages ou Vercel | HTTPS gratuit, CI/CD simple |

### 3.2 Structure des fichiers

```
engineSimulator/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── manifest.json                    # PWA manifest
├── sw.js                            # Service Worker
├── docs/
│   ├── SPECS.md
│   ├── ARCHITECTURE.md
│   └── ALGORITHMS.md
├── src/
│   ├── main.ts                      # Point d'entrée
│   ├── app.ts                       # Mode Manager / orchestrateur
│   │
│   ├── domain/                      # Couche domaine (logique métier pure)
│   │   ├── engine-model.ts          # Calcul couple, puissance
│   │   ├── transmission.ts          # Gestion des rapports, RPM ↔ vitesse
│   │   ├── vehicle-dynamics.ts      # Simulation physique (mode Test)
│   │   ├── turbo-model.ts           # Simulation turbo / BOV
│   │   └── types.ts                 # Interfaces EngineProfile, EngineState
│   │
│   ├── audio/                       # Couche audio
│   │   ├── audio-engine.ts          # Orchestrateur audio (AudioContext, routing)
│   │   ├── engine-worklet.ts        # AudioWorkletProcessor (synthèse harmonique)
│   │   ├── exhaust-filter.ts        # Chaîne de filtres échappement
│   │   ├── turbo-audio.ts           # Couche son turbo + BOV
│   │   └── noise-generator.ts       # Bruit de combustion
│   │
│   ├── sensors/                     # Couche capteurs
│   │   ├── gps-reader.ts            # Wrapper Geolocation API
│   │   ├── accel-reader.ts          # Wrapper DeviceMotion API
│   │   ├── sensor-fusion.ts         # Filtre de Kalman
│   │   └── permissions.ts           # Gestion des permissions (iOS/Android)
│   │
│   ├── ui/                          # Couche présentation
│   │   ├── dashboard.ts             # Tachymètre, vitesse, indicateurs
│   │   ├── controls.ts              # Accélérateur, frein, rapports
│   │   ├── profile-selector.ts      # Sélection du profil moteur
│   │   └── styles.css               # Styles globaux
│   │
│   └── data/                        # Données statiques
│       └── profiles/
│           ├── honda-k20a.json
│           ├── toyota-2gr-fe.json
│           ├── ford-coyote-50.json
│           ├── bmw-b58.json
│           ├── ferrari-f136.json
│           └── vw-20-tdi.json
│
└── public/
    ├── icons/                       # Icônes PWA
    └── audio/                       # Samples audio (V2, si approche hybride)
```

### 3.3 Mapping PIM → PSM

| Composant PIM | Implémentation PSM |
|---------------|-------------------|
| ModeManager | `app.ts` — classe `App` avec machine à états |
| TorqueCalculator | `domain/engine-model.ts` — interpolation linéaire sur `torqueCurve[]` |
| TransmissionModel | `domain/transmission.ts` — formule RPM ↔ vitesse, shift logic |
| VehicleDynamics | `domain/vehicle-dynamics.ts` — intégration d'Euler semi-implicite |
| TurboModel | `domain/turbo-model.ts` — filtre passe-bas 1er ordre |
| SensorAdapter | `sensors/gps-reader.ts` + `sensors/accel-reader.ts` |
| SensorFusion | `sensors/sensor-fusion.ts` — filtre de Kalman 2D [vitesse, accélération] |
| AudioSynthesizer | `audio/audio-engine.ts` — orchestre AudioContext + AudioWorklet |
| HarmonicGenerator | `audio/engine-worklet.ts` — `AudioWorkletProcessor` avec synthèse additive |
| ExhaustFilter | `audio/exhaust-filter.ts` — `BiquadFilterNode` (lowpass + peaking) |
| DashboardView | `ui/dashboard.ts` — Canvas 2D ou SVG pour le tachymètre |
| ControlsView | `ui/controls.ts` — Touch events pour accélérateur/frein |
| ProfileSelector | `ui/profile-selector.ts` — Liste sélectionnable |
| StorageAdapter | `localStorage` pour settings, `import` JSON pour profils |

### 3.4 Graphe de dépendances

```
main.ts
  └── App (app.ts)
        ├── ProfileLoader (data/profiles/*.json)
        ├── SensorManager (sensors/)
        │     ├── GpsReader
        │     ├── AccelReader
        │     └── SensorFusion (KalmanFilter)
        ├── EngineSimulator (domain/)
        │     ├── EngineModel
        │     ├── Transmission
        │     ├── VehicleDynamics
        │     └── TurboModel
        ├── AudioEngine (audio/)
        │     ├── EngineWorklet (AudioWorkletProcessor)
        │     ├── ExhaustFilter
        │     ├── TurboAudio
        │     └── NoiseGenerator
        └── UI (ui/)
              ├── Dashboard
              ├── Controls
              └── ProfileSelector
```

### 3.5 Communication AudioWorklet

L'AudioWorklet tourne dans un thread séparé. Communication via `AudioParam` (pour les paramètres continus) et `MessagePort` (pour les changements de profil) :

```
Thread principal (60Hz)                    Thread audio (44100Hz)
┌──────────────────┐                      ┌──────────────────────┐
│  App / Engine    │                      │  EngineWorkletProc.  │
│  Model           │                      │                      │
│                  │   AudioParam.rpm     │                      │
│  rpm: 3500 ──────┼──────────────────────►│  process() {         │
│  throttle: 0.7 ──┼──────────────────────►│    // read params    │
│                  │   AudioParam.throttle │    // compute harmonics│
│                  │                      │    // write output    │
│                  │   MessagePort        │  }                    │
│  newProfile ─────┼──────────────────────►│                      │
│                  │                      │  onMessage() {        │
│                  │                      │    // reconfigure     │
│                  │                      │  }                    │
└──────────────────┘                      └──────────────────────┘
```

### 3.6 Déploiement PWA

```yaml
# manifest.json
{
  "name": "Engine Simulator",
  "short_name": "EngSim",
  "display": "fullscreen",
  "orientation": "landscape",
  "background_color": "#1a1a2e",
  "theme_color": "#e94560",
  "start_url": "/",
  "scope": "/"
}
```

**Exigences** :
- HTTPS (obligatoire pour Geolocation + DeviceMotion)
- Service Worker pour le mode offline (les profils et l'app doivent fonctionner sans réseau)
- Manifest pour l'installation sur l'écran d'accueil
- Orientation paysage préférée pour le tableau de bord

---

## 4. Traçabilité CIM → PIM → PSM

| Règle métier (CIM) | Composant PIM | Implémentation PSM |
|---------------------|---------------|-------------------|
| RM-01 : RPM = f(vitesse, rapport) | TransmissionModel | `transmission.ts` : `speedToRPM()` |
| RM-02 : Couple = f(RPM, throttle) | TorqueCalculator | `engine-model.ts` : `getTorque()` |
| RM-03 : Son = f(RPM, charge, cylindres) | AudioSynthesizer | `engine-worklet.ts` : `process()` |
| RM-04 : Passage rapport haut | TransmissionModel | `transmission.ts` : `checkUpshift()` |
| RM-05 : Rétrogradage | TransmissionModel | `transmission.ts` : `checkDownshift()` |
| RM-06 : Turbo lag | TurboModel | `turbo-model.ts` : `update()` |
| RM-07 : BOV | TurboModel + AudioSynth | `turbo-model.ts` + `turbo-audio.ts` |
| RM-08 : Limites RPM | EngineModel | `engine-model.ts` : `clampRPM()` |
