# Étude des algorithmes — Engine Simulator

Étude détaillée des algorithmes nécessaires pour les deux modes du simulateur (Live et Test), la synthèse sonore, et la modélisation moteur.

---

## Table des matières

1. [Algorithmes du mode Live (capteurs)](#1-algorithmes-du-mode-live-capteurs)
2. [Algorithmes du mode Test (simulation)](#2-algorithmes-du-mode-test-simulation)
3. [Algorithmes communs (modèle moteur)](#3-algorithmes-communs-modèle-moteur)
4. [Algorithmes de synthèse sonore](#4-algorithmes-de-synthèse-sonore)
5. [Récapitulatif des complexités](#5-récapitulatif-des-complexités)

---

## 1. Algorithmes du mode Live (capteurs)

### 1.1 Lecture GPS et extraction de la vitesse

**Entrée** : `GeolocationPosition` (~1 Hz)
**Sortie** : Vitesse en m/s, fiabilité

```
Algorithme: GPS_READ
─────────────────────────
À chaque callback watchPosition(position):
  speed_ms ← position.coords.speed
  accuracy ← position.coords.accuracy

  SI speed_ms est null OU accuracy > 20m:
    Marquer comme non fiable
    RETOUR

  speed_kmh ← speed_ms × 3.6
  Envoyer (speed_ms, accuracy, timestamp) au filtre de Kalman
```

**Complexité** : O(1) par lecture.

### 1.2 Lecture accéléromètre et filtrage

**Entrée** : `DeviceMotionEvent.acceleration` (~60 Hz, 3 axes)
**Sortie** : Accélération longitudinale filtrée

#### 1.2.1 Filtre passe-bas EMA (Exponential Moving Average)

Élimine le bruit haute fréquence (vibrations du véhicule, bruit capteur).

```
Algorithme: LOW_PASS_FILTER(raw, prev, alpha)
───────────────────────────────────────────────
filtered ← prev + alpha × (raw - prev)
RETOUR filtered
```

**Paramètre** : `alpha` ∈ [0.05, 0.5]
- Faible alpha (0.05-0.1) : fort lissage, latence accrue (~100ms)
- Fort alpha (0.2-0.5) : réactif mais bruité

**Recommandation** : `alpha = 0.15` pour un bon compromis.

**Complexité** : O(1) par échantillon.

#### 1.2.2 Extraction de l'accélération longitudinale

Le téléphone peut être dans n'importe quelle orientation. Il faut projeter l'accélération 3D sur l'axe de déplacement.

**Approche simplifiée (téléphone fixé, orientation connue)** :

```
Algorithme: EXTRACT_LONGITUDINAL(accel, phoneOrientation)
─────────────────────────────────────────────────────────
// phoneOrientation déterminé lors de la calibration
SI téléphone en portrait vertical (fixé au tableau de bord):
  longitudinal ← accel.y    // axe Y = avant/arrière
SINON SI téléphone à plat (posé sur siège):
  longitudinal ← accel.x OU accel.y   // selon orientation
FIN SI

RETOUR LOW_PASS_FILTER(longitudinal, prev, 0.15)
```

**Approche avancée (utilisant DeviceOrientation + GPS heading)** :

```
Algorithme: EXTRACT_LONGITUDINAL_ADVANCED(accel, orientation, gpsHeading)
──────────────────────────────────────────────────────────────────────────
// 1. Transformer accéléromètre de repère appareil → repère terrestre
earthAccel ← rotateToEarthFrame(accel, orientation.alpha, orientation.beta, orientation.gamma)

// 2. Projeter sur la direction de déplacement (heading GPS)
headingRad ← gpsHeading × π / 180
longitudinal ← earthAccel.x × sin(headingRad) + earthAccel.y × cos(headingRad)
lateral      ← earthAccel.x × cos(headingRad) - earthAccel.y × sin(headingRad)

RETOUR (longitudinal, lateral)
```

**Complexité** : O(1) par échantillon (quelques multiplications matricielles 3×3).

### 1.3 Fusion GPS + Accéléromètre (Filtre de Kalman 1D)

**Objectif** : Combiner la vitesse GPS (précise mais lente, ~1Hz) avec l'accéléromètre (rapide ~60Hz mais dérive) pour obtenir une estimation de vitesse fluide et précise.

**État** : x = [vitesse, accélération]ᵀ

#### Algorithme complet

```
Algorithme: KALMAN_FUSION
──────────────────────────

INITIALISATION:
  x ← [0, 0]                           // [vitesse, accélération]
  P ← [[100, 0], [0, 10]]             // Covariance initiale (forte incertitude)
  Q ← [[0.1, 0], [0, 1.0]]           // Bruit de processus
  R_gps ← 2.0                          // Variance mesure GPS (m/s)²
  R_accel ← 1.0                        // Variance mesure accéléromètre (m/s²)²

PRÉDICTION (appelée à chaque pas de temps dt, ~60Hz):
  // Matrice de transition
  F ← [[1, dt], [0, 1]]

  // Prédire l'état
  x[0] ← x[0] + x[1] × dt            // vitesse += accélération × dt
  // x[1] inchangé (modèle de marche aléatoire pour l'accélération)

  // Prédire la covariance
  P ← F × P × Fᵀ + Q × dt

MISE À JOUR GPS (appelée à ~1Hz quand donnée disponible):
  z ← vitesse_gps_mesurée
  H ← [1, 0]                           // On mesure la vitesse directement

  y ← z - x[0]                         // Innovation
  S ← P[0][0] + R_gps                  // Covariance de l'innovation
  K ← [P[0][0]/S, P[1][0]/S]          // Gain de Kalman

  x[0] ← x[0] + K[0] × y              // Corriger vitesse
  x[1] ← x[1] + K[1] × y              // Corriger accélération

  P ← (I - K × H) × P                 // Mettre à jour covariance

MISE À JOUR ACCÉLÉROMÈTRE (appelée à ~60Hz):
  z ← accélération_longitudinale_mesurée
  H ← [0, 1]                           // On mesure l'accélération directement

  y ← z - x[1]
  S ← P[1][1] + R_accel
  K ← [P[0][1]/S, P[1][1]/S]

  x[0] ← x[0] + K[0] × y
  x[1] ← x[1] + K[1] × y

  P ← (I - K × H) × P

SORTIE:
  vitesse_estimée ← max(0, x[0])       // Vitesse ne peut pas être négative
  accélération_estimée ← x[1]
```

**Complexité** : O(1) par pas de temps (matrices 2×2 seulement).

**Comportement attendu** :
- Quand le GPS est disponible : la vitesse est précise et stable
- Quand le GPS est perdu (tunnel) : l'accéléromètre maintient une estimation qui dérive lentement
- La transition est transparente grâce au gain de Kalman adaptatif

### 1.4 Gestion de la perte GPS (Dead Reckoning)

```
Algorithme: GPS_LOSS_HANDLER
─────────────────────────────
GPS_TIMEOUT ← 5000 ms

À chaque cycle:
  elapsed ← now - dernière_position_gps

  SI elapsed > GPS_TIMEOUT:
    gps_available ← false
    // Augmenter l'incertitude du processus
    Q[0][0] ← Q[0][0] × 1.01          // La confiance en vitesse diminue
    // L'accéléromètre seul fait la prédiction
    // Afficher indicateur de dégradation

  SI nouvelle position GPS reçue:
    gps_available ← true
    Q[0][0] ← Q_initial[0][0]          // Restaurer les paramètres normaux
    // Le filtre de Kalman se recale automatiquement
```

### 1.5 Mapping accélération → throttle (mode Live)

En mode Live, on n'a pas de pédale d'accélérateur. On déduit la "charge moteur" de l'accélération mesurée.

```
Algorithme: ACCEL_TO_THROTTLE(acceleration, speed)
───────────────────────────────────────────────────
// Estimer la résistance à la vitesse actuelle
F_resistance ← 0.5 × Cd × rho × A × speed² + Crr × m × g

// L'accélération demande une force nette
F_net ← m × acceleration

// La force totale nécessaire (traction + résistance)
F_required ← F_net + F_resistance

// Force max disponible dans le rapport actuel
T_max ← torqueCurve.interpolate(rpm)
F_max ← T_max × gear_ratio × final_drive / wheel_radius

// Throttle = fraction de la force max utilisée
throttle ← clamp(F_required / F_max, 0, 1)

// Si accélération négative → frein moteur
SI acceleration < -0.5:
  throttle ← 0
  engine_braking ← true
FIN SI

RETOUR throttle
```

---

## 2. Algorithmes du mode Test (simulation)

### 2.1 Simulation physique du véhicule

**Entrée** : Position d'accélérateur, frein, rapport engagé
**Sortie** : Vitesse, accélération, RPM

```
Algorithme: VEHICLE_SIMULATION(dt)    // dt ~ 16ms (60Hz)
──────────────────────────────────────
// 1. Couple moteur
torque_max ← INTERPOLATE_TORQUE(rpm, torqueCurve)
torque ← torque_max × throttle^1.5     // Non-linéarité du papillon

// 2. Si turbo, appliquer le boost (avec lag)
SI profil.aspiration == 'turbo':
  boost ← TURBO_UPDATE(rpm, throttle, dt)
  torque ← torque × (1 + boost_multiplier × boost)
FIN SI

// 3. Force de traction aux roues
F_traction ← torque × gear_ratio × final_drive × eta / wheel_radius

// 4. Limiter par l'adhérence (simplifié)
F_grip_max ← mu × m × g × weight_fraction
F_traction ← min(F_traction, F_grip_max)

// 5. Force de freinage
F_brake ← brake × brake_force_max

// 6. Forces de résistance
F_drag ← 0.5 × Cd × rho × A × speed²
F_rolling ← Crr × m × g

// 7. Force nette
F_net ← F_traction - F_brake - F_drag - F_rolling

// 8. Accélération
m_effective ← m × (1 + inertia_factor[gear])   // inertie rotative
acceleration ← F_net / m_effective

// 9. Intégration semi-implicite d'Euler
speed ← max(0, speed + acceleration × dt)

// 10. RPM depuis la vitesse
rpm ← SPEED_TO_RPM(speed, gear)
rpm ← clamp(rpm, idle_rpm, redline_rpm)

// 11. Shift logic (si automatique)
SHIFT_CHECK(rpm, throttle, gear)
```

### 2.2 Interpolation de la courbe de couple

**Entrée** : RPM courant, table `torqueCurve = [[rpm1, T1], [rpm2, T2], ...]`
**Sortie** : Couple interpolé en Nm

```
Algorithme: INTERPOLATE_TORQUE(rpm, curve)
───────────────────────────────────────────
// Trouver l'intervalle encadrant
i ← 0
TANT QUE i < len(curve)-1 ET curve[i+1][0] < rpm:
  i ← i + 1

SI i >= len(curve)-1:
  RETOUR curve[len(curve)-1][1]          // Au-delà de la table → dernière valeur

// Interpolation linéaire
rpm_low  ← curve[i][0]
rpm_high ← curve[i+1][0]
T_low    ← curve[i][1]
T_high   ← curve[i+1][1]

t ← (rpm - rpm_low) / (rpm_high - rpm_low)
RETOUR T_low + t × (T_high - T_low)
```

**Variante** : Interpolation par spline cubique monotone (Hermite) pour des courbes plus lisses, utile si peu de points dans la table.

**Complexité** : O(n) avec recherche linéaire, O(log n) avec recherche binaire (n = nombre de points). En pratique n < 15, donc linéaire suffit.

### 2.3 Logique de passage des rapports (mode automatique)

```
Algorithme: SHIFT_CHECK(rpm, throttle, current_gear)
─────────────────────────────────────────────────────
// Seuils adaptatifs selon la charge
upshift_rpm   ← peak_power_rpm × (0.60 + 0.35 × throttle)
downshift_rpm ← peak_torque_rpm × (0.40 + 0.20 × throttle)

// Hystérésis temporelle
SI time_since_last_shift < MIN_SHIFT_DELAY (0.8s):
  RETOUR     // Empêcher les oscillations

// Montée de rapport
SI rpm > upshift_rpm ET current_gear < max_gear:
  SHIFT_UP()

// Descente de rapport
SI rpm < downshift_rpm ET current_gear > 1:
  SHIFT_DOWN()

───────────────────────────────────────────────────
Algorithme: SHIFT_UP()
  new_gear ← current_gear + 1
  // RPM dans le nouveau rapport
  rpm_new ← rpm × (gear_ratios[new_gear] / gear_ratios[current_gear])
  // Transition : courte coupure de couple (100ms)
  is_shifting ← true
  schedule(100ms, () => {
    current_gear ← new_gear
    is_shifting ← false
  })

───────────────────────────────────────────────────
Algorithme: SHIFT_DOWN()
  new_gear ← current_gear - 1
  rpm_new ← rpm × (gear_ratios[new_gear] / gear_ratios[current_gear])
  // Rev-match : monter les RPM au niveau cible
  is_shifting ← true
  target_rpm ← rpm_new
  schedule(150ms, () => {
    current_gear ← new_gear
    is_shifting ← false
  })
```

**Exemples de seuils (Honda K20A, redline 8600, peak power 8000, peak torque 7000)** :

| Throttle | Upshift RPM | Downshift RPM |
|----------|-------------|---------------|
| 20% | 5 480 | 3 500 |
| 50% | 6 400 | 4 200 |
| 80% | 7 040 | 4 760 |
| 100% | 7 600 | 4 200 |

### 2.4 Conversion RPM ↔ Vitesse

```
Algorithme: RPM_TO_SPEED(rpm, gear)
────────────────────────────────────
speed_ms ← (rpm × 2π × wheel_radius) / (gear_ratios[gear] × final_drive × 60)
RETOUR speed_ms

Algorithme: SPEED_TO_RPM(speed_ms, gear)
─────────────────────────────────────────
rpm ← (speed_ms × gear_ratios[gear] × final_drive × 60) / (2π × wheel_radius)
RETOUR rpm
```

**Exemple numérique** (Honda K20A, rapport 3, wheel_radius = 0.32m) :
- RPM 5000 → vitesse = (5000 × 2π × 0.32) / (1.481 × 4.1 × 60) = 10,053 / 364.3 = **27.6 m/s = 99.3 km/h**

---

## 3. Algorithmes communs (modèle moteur)

### 3.1 Modèle turbo (lag + boost)

```
Algorithme: TURBO_UPDATE(rpm, throttle, dt)
────────────────────────────────────────────
// Boost cible (proportionnel au throttle et au RPM)
SI rpm < boost_threshold_rpm:
  boost_target ← 0
SINON:
  rpm_factor ← min(1.0, (rpm - boost_threshold_rpm) / 2000)
  boost_target ← max_boost_bar × throttle × rpm_factor
FIN SI

// Constante de temps variable (plus lent à bas régime)
tau ← spool_time_base × (boost_threshold_rpm / max(rpm, boost_threshold_rpm))

// Filtre passe-bas 1er ordre (turbo lag)
boost_actual ← boost_actual + (boost_target - boost_actual) × (dt / tau)

// BOV : déclenché si throttle chute alors que boost > seuil
SI throttle < 0.1 ET boost_actual > 0.3:
  TRIGGER_BOV()
  boost_actual ← boost_actual × 0.5    // Chute rapide de la pression
FIN SI

RETOUR boost_actual
```

**Paramètres typiques** :
| Moteur | max_boost_bar | spool_time (s) | threshold_rpm |
|--------|---------------|-----------------|---------------|
| BMW B58 | 1.2 | 0.5 | 1500 |
| VW 2.0 TDI | 1.8 | 0.8 | 1200 |
| Petit turbo aftermarket | 0.8 | 0.3 | 2500 |
| Gros turbo aftermarket | 1.5 | 1.5 | 3500 |

### 3.2 Calcul de la puissance instantanée

```
Algorithme: COMPUTE_POWER(torque_nm, rpm)
──────────────────────────────────────────
power_watts ← torque_nm × rpm × 2π / 60
power_kw ← power_watts / 1000
power_hp ← power_kw × 1.341           // CV DIN → power_kw × 1.36
RETOUR (power_kw, power_hp)
```

### 3.3 Régulation du ralenti

Quand la vitesse est nulle ou très basse et que l'embrayage est dégagé (neutre ou vitesse basse), le RPM doit se stabiliser au ralenti.

```
Algorithme: IDLE_CONTROL(rpm, speed, gear, throttle, dt)
─────────────────────────────────────────────────────────
SI speed < 2.0 m/s ET throttle < 0.05:
  // Régulation vers le RPM de ralenti
  target_rpm ← idle_rpm
  rpm ← rpm + (target_rpm - rpm) × (dt / 0.3)    // Convergence en ~0.3s

SI throttle > 0 ET gear == 0 (neutre):
  // Rev libre (pas de charge)
  // RPM monte proportionnellement au throttle
  rpm_target ← idle_rpm + throttle × (redline_rpm - idle_rpm) × 0.8
  // Montée rapide, descente plus lente
  SI rpm_target > rpm:
    tau ← 0.15                // Montée rapide
  SINON:
    tau ← 0.4                 // Descente plus lente (inertie du volant moteur)
  rpm ← rpm + (rpm_target - rpm) × (dt / tau)

RETOUR rpm
```

---

## 4. Algorithmes de synthèse sonore

### 4.1 Fréquences fondamentales

```
Algorithme: COMPUTE_FREQUENCIES(rpm, cylinders)
────────────────────────────────────────────────
f_crank  ← rpm / 60                            // Hz, fréquence du vilebrequin
f_firing ← (rpm × cylinders) / 120             // Hz, fréquence d'allumage (4 temps)

RETOUR (f_crank, f_firing)
```

**Table de référence à 6000 RPM** :

| Moteur | Cylindres | f_crank (Hz) | f_firing (Hz) |
|--------|-----------|-------------|---------------|
| Inline-4 | 4 | 100 | 200 |
| V6 | 6 | 100 | 300 |
| V8 | 8 | 100 | 400 |
| V10 | 10 | 100 | 500 |
| V12 | 12 | 100 | 600 |

### 4.2 Synthèse additive (coeur de l'algorithme audio)

L'algorithme tourne dans l'AudioWorklet à 44100 Hz (ou 48000 Hz).

```
Algorithme: ADDITIVE_SYNTHESIS(rpm, throttle, cylinders, engine_type)
─────────────────────────────────────────────────────────────────────
// Exécuté pour chaque échantillon audio (44100 fois par seconde)

CONSTANTES:
  N_HARMONICS ← 24                     // Nombre d'harmoniques
  SAMPLE_RATE ← 44100
  spectral_rolloff ← 0.9               // Pente du spectre (alpha)
  firing_boost ← 3.0                   // Boost des harmoniques d'allumage
  noise_amp ← 0.03                     // 3% de jitter en amplitude
  noise_freq ← 0.003                   // 0.3% de jitter en fréquence

f_crank ← rpm / 60

// Calcul de l'incrément de phase pour chaque harmonique
POUR h DE 1 À N_HARMONICS:
  f_h ← h × f_crank                    // Fréquence de l'harmonique h
  phase_inc[h] ← f_h / SAMPLE_RATE

  // Amplitude de base (décroissance spectrale)
  amp[h] ← 1.0 / h^spectral_rolloff

  // Boost des harmoniques liées à l'ordre d'allumage
  half_cyl ← cylinders / 2
  SI h MOD half_cyl == 0:
    amp[h] ← amp[h] × firing_boost

  // Modulation par la charge (throttle)
  // Plus de hautes fréquences à plein gaz
  load_factor ← 0.3 + 0.7 × throttle × exp(-h × 0.02 × (1 - throttle))
  amp[h] ← amp[h] × load_factor

  // Micro-variation aléatoire (évite le son "synthétique")
  amp[h] ← amp[h] × (1 + noise_amp × slow_random())
  f_h_actual ← f_h × (1 + noise_freq × slow_random())

FIN POUR

// Somme des harmoniques
sample ← 0
POUR h DE 1 À N_HARMONICS:
  phases[h] ← phases[h] + phase_inc[h]
  SI phases[h] >= 1.0: phases[h] ← phases[h] - 1.0
  sample ← sample + amp[h] × sin(2π × phases[h])
FIN POUR

// Normalisation
sample ← sample × master_gain

RETOUR sample
```

**Spécificités par type de moteur** :

| Type | Harmoniques dominantes | Caractéristique sonore |
|------|----------------------|------------------------|
| Inline-4 | h = 2, 4, 6, 8... (paires) | Son régulier, "bourdonnement" |
| V6 | h = 3, 6, 9, 12... | Son plus grave, harmoniques plus espacées |
| V8 cross-plane | h = 1, 2, 3, 4... (toutes, surtout impaires) | "Burble" caractérique, tir irrégulier |
| V8 flat-plane | h = 4, 8, 12... | Son plus aigu, régulier, type Ferrari |
| Diesel | Harmoniques plus larges, plus de bruit | Claquement caractéristique |

#### Cas spécial : V8 cross-plane

Le vilebrequin en croix produit des intervalles de tir irréguliers (90°-270°-90°-270° par banc). Cela crée des harmoniques aux ordres impairs (1, 3, 5...) qui sont absentes dans les moteurs à tir régulier.

```
Algorithme: V8_CROSSPLANE_HARMONICS(h, base_amp)
──────────────────────────────────────────────────
// Les harmoniques impaires de f_crank sont fortes
SI h MOD 2 == 1:
  amp ← base_amp × 2.5              // Fort boost des impaires
SINON SI h MOD 4 == 0:
  amp ← base_amp × 3.0              // Harmoniques d'allumage (chaque 4e)
SINON:
  amp ← base_amp × 0.5              // Paires non-allumage atténuées

RETOUR amp
```

### 4.3 Chaîne de filtrage d'échappement

Après la synthèse additive, le signal passe par une chaîne de filtres simulant l'échappement.

```
Algorithme: EXHAUST_FILTER_CHAIN(signal, rpm, exhaust_type)
────────────────────────────────────────────────────────────
// 1. Filtre passe-bas (muffler)
SELON exhaust_type:
  "stock":
    cutoff ← 800 + rpm × 0.1           // 800-1600 Hz
    Q ← 0.7
  "sport":
    cutoff ← 1500 + rpm × 0.3          // 1500-4200 Hz
    Q ← 1.5
  "straight-pipe":
    cutoff ← 4000 + rpm × 0.5          // Presque pas de filtrage
    Q ← 0.5

signal ← BIQUAD_LOWPASS(signal, cutoff, Q)

// 2. Résonances d'échappement (1-3 pics)
// Chaque pic simule une résonance du tube d'échappement
POUR CHAQUE resonance DANS exhaust_resonances:
  signal ← BIQUAD_PEAKING(signal, resonance.freq, resonance.Q, resonance.gain_dB)

// 3. Saturation douce (optionnelle, pour agressivité)
SI exhaust_type == "straight-pipe":
  signal ← SOFT_CLIP(signal, threshold=0.8)

RETOUR signal
```

**Résonances typiques** :

| Type d'échappement | Résonance 1 | Résonance 2 | Résonance 3 |
|--------------------|-------------|-------------|-------------|
| Stock | 400 Hz, Q=3, +4dB | 1200 Hz, Q=2, +2dB | — |
| Sport | 600 Hz, Q=5, +8dB | 1800 Hz, Q=3, +4dB | 3500 Hz, Q=2, +3dB |
| Straight-pipe | 300 Hz, Q=8, +10dB | 900 Hz, Q=5, +6dB | 2700 Hz, Q=3, +4dB |

### 4.4 Synthèse du son turbo

```
Algorithme: TURBO_AUDIO(boost_actual, rpm, dt)
───────────────────────────────────────────────
// 1. Sifflement turbo (Blade Pass Frequency simplifié)
// En pratique, on ne modélise pas les vraies RPM turbo,
// on mappe le boost vers une fréquence audible
turbo_freq ← 2000 + boost_actual × 8000       // 2-10 kHz selon boost
turbo_amp ← boost_actual × 0.15                // Proportionnel au boost

turbo_signal ← turbo_amp × sin(2π × turbo_freq × t)
// Ajouter harmonique
turbo_signal += turbo_amp × 0.3 × sin(2π × turbo_freq × 2 × t)
// Filtrer avec bandpass
turbo_signal ← BIQUAD_BANDPASS(turbo_signal, turbo_freq, Q=5)

// 2. Blow-Off Valve (déclenché par événement)
SI bov_triggered:
  bov_time ← temps depuis déclenchement

  // Enveloppe : attaque rapide, decay lent
  SI bov_time < 0.01:                         // Attack 10ms
    bov_env ← bov_time / 0.01
  SINON:
    bov_env ← exp(-(bov_time - 0.01) / 0.2)  // Decay 200ms

  // Bruit filtré
  bov_signal ← WHITE_NOISE() × bov_env
  bov_signal ← BIQUAD_BANDPASS(bov_signal, 1200, Q=3)

  // Flutter optionnel (modulation d'amplitude)
  flutter ← 0.5 + 0.5 × sin(2π × 25 × bov_time)  // 25 Hz flutter
  bov_signal ← bov_signal × flutter

  SI bov_env < 0.01: bov_triggered ← false

turbo_signal ← turbo_signal + bov_signal

RETOUR turbo_signal
```

### 4.5 Bruit de combustion

Ajoute du "corps" au son en mélangeant du bruit filtré proportionnel à la charge.

```
Algorithme: COMBUSTION_NOISE(throttle, rpm)
────────────────────────────────────────────
// Bruit rose (pink noise) filtré
noise ← PINK_NOISE()

// Amplitude proportionnelle à la charge et au régime
noise_amp ← throttle × 0.05 × (rpm / redline_rpm)

// Filtrage passe-bande autour de la fréquence d'allumage
center_freq ← (rpm × cylinders) / 120
noise ← BIQUAD_BANDPASS(noise, center_freq × 2, Q=1)

RETOUR noise × noise_amp
```

### 4.6 Crépitements à la décélération (V2)

Lors d'un lâcher brutal d'accélérateur à haut régime, des carburants imbrûlés s'enflamment dans l'échappement.

```
Algorithme: DECEL_CRACKLE(throttle, prev_throttle, rpm)
────────────────────────────────────────────────────────
// Détecter un lâcher brutal
throttle_drop ← prev_throttle - throttle

SI throttle_drop > 0.5 ET rpm > 4000:
  crackle_probability ← throttle_drop × (rpm / redline_rpm) × 0.3

  // Générer des "pops" aléatoires pendant ~1 seconde
  SI random() < crackle_probability × dt:
    // Court burst de bruit (1-5ms)
    duration ← 0.001 + random() × 0.004
    amplitude ← 0.2 + random() × 0.3
    freq ← 200 + random() × 800

    TRIGGER_IMPULSE(duration, amplitude, freq)
FIN SI
```

### 4.7 Génération de bruit lent (slow_random)

Pour les micro-variations (section 4.2), on a besoin d'un bruit aléatoire lent (< 20 Hz) :

```
Algorithme: SLOW_RANDOM_GENERATOR
──────────────────────────────────
// Bruit blanc filtré par EMA très agressif
// Appelé à sample_rate mais produit un signal variant à ~5-20 Hz

INITIALISATION:
  value ← 0
  alpha ← 0.0005                       // Très faible = très lent

À CHAQUE ÉCHANTILLON:
  white ← (random() × 2 - 1)           // [-1, 1]
  value ← value + alpha × (white - value)
  RETOUR value
```

### 4.8 Graphe de routage Web Audio API

```
┌──────────────────┐
│ EngineWorklet    │    Thread audio, synthèse additive
│ (AudioWorklet    │    Paramètres: rpm, throttle, cylinders, type
│  Processor)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Lowpass Filter   │    BiquadFilterNode type="lowpass"
│ (Exhaust muffler)│    freq: dynamique selon exhaust_type et rpm
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Peaking EQ 1     │    BiquadFilterNode type="peaking"
│ (Resonance 1)    │    Résonance basse de l'échappement
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Peaking EQ 2     │    BiquadFilterNode type="peaking"
│ (Resonance 2)    │    Résonance haute de l'échappement
└────────┬─────────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼                             │
┌──────────────────┐              │
│ Turbo Oscillator │              │
│ + BOV Noise      │              │
│ (via GainNode)   │              │
└────────┬─────────┘              │
         │                        │
         ▼                        ▼
┌────────────────────────────────────┐
│          Mixer (GainNode)          │
│  Combine engine + turbo + noise    │
└────────────────┬───────────────────┘
                 │
                 ▼
┌──────────────────┐
│ Compressor       │    DynamicsCompressorNode
│ (Limiter)        │    Protège les haut-parleurs
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Master Gain      │    Volume global
└────────┬─────────┘
         │
         ▼
    AudioDestination
    (haut-parleur)
```

---

## 5. Récapitulatif des complexités

| Algorithme | Complexité par appel | Fréquence | Charge CPU |
|-----------|---------------------|-----------|------------|
| GPS Read | O(1) | ~1 Hz | Négligeable |
| Accel Read + Filter | O(1) | ~60 Hz | Négligeable |
| Kalman Predict | O(1) (matrices 2×2) | ~60 Hz | Faible |
| Kalman Update GPS | O(1) | ~1 Hz | Négligeable |
| Kalman Update Accel | O(1) | ~60 Hz | Faible |
| Vehicle Simulation | O(1) | ~60 Hz | Faible |
| Torque Interpolation | O(n), n<15 | ~60 Hz | Négligeable |
| Shift Logic | O(1) | ~60 Hz | Négligeable |
| Turbo Model | O(1) | ~60 Hz | Négligeable |
| **Additive Synthesis** | **O(H)**, H=24 harmoniques | **44100 Hz** | **Dominant** |
| Exhaust Filters | O(1) par filtre | 44100 Hz | Modéré |
| Turbo Audio | O(1) | 44100 Hz | Faible |
| Combustion Noise | O(1) | 44100 Hz | Faible |

**Charge totale estimée** : La synthèse additive avec 24 harmoniques représente ~24 multiplications + additions par échantillon, soit ~1 million d'opérations par seconde. C'est largement dans les capacités d'un AudioWorklet JavaScript. Si on pousse à 40+ harmoniques ou on ajoute un modèle physique, le passage à WebAssembly serait recommandé.

---

## Annexe A : Formules de référence rapide

| Formule | Utilisation |
|---------|-------------|
| `f_crank = RPM / 60` | Fréquence vilebrequin |
| `f_firing = (RPM × cyl) / 120` | Fréquence d'allumage (4 temps) |
| `RPM = (v × Gr × Fd × 60) / (2π × Rw)` | Vitesse → RPM |
| `v = (RPM × 2π × Rw) / (Gr × Fd × 60)` | RPM → Vitesse |
| `P = T × RPM × 2π / 60` | Puissance (W) depuis couple et RPM |
| `F_drag = ½ × Cd × ρ × A × v²` | Force aérodynamique |
| `F_roll = Crr × m × g` | Résistance au roulement |
| `a = F_net / (m × (1 + δ))` | Accélération (avec inertie rotative) |
| `boost += (target - boost) × dt / τ` | Turbo lag (filtre 1er ordre) |
| `filtered = prev + α × (raw - prev)` | Filtre EMA passe-bas |

## Annexe B : Constantes physiques utiles

| Constante | Valeur | Unité |
|-----------|--------|-------|
| g (gravité) | 9.81 | m/s² |
| ρ (air, 15°C, niveau mer) | 1.225 | kg/m³ |
| Vitesse du son (15°C) | 340 | m/s |
| 1 bar | 100 000 | Pa |
| 1 ch (DIN) | 735.5 | W |
| 1 hp | 745.7 | W |
| km/h → m/s | ÷ 3.6 | — |
