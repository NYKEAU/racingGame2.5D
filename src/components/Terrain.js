import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Constants pour la configuration de terrain
const TERRAIN_CONFIG = {
  VISIBLE_CHUNKS_AHEAD: 5, // Nombre de chunks à générer en avance
  VISIBLE_CHUNKS_BEHIND: 5, // Nombre de chunks à conserver derrière
  DECORATION_DENSITY: 0.3, // Densité des décorations (0-1)
  LOD_DISTANCES: {
    HIGH: 100, // Distance pour le niveau de détail élevé
    MEDIUM: 200, // Distance pour le niveau de détail moyen
    LOW: 400, // Distance pour le niveau de détail bas
  },
};

// Types d'éléments de décor
const DECORATION_TYPES = {
  ROCK: 'rock',
  TREE: 'tree',
  SIGN: 'sign',
};

export default class Terrain {
  constructor(scene, physicsWorld, seed = Math.floor(Math.random() * 1000000)) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.terrainMeshes = [];
    this.segmentWidth = 40;
    this.segmentDepth = 8; // Ajouter la profondeur du terrain
    this.visibleSegments = 15; // Ajouter le nombre de segments visibles
    this.decorations = [];

    // Utiliser la SEED pour la génération du terrain
    this.seed = seed;
    this.noiseOffsetX = seed % 10000;
    this.noiseOffsetY = (seed % 1000) * 10;

    // Historique des types de chunks générés
    this.chunkHistory = [];

    // Matériau unique pour le terrain
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d572c,
      roughness: 0.8,
      metalness: 0.2,
    });

    // Matériau pour les corps physiques
    this.terrainPhysicsMaterial = new CANNON.Material('terrain');

    // Initialiser le terrain
    this.initialTerrainWidth = 400; // 10 segments pour commencer (40x10)
    this.initialize();
  }

  // Initialisation des ressources pour les décorations
  initializeDecorationResources() {
    // Géométries partagées pour les décorations
    this.sharedGeometries = {
      rock: [
        new THREE.DodecahedronGeometry(1.0, 0), // Rocher grand
        new THREE.DodecahedronGeometry(0.7, 0), // Rocher moyen
        new THREE.DodecahedronGeometry(0.4, 0), // Rocher petit
      ],
      tree: [
        // Tronc
        new THREE.CylinderGeometry(0.2, 0.3, 2.0, 8),
        // Feuillage
        new THREE.ConeGeometry(1.5, 3.0, 8),
      ],
      sign: [
        // Poteau
        new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6),
        // Panneau
        new THREE.BoxGeometry(1.5, 1.0, 0.1),
      ],
    };

    // Matériaux partagés pour les décorations
    this.sharedMaterials = {
      rock: new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.9,
        metalness: 0.1,
      }),
      treeTrunk: new THREE.MeshStandardMaterial({
        color: 0x704214,
        roughness: 0.9,
        metalness: 0.0,
      }),
      treeLeaves: new THREE.MeshStandardMaterial({
        color: 0x38761d,
        roughness: 0.8,
        metalness: 0.0,
      }),
      signPost: new THREE.MeshStandardMaterial({
        color: 0x6d4c41,
        roughness: 0.8,
        metalness: 0.1,
      }),
      signPanel: new THREE.MeshStandardMaterial({
        color: 0xf5f5f5,
        roughness: 0.5,
        metalness: 0.2,
      }),
    };
  }

  // Obtenir un objet du pool ou en créer un nouveau
  getFromPool(poolName, createFunc) {
    const pool = this.objectPools[poolName];
    if (pool && pool.length > 0) {
      return pool.pop();
    }
    return createFunc();
  }

  // Retourner un objet au pool
  returnToPool(poolName, object) {
    if (!this.objectPools[poolName]) {
      this.objectPools[poolName] = [];
    }
    this.objectPools[poolName].push(object);
  }

  // Initialisation du terrain
  initialize() {
    const initialSegments = 30;

    // Créer des segments initiaux avec un chevauchement pour éviter les trous
    for (let i = -5; i < initialSegments; i++) {
      this.createTerrainSegment(i * this.segmentWidth);
    }

    // S'assurer que l'historique des chunks est correctement initialisé
    this.chunkHistory = this.terrainMeshes.map((segment) => segment.chunkType);

    console.log(
      `Terrain initialisé avec ${this.terrainMeshes.length} segments`
    );
  }

  // Utiliser la SEED pour générer un nombre pseudo-aléatoire déterministe
  seededRandom() {
    // Utiliser un algorithme simple LCG (Linear Congruential Generator)
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  // Sélectionner un type de terrain basé sur la difficulté et la SEED
  selectChunkType(difficulty) {
    // Utiliser notre générateur déterministe
    const rand = this.seededRandom();

    // La sélection du type est maintenant déterministe mais dépend toujours de la difficulté
    if (difficulty < 0.15) {
      // Début du jeu: plutôt des collines ou des plateaux
      return rand < 0.7 ? 'hills' : 'plateau';
    } else if (difficulty < 0.3) {
      // Zone 15-30%: introduire des ramps et quelques washboards
      if (rand < 0.5) return 'hills';
      else if (rand < 0.7) return 'plateau';
      else if (rand < 0.9) return 'ramp';
      else return 'washboard';
    } else if (difficulty < 0.5) {
      // Zone 30-50%: ajouter des vallées et quelques trous
      if (rand < 0.3) return 'hills';
      else if (rand < 0.5) return 'ramp';
      else if (rand < 0.7) return 'washboard';
      else if (rand < 0.9) return 'valley';
      else return 'gap';
    } else if (difficulty < 0.7) {
      // Zone 50-70%: augmenter la difficulté avec plus de gaps et de washboards
      if (rand < 0.2) return 'hills';
      else if (rand < 0.4) return 'plateau';
      else if (rand < 0.6) return 'washboard';
      else if (rand < 0.8) return 'valley';
      else return 'gap';
    } else {
      // Zone 70-100%: maximum de difficulté
      if (rand < 0.15) return 'hills';
      else if (rand < 0.35) return 'ramp';
      else if (rand < 0.55) return 'washboard';
      else if (rand < 0.75) return 'valley';
      else return 'gap';
    }
  }

  // Fonctions d'interpolation pour des transitions douces

  // Interpolation cubique (plus douce que linéaire)
  cubicInterpolation(t) {
    return t * t * (3 - 2 * t);
  }

  // Interpolation quintique (encore plus douce)
  quinticInterpolation(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Courbe de Bézier cubique
  bezierInterpolation(t, p0, p1, p2, p3) {
    const oneMinusT = 1 - t;
    return (
      oneMinusT * oneMinusT * oneMinusT * p0 +
      3 * oneMinusT * oneMinusT * t * p1 +
      3 * oneMinusT * t * t * p2 +
      t * t * t * p3
    );
  }

  // Interpolation entre deux hauteurs avec contrôle de la courbe
  smoothTransition(t, startHeight, endHeight, smoothness = 'cubic') {
    // Sélectionner la fonction d'interpolation en fonction de la douceur désirée
    let interpolationFunction;
    switch (smoothness) {
      case 'linear':
        interpolationFunction = (t) => t;
        break;
      case 'cubic':
        interpolationFunction = this.cubicInterpolation;
        break;
      case 'quintic':
        interpolationFunction = this.quinticInterpolation;
        break;
      default:
        interpolationFunction = this.cubicInterpolation;
    }

    const factor = interpolationFunction(t);
    return startHeight * (1 - factor) + endHeight * factor;
  }

  // Transition en courbe de Bézier entre deux segments de terrain
  bezierTransition(
    x,
    segment1End,
    segment2Start,
    segment1Height,
    segment2Height
  ) {
    // Normaliser la position entre les deux segments
    const t = (x - segment1End) / (segment2Start - segment1End);

    // Points de contrôle adaptatifs pour la courbe de Bézier
    // Plus la différence de hauteur est grande, plus les points de contrôle sont éloignés
    // pour éviter des pentes trop abruptes
    const heightDiff = Math.abs(segment2Height - segment1Height);
    const controlPointDistance = Math.min(0.3 + heightDiff * 0.05, 0.5);

    const p0 = segment1Height;
    const p1 =
      segment1Height + (segment2Height - segment1Height) * controlPointDistance;
    const p2 =
      segment2Height - (segment2Height - segment1Height) * controlPointDistance;
    const p3 = segment2Height;

    return this.bezierInterpolation(t, p0, p1, p2, p3);
  }

  // Génération d'une hauteur avec une fonction de bruit améliorée
  improvedNoise(x, frequency, octaves, persistence, lacunarity) {
    let total = 0;
    let amplitude = 1;
    let maxValue = 0;

    // Ajouter les offsets basés sur la SEED
    const seedX = x + this.noiseOffsetX;

    for (let i = 0; i < octaves; i++) {
      // Utiliser la SEED pour avoir un bruit déterministe
      total += this.noise(seedX * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  // Fonction de bruit simplifiée mais déterministe
  noise(x) {
    // Fonction de bruit simplifiée mais qui respecte la SEED
    const X = Math.floor(x) & 255;
    x -= Math.floor(x);
    const fadeX = x * x * (3 - 2 * x);

    // Utiliser la SEED comme partie du calcul
    const offset = this.seed % 256;
    const h1 = (X + offset) & 255;
    const h2 = (X + 1 + offset) & 255;

    const n1 = Math.sin(h1 * 37.1 + this.seed * 0.1) * 43758.5453;
    const n2 = Math.sin(h2 * 37.1 + this.seed * 0.1) * 43758.5453;

    const res1 = (n1 - Math.floor(n1)) * 2 - 1;
    const res2 = (n2 - Math.floor(n2)) * 2 - 1;

    return res1 + fadeX * (res2 - res1);
  }

  // Fonctions de génération pour chaque type de terrain
  generateHills(x, startX, endX, difficulty) {
    // Limitation stricte de la difficulté pour des collines plus douces
    const adjustedDifficulty = Math.min(difficulty * 0.6, 0.5);
    const maxAmplitude = 1.8; // Légèrement augmenté pour plus de variations
    const amplitude = Math.min(1.2 + adjustedDifficulty * 1.3, maxAmplitude);

    // Utiliser notre bruit amélioré pour des collines plus naturelles
    const baseNoise = this.improvedNoise(x, 0.05, 3, 0.5, 2.0);
    const detailNoise = this.improvedNoise(x, 0.2, 2, 0.3, 2.5);

    // Combiner le bruit de base et les détails
    const rawHeight = baseNoise * amplitude + detailNoise * (amplitude * 0.3);

    // Limitation des changements brusques
    const previousHeight = this.getTerrainHeightNear(x - 0.5);

    // Lisser les transitions si un segment précédent existe
    if (previousHeight !== undefined) {
      const delta = rawHeight - previousHeight;
      const maxHeightDelta = 0.15; // Réduit de 0.2 à 0.15 pour des pentes encore plus douces

      if (Math.abs(delta) > maxHeightDelta) {
        // Utiliser une transition douce plutôt qu'une limitation brutale
        const t = Math.min(Math.abs(delta) / maxHeightDelta, 1);
        // Utiliser interpolation quintique pour des transitions encore plus douces
        const smoothFactor = this.quinticInterpolation(1 - t);

        return previousHeight + delta * smoothFactor;
      }
    }

    // Vérifier également la transition aux bords du segment
    if (x - startX < 1.0) {
      // Transition spéciale au début du segment
      const borderFactor = x - startX;
      // Récupérer la hauteur du segment précédent si disponible
      const prevSegmentHeight = this.getTerrainHeightAt(startX - 0.1);

      if (prevSegmentHeight !== undefined && prevSegmentHeight !== null) {
        // Interpolation quintique entre segment précédent et hauteur actuelle
        const t = this.quinticInterpolation(borderFactor);
        return prevSegmentHeight * (1 - t) + rawHeight * t;
      }
    } else if (endX - x < 1.0) {
      // Transition spéciale à la fin du segment
      const borderFactor = endX - x;
      // Récupérer la hauteur du segment suivant si disponible
      const nextSegmentHeight = this.getTerrainHeightAt(endX + 0.1);

      if (nextSegmentHeight !== undefined && nextSegmentHeight !== null) {
        // Interpolation quintique entre hauteur actuelle et segment suivant
        const t = this.quinticInterpolation(borderFactor);
        return rawHeight * (1 - t) + nextSegmentHeight * t;
      }
    }

    return rawHeight;
  }

  generatePlateau(x, startX, endX, difficulty) {
    const width = endX - startX;
    const baseHeight = Math.sin(startX * 0.03) * 4;

    // Distance depuis les bords
    const distanceFromStart = x - startX;
    const distanceFromEnd = endX - x;
    const transitionWidth = width * 0.2; // 20% du segment

    // Transition en début de plateau
    if (distanceFromStart < transitionWidth) {
      const prevHeight =
        this.getTerrainHeightNear(startX - 0.1) ||
        this.generateHills(
          startX - 0.1,
          startX - this.segmentWidth,
          startX,
          difficulty
        );

      const t = distanceFromStart / transitionWidth;
      return this.smoothTransition(t, prevHeight, baseHeight, 'quintic');
    }
    // Transition en fin de plateau
    else if (distanceFromEnd < transitionWidth) {
      const nextHeight =
        this.getTerrainHeightNear(endX + 0.1) ||
        this.generateHills(
          endX + 0.1,
          endX,
          endX + this.segmentWidth,
          difficulty
        );

      const t = distanceFromEnd / transitionWidth;
      return this.smoothTransition(t, nextHeight, baseHeight, 'quintic');
    }
    // Centre du plateau (légères ondulations)
    else {
      // Ajouter de légères ondulations pour un plateau plus intéressant
      return baseHeight + Math.sin(x * 0.3) * 0.2 + Math.cos(x * 0.7) * 0.1;
    }
  }

  generateGap(x, startX, endX, difficulty) {
    // Pour un vrai trou, on utilise null pour indiquer l'absence de terrain
    const adjustedDifficulty = Math.min(difficulty * 0.7, 0.6);
    const width = endX - startX;

    // Taille du trou adaptée à la difficulté
    const gapWidth = Math.min(3 + adjustedDifficulty * 2, 5.0);

    // Position du centre du trou
    const gapCenter = (startX + endX) / 2;

    // Début et fin du trou
    const gapStart = gapCenter - gapWidth / 2;
    const gapEnd = gapCenter + gapWidth / 2;

    // Longueur de la transition (plus douce)
    const transitionLength = width * 0.15; // 15% du segment pour la transition

    // Terrain avant le trou
    if (x < gapStart - transitionLength) {
      // Terrain normal avant le trou, légèrement surélevé pour anticiper la descente
      const preGapHeight = this.generateHills(
        x,
        startX,
        gapStart - transitionLength,
        adjustedDifficulty * 0.3
      );
      return preGapHeight + 0.5; // Légère surélévation
    }
    // Transition vers le trou
    else if (x < gapStart) {
      // Calculer la hauteur de référence avant le trou
      const baseHeight =
        this.generateHills(
          gapStart - transitionLength,
          startX,
          gapStart - transitionLength,
          adjustedDifficulty * 0.3
        ) + 0.5; // Même surélévation

      // Distance normalisée dans la transition
      const t = (x - (gapStart - transitionLength)) / transitionLength;

      // Utiliser une interpolation quintique pour une transition très douce
      return this.smoothTransition(t, baseHeight, -24, 'quintic');
    }
    // Zone du trou - pas de terrain
    else if (x < gapEnd) {
      return null;
    }
    // Transition après le trou
    else if (x < gapEnd + transitionLength) {
      // Calculer la hauteur de référence après le trou
      const afterGapHeight =
        this.generateHills(
          gapEnd + transitionLength,
          gapEnd + transitionLength,
          endX,
          adjustedDifficulty * 0.3
        ) + 0.5; // Légère surélévation

      // Distance normalisée dans la transition
      const t = (x - gapEnd) / transitionLength;

      // Utiliser une interpolation quintique pour une transition très douce
      return this.smoothTransition(t, -24, afterGapHeight, 'quintic');
    }
    // Terrain après le trou
    else {
      // Terrain normal après le trou, légèrement surélevé
      const postGapHeight = this.generateHills(
        x,
        gapEnd + transitionLength,
        endX,
        adjustedDifficulty * 0.3
      );
      return postGapHeight + 0.5; // Légère surélévation
    }
  }

  generateRamp(x, startX, endX, difficulty) {
    const width = endX - startX;
    const adjustedDifficulty = Math.min(difficulty * 0.7, 0.6);

    // Configuration de la rampe
    const rampWidth = width * 0.6; // 60% du segment
    const rampCenter = (startX + endX) / 2;
    const rampStart = rampCenter - rampWidth / 2;
    const rampPeak = rampCenter;
    const rampEnd = rampCenter + rampWidth / 2;

    // Hauteur maximale de la rampe
    const rampHeight = Math.min(3 + adjustedDifficulty * 1.5, 5);

    // Transitions plus douces
    const transitionLength = width * 0.15; // 15% du segment

    // Avant la rampe
    if (x < rampStart) {
      const baseHeight = this.generateHills(
        x,
        startX,
        rampStart,
        adjustedDifficulty * 0.3
      );

      // Légère montée avant la rampe pour une transition plus douce
      const distanceToRamp = rampStart - x;
      if (distanceToRamp < transitionLength) {
        const t = 1 - distanceToRamp / transitionLength;
        return baseHeight + rampHeight * 0.1 * this.cubicInterpolation(t);
      }

      return baseHeight;
    }
    // Montée de la rampe
    else if (x < rampPeak) {
      const baseHeight = this.generateHills(
        rampStart,
        startX,
        rampStart,
        adjustedDifficulty * 0.3
      );
      const t = (x - rampStart) / (rampPeak - rampStart);

      // Utiliser une courbe de Bézier pour la montée (plus naturelle)
      const p0 = baseHeight;
      const p1 = baseHeight + rampHeight * 0.3;
      const p2 = baseHeight + rampHeight * 0.7;
      const p3 = baseHeight + rampHeight;

      return this.bezierInterpolation(t, p0, p1, p2, p3);
    }
    // Descente de la rampe
    else if (x < rampEnd) {
      const baseHeight = this.generateHills(
        rampStart,
        startX,
        rampStart,
        adjustedDifficulty * 0.3
      );
      const peakHeight = baseHeight + rampHeight;
      const t = (x - rampPeak) / (rampEnd - rampPeak);

      // Utiliser une courbe de Bézier pour la descente (plus naturelle)
      const p0 = peakHeight;
      const p1 = peakHeight - rampHeight * 0.3;
      const p2 = peakHeight - rampHeight * 0.7;
      const p3 = baseHeight;

      return this.bezierInterpolation(t, p0, p1, p2, p3);
    }
    // Après la rampe
    else {
      const baseHeight = this.generateHills(
        x,
        rampEnd,
        endX,
        adjustedDifficulty * 0.3
      );

      // Légère descente après la rampe pour une transition plus douce
      const distanceFromRamp = x - rampEnd;
      if (distanceFromRamp < transitionLength) {
        const t = distanceFromRamp / transitionLength;
        return baseHeight + rampHeight * 0.1 * this.cubicInterpolation(1 - t);
      }

      return baseHeight;
    }
  }

  generateWashboard(x, startX, endX, difficulty) {
    const width = endX - startX;
    const adjustedDifficulty = Math.min(difficulty * 0.7, 0.6);

    // Configuration des washboards
    const washboardCenter = (startX + endX) / 2;
    const washboardWidth = width * 0.7; // 70% du segment
    const washboardStart = washboardCenter - washboardWidth / 2;
    const washboardEnd = washboardCenter + washboardWidth / 2;

    // Transitions plus douces
    const transitionLength = width * 0.15; // 15% du segment

    // Avant les washboards
    if (x < washboardStart) {
      return this.generateHills(
        x,
        startX,
        washboardStart,
        adjustedDifficulty * 0.3
      );
    }
    // Zone des washboards
    else if (x < washboardEnd) {
      // Calculer la hauteur de base
      const baseHeight = this.generateHills(
        washboardStart,
        startX,
        washboardStart,
        adjustedDifficulty * 0.3
      );

      // Amplitude et fréquence des ondulations
      const normalizedX =
        (x - washboardStart) / (washboardEnd - washboardStart);
      const phase = normalizedX * Math.PI * 2 * 8; // 8 ondulations complètes

      // Amplitude adaptée à la difficulté
      const maxAmplitude = Math.min(0.7 + adjustedDifficulty * 0.6, 1.5);

      // Contrôler l'amplitude aux extrémités (entrée/sortie progressive)
      let amplitudeFactor = 1.0;
      const fadeLength = washboardWidth * 0.2;

      const distFromStart = x - washboardStart;
      const distFromEnd = washboardEnd - x;

      if (distFromStart < fadeLength) {
        amplitudeFactor = this.cubicInterpolation(distFromStart / fadeLength);
      } else if (distFromEnd < fadeLength) {
        amplitudeFactor = this.cubicInterpolation(distFromEnd / fadeLength);
      }

      // Créer une onde sinusoïdale avec des harmoniques pour plus de réalisme
      const mainWave = Math.sin(phase) * maxAmplitude;
      const secondaryWave = Math.sin(phase * 2) * (maxAmplitude * 0.2);

      return baseHeight + (mainWave + secondaryWave) * amplitudeFactor;
    }
    // Après les washboards
    else {
      return this.generateHills(
        x,
        washboardEnd,
        endX,
        adjustedDifficulty * 0.3
      );
    }
  }

  generateValley(x, startX, endX, difficulty) {
    const width = endX - startX;
    const adjustedDifficulty = Math.min(difficulty * 0.7, 0.6);

    // Configuration de la vallée
    const valleyWidth = width * 0.8; // 80% du segment
    const valleyDepth = Math.min(3 + adjustedDifficulty * 2, 6);
    const valleyCenter = (startX + endX) / 2;
    const valleyStart = valleyCenter - valleyWidth / 2;
    const valleyEnd = valleyCenter + valleyWidth / 2;

    // Avant la vallée
    if (x < valleyStart) {
      return this.generateHills(
        x,
        startX,
        valleyStart,
        adjustedDifficulty * 0.3
      );
    }
    // Dans la vallée
    else if (x < valleyEnd) {
      // Calculer la hauteur de base
      const baseHeight = this.generateHills(
        valleyStart,
        startX,
        valleyStart,
        adjustedDifficulty * 0.3
      );

      // Position normalisée dans la vallée
      const t = (x - valleyStart) / valleyWidth;

      // Fonction de forme de vallée lissée (basée sur le cosinus)
      const valleyShape = (1 - Math.cos(Math.PI * 2 * t)) / 2;

      // Ajouter de petites irrégularités pour plus de naturel
      const irregularities = Math.sin(x * 0.5) * 0.3 + Math.cos(x * 0.3) * 0.2;

      return (
        baseHeight - valleyDepth * (1 - valleyShape) + irregularities * 0.3
      );
    }
    // Après la vallée
    else {
      return this.generateHills(x, valleyEnd, endX, adjustedDifficulty * 0.3);
    }
  }

  // Nouvelle méthode pour obtenir la hauteur du terrain à proximité sans créer de boucles infinies
  getTerrainHeightNear(x) {
    // Utiliser uniquement les segments existants pour éviter la récursion infinie
    const segment = this.terrainMeshes.find(
      (s) => s.startX <= x && s.startX + this.segmentWidth > x
    );

    if (segment && segment.points) {
      // Trouver les points les plus proches dans le segment existant
      const pointIndex = Math.floor(
        ((x - segment.startX) / this.segmentWidth) * segment.points.length
      );
      if (segment.points[pointIndex]) {
        return segment.points[pointIndex].y;
      }
    }

    // Si aucun point existant, retourner undefined pour indiquer qu'il faut générer normalement
    return undefined;
  }

  // Obtenir la hauteur du terrain à une position X
  getTerrainHeightAt(x) {
    // Parcourir les segments de terrain existants
    for (const segment of this.terrainMeshes) {
      if (x >= segment.startX && x < segment.startX + this.segmentWidth) {
        // Trouver les points les plus proches
        const points = segment.points;
        if (!points || points.length === 0) {
          return 0; // Valeur par défaut si le segment n'a pas de points
        }

        // Calculer l'index dans le tableau de points
        const normalizedX = (x - segment.startX) / this.segmentWidth;
        const index = Math.floor(normalizedX * (points.length - 1));

        // Si ce point a une hauteur null, c'est un trou
        if (points[index] && points[index].height === null) {
          return null; // Signaler qu'il n'y a pas de terrain à cette position
        }

        // Interpolation entre les deux points les plus proches
        if (index < points.length - 1) {
          const x1 =
            segment.startX + (index / (points.length - 1)) * this.segmentWidth;
          const x2 =
            segment.startX +
            ((index + 1) / (points.length - 1)) * this.segmentWidth;

          const y1 = points[index].y;
          const y2 = points[index + 1].y;

          // Interpolation cubique au lieu de linéaire pour plus de douceur
          const t = (x - x1) / (x2 - x1);
          return (
            y1 * (1 - this.cubicInterpolation(t)) +
            y2 * this.cubicInterpolation(t)
          );
        } else {
          return points[index].y;
        }
      }
    }

    // Si on n'a pas trouvé de segment correspondant, générer une hauteur basée sur la dernière section connue
    return this.generateHills(x, x - 10, x + 10, 0.1);
  }

  // Création d'un segment de terrain
  createTerrainSegment(startX) {
    const segmentIndex = Math.floor(startX / this.segmentWidth);

    // Augmenter la densité des points pour une meilleure précision
    const nbPoints = 50; // Augmenté de 40 à 50 pour plus de détails
    const points = [];

    const chunkType = this.selectChunkType(
      Math.min(0.1 + segmentIndex * 0.01, 0.9)
    );

    // Trouver le segment précédent et le segment suivant pour une transition plus douce
    const previousSegment = this.terrainMeshes.find(
      (s) => s.startX === startX - this.segmentWidth
    );

    const previousEndHeight = previousSegment
      ? previousSegment.points[previousSegment.points.length - 1].y
      : null;

    // Générer les points du terrain
    for (let i = 0; i < nbPoints; i++) {
      const x = startX + (i / (nbPoints - 1)) * this.segmentWidth;
      let y;
      let isGap = false;

      // Appliquer une transition spéciale pour le premier point du segment
      if (i === 0 && previousEndHeight !== null) {
        // On force le premier point à correspondre au dernier point du segment précédent
        y = previousEndHeight;
      } else {
        switch (chunkType) {
          case 'hills':
            y = this.generateHills(
              x,
              startX,
              startX + this.segmentWidth,
              Math.min(0.1 + segmentIndex * 0.01, 0.9)
            );
            break;
          case 'plateau':
            y = this.generatePlateau(
              x,
              startX,
              startX + this.segmentWidth,
              Math.min(0.1 + segmentIndex * 0.01, 0.9)
            );
            break;
          case 'gap':
            y = this.generateGap(
              x,
              startX,
              startX + this.segmentWidth,
              Math.min(0.1 + segmentIndex * 0.01, 0.9)
            );
            if (y === null) isGap = true;
            break;
          case 'ramp':
            y = this.generateRamp(
              x,
              startX,
              startX + this.segmentWidth,
              Math.min(0.1 + segmentIndex * 0.01, 0.9)
            );
            break;
          case 'washboard':
            y = this.generateWashboard(
              x,
              startX,
              startX + this.segmentWidth,
              Math.min(0.1 + segmentIndex * 0.01, 0.9)
            );
            break;
          case 'valley':
            y = this.generateValley(
              x,
              startX,
              startX + this.segmentWidth,
              Math.min(0.1 + segmentIndex * 0.01, 0.9)
            );
            break;
          default:
            y = this.generateHills(
              x,
              startX,
              startX + this.segmentWidth,
              Math.min(0.1 + segmentIndex * 0.01, 0.9)
            );
        }
      }

      // Si nous sommes près du début du segment, lisser la transition
      // Cela assure une connexion propre avec le segment précédent
      if (i > 0 && i < 5 && previousEndHeight !== null) {
        const blendFactor = 1 - this.quinticInterpolation(i / 5);
        const generatedY = y;
        // Interpoler entre la hauteur idéale pour la jonction et la hauteur générée
        y = previousEndHeight * blendFactor + generatedY * (1 - blendFactor);
      }

      // Stocker si c'est un trou pour la physique
      points.push({
        x,
        y: isGap ? -24 : y, // Utiliser une valeur très basse pour la visualisation des trous
        height: isGap ? null : y, // Marquer les trous avec null
      });
    }

    // Post-processing pour lisser les transitions internes du segment
    this.smoothSegmentPoints(points);

    // Créer la géométrie du terrain
    const terrainShape = new THREE.Shape();
    const initialHeight = points[0].y;

    // Commencer la forme
    terrainShape.moveTo(points[0].x, points[0].y);

    // Ajouter tous les points du terrain
    for (let i = 1; i < points.length; i++) {
      if (points[i].height !== null) {
        terrainShape.lineTo(points[i].x, points[i].y);
      } else {
        // Pour les trous, on dessine la ligne en bas
        terrainShape.lineTo(points[i].x, -24);
      }
    }

    // Fermer la forme
    terrainShape.lineTo(points[points.length - 1].x, -50);
    terrainShape.lineTo(points[0].x, -50);
    terrainShape.lineTo(points[0].x, initialHeight);

    // Extruder la forme pour créer un volume 3D
    const extrudeSettings = {
      steps: 1,
      depth: this.segmentDepth,
      bevelEnabled: false,
    };

    const terrainGeometry = new THREE.ExtrudeGeometry(
      terrainShape,
      extrudeSettings
    );

    // Utiliser une couleur différente selon le type de terrain
    let terrainColor;
    switch (chunkType) {
      case 'hills':
        terrainColor = 0x556b2f; // Vert olive
        break;
      case 'plateau':
        terrainColor = 0x228b22; // Vert forêt
        break;
      case 'gap':
        terrainColor = 0x8b4513; // Marron
        break;
      case 'ramp':
        terrainColor = 0x698269; // Vert gris
        break;
      case 'washboard':
        terrainColor = 0x6b8e23; // Vert olive foncé
        break;
      case 'valley':
        terrainColor = 0x4b543b; // Vert grisâtre
        break;
      default:
        terrainColor = 0x556b2f; // Vert olive par défaut
    }

    const terrainMaterial = new THREE.MeshStandardMaterial({
      color: terrainColor,
      roughness: 0.8,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });

    const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;
    terrainMesh.position.z = -this.segmentDepth / 2;
    terrainMesh.position.y = 1;
    this.scene.add(terrainMesh);

    // Créer les corps physiques pour le terrain
    const terrainBodies = [];

    // Identifier les zones de trou pour traitement spécial
    let gapRanges = [];
    let currentGapStart = null;

    for (let i = 0; i < points.length; i++) {
      if (points[i].height === null && currentGapStart === null) {
        // Début d'un trou
        currentGapStart = i;
      } else if (points[i].height !== null && currentGapStart !== null) {
        // Fin d'un trou
        gapRanges.push({
          start: currentGapStart,
          end: i - 1,
        });
        currentGapStart = null;
      }
    }

    // Si un trou finit à la fin du segment
    if (currentGapStart !== null) {
      gapRanges.push({
        start: currentGapStart,
        end: points.length - 1,
      });
    }

    // Ne pas créer de corps physiques pour les parties en trou
    let currentSegmentStart = 0;

    // Traiter chaque section entre les trous
    for (const gap of gapRanges) {
      if (currentSegmentStart < gap.start) {
        // Créer un segment avant le trou
        this.createPhysicsSegment(
          points.slice(currentSegmentStart, gap.start),
          terrainBodies
        );
      }

      // Ajouter une barrière invisible au fond du trou (-34) pour éviter de tomber infiniment
      this.createBottomBarrier(
        points[gap.start].x,
        points[gap.end].x,
        terrainBodies
      );

      currentSegmentStart = gap.end + 1;
    }

    // Créer le dernier segment après le dernier trou
    if (currentSegmentStart < points.length) {
      this.createPhysicsSegment(
        points.slice(currentSegmentStart),
        terrainBodies
      );
    }

    // Si pas de trous, créer un seul segment physique
    if (gapRanges.length === 0) {
      this.createPhysicsSegment(points, terrainBodies);
    }

    // Ajouter des décorations en fonction du type de terrain
    const decorations = [];

    switch (chunkType) {
      case 'ramp':
        const arrowGeometry = new THREE.ConeGeometry(0.5, 2, 8);
        const arrowMaterial = new THREE.MeshStandardMaterial({
          color: 0xff0000,
        });
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);

        const rampCenter = startX + this.segmentWidth / 2;
        const rampHeight = this.getTerrainHeightAt(rampCenter);
        arrow.position.set(rampCenter, rampHeight + 3, 0);
        arrow.rotation.z = -Math.PI / 2;
        this.scene.add(arrow);
        decorations.push(arrow);
        break;

      case 'gap':
        const skullGeometry = new THREE.SphereGeometry(0.5, 8, 8);
        const skullMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
        });

        const gapCenter = startX + this.segmentWidth / 2;
        const gapStart = gapCenter - 4;
        // Vérifier si on n'est pas juste avant un trou
        const skullHeight = this.getTerrainHeightAt(gapStart - 1) || 0;

        const skull = new THREE.Mesh(skullGeometry, skullMaterial);
        skull.position.set(gapStart - 1, skullHeight + 1, 0);
        this.scene.add(skull);
        decorations.push(skull);
        break;
    }

    this.terrainMeshes.push({
      mesh: terrainMesh,
      bodies: terrainBodies,
      startX: startX,
      points: points,
      chunkType: chunkType,
      decorations: decorations,
    });
  }

  // Nouvelle méthode pour créer une barrière au fond des trous
  createBottomBarrier(startX, endX, bodiesArray) {
    // Créer une barrière invisible au fond du trou pour éviter que le véhicule ne tombe indéfiniment
    const width = endX - startX;
    const barrierShape = new CANNON.Box(
      new CANNON.Vec3(width / 2, 2, this.segmentDepth / 2)
    );

    const barrierBody = new CANNON.Body({
      mass: 0,
      material: this.groundMaterial,
      collisionFilterGroup: 1,
      collisionFilterMask: 1,
    });

    barrierBody.addShape(barrierShape);

    // Positionner la barrière au fond du trou à sa position d'origine
    barrierBody.position.set(startX + width / 2, -30, 0);

    this.physicsWorld.addBody(barrierBody);
    bodiesArray.push(barrierBody);
  }

  // Créer un segment de physique pour le terrain
  createPhysicsSegment(points, bodiesArray) {
    // Ignorer les segments vides
    if (!points || points.length < 2) return;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // Ignorer les points de trou
      if (p1.height === null || p2.height === null) continue;

      const width = p2.x - p1.x;
      // Utiliser les positions d'origine sans décalage
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      // Créer une boîte pour représenter ce segment
      const segmentShape = new CANNON.Box(
        new CANNON.Vec3(width / 2, 1, this.segmentDepth / 2)
      );

      const segmentBody = new CANNON.Body({
        mass: 0,
        material: this.groundMaterial,
        collisionFilterGroup: 1,
        collisionFilterMask: 1,
      });

      segmentBody.addShape(segmentShape);
      segmentBody.position.set(midX, midY, 0);
      segmentBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), angle);

      this.physicsWorld.addBody(segmentBody);
      bodiesArray.push(segmentBody);
    }
  }

  // Mise à jour du terrain en fonction de la position du véhicule
  update(vehiclePosition) {
    try {
      // Vérifier que la position du véhicule est valide
      if (!vehiclePosition || typeof vehiclePosition.x !== 'number') {
        console.warn(
          'Position du véhicule invalide pour la mise à jour du terrain'
        );
        return;
      }

      const currentSegmentIndex = Math.floor(
        vehiclePosition.x / this.segmentWidth
      );

      // Vérifier que l'index du segment est valide
      if (isNaN(currentSegmentIndex) || currentSegmentIndex < 0) {
        console.warn('Index de segment invalide:', currentSegmentIndex);
        return;
      }

      const currentChunkType =
        this.terrainMeshes.find(
          (segment) =>
            segment.startX <= vehiclePosition.x &&
            segment.startX + this.segmentWidth > vehiclePosition.x
        )?.chunkType || 'hills';

      // Vérifier les segments existants pour éviter les doublons
      // Créer un Set des startX des segments existants pour recherche rapide
      const existingSegmentsStartX = new Set(
        this.terrainMeshes.map((segment) => segment.startX)
      );

      // Supprimer les segments dupliqués avant de générer des nouveaux
      const uniqueSegments = [];
      const processedStartX = new Set();

      for (const segment of this.terrainMeshes) {
        if (!processedStartX.has(segment.startX)) {
          uniqueSegments.push(segment);
          processedStartX.add(segment.startX);
        } else {
          // Segment dupliqué, le supprimer
          this.removeSegment(segment);
        }
      }

      this.terrainMeshes = uniqueSegments;

      // Générer de nouveaux segments si nécessaire
      try {
        // Augmenter la marge de génération anticipée pour éviter les vides
        while (
          this.terrainMeshes.length === 0 ||
          currentSegmentIndex + 12 >= this.terrainMeshes.length // Augmenté de 8 à 12
        ) {
          let nextStartX = 0;
          if (this.terrainMeshes.length > 0) {
            const lastSegment =
              this.terrainMeshes[this.terrainMeshes.length - 1];
            nextStartX = lastSegment.startX + this.segmentWidth;
          }

          // Vérifier que ce segment n'existe pas déjà
          if (!existingSegmentsStartX.has(nextStartX)) {
            this.createTerrainSegment(nextStartX);
            existingSegmentsStartX.add(nextStartX);
          } else {
            console.warn(
              `Tentative de création d'un segment dupliqué à ${nextStartX}, ignoré`
            );
            // Avancer quand même pour ne pas rester bloqué
            nextStartX += this.segmentWidth;
          }
        }
      } catch (error) {
        console.error(
          'Erreur lors de la génération de nouveaux segments:',
          error
        );
      }

      // Supprimer les segments trop éloignés mais en garder plus derrière le joueur
      try {
        // Augmenter le nombre minimum de segments à conserver
        const minSegmentsToKeep = 25; // Augmenté de 15 à 25

        // Ne supprimer les segments que s'il y en a beaucoup et que le joueur est loin du début
        // Cela devrait empêcher la suppression trop agressive des segments
        while (
          this.terrainMeshes.length > minSegmentsToKeep &&
          currentSegmentIndex > 10 && // Augmenté de 7 à 10
          this.terrainMeshes[0].startX + this.segmentWidth * 15 <
            vehiclePosition.x // Ajouté: Ne supprimer que les segments très loin derrière
        ) {
          const oldSegment = this.terrainMeshes.shift();
          if (oldSegment) {
            this.removeSegment(oldSegment);
            // Supprimer du Set aussi
            existingSegmentsStartX.delete(oldSegment.startX);
          }
        }
      } catch (error) {
        console.error(
          "Erreur lors de la suppression d'anciens segments:",
          error
        );
      }

      // Vérifier si le terrain actuel existe, sinon régénérer
      const currentTerrainExists = this.terrainMeshes.some(
        (segment) =>
          segment.startX <= vehiclePosition.x &&
          segment.startX + this.segmentWidth > vehiclePosition.x
      );

      if (!currentTerrainExists) {
        console.warn(
          'Terrain manquant à la position actuelle, régénération...'
        );
        // Forcer la génération d'un segment à la position actuelle
        const segmentStartX =
          Math.floor(vehiclePosition.x / this.segmentWidth) * this.segmentWidth;

        if (!existingSegmentsStartX.has(segmentStartX)) {
          this.createTerrainSegment(segmentStartX);
          existingSegmentsStartX.add(segmentStartX);
        }
      }

      // Mettre à jour l'affichage des infos du terrain
      this.updateTerrainInfo(currentSegmentIndex, currentChunkType);
    } catch (error) {
      console.error('Erreur générale dans la mise à jour du terrain:', error);
    }
  }

  // Supprimer proprement un segment
  removeSegment(segment) {
    try {
      // Vérifier que le segment existe
      if (!segment) {
        return;
      }

      // Supprimer les corps physiques
      if (segment.bodies && Array.isArray(segment.bodies)) {
        segment.bodies.forEach((body) => {
          if (
            body &&
            this.physicsWorld &&
            this.physicsWorld.bodies &&
            this.physicsWorld.bodies.includes(body)
          ) {
            this.physicsWorld.removeBody(body);
          }
        });
      }

      // Supprimer le mesh visuel
      if (segment.mesh) {
        if (this.scene) {
          this.scene.remove(segment.mesh);
        }

        if (segment.mesh.geometry) {
          segment.mesh.geometry.dispose();
        }

        if (segment.mesh.material) {
          if (Array.isArray(segment.mesh.material)) {
            segment.mesh.material.forEach((material) => material.dispose());
          } else {
            segment.mesh.material.dispose();
          }
        }
      }

      // Supprimer les décorations
      if (segment.decorations && Array.isArray(segment.decorations)) {
        segment.decorations.forEach((decoration) => {
          if (this.scene && decoration) {
            this.scene.remove(decoration);
          }
          if (decoration && decoration.geometry) decoration.geometry.dispose();
          if (decoration && decoration.material) {
            if (Array.isArray(decoration.material)) {
              decoration.material.forEach((m) => m.dispose());
            } else {
              decoration.material.dispose();
            }
          }
        });
      }
    } catch (error) {
      console.error("Erreur lors de la suppression d'un segment:", error);
    }
  }

  // Mise à jour de l'affichage des informations sur le terrain
  updateTerrainInfo(currentSegmentIndex, currentChunkType) {
    const infoExists = document.querySelector('.terrain-info');
    if (infoExists) infoExists.remove();

    const terrainInfo = document.createElement('div');
    terrainInfo.className = 'terrain-info';

    let terrainName, terrainColor;
    switch (currentChunkType) {
      case 'hills':
        terrainName = 'Collines';
        terrainColor = '#556b2f';
        break;
      case 'plateau':
        terrainName = 'Plateau';
        terrainColor = '#6a994e';
        break;
      case 'gap':
        terrainName = 'Trou';
        terrainColor = '#3a5a40';
        break;
      case 'ramp':
        terrainName = 'Rampe';
        terrainColor = '#8c8c8c';
        break;
      case 'washboard':
        terrainName = 'Bosses';
        terrainColor = '#bca76a';
        break;
      case 'valley':
        terrainName = 'Vallée';
        terrainColor = '#4b543b';
        break;
      default:
        terrainName = 'Terrain';
        terrainColor = '#556b2f';
    }

    const currentDifficulty = Math.min(0.1 + currentSegmentIndex * 0.01, 0.9);
    const difficultyPercent = Math.round(currentDifficulty * 100);

    terrainInfo.innerHTML = `<span style="color:${terrainColor}">Terrain: ${terrainName}</span> - Difficulté: ${difficultyPercent}%`;
    terrainInfo.style.cssText =
      'position:absolute; bottom:70px; left:10px; background:rgba(0,0,0,0.7); color:white; padding:5px 10px; border-radius:3px; font-family:sans-serif;';

    document.body.appendChild(terrainInfo);
    this.infoElement = terrainInfo;
  }

  // Nettoyage des ressources lors de la destruction
  dispose() {
    try {
      if (this.infoElement) {
        this.infoElement.remove();
      }

      // Copier le tableau pour éviter les problèmes pendant l'itération
      const segments = [...this.terrainMeshes];
      segments.forEach((segment) => {
        this.removeSegment(segment);
      });

      this.terrainMeshes = [];
      this.chunkHistory = [];
    } catch (error) {
      console.error(
        'Erreur lors de la libération des ressources du terrain:',
        error
      );
    }
  }

  // Création d'un rocher décoratif
  createRockDecoration(x, y, segmentType) {
    // Vérifier si nous avons un rocher disponible dans le pool
    let rockMesh = null;

    // Fonction de création d'un nouveau rocher
    const createRockMesh = () => {
      // Choisir aléatoirement une taille de rocher
      const sizeIndex = Math.floor(
        this.seededRandom() * this.sharedGeometries.rock.length
      );
      const rockSize = this.seededRandom() * 0.5 + 0.5; // Échelle entre 0.5 et 1.0

      // Créer le mesh du rocher
      const rock = new THREE.Mesh(
        this.sharedGeometries.rock[sizeIndex],
        this.sharedMaterials.rock
      );

      // Appliquer une échelle légèrement aléatoire
      rock.scale.set(rockSize, rockSize * 0.8, rockSize);

      // Ajouter de légères rotations aléatoires pour plus de variété
      rock.rotation.x = this.seededRandom() * Math.PI;
      rock.rotation.z = this.seededRandom() * Math.PI;

      rock.castShadow = true;
      rock.receiveShadow = true;

      return rock;
    };

    // Obtenir un rocher du pool ou en créer un nouveau
    rockMesh = this.getFromPool(DECORATION_TYPES.ROCK, createRockMesh);

    // Positionner le rocher correctement sur le terrain
    rockMesh.position.set(
      x + (this.seededRandom() - 0.5) * 2, // Légère variation en X
      y + rockMesh.scale.y / 2, // Placer sur le terrain
      (this.seededRandom() - 0.5) * 4 // Position Z aléatoire
    );

    // Adapter la taille et la position en fonction du type de terrain
    if (segmentType === 'ramp') {
      // Éviter les rochers sur les rampes, les placer aux bords
      rockMesh.position.x += this.seededRandom() > 0.5 ? 2 : -2;
    } else if (segmentType === 'washboard') {
      // Rochers plus petits sur les washboards
      rockMesh.scale.multiplyScalar(0.7);
    }

    this.scene.add(rockMesh);
    return rockMesh;
  }

  // Création d'un arbre décoratif
  createTreeDecoration(x, y, segmentType) {
    // Fonction de création d'un nouvel arbre
    const createTreeGroup = () => {
      const treeGroup = new THREE.Group();

      // Taille de l'arbre et variations
      const treeScale = this.seededRandom() * 0.5 + 0.8; // Échelle entre 0.8 et 1.3

      // Créer le tronc
      const trunk = new THREE.Mesh(
        this.sharedGeometries.tree[0],
        this.sharedMaterials.treeTrunk
      );
      trunk.castShadow = true;

      // Créer le feuillage
      const foliage = new THREE.Mesh(
        this.sharedGeometries.tree[1],
        this.sharedMaterials.treeLeaves
      );
      foliage.position.y = 2.5; // Positionner le feuillage au-dessus du tronc
      foliage.castShadow = true;

      // Ajouter les composants à l'arbre
      treeGroup.add(trunk);
      treeGroup.add(foliage);

      // Appliquer l'échelle totale
      treeGroup.scale.set(treeScale, treeScale, treeScale);

      // Légère rotation aléatoire pour plus de naturel
      treeGroup.rotation.z = (this.seededRandom() - 0.5) * 0.2;

      return treeGroup;
    };

    // Obtenir un arbre du pool ou en créer un nouveau
    const tree = this.getFromPool(DECORATION_TYPES.TREE, createTreeGroup);

    // Éviter de placer des arbres sur certains types de terrain
    let offsetX = 0;
    if (segmentType === 'ramp' || segmentType === 'gap') {
      // Déplacer l'arbre vers les côtés pour les rampes et les trous
      offsetX = this.seededRandom() > 0.5 ? 3 : -3;
    }

    // Positionner l'arbre correctement sur le terrain
    tree.position.set(
      x + offsetX + (this.seededRandom() - 0.5) * 3, // Variation en X
      y, // Placer sur le terrain
      (this.seededRandom() - 0.5) * 5 // Position Z aléatoire
    );

    this.scene.add(tree);
    return tree;
  }

  // Création d'un panneau décoratif
  createSignDecoration(x, y, segmentType, distance) {
    // Fonction de création d'un nouveau panneau
    const createSignGroup = () => {
      const signGroup = new THREE.Group();

      // Créer le poteau
      const post = new THREE.Mesh(
        this.sharedGeometries.sign[0],
        this.sharedMaterials.signPost
      );
      post.castShadow = true;

      // Créer le panneau
      const panel = new THREE.Mesh(
        this.sharedGeometries.sign[1],
        this.sharedMaterials.signPanel
      );
      panel.position.y = 1.2; // Positionner au sommet du poteau
      panel.castShadow = true;

      // Ajouter les composants au panneau
      signGroup.add(post);
      signGroup.add(panel);

      // Ajouter des chiffres pour indiquer la distance
      const textGeometry = new THREE.TextGeometry(distance.toString(), {
        font: new THREE.Font({}), // Il faudrait charger une vraie police
        size: 0.3,
        height: 0.05,
      });

      return signGroup;
    };

    // Obtenir un panneau du pool ou en créer un nouveau (géré différemment car contient du texte avec la distance)
    // Dans un cas réel, on créerait une texture dynamique avec la distance
    // Pour simplifier, on va juste créer un nouveau panneau à chaque fois
    const sign = createSignGroup();

    // Positionner le panneau sur le bord du terrain
    sign.position.set(
      x,
      y + 0.5, // Légèrement au-dessus du sol
      this.seededRandom() > 0.5 ? 3 : -3 // Alternance des côtés
    );

    // Orientation du panneau vers la caméra
    sign.rotation.y = sign.position.z > 0 ? Math.PI / 2 : -Math.PI / 2;

    this.scene.add(sign);
    return sign;
  }

  // Ajout intelligent de décorations en fonction du type de terrain
  addTerrainDecorations(startX, points, chunkType, decorations) {
    // Nombre de décorations basé sur le type de terrain et la densité configurée
    let decorationCount;
    switch (chunkType) {
      case 'hills':
        decorationCount = Math.floor(this.seededRandom() * 3 + 1); // 1-3 décorations
        break;
      case 'plateau':
        decorationCount = Math.floor(this.seededRandom() * 5 + 2); // 2-6 décorations
        break;
      case 'valley':
        decorationCount = Math.floor(this.seededRandom() * 3 + 1); // 1-3 décorations
        break;
      case 'washboard':
      case 'ramp':
        decorationCount = 1; // Moins de décorations sur les obstacles
        break;
      case 'gap':
        decorationCount = 0; // Pas de décorations sur les trous
        break;
      default:
        decorationCount = Math.floor(this.seededRandom() * 2 + 1); // 1-2 décorations par défaut
    }

    // Ajuster en fonction de la densité configurée
    decorationCount = Math.floor(
      decorationCount * TERRAIN_CONFIG.DECORATION_DENSITY
    );

    // Positions possibles pour les décorations (éviter les bords)
    const segmentPositions = [];
    const step = this.segmentWidth / (decorationCount + 1);

    for (let i = 1; i <= decorationCount; i++) {
      segmentPositions.push(startX + step * i);
    }

    // Créer les décorations aux positions calculées
    for (const x of segmentPositions) {
      // Calculer la hauteur du terrain à cette position
      const terrainHeight = this.getTerrainHeightAt(x);

      // Ne pas placer de décorations sur les trous
      if (terrainHeight === null) continue;

      // Choisir un type de décoration en fonction du terrain et de l'aléatoire
      const randomVal = this.seededRandom();

      // Distance depuis le début, pour afficher sur les panneaux
      const distance = Math.floor(x);

      if (randomVal < 0.6) {
        // 60% de chance d'avoir un rocher
        const rock = this.createRockDecoration(x, terrainHeight, chunkType);
        decorations.push(rock);
      } else if (randomVal < 0.9) {
        // 30% de chance d'avoir un arbre
        const tree = this.createTreeDecoration(x, terrainHeight, chunkType);
        decorations.push(tree);
      } else {
        // 10% de chance d'avoir un panneau
        // Placer des panneaux tous les ~200 unités
        if (distance % 200 < 20) {
          const sign = this.createSignDecoration(
            x,
            terrainHeight,
            chunkType,
            distance
          );
          decorations.push(sign);
        }
      }
    }

    return decorations;
  }

  // Système de niveau de détail (LOD) pour les terrains éloignés
  applyLOD(terrainSegment, distanceFromPlayer) {
    // Ne pas modifier les segments très proches
    if (distanceFromPlayer < TERRAIN_CONFIG.LOD_DISTANCES.HIGH) {
      return;
    }

    // Réduire la résolution des corps physiques pour les segments éloignés
    if (terrainSegment.bodies && Array.isArray(terrainSegment.bodies)) {
      // Niveau de détail moyen
      if (distanceFromPlayer < TERRAIN_CONFIG.LOD_DISTANCES.MEDIUM) {
        // Désactiver certains corps physiques pour réduire les calculs
        const skipRate = 2; // Conserver 1 corps sur 2

        for (let i = 0; i < terrainSegment.bodies.length; i++) {
          if (i % skipRate !== 0 && terrainSegment.bodies[i]) {
            terrainSegment.bodies[i].type = CANNON.Body.STATIC; // Moins de calculs de collision
          }
        }
      }
      // Niveau de détail bas (très éloigné)
      else if (distanceFromPlayer < TERRAIN_CONFIG.LOD_DISTANCES.LOW) {
        const skipRate = 4; // Conserver 1 corps sur 4

        for (let i = 0; i < terrainSegment.bodies.length; i++) {
          if (i % skipRate !== 0 && terrainSegment.bodies[i]) {
            terrainSegment.bodies[i].type = CANNON.Body.STATIC;
            // Simplifier les shapes également
            terrainSegment.bodies[i].sleepSpeedLimit = 2.0; // S'endormir plus facilement
          }
        }
      }
      // Très loin (presque invisible)
      else {
        // Désactiver complètement la physique des segments très éloignés
        for (let i = 0; i < terrainSegment.bodies.length; i++) {
          if (terrainSegment.bodies[i]) {
            terrainSegment.bodies[i].type = CANNON.Body.STATIC;
            terrainSegment.bodies[i].sleep(); // Mettre en sommeil
          }
        }
      }
    }

    // Simplifier les décorations pour les segments éloignés
    if (
      terrainSegment.decorations &&
      Array.isArray(terrainSegment.decorations)
    ) {
      // Niveau de détail moyen
      if (distanceFromPlayer < TERRAIN_CONFIG.LOD_DISTANCES.MEDIUM) {
        // Réduire le niveau de détail visuel si possible
        terrainSegment.decorations.forEach((decoration) => {
          if (
            decoration &&
            decoration.userData &&
            decoration.userData.lodLevel
          ) {
            decoration.userData.lodLevel = 1; // Niveau de détail moyen
          }
        });
      }
      // Niveau de détail bas
      else if (distanceFromPlayer < TERRAIN_CONFIG.LOD_DISTANCES.LOW) {
        // Cacher certaines décorations mineures
        terrainSegment.decorations.forEach((decoration) => {
          if (decoration) {
            if (
              decoration.userData &&
              decoration.userData.type === DECORATION_TYPES.ROCK
            ) {
              // Masquer les petits rochers
              if (decoration.scale.x < 0.7) {
                decoration.visible = false;
              }
            }
          }
        });
      }
      // Très loin
      else {
        // Ne conserver que les décorations importantes
        terrainSegment.decorations.forEach((decoration) => {
          if (decoration) {
            if (
              decoration.userData &&
              decoration.userData.type !== DECORATION_TYPES.SIGN
            ) {
              decoration.visible = false; // Masquer tout sauf les panneaux
            }
          }
        });
      }
    }
  }

  // Nouvelle méthode pour lisser les points internes d'un segment
  smoothSegmentPoints(points) {
    if (points.length < 5) return;

    // Ne pas lisser les trous
    const validPoints = points.filter((p) => p.height !== null);
    if (validPoints.length < 5) return;

    // Appliquer un lissage par moyenne mobile (filtre de Savitzky-Golay simplifié)
    const windowSize = 5; // Taille de la fenêtre de lissage
    const halfWindow = Math.floor(windowSize / 2);

    // Créer une copie des hauteurs originales
    const originalHeights = validPoints.map((p) => p.y);

    // Lisser chaque point (sauf les extrémités pour préserver les jonctions)
    for (let i = halfWindow; i < validPoints.length - halfWindow; i++) {
      let sum = 0;
      // Somme pondérée des points dans la fenêtre
      for (let j = -halfWindow; j <= halfWindow; j++) {
        // Pondération plus importante pour les points centraux
        const weight = 1.0 - Math.abs(j) / (halfWindow + 1);
        sum += originalHeights[i + j] * weight;
      }
      // Normaliser
      validPoints[i].y = sum / windowSize;
    }

    // Maintenant, trouver ces points dans le tableau original et mettre à jour leurs valeurs
    for (const validPoint of validPoints) {
      const originalPoint = points.find((p) => p.x === validPoint.x);
      if (originalPoint && originalPoint.height !== null) {
        originalPoint.y = validPoint.y;
        originalPoint.height = validPoint.y;
      }
    }
  }
}
