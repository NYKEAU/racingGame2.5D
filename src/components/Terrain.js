import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Constants pour la configuration de terrain
const TERRAIN_CONFIG = {
  VISIBLE_CHUNKS_AHEAD: 5, // Nombre de chunks à générer en avance
  VISIBLE_CHUNKS_BEHIND: 5, // Nombre de chunks à conserver derrière
  DECORATION_DENSITY: {
    TREE: 0.1, // Densité des arbres (0-1) - réduite de 0.3 à 0.1
    ROCK: 0.1, // Densité des rochers (0-1) - réduite de 0.3 à 0.1
    SIGN: 0.2, // Densité des panneaux (0-1) - réduite de 0.3 à 0.2
  },
  LOD_DISTANCES: {
    HIGH: 100, // Distance pour le niveau de détail élevé
    MEDIUM: 200, // Distance pour le niveau de détail moyen
    LOW: 400, // Distance pour le niveau de détail bas
  },
  PHYSICS_SIMPLIFICATION: {
    SEGMENT_STEP: 3, // Ne créer qu'un segment physique sur 3 (réduit les hitboxes)
    SKIP_MINOR_SEGMENTS: true, // Ignorer les petits segments de terrain pour la physique
  },
};

// Paramètres de debug pour le développement
const DEBUG = {
  SHOW_PHYSICS: false, // Désactivé - N'affiche plus les formes physiques
  WIREFRAME: false, // Désactivé - N'affiche plus les maillages en wireframe
};

// Groupes de collision pour la physique
const COLLISION_GROUPS = {
  TERRAIN: 1,
  VEHICLE: 2,
  WHEELS: 4,
  DECORATIONS: 8,
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
    this.segmentDepth = 8; // Profondeur du terrain central
    this.visibleSegments = 15;
    this.decorations = [];

    // Configuration des zones du terrain
    this.terrainConfig = {
      central: {
        width: 6, // Largeur de la zone jouable centrale
        hasCollision: true,
      },
      borders: {
        width: 20, // Largeur totale des bordures de chaque côté
        hasCollision: false,
      },
    };

    // Largeur totale du terrain (central + bordures)
    this.totalWidth =
      this.terrainConfig.central.width + this.terrainConfig.borders.width * 2;

    // Utiliser la SEED pour la génération du terrain
    this.seed = seed;
    this.noiseOffsetX = seed % 10000;
    this.noiseOffsetY = (seed % 1000) * 10;

    // Historique des types de chunks générés
    this.chunkHistory = [];

    // Matériaux pour le terrain central et les bordures - Utiliser des matériaux opaques sans wireframe
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d572c,
      roughness: 0.8,
      metalness: 0.2,
      wireframe: false,
      flatShading: false,
      side: THREE.DoubleSide, // S'assurer que les deux côtés sont rendus
    });

    this.borderMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e3e1e, // Couleur légèrement plus sombre pour les bordures
      roughness: 0.9,
      metalness: 0.1,
      wireframe: false,
      flatShading: false,
      side: THREE.DoubleSide, // S'assurer que les deux côtés sont rendus
    });

    // Matériau pour les corps physiques
    this.terrainPhysicsMaterial = new CANNON.Material('terrain');

    // Créer et initialiser le groundMaterial pour la physique
    this.groundMaterial = new CANNON.Material('ground');
    const wheelGroundContact = new CANNON.ContactMaterial(
      new CANNON.Material('wheel'),
      this.groundMaterial,
      {
        friction: 0.8,
        restitution: 0.1,
        contactEquationStiffness: 1e6,
      }
    );
    if (this.physicsWorld) {
      this.physicsWorld.addContactMaterial(wheelGroundContact);
    }

    // Système de pool d'objets pour les décorations
    this.objectPools = {
      rock: [],
      tree: [],
      sign: [],
    };

    // Initialiser les ressources de décorations
    this.initializeDecorationResources();

    // Initialiser le terrain
    this.initialTerrainWidth = 400;
    this.initialize();
  }

  // Initialisation des ressources pour les décorations
  initializeDecorationResources() {
    console.log('Initialisation des ressources pour les décorations');

    // Créer directement les géométries et matériaux partagés
    this.sharedGeometries = {
      rock: [
        new THREE.DodecahedronGeometry(1.0, 0), // Grand rocher
        new THREE.DodecahedronGeometry(0.7, 0), // Rocher moyen
        new THREE.DodecahedronGeometry(0.4, 0), // Petit rocher
      ],
      tree: {
        trunk: new THREE.CylinderGeometry(0.2, 0.3, 2.0, 8),
        leaves: new THREE.ConeGeometry(1.5, 3.0, 8),
      },
      sign: {
        post: new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6),
        panel: new THREE.BoxGeometry(1.5, 1.0, 0.1),
        text: new THREE.PlaneGeometry(1.3, 0.8),
      },
    };

    this.sharedMaterials = {
      rock: new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.9,
        metalness: 0.1,
      }),
      tree: {
        trunk: new THREE.MeshStandardMaterial({
          color: 0x704214,
          roughness: 0.9,
          metalness: 0.0,
        }),
        leaves: new THREE.MeshStandardMaterial({
          color: 0x38761d,
          roughness: 0.8,
          metalness: 0.0,
        }),
      },
      sign: {
        post: new THREE.MeshStandardMaterial({
          color: 0x6d4c41,
          roughness: 0.8,
          metalness: 0.1,
        }),
        panel: new THREE.MeshStandardMaterial({
          color: 0xf5f5f5,
          roughness: 0.5,
          metalness: 0.2,
        }),
        text: new THREE.MeshBasicMaterial({
          color: 0x000000,
          side: THREE.DoubleSide,
        }),
      },
    };

    // Initialiser les pools d'objets pour les décorations
    this.objectPools = {
      rock: [],
      tree: [],
      sign: [],
    };

    // Précharger quelques objets dans chaque pool
    try {
      // Rochers - créer 3 tailles différentes
      for (let i = 0; i < 45; i++) {
        const rockIndex = i % 3;
        const rockGeometry = this.sharedGeometries.rock[rockIndex];
        const rockMaterial = this.sharedMaterials.rock;

        const rockMesh = new THREE.Mesh(rockGeometry, rockMaterial);
        rockMesh.castShadow = true;
        rockMesh.receiveShadow = true;
        rockMesh.visible = false;

        // Stocker le type dans les userData pour faciliter l'identification
        rockMesh.userData = { type: DECORATION_TYPES.ROCK };

        this.scene.add(rockMesh);
        this.objectPools.rock.push(rockMesh);
      }

      // Arbres
      for (let i = 0; i < 45; i++) {
        const treeGroup = new THREE.Group();

        // Tronc
        const trunk = new THREE.Mesh(
          this.sharedGeometries.tree.trunk,
          this.sharedMaterials.tree.trunk
        );
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        trunk.position.y = 1.0;
        treeGroup.add(trunk);

        // Feuillage
        const leaves = new THREE.Mesh(
          this.sharedGeometries.tree.leaves,
          this.sharedMaterials.tree.leaves
        );
        leaves.castShadow = true;
        leaves.receiveShadow = true;
        leaves.position.y = 3.5;
        treeGroup.add(leaves);

        treeGroup.visible = false;
        treeGroup.userData = { type: DECORATION_TYPES.TREE };

        this.scene.add(treeGroup);
        this.objectPools.tree.push(treeGroup);
      }

      // Panneaux
      for (let i = 0; i < 20; i++) {
        const signGroup = new THREE.Group();

        // Poteau
        const post = new THREE.Mesh(
          this.sharedGeometries.sign.post,
          this.sharedMaterials.sign.post
        );
        post.castShadow = true;
        post.receiveShadow = true;
        post.position.y = 1.25;
        signGroup.add(post);

        // Panneau
        const panel = new THREE.Mesh(
          this.sharedGeometries.sign.panel,
          this.sharedMaterials.sign.panel
        );
        panel.castShadow = true;
        panel.receiveShadow = true;
        panel.position.y = 2.0;
        signGroup.add(panel);

        // Texte
        const text = new THREE.Mesh(
          this.sharedGeometries.sign.text,
          this.sharedMaterials.sign.text
        );
        text.position.y = 2.0;
        text.position.z = 0.06;
        signGroup.add(text);

        signGroup.visible = false;
        signGroup.userData = { type: DECORATION_TYPES.SIGN };

        this.scene.add(signGroup);
        this.objectPools.sign.push(signGroup);
      }

      console.log('Ressources de décorations initialisées:', {
        rochers: this.objectPools.rock.length,
        arbres: this.objectPools.tree.length,
        panneaux: this.objectPools.sign.length,
      });
    } catch (error) {
      console.error("Erreur lors de l'initialisation des décorations:", error);
    }
  }

  // Obtenir un objet du pool ou en créer un nouveau
  getFromPool(poolName, createFunc) {
    // Vérifier si le pool existe
    if (!this.objectPools || !this.objectPools[poolName]) {
      console.warn(`Pool ${poolName} non initialisé`);

      // Initialiser le pool s'il n'existe pas
      if (!this.objectPools) {
        this.objectPools = {};
      }
      if (!this.objectPools[poolName]) {
        this.objectPools[poolName] = [];
      }

      // Créer un nouvel objet
      const newObject = createFunc();
      return newObject;
    }

    // Obtenir un objet du pool ou en créer un nouveau
    if (this.objectPools[poolName].length > 0) {
      return this.objectPools[poolName].pop();
    } else {
      const newObject = createFunc();
      return newObject;
    }
  }

  // Retourner un objet au pool
  returnToPool(poolName, object) {
    // Vérifier si le pool existe
    if (!this.objectPools || !this.objectPools[poolName]) {
      console.warn(`Pool ${poolName} non initialisé`);
      return;
    }

    // Cacher l'objet et le retourner au pool
    object.visible = false;
    this.objectPools[poolName].push(object);
  }

  // Initialisation du terrain avec davantage de segments pour éviter les manques visuels
  initialize() {
    console.log('Initialisation complète du terrain avec tous les segments');

    // Générer plus de segments initiaux pour éviter les zones manquantes
    const initialSegments = 20; // Augmenté à 20 au lieu de 10

    // Démarrer plus en arrière pour avoir un terrain visible dès le départ
    const startOffset = -5;

    // Créer des segments initiaux avec un chevauchement pour éviter les trous
    for (let i = startOffset; i < initialSegments + startOffset; i++) {
      this.createTerrainSegment(i * this.segmentWidth, false); // Créer avec les décorations
    }

    // S'assurer que tous les segments sont correctement configurés
    this.terrainMeshes.forEach((segment) => {
      // Vérifier que toutes les parties du segment sont bien connectées
      if (segment.meshes) {
        segment.meshes.forEach((mesh) => {
          if (!mesh.parent) {
            this.scene.add(mesh);
          }
        });
      }
    });

    // S'assurer que l'historique des chunks est correctement initialisé
    this.chunkHistory = this.terrainMeshes.map((segment) => segment.chunkType);

    console.log(
      `Terrain initialisé avec ${this.terrainMeshes.length} segments complets`
    );
  }

  // Méthode pour générer des segments supplémentaires après le chargement initial
  generateAdditionalSegments() {
    console.log('Génération des segments additionnels...');

    // Ajout des décorations aux segments déjà créés
    console.log('Ajout des décorations aux segments existants...');
    this.terrainMeshes.forEach((segment) => {
      if (segment.decorations && segment.decorations.length === 0) {
        this.addTerrainDecorations(
          segment.startX,
          segment.points,
          segment.chunkType,
          segment.decorations
        );
      }
    });

    // Générer les segments restants de manière progressive
    const totalSegments = 30; // Nombre total de segments à atteindre
    const existingSegments = this.terrainMeshes.length;
    const remainingSegments = Math.max(0, totalSegments - existingSegments);

    if (remainingSegments <= 0) {
      console.log('Aucun segment supplémentaire à générer');
      return;
    }

    // Générer par lots pour éviter de bloquer le thread principal
    this.scheduleRemainingSegments(existingSegments);
  }

  // Méthode pour générer progressivement les segments restants
  scheduleRemainingSegments(startIndex) {
    let currentIndex = 8; // Commencer après les segments initiaux

    const generateNextBatch = () => {
      const batchSize = 5;
      let segmentsCreated = 0;

      for (let i = 0; i < batchSize; i++) {
        const segmentX = (currentIndex + i) * this.segmentWidth;
        // Vérifier si le segment existe déjà
        const exists = this.terrainMeshes.some(
          (segment) => Math.abs(segment.startX - segmentX) < 0.1
        );

        if (!exists) {
          this.createTerrainSegment(segmentX);
          segmentsCreated++;
        }
      }

      currentIndex += batchSize;

      // Continuer jusqu'à avoir généré tous les segments désirés
      if (currentIndex < 30 && segmentsCreated > 0) {
        setTimeout(generateNextBatch, 300);
      } else {
        console.log('Génération des segments additionnels terminée');
      }
    };

    // Commencer la génération avec un délai
    setTimeout(generateNextBatch, 300);
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
  createTerrainSegment(startX, priorityCreate = false) {
    const segmentIndex = Math.floor(startX / this.segmentWidth);

    // Toujours créer avec la qualité maximum, peu importe si c'est une création prioritaire
    const quality = 'high';

    // Générer un type de chunk (hills, plateau, ramps, etc.) en fonction de la position
    const difficulty = Math.min(0.99, Math.max(0, Math.abs(startX) / 5000));
    const chunkType = this.selectChunkType(difficulty);

    // Nombre de points pour ce segment (plus élevé pour plus de détails)
    const nbPoints = 30; // Augmenter pour plus de détails

    // Stocker l'information sur le segment précédent pour des transitions douces
    const previousEndHeight =
      this.terrainMeshes.length > 0
        ? this.terrainMeshes[this.terrainMeshes.length - 1].points[
            this.terrainMeshes[this.terrainMeshes.length - 1].points.length - 1
          ].height
        : null;

    // Générer le profil du terrain pour ce segment
    const points = [];

    for (let i = 0; i < nbPoints; i++) {
      const x = startX + (i / (nbPoints - 1)) * this.segmentWidth;
      const normalizedX = i / (nbPoints - 1);

      // Vérifier si c'est un gap (trou) - plus probable avec difficulté élevée
      const isGap =
        chunkType === 'gap' && normalizedX > 0.3 && normalizedX < 0.7;

      // Générer la hauteur en fonction du type de chunk
      let y = 0;

      switch (chunkType) {
        case 'hills':
          y = this.generateHills(
            x,
            startX,
            startX + this.segmentWidth,
            difficulty
          );
          break;
        case 'plateau':
          y = this.generatePlateau(
            x,
            startX,
            startX + this.segmentWidth,
            difficulty
          );
          break;
        case 'ramp':
          y = this.generateRamp(
            x,
            startX,
            startX + this.segmentWidth,
            difficulty
          );
          break;
        case 'gap':
          y = this.generateGap(
            x,
            startX,
            startX + this.segmentWidth,
            difficulty
          );
          break;
        case 'washboard':
          y = this.generateWashboard(
            x,
            startX,
            startX + this.segmentWidth,
            difficulty
          );
          break;
        case 'valley':
          y = this.generateValley(
            x,
            startX,
            startX + this.segmentWidth,
            difficulty
          );
          break;
        default:
          y = this.generateHills(
            x,
            startX,
            startX + this.segmentWidth,
            difficulty
          );
      }

      // Lisser les transitions près du début du segment
      if (i > 0 && i < 5 && previousEndHeight !== null) {
        const blendFactor = 1 - this.quinticInterpolation(i / 5);
        const generatedY = y;
        y = previousEndHeight * blendFactor + generatedY * (1 - blendFactor);
      }

      points.push({
        x,
        y: isGap ? -24 : y,
        height: isGap ? null : y,
      });
    }

    // Post-processing pour lisser les transitions internes du segment
    this.smoothSegmentPoints(points);

    // Créer trois parties du terrain : bordure gauche, zone centrale, bordure droite
    const terrainMeshes = [];
    const terrainBodies = [];

    // Créer le maillage pour la zone centrale (avec collisions)
    const centralMesh = this.createTerrainMeshPart(
      points,
      -this.terrainConfig.central.width / 2, // Centrer par rapport à z=0
      this.terrainConfig.central.width, // Largeur zone centrale
      this.terrainMaterial,
      'central'
    );
    terrainMeshes.push(centralMesh);

    // Créer la bordure gauche (sans collision)
    const leftBorderMesh = this.createTerrainMeshPart(
      points,
      -this.terrainConfig.central.width / 2 - this.terrainConfig.borders.width,
      this.terrainConfig.borders.width,
      this.borderMaterial,
      'left'
    );
    terrainMeshes.push(leftBorderMesh);

    // Créer la bordure droite (sans collision)
    const rightBorderMesh = this.createTerrainMeshPart(
      points,
      this.terrainConfig.central.width / 2,
      this.terrainConfig.borders.width,
      this.borderMaterial,
      'right'
    );
    terrainMeshes.push(rightBorderMesh);

    // Ajouter les meshes à la scène
    terrainMeshes.forEach((mesh) => {
      // S'assurer que le maillage n'est pas déjà dans la scène
      if (!mesh.parent) {
        this.scene.add(mesh);
      }
    });

    // Créer les corps physiques uniquement pour la zone centrale
    this.createPhysicsForSegment(points, terrainBodies, chunkType);

    // Créer le segment complet avec toutes ses propriétés
    const segment = {
      startX: startX,
      meshes: terrainMeshes,
      bodies: terrainBodies,
      points: points,
      chunkType: chunkType,
      decorations: [],
    };

    // Toujours ajouter des décorations pour un look uniforme
    this.addTerrainDecorations(startX, points, chunkType, segment.decorations);

    // Ajouter le segment à la liste
    this.terrainMeshes.push(segment);

    return segment;
  }

  // Méthode pour créer une partie du maillage du terrain
  createTerrainMeshPart(points, zOffset, width, material, partType) {
    // Créer la forme 2D du terrain
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
      depth: width,
      bevelEnabled: false,
    };

    const terrainGeometry = new THREE.ExtrudeGeometry(
      terrainShape,
      extrudeSettings
    );

    // Utiliser le bon matériau en fonction du type de partie
    const meshMaterial =
      partType === 'central' ? this.terrainMaterial : this.borderMaterial;

    // S'assurer que le matériau est correctement configuré
    meshMaterial.wireframe = false;
    meshMaterial.side = THREE.DoubleSide;
    meshMaterial.needsUpdate = true;

    // Créer le mesh avec le matériau correspondant
    const terrainMesh = new THREE.Mesh(terrainGeometry, meshMaterial.clone());
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;

    // Positionner la partie du terrain
    terrainMesh.position.z = zOffset;

    // Ajouter des métadonnées pour faciliter l'identification
    terrainMesh.userData = {
      type: 'terrain',
      part: partType,
      hasCollision: partType === 'central',
    };

    return terrainMesh;
  }

  // Nouvelle méthode pour créer la physique uniquement pour la zone centrale
  createPhysicsForSegment(points, bodiesArray, chunkType) {
    // Utiliser les paramètres de simplification
    const skipMinorSegments =
      TERRAIN_CONFIG.PHYSICS_SIMPLIFICATION.SKIP_MINOR_SEGMENTS;
    const segmentStep = TERRAIN_CONFIG.PHYSICS_SIMPLIFICATION.SEGMENT_STEP || 1;

    // Déterminer la rigidité du segment en fonction du type de chunk
    const rigidityMultiplier = this.getSegmentRigidity(chunkType);

    // Créer les barrières latérales avec rigidité personnalisée
    this.createSideBarriers(points, bodiesArray, rigidityMultiplier);

    // Créer les segments de physique avec simplification
    this.createPhysicsSegment(
      points,
      bodiesArray,
      segmentStep,
      skipMinorSegments
    );

    // Créer les collisions d'arrière-plan
    this.createBackgroundPhysics(points, bodiesArray, rigidityMultiplier);
  }

  // Créer des barrières latérales pour empêcher le véhicule de sortir du monde
  createSideBarriers(points, bodiesArray, rigidityMultiplier) {
    if (!points || points.length < 2) return;

    const startX = points[0].x;
    const endX = points[points.length - 1].x;
    const segmentLength = endX - startX;

    // Propriétés pour les barrières latérales
    const barrierHeight = 15; // Hauteur augmentée
    const barrierThickness = 1;

    // Créer les barrières latérales (gauche et droite)
    [-1, 1].forEach((side) => {
      const zOffset =
        side *
        (this.terrainConfig.central.width / 2 +
          this.terrainConfig.borders.width / 2);

      // Hauteur moyenne des points pour placer la barrière
      let avgHeight = 0;
      points.forEach((point) => {
        if (point.height !== null) {
          avgHeight += point.height;
        }
      });
      avgHeight /= points.filter((p) => p.height !== null).length;

      // Créer un corps rigide CANNON pour la barrière
      const barrierShape = new CANNON.Box(
        new CANNON.Vec3(
          segmentLength / 2,
          barrierHeight / 2,
          barrierThickness / 2
        )
      );

      const barrierBody = new CANNON.Body({
        mass: 0, // Statique
        position: new CANNON.Vec3(
          startX + segmentLength / 2,
          avgHeight + barrierHeight / 2,
          zOffset
        ),
        shape: barrierShape,
        material: this.terrainMaterial,
      });

      // Renforcer la friction
      barrierBody.material = this.terrainMaterial;
      barrierBody.collisionFilterGroup = COLLISION_GROUPS.TERRAIN;
      barrierBody.collisionFilterMask =
        COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.WHEELS;

      // Ajouter au monde physique
      this.physicsWorld.addBody(barrierBody);
      bodiesArray.push(barrierBody);

      // Option: Visualiser les barrières en mode debug
      if (DEBUG.SHOW_PHYSICS) {
        const barrierMesh = new THREE.Mesh(
          new THREE.BoxGeometry(segmentLength, barrierHeight, barrierThickness),
          new THREE.MeshBasicMaterial({
            color: 0xff0000,
            wireframe: true,
            transparent: true,
            opacity: 0.3,
          })
        );
        barrierMesh.position.set(
          startX + segmentLength / 2,
          avgHeight + barrierHeight / 2,
          zOffset
        );
        this.scene.add(barrierMesh);
      }
    });
  }

  // Créer des éléments physiques pour rendre l'arrière-plan plus solide
  createBackgroundPhysics(points, bodiesArray, rigidityMultiplier) {
    if (!points || points.length < 2) return;

    try {
      // Paramètres pour l'arrière-plan
      const bgDepth = this.terrainConfig.borders.width * 2; // Profondeur du terrain d'arrière-plan
      const startX = points[0].x;
      const endX = points[points.length - 1].x;
      const segmentLength = endX - startX;

      // Créer des éléments physiques pour l'arrière-plan à gauche et à droite
      [-1, 1].forEach((side) => {
        // Base z position (middle of the background area)
        const baseZ =
          side *
          (this.terrainConfig.central.width / 2 +
            this.terrainConfig.borders.width / 2);

        // Définir plusieurs niveaux de profondeur pour l'arrière-plan
        const depthLevels = [0.3, 0.7, 1.0];

        depthLevels.forEach((depthFactor) => {
          // Z position adjusted by depth factor
          const zOffset = baseZ * depthFactor;

          // Sous-diviser le segment pour un meilleur rendu de l'arrière-plan
          const subsegments = 3; // Nombre de sous-segments
          const subsegmentLength = segmentLength / subsegments;

          for (let i = 0; i < subsegments; i++) {
            // Position X du sous-segment
            const subsegmentX = startX + i * subsegmentLength;

            // Trouver les points correspondants dans le tableau de points
            const startIdx = Math.floor((i * points.length) / subsegments);
            const endIdx = Math.floor(((i + 1) * points.length) / subsegments);

            // Calculer la hauteur moyenne de ce sous-segment
            let avgHeight = 0;
            let count = 0;
            for (let j = startIdx; j < endIdx; j++) {
              if (points[j] && points[j].height !== null) {
                avgHeight += points[j].height;
                count++;
              }
            }

            if (count > 0) {
              avgHeight /= count;

              // Ajouter une variation selon la profondeur
              const heightVariation =
                (1 - depthFactor) * 5 * (this.seededRandom() * 2 - 1);
              avgHeight += heightVariation;

              // Créer un corps pour ce sous-segment d'arrière-plan
              const bgBodyShape = new CANNON.Box(
                new CANNON.Vec3(
                  subsegmentLength / 2,
                  5, // Hauteur
                  bgDepth / depthLevels.length / 2 // Épaisseur basée sur le niveau de profondeur
                )
              );

              const bgBody = new CANNON.Body({
                mass: 0, // Statique
                position: new CANNON.Vec3(
                  subsegmentX + subsegmentLength / 2,
                  avgHeight + 2, // Légèrement au-dessus du sol
                  zOffset
                ),
                shape: bgBodyShape,
                material: this.terrainMaterial,
              });

              // Configurer la collision
              bgBody.collisionFilterGroup = COLLISION_GROUPS.TERRAIN;
              bgBody.collisionFilterMask =
                COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.WHEELS;

              // Ajouter au monde physique
              this.physicsWorld.addBody(bgBody);
              bodiesArray.push(bgBody);

              // Visualiser en mode debug
              if (DEBUG.SHOW_PHYSICS) {
                const bgMesh = new THREE.Mesh(
                  new THREE.BoxGeometry(
                    subsegmentLength,
                    10,
                    bgDepth / depthLevels.length
                  ),
                  new THREE.MeshBasicMaterial({
                    color: 0x00ff00,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.2,
                  })
                );
                bgMesh.position.copy(bgBody.position);
                this.scene.add(bgMesh);
              }
            }
          }
        });
      });
    } catch (error) {
      console.error(
        "Erreur lors de la création de la physique d'arrière-plan:",
        error
      );
    }
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
  createPhysicsSegment(
    points,
    bodiesArray,
    segmentStep = 1,
    skipMinorSegments = false
  ) {
    const groundMaterial = this.groundMaterial;

    // Parcourir les points du segment avec le pas de simplification
    for (let i = 0; i < points.length - 1; i += segmentStep) {
      const p1 = points[i];
      const p2 = points[Math.min(i + segmentStep, points.length - 1)];

      // Calculer la longueur du segment
      const segmentLength = Math.abs(p2.x - p1.x);

      // Ignorer les petits segments si l'option est activée
      if (skipMinorSegments && segmentLength < 0.5) {
        continue;
      }

      // Créer un corps pour ce segment de terrain
      const width = segmentLength;
      const height = 1;

      // Position et rotation du segment
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const cx = (p2.x + p1.x) / 2;
      const cy = (p2.y + p1.y) / 2;

      // Créer la forme physique - un rectangle
      const segmentShape = new CANNON.Box(
        new CANNON.Vec3(width / 2, height / 2, 100)
      );

      // Créer le corps physique
      const segmentBody = new CANNON.Body({
        mass: 0,
        position: new CANNON.Vec3(cx, cy - height / 2, 0),
        material: groundMaterial,
      });

      // Ajouter la forme au corps
      segmentBody.addShape(segmentShape);

      // Appliquer la rotation
      segmentBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), angle);

      // Ajouter au monde physique
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

      // Déterminer le type de chunk actuel
      const currentSegment = this.terrainMeshes.find(
        (segment) =>
          segment.startX <= vehiclePosition.x &&
          segment.startX + this.segmentWidth > vehiclePosition.x
      );

      const currentChunkType = currentSegment
        ? currentSegment.chunkType
        : 'hills';

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

      // Constantes pour la gestion des segments visibles
      const segmentsAhead = TERRAIN_CONFIG.VISIBLE_CHUNKS_AHEAD || 5;
      const segmentsBehind = TERRAIN_CONFIG.VISIBLE_CHUNKS_BEHIND || 5;

      // Générer de nouveaux segments si nécessaire
      try {
        // Augmenter la marge de génération anticipée pour éviter les vides
        // Utiliser un nombre fixe de segments visibles avant et après la position actuelle
        while (true) {
          const lastSegmentIndex =
            this.terrainMeshes.length > 0
              ? Math.floor(
                  this.terrainMeshes[this.terrainMeshes.length - 1].startX /
                    this.segmentWidth
                )
              : -1;

          // Arrêter si nous avons assez de segments en avance
          if (lastSegmentIndex >= currentSegmentIndex + segmentsAhead) {
            break;
          }

          // Calculer la position du prochain segment
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
        // Ne supprimer que s'il y a assez de segments et que le joueur est suffisamment avancé
        while (
          this.terrainMeshes.length > segmentsAhead + segmentsBehind &&
          currentSegmentIndex > segmentsBehind
        ) {
          // Obtenir le segment le plus en arrière
          const firstSegment = this.terrainMeshes[0];
          const firstSegmentIndex = Math.floor(
            firstSegment.startX / this.segmentWidth
          );

          // Ne supprimer que si ce segment est suffisamment derrière le joueur
          if (firstSegmentIndex < currentSegmentIndex - segmentsBehind) {
            this.removeSegment(firstSegment);
            this.terrainMeshes.shift();
            existingSegmentsStartX.delete(firstSegment.startX);
          } else {
            break;
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

      // Appliquer le LOD en fonction de la distance au joueur
      this.applyLODToSegments(vehiclePosition);

      // Mettre à jour l'affichage des infos du terrain
      this.updateTerrainInfo(currentSegmentIndex, currentChunkType);
    } catch (error) {
      console.error('Erreur générale dans la mise à jour du terrain:', error);
    }
  }

  // Applique le LOD à tous les segments en fonction de leur distance au joueur
  applyLODToSegments(vehiclePosition) {
    if (!vehiclePosition) {
      console.warn(
        'Position du véhicule non disponible pour applyLODToSegments'
      );
      return;
    }

    // Vérifier que lodDistances est défini
    const lodDistances = TERRAIN_CONFIG.LOD_DISTANCES || {
      HIGH: 100,
      MEDIUM: 200,
      LOW: 400,
    };

    try {
      this.terrainMeshes.forEach((segment) => {
        if (!segment) return;

        // Calculer la distance entre le segment et le joueur
        const segmentCenterX = segment.startX + this.segmentWidth / 2;
        const distanceFromPlayer = Math.abs(segmentCenterX - vehiclePosition.x);

        // Appliquer le LOD en fonction de la distance
        this.applyLOD(segment, distanceFromPlayer, false, vehiclePosition);
      });
    } catch (error) {
      console.error("Erreur lors de l'application du LOD:", error);
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

      // Supprimer les meshes visuels (plusieurs parties maintenant)
      if (segment.meshes && Array.isArray(segment.meshes)) {
        segment.meshes.forEach((mesh) => {
          if (this.scene) {
            this.scene.remove(mesh);
          }

          if (mesh.geometry) {
            mesh.geometry.dispose();
          }

          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((material) => material.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        });
      }

      // Supprimer les décorations
      if (segment.decorations && Array.isArray(segment.decorations)) {
        segment.decorations.forEach((decoration) => {
          if (decoration && decoration.mesh) {
            if (this.scene) {
              this.scene.remove(decoration.mesh);
            }

            // Retourner la décoration à son pool si possible
            if (decoration.type && this.objectPools[decoration.type]) {
              this.returnToPool(decoration.type, decoration.mesh);
            } else {
              // Sinon, nettoyer les ressources
              if (decoration.mesh.geometry) {
                decoration.mesh.geometry.dispose();
              }
              if (decoration.mesh.material) {
                if (Array.isArray(decoration.mesh.material)) {
                  decoration.mesh.material.forEach((m) => m.dispose());
                } else {
                  decoration.mesh.material.dispose();
                }
              }
            }
          }
        });
      }
    } catch (error) {
      console.error("Erreur lors de la suppression d'un segment:", error);
    }
  }

  // Mise à jour de l'affichage d'information sur le terrain
  updateTerrainInfo(currentSegmentIndex, currentChunkType) {
    // Création ou mise à jour de l'élément d'affichage
    let terrainInfo = document.querySelector('.terrain-info');

    if (!terrainInfo) {
      terrainInfo = document.createElement('div');
      terrainInfo.className = 'terrain-info';
      terrainInfo.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 20px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-family: 'Arial', sans-serif;
        font-size: 16px;
        z-index: 1000;
      `;
      document.body.appendChild(terrainInfo);
    }

    // Obtenir la difficulté en fonction de la position
    const difficulty = Math.min(0.1 + currentSegmentIndex * 0.01, 0.9);
    const difficultyPercent = Math.floor(difficulty * 100);

    // Déterminer le nom et la couleur du type de terrain actuel
    let terrainName = 'Standard';
    let terrainColor = '#FFFFFF';

    switch (currentChunkType) {
      case 'hill':
        terrainName = 'Collines';
        terrainColor = '#4CAF50';
        break;
      case 'plateau':
        terrainName = 'Plateau';
        terrainColor = '#2196F3';
        break;
      case 'valley':
        terrainName = 'Vallée';
        terrainColor = '#9C27B0';
        break;
      case 'ramp':
        terrainName = 'Rampe';
        terrainColor = '#FF9800';
        break;
      case 'gap':
        terrainName = 'Trou';
        terrainColor = '#F44336';
        break;
      case 'washboard':
        terrainName = 'Ondulations';
        terrainColor = '#FFEB3B';
        break;
      default:
        terrainName = 'Standard';
        terrainColor = '#FFFFFF';
    }

    // Mise à jour du contenu
    terrainInfo.innerHTML = `<span style="color:${terrainColor}">Terrain: ${terrainName}</span> - Difficulté: ${difficultyPercent}%`;
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
    try {
      // Vérifier que le pool est initialisé
      if (!this.objectPools) {
        this.objectPools = { rock: [], tree: [], sign: [] };
      }

      let rockMesh;

      // Obtenir un rocher du pool ou en créer un nouveau
      if (this.objectPools.rock && this.objectPools.rock.length > 0) {
        rockMesh = this.objectPools.rock.pop();
      } else {
        // Créer un nouveau rocher
        const rockIndex = Math.floor(Math.random() * 3);
        const rockGeometry = this.sharedGeometries.rock[rockIndex];

        if (!rockGeometry) {
          console.warn(
            "Géométrie de rocher non disponible, création d'une nouvelle"
          );
          const fallbackGeometry = new THREE.DodecahedronGeometry(0.7, 0);
          rockMesh = new THREE.Mesh(
            fallbackGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x888888,
              roughness: 0.9,
              metalness: 0.1,
            })
          );
        } else {
          rockMesh = new THREE.Mesh(rockGeometry, this.sharedMaterials.rock);
        }

        rockMesh.castShadow = true;
        rockMesh.receiveShadow = true;
        rockMesh.userData = { type: DECORATION_TYPES.ROCK };
        this.scene.add(rockMesh);
      }

      // Positionner le rocher
      rockMesh.position.set(x, y + 0.5, (Math.random() - 0.5) * 3);
      rockMesh.visible = true;

      // Ajuster légèrement la taille et la rotation à chaque utilisation
      const scale = Math.random() * 0.4 + 0.8;
      rockMesh.scale.set(scale, scale, scale);

      // Rotations aléatoires
      rockMesh.rotation.x = Math.random() * Math.PI;
      rockMesh.rotation.y = Math.random() * Math.PI * 2;
      rockMesh.rotation.z = Math.random() * Math.PI;

      return { mesh: rockMesh, type: DECORATION_TYPES.ROCK };
    } catch (error) {
      console.error("Erreur lors de la création d'un rocher:", error);
      return { mesh: null, type: DECORATION_TYPES.ROCK };
    }
  }

  // Création d'un arbre décoratif
  createTreeDecoration(x, y, segmentType) {
    try {
      // Vérifier que le pool est initialisé
      if (!this.objectPools) {
        this.objectPools = { rock: [], tree: [], sign: [] };
      }

      let treeGroup;

      // Obtenir un arbre du pool ou en créer un nouveau
      if (this.objectPools.tree && this.objectPools.tree.length > 0) {
        treeGroup = this.objectPools.tree.pop();
      } else {
        // Créer un nouvel arbre
        treeGroup = new THREE.Group();

        // S'assurer que les géométries sont disponibles
        let trunkGeometry = this.sharedGeometries?.tree?.trunk;
        let leavesGeometry = this.sharedGeometries?.tree?.leaves;

        if (!trunkGeometry || !leavesGeometry) {
          console.warn(
            "Géométries d'arbre non disponibles, création de nouvelles"
          );
          trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, 2.0, 8);
          leavesGeometry = new THREE.ConeGeometry(1.5, 3.0, 8);
        }

        // S'assurer que les matériaux sont disponibles
        let trunkMaterial = this.sharedMaterials?.tree?.trunk;
        let leavesMaterial = this.sharedMaterials?.tree?.leaves;

        if (!trunkMaterial || !leavesMaterial) {
          console.warn(
            "Matériaux d'arbre non disponibles, création de nouveaux"
          );
          trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x704214,
            roughness: 0.9,
            metalness: 0.0,
          });
          leavesMaterial = new THREE.MeshStandardMaterial({
            color: 0x38761d,
            roughness: 0.8,
            metalness: 0.0,
          });
        }

        // Tronc
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        trunk.position.y = 1.0;
        treeGroup.add(trunk);

        // Feuillage
        const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
        leaves.castShadow = true;
        leaves.receiveShadow = true;
        leaves.position.y = 3.5;
        treeGroup.add(leaves);

        treeGroup.userData = { type: DECORATION_TYPES.TREE };
        this.scene.add(treeGroup);
      }

      // Positionner l'arbre
      treeGroup.position.set(x, y, (Math.random() - 0.5) * 3);
      treeGroup.visible = true;

      // Ajuster légèrement la taille et la rotation à chaque utilisation
      const scale = Math.random() * 0.3 + 0.8;
      treeGroup.scale.set(scale, scale, scale);
      treeGroup.rotation.y = Math.random() * Math.PI * 2;
      treeGroup.rotation.z = (Math.random() - 0.5) * 0.2; // Légère inclinaison aléatoire

      return { mesh: treeGroup, type: DECORATION_TYPES.TREE };
    } catch (error) {
      console.error("Erreur lors de la création d'un arbre:", error);
      return { mesh: null, type: DECORATION_TYPES.TREE };
    }
  }

  // Création d'un panneau décoratif
  createSignDecoration(x, y, segmentType, distance) {
    // Obtenir un panneau du pool
    if (
      !this.objectPools ||
      !this.objectPools.sign ||
      this.objectPools.sign.length === 0
    ) {
      console.warn('Pool de panneaux non initialisé ou vide');
      return { mesh: null, type: DECORATION_TYPES.SIGN };
    }

    let signGroup;

    if (this.objectPools.sign.length > 0) {
      signGroup = this.objectPools.sign.pop();

      // Mettre à jour le texte du panneau avec la distance
      const textMesh = signGroup.children.find(
        (child) => child.geometry && child.geometry.type === 'PlaneGeometry'
      );

      if (textMesh) {
        // Mettre à jour le texte (simulation par couleur variable)
        const distanceColor = Math.floor(Math.random() * 0xffffff);
        textMesh.material.color.setHex(distanceColor);
      }
    } else {
      // Créer un nouveau panneau si le pool est vide
      signGroup = new THREE.Group();

      // Poteau
      const post = new THREE.Mesh(
        this.sharedGeometries.sign.post,
        this.sharedMaterials.sign.post
      );
      post.castShadow = true;
      post.receiveShadow = true;
      post.position.y = 1.25;
      signGroup.add(post);

      // Panneau
      const panel = new THREE.Mesh(
        this.sharedGeometries.sign.panel,
        this.sharedMaterials.sign.panel
      );
      panel.castShadow = true;
      panel.receiveShadow = true;
      panel.position.y = 2.0;
      signGroup.add(panel);

      // Texte
      const text = new THREE.Mesh(
        this.sharedGeometries.sign.text,
        this.sharedMaterials.sign.text
      );
      text.position.y = 2.0;
      text.position.z = 0.06;
      signGroup.add(text);

      signGroup.userData = { type: DECORATION_TYPES.SIGN };
      this.scene.add(signGroup);
    }

    // Positionner le panneau
    signGroup.position.set(x, y + 0.2, (Math.random() - 0.5) * 2);
    signGroup.visible = true;

    // Orienter le panneau vers le joueur
    signGroup.rotation.y = Math.PI / 2;

    return { mesh: signGroup, type: DECORATION_TYPES.SIGN };
  }

  // Ajouter des décorations au terrain
  addTerrainDecorations(startX, points, chunkType, decorations) {
    // Vérifier si le tableau decorations existe
    if (!decorations) {
      console.warn(
        "Le tableau decorations n'existe pas pour le segment " + startX
      );
      return;
    }

    try {
      // Densité de base pour les décorations depuis la configuration
      const baseDensity = TERRAIN_CONFIG.DECORATION_DENSITY;

      const nbPoints = Math.min(points.length, 40);

      // Points disponibles pour placement des décorations (éviter les extrémités)
      const availablePoints = points.filter(
        (p, i) => i > 2 && i < points.length - 3 && p.height !== null
      );

      // Points utilisés pour éviter les superpositions
      const usedPositions = [];

      // Fonction pour obtenir un point aléatoire
      const getRandomPoint = () => {
        if (availablePoints.length === 0) return null;
        const index = Math.floor(this.seededRandom() * availablePoints.length);
        return availablePoints[index];
      };

      // Vérifier si un espace est disponible pour une décoration
      const isSpaceAvailable = (x, z, radius) => {
        for (const pos of usedPositions) {
          const distance = Math.sqrt(
            Math.pow(pos.x - x, 2) + Math.pow(pos.z - z, 2)
          );
          if (distance < radius + pos.radius) {
            return false;
          }
        }

        // Vérifier également la distance à l'axe Z (route centrale)
        if (Math.abs(z) < 1.5 && chunkType !== 'plateau') {
          return false; // Éviter de placer des décorations sur la route
        }

        return true;
      };

      // Définir les zones de placement des décorations avec des densités plus élevées
      const zones = [
        // Zone centrale (augmenter la densité)
        {
          zMin: -this.terrainConfig.central.width / 2,
          zMax: this.terrainConfig.central.width / 2,
          densityFactor: 0.3, // Réduit de 0.6 à 0.3 pour la zone centrale
          decorTypes: ['rock'], // Principalement des rochers sur la route
        },
        // Zone de transition gauche (densité fortement augmentée)
        {
          zMin: -this.terrainConfig.central.width / 2 - 5,
          zMax: -this.terrainConfig.central.width / 2,
          densityFactor: 1.0, // Réduit de 1.5 à 1.0 pour les bords
          decorTypes: ['rock', 'tree', 'sign'],
        },
        // Zone de transition droite (densité fortement augmentée)
        {
          zMin: this.terrainConfig.central.width / 2,
          zMax: this.terrainConfig.central.width / 2 + 5,
          densityFactor: 1.0, // Réduit de 1.5 à 1.0 pour les bords
          decorTypes: ['rock', 'tree', 'sign'],
        },
        // Zone bordure gauche profonde (densité maximale)
        {
          zMin:
            -this.terrainConfig.central.width / 2 -
            this.terrainConfig.borders.width,
          zMax: -this.terrainConfig.central.width / 2 - 5,
          densityFactor: 2.0, // Réduit de 2.5 à 2.0
          decorTypes: ['rock', 'tree'],
        },
        // Zone bordure droite profonde (densité maximale)
        {
          zMin: this.terrainConfig.central.width / 2 + 5,
          zMax:
            this.terrainConfig.central.width / 2 +
            this.terrainConfig.borders.width,
          densityFactor: 2.0, // Réduit de 2.5 à 2.0
          decorTypes: ['rock', 'tree'],
        },
      ];

      // Appliquer un multiplicateur de densité selon le type de terrain
      let terrainMultiplier = 1.0;
      switch (chunkType) {
        case 'hills':
          terrainMultiplier = 1.8; // Plus de décorations sur les collines
          break;
        case 'plateau':
          terrainMultiplier = 1.5; // Un peu plus sur les plateaux
          break;
        case 'ramp':
          terrainMultiplier = 0.8; // Moins sur les rampes, mais pas trop peu
          break;
        case 'washboard':
          terrainMultiplier = 0.6; // Moins sur les washboards
          break;
        case 'valley':
          terrainMultiplier = 1.0; // Normal dans les vallées
          break;
        default:
          terrainMultiplier = 1.2; // Densité standard augmentée pour les autres types
      }

      // Pour chaque zone, ajouter des décorations
      zones.forEach((zone) => {
        // Calculer le nombre de décorations pour chaque type dans la zone
        const nbPoints = Math.min(points.length, 40);
        const zoneWidth = zone.zMax - zone.zMin;

        // Ajouter des rochers
        if (zone.decorTypes.includes('rock')) {
          const rockCount = Math.floor(
            nbPoints *
              baseDensity.ROCK *
              zone.densityFactor *
              terrainMultiplier *
              (zoneWidth / 5)
          );

          for (let i = 0; i < rockCount; i++) {
            const point = getRandomPoint();
            if (!point) continue;

            // Position avec variation aléatoire
            const posX = point.x + (Math.random() - 0.5) * 3;
            const posZ = zone.zMin + Math.random() * (zone.zMax - zone.zMin);

            // Vérifier l'espace disponible
            if (isSpaceAvailable(posX, posZ, 1.5)) {
              const rockDecoration = this.createRockDecoration(
                posX,
                point.y,
                chunkType
              );
              if (rockDecoration && rockDecoration.mesh) {
                rockDecoration.mesh.position.z = posZ;
                // Faire varier la taille
                const scale = 0.6 + Math.random() * 0.8;
                rockDecoration.mesh.scale.set(scale, scale, scale);
                decorations.push(rockDecoration);
              }
            }
          }
        }

        // Ajouter des arbres avec densité augmentée
        if (zone.decorTypes.includes('tree')) {
          const treeCount = Math.floor(
            nbPoints *
              baseDensity.TREE *
              zone.densityFactor *
              terrainMultiplier *
              (zoneWidth / 5)
          );

          for (let i = 0; i < treeCount; i++) {
            const point = getRandomPoint();
            if (!point) continue;

            // Position avec variation
            const posX = point.x + (Math.random() - 0.5) * 4;
            const posZ = zone.zMin + Math.random() * (zone.zMax - zone.zMin);

            // Vérifier l'espace disponible
            if (isSpaceAvailable(posX, posZ, 3)) {
              // Utiliser la nouvelle méthode pour créer un modèle d'arbre
              const treeModel = this.createTreeModel(
                Math.floor(Math.random() * 100)
              );

              if (treeModel) {
                // Positionner le modèle
                treeModel.position.set(posX, point.y, posZ);
                treeModel.visible = true;

                // Varier la taille des arbres
                const distanceFromCenter = Math.abs(posZ);
                const scaleFactor =
                  0.7 + (distanceFromCenter / 15) * 0.4 + Math.random() * 0.3;
                treeModel.scale.set(scaleFactor, scaleFactor, scaleFactor);

                // Rotation aléatoire
                treeModel.rotation.y = Math.random() * Math.PI * 2;

                // Légère inclinaison aléatoire
                treeModel.rotation.x = (Math.random() - 0.5) * 0.1;
                treeModel.rotation.z = (Math.random() - 0.5) * 0.2;

                // Ajouter à la scène
                this.scene.add(treeModel);

                // Ajouter aux décorations
                decorations.push({
                  mesh: treeModel,
                  type: DECORATION_TYPES.TREE,
                });
              }
            }
          }
        }

        // Ajouter des panneaux
        if (zone.decorTypes.includes('sign')) {
          // Panneaux spécifiques aux positions clés (tous les 50m environ)
          if ((startX % 50 < 10 || startX % 100 < 20) && startX > 10) {
            const signPoint =
              availablePoints[Math.floor(availablePoints.length / 3)];
            if (signPoint) {
              // Alterner entre le côté gauche et droit
              const side = Math.floor(startX / 50) % 2 === 0 ? -2.5 : 2.5;

              // Utiliser la nouvelle méthode de création de panneaux
              const signModel = this.createSignModel(
                Math.floor(startX / 50) % 3
              );

              if (signModel) {
                // Positionner le panneau
                signModel.position.set(signPoint.x, signPoint.y + 0.1, side);
                signModel.visible = true;

                // Orienter le panneau
                signModel.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;

                // Ajuster la taille
                const scale = 0.8 + Math.random() * 0.4;
                signModel.scale.set(scale, scale, scale);

                // Ajouter à la scène
                this.scene.add(signModel);

                // Ajouter aux décorations
                decorations.push({
                  mesh: signModel,
                  type: DECORATION_TYPES.SIGN,
                });
              }
            }
          }

          // Panneaux supplémentaires aléatoires
          const signCount = Math.floor(
            nbPoints *
              baseDensity.SIGN *
              zone.densityFactor *
              terrainMultiplier *
              (zoneWidth / 10)
          );

          for (let i = 0; i < signCount; i++) {
            const point = getRandomPoint();
            if (!point) continue;

            const posX = point.x + (Math.random() - 0.5) * 3;
            const posZ = zone.zMin + Math.random() * (zone.zMax - zone.zMin);

            if (isSpaceAvailable(posX, posZ, 4)) {
              const signModel = this.createSignModel(
                i + Math.floor(Math.random() * 10)
              );

              if (signModel) {
                signModel.position.set(posX, point.y + 0.1, posZ);
                signModel.visible = true;
                signModel.rotation.y = Math.random() * Math.PI * 2;

                const scale = 0.7 + Math.random() * 0.3;
                signModel.scale.set(scale, scale, scale);

                this.scene.add(signModel);

                decorations.push({
                  mesh: signModel,
                  type: DECORATION_TYPES.SIGN,
                });
              }
            }
          }
        }
      });

      console.log(
        `Ajout de ${decorations.length} décorations au segment ${startX}`
      );
    } catch (error) {
      console.error("Erreur lors de l'ajout des décorations:", error);
    }
  }

  // Système de niveau de détail (LOD) pour les terrains éloignés
  applyLOD(
    segment,
    distanceFromPlayer,
    isStartup = false,
    vehiclePosition = null
  ) {
    if (!segment) return;

    const lodDistances = {
      HIGH: 100,
      MEDIUM: 200,
      LOW: 400,
    };

    // LOD pour les meshes du terrain
    if (segment.meshes && Array.isArray(segment.meshes)) {
      segment.meshes.forEach((mesh) => {
        if (!mesh) return;

        // Obtenir les infos de la partie de terrain
        const partType = mesh.userData?.part || 'central';

        // Vérifier que le mesh a un matériau valide
        if (!mesh.material) return;

        // Ne jamais mettre les bordures en wireframe, quelle que soit la distance
        mesh.material.wireframe = false;

        // Réduire seulement les autres aspects visuels pour les parties lointaines
        if (distanceFromPlayer > lodDistances.MEDIUM) {
          // Réduire seulement l'ombrage pour les parties lointaines
          mesh.castShadow = partType === 'central';
          mesh.receiveShadow = partType === 'central';
        } else {
          // Restaurer la qualité pour les parties proches
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }

    // LOD pour les décorations
    if (segment.decorations && Array.isArray(segment.decorations)) {
      segment.decorations.forEach((decoration) => {
        if (!decoration || !decoration.mesh) return;

        // Gérer la visibilité en fonction de la distance
        if (distanceFromPlayer > lodDistances.LOW) {
          // Masquer les décorations très lointaines
          decoration.mesh.visible = false;
        } else if (distanceFromPlayer > lodDistances.MEDIUM) {
          // Réduire les détails pour les décorations à distance moyenne
          decoration.mesh.visible = true;

          // Simplifier la géométrie ou réduire la qualité si possible
          if (decoration.mesh.traverse) {
            decoration.mesh.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = false;
              }
            });
          }
        } else {
          // Détails complets pour les décorations proches
          decoration.mesh.visible = true;

          if (decoration.mesh.traverse) {
            decoration.mesh.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
          }
        }
      });
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

  // Initialise les pools de ressources pour les décorations
  initDecorationResources() {
    // Création des pools vides
    this.decorationPools = {
      [DECORATION_TYPES.TREE]: [],
      [DECORATION_TYPES.ROCK]: [],
      [DECORATION_TYPES.SIGN]: [],
    };

    // Vérification des pools à chaque démarrage
    console.log('Initialisation des pools de décorations');

    try {
      // Pool d'arbres
      const numTrees = TERRAIN_CONFIG.DECORATION_DENSITY.TREE;
      for (let i = 0; i < numTrees; i++) {
        const tree = this.createTreeModel(i);
        if (tree) this.decorationPools[DECORATION_TYPES.TREE].push(tree);
      }
      console.log(
        `Pool d'arbres créé avec ${
          this.decorationPools[DECORATION_TYPES.TREE].length
        } modèles`
      );

      // Pool de rochers
      const numRocks = TERRAIN_CONFIG.DECORATION_DENSITY.ROCK;
      for (let i = 0; i < numRocks; i++) {
        const rock = this.createRockModel(i);
        if (rock) this.decorationPools[DECORATION_TYPES.ROCK].push(rock);
      }
      console.log(
        `Pool de rochers créé avec ${
          this.decorationPools[DECORATION_TYPES.ROCK].length
        } modèles`
      );

      // Pool de panneaux
      const numSigns = TERRAIN_CONFIG.DECORATION_DENSITY.SIGN;
      for (let i = 0; i < numSigns; i++) {
        const sign = this.createSignModel(i);
        if (sign) this.decorationPools[DECORATION_TYPES.SIGN].push(sign);
      }
      console.log(
        `Pool de panneaux créé avec ${
          this.decorationPools[DECORATION_TYPES.SIGN].length
        } modèles`
      );
    } catch (error) {
      console.error(
        "Erreur lors de l'initialisation des pools de décorations:",
        error
      );
      // Créer des pools de secours minimalistes en cas d'erreur
      this.createBackupDecorationPools();
    }
  }

  // Crée des pools de secours en cas d'erreur d'initialisation
  createBackupDecorationPools() {
    console.warn('Création de pools de secours pour les décorations');

    // Réinitialiser les pools
    this.decorationPools = {
      [DECORATION_TYPES.TREE]: [],
      [DECORATION_TYPES.ROCK]: [],
      [DECORATION_TYPES.SIGN]: [],
    };

    // Créer au moins un modèle de chaque type
    try {
      // Arbre de secours
      const backupTree = this.createBackupTreeModel();
      if (backupTree) {
        this.decorationPools[DECORATION_TYPES.TREE].push(backupTree);
        console.log("Modèle d'arbre de secours créé");
      }

      // Rocher de secours
      const backupRock = this.createBackupRockModel();
      if (backupRock) {
        this.decorationPools[DECORATION_TYPES.ROCK].push(backupRock);
        console.log('Modèle de rocher de secours créé');
      }

      // Panneau de secours
      const backupSign = this.createBackupSignModel();
      if (backupSign) {
        this.decorationPools[DECORATION_TYPES.SIGN].push(backupSign);
        console.log('Modèle de panneau de secours créé');
      }
    } catch (error) {
      console.error('Échec de la création des modèles de secours:', error);
    }
  }

  // Modèles de secours simplifiés
  createBackupTreeModel() {
    try {
      const geometry = new THREE.CylinderGeometry(0.2, 0.4, 2, 5);
      const material = new THREE.MeshLambertMaterial({ color: 0x006400 });
      const trunk = new THREE.Mesh(geometry, material);

      const topGeometry = new THREE.ConeGeometry(1, 2, 6);
      const topMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 });
      const top = new THREE.Mesh(topGeometry, topMaterial);
      top.position.y = 2;

      const tree = new THREE.Group();
      tree.add(trunk);
      tree.add(top);

      return tree;
    } catch (error) {
      console.error(
        "Échec de la création du modèle d'arbre de secours:",
        error
      );
      return null;
    }
  }

  createBackupRockModel() {
    try {
      const geometry = new THREE.DodecahedronGeometry(0.6, 0);
      const material = new THREE.MeshLambertMaterial({ color: 0x808080 });
      return new THREE.Mesh(geometry, material);
    } catch (error) {
      console.error(
        'Échec de la création du modèle de rocher de secours:',
        error
      );
      return null;
    }
  }

  createBackupSignModel() {
    try {
      const postGeometry = new THREE.BoxGeometry(0.1, 1, 0.1);
      const postMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
      const post = new THREE.Mesh(postGeometry, postMaterial);

      const signGeometry = new THREE.BoxGeometry(0.6, 0.4, 0.05);
      const signMaterial = new THREE.MeshLambertMaterial({ color: 0xffd700 });
      const sign = new THREE.Mesh(signGeometry, signMaterial);
      sign.position.y = 0.5;

      const signGroup = new THREE.Group();
      signGroup.add(post);
      signGroup.add(sign);

      return signGroup;
    } catch (error) {
      console.error(
        'Échec de la création du modèle de panneau de secours:',
        error
      );
      return null;
    }
  }

  // Crée une décoration à partir des pools
  createDecoration(type, x, y, z) {
    // Vérifier si les pools sont initialisés
    if (!this.decorationPools) {
      console.warn('Les pools de décorations ne sont pas initialisés');
      this.initDecorationResources();
    }

    // Vérifier si le pool spécifique existe
    if (
      !this.decorationPools[type] ||
      this.decorationPools[type].length === 0
    ) {
      console.warn(`Le pool de type ${type} n'est pas initialisé ou est vide`);
      // Tenter de créer des pools de secours si nécessaire
      if (
        !this.decorationPools[type] ||
        this.decorationPools[type].length === 0
      ) {
        this.createBackupDecorationPools();
      }

      // Vérifier à nouveau après tentative de secours
      if (
        !this.decorationPools[type] ||
        this.decorationPools[type].length === 0
      ) {
        console.error(`Impossible de créer une décoration de type ${type}`);
        return null;
      }
    }

    try {
      // Choisir un modèle aléatoire du pool
      const randomIndex = Math.floor(
        Math.random() * this.decorationPools[type].length
      );
      const template = this.decorationPools[type][randomIndex];

      if (!template) {
        console.warn(
          `Modèle invalide trouvé dans le pool ${type} à l'index ${randomIndex}`
        );
        return null;
      }

      // Cloner le modèle
      const model = template.clone();

      // Positionner la décoration
      model.position.set(x, y, z);

      // Rotation aléatoire pour les arbres et rochers
      if (type === DECORATION_TYPES.TREE || type === DECORATION_TYPES.ROCK) {
        model.rotation.y = Math.random() * Math.PI * 2;
      }

      // Échelle aléatoire
      let scale = 1.0;
      switch (type) {
        case DECORATION_TYPES.TREE:
          scale = 0.7 + Math.random() * 0.7;
          break;
        case DECORATION_TYPES.ROCK:
          scale = 0.5 + Math.random() * 0.7;
          break;
        case DECORATION_TYPES.SIGN:
          scale = 0.9 + Math.random() * 0.2;
          break;
      }

      model.scale.set(scale, scale, scale);

      // Configurer les ombres
      model.castShadow = true;
      model.receiveShadow = true;

      // Récursivement configurer les ombres pour les enfants
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Ajouter à la scène
      this.scene.add(model);

      return {
        type: type,
        mesh: model,
        position: { x, y, z },
      };
    } catch (error) {
      console.error(
        `Erreur lors de la création d'une décoration de type ${type}:`,
        error
      );
      return null;
    }
  }

  // Crée un modèle d'arbre pour le pool
  createTreeModel(index) {
    try {
      // Varier les types d'arbres en fonction de l'index
      const treeType = index % 3;
      const treeGroup = new THREE.Group();

      // Tronc de base
      let trunkGeometry, leavesMaterial;

      switch (treeType) {
        case 0: // Pin
          trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, 2.8, 8);
          const pineLeaves = new THREE.ConeGeometry(1.2, 4.0, 8);
          leavesMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d572c,
            roughness: 0.8,
            metalness: 0.1,
          });

          const trunk = new THREE.Mesh(
            trunkGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x5d4037,
              roughness: 0.9,
              metalness: 0.0,
            })
          );
          trunk.position.y = 1.4;
          treeGroup.add(trunk);

          // Plusieurs cônes pour le pin
          const cone1 = new THREE.Mesh(pineLeaves, leavesMaterial);
          cone1.position.y = 4.0;
          treeGroup.add(cone1);

          const cone2 = new THREE.Mesh(pineLeaves, leavesMaterial);
          cone2.position.y = 3.2;
          cone2.scale.set(1.2, 0.8, 1.2);
          treeGroup.add(cone2);

          const cone3 = new THREE.Mesh(pineLeaves, leavesMaterial);
          cone3.position.y = 2.4;
          cone3.scale.set(1.4, 0.6, 1.4);
          treeGroup.add(cone3);
          break;

        case 1: // Arbre arrondi
          trunkGeometry = new THREE.CylinderGeometry(0.15, 0.3, 2.2, 8);
          const sphereGeometry = new THREE.SphereGeometry(1.8, 8, 6);
          leavesMaterial = new THREE.MeshStandardMaterial({
            color: 0x4caf50,
            roughness: 0.8,
            metalness: 0.0,
          });

          const roundTrunk = new THREE.Mesh(
            trunkGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x795548,
              roughness: 0.9,
              metalness: 0.0,
            })
          );
          roundTrunk.position.y = 1.1;
          treeGroup.add(roundTrunk);

          // Feuillage sphérique
          const leaves = new THREE.Mesh(sphereGeometry, leavesMaterial);
          leaves.position.y = 3.2;
          treeGroup.add(leaves);
          break;

        case 2: // Arbre stylisé bas
          trunkGeometry = new THREE.CylinderGeometry(0.25, 0.4, 1.5, 6);
          const flatLeavesGeometry = new THREE.CylinderGeometry(0, 2.2, 1.5, 8);
          leavesMaterial = new THREE.MeshStandardMaterial({
            color: 0x33691e,
            roughness: 0.7,
            metalness: 0.1,
          });

          const shortTrunk = new THREE.Mesh(
            trunkGeometry,
            new THREE.MeshStandardMaterial({
              color: 0x6d4c41,
              roughness: 0.9,
              metalness: 0.0,
            })
          );
          shortTrunk.position.y = 0.75;
          treeGroup.add(shortTrunk);

          // Feuillage plat
          const flatLeaves = new THREE.Mesh(flatLeavesGeometry, leavesMaterial);
          flatLeaves.position.y = 2.0;
          treeGroup.add(flatLeaves);
          break;
      }

      // Configurer les ombres pour tous les enfants
      treeGroup.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      return treeGroup;
    } catch (error) {
      console.error("Erreur lors de la création du modèle d'arbre:", error);
      return this.createBackupTreeModel();
    }
  }

  // Crée un modèle de rocher pour le pool
  createRockModel(index) {
    try {
      // Varier les types de rochers en fonction de l'index
      const rockType = index % 4;

      let rockGeometry;
      let rockMaterial;

      switch (rockType) {
        case 0: // Rocher anguleux
          rockGeometry = new THREE.DodecahedronGeometry(0.8, 0);
          rockMaterial = new THREE.MeshStandardMaterial({
            color: 0x7f7f7f,
            roughness: 0.9,
            metalness: 0.2,
          });
          break;

        case 1: // Petit rocher arrondi
          rockGeometry = new THREE.SphereGeometry(0.6, 7, 5);
          rockMaterial = new THREE.MeshStandardMaterial({
            color: 0x9e9e9e,
            roughness: 0.85,
            metalness: 0.15,
          });
          break;

        case 2: // Rocher plat
          rockGeometry = new THREE.BoxGeometry(1.2, 0.4, 0.8);
          rockMaterial = new THREE.MeshStandardMaterial({
            color: 0x757575,
            roughness: 0.8,
            metalness: 0.1,
          });
          break;

        case 3: // Rocher composite
          // Créer un groupe pour assembler plusieurs formes
          const rockGroup = new THREE.Group();

          // Base du rocher
          const baseGeometry = new THREE.BoxGeometry(1.2, 0.6, 0.9);
          const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x616161,
            roughness: 0.9,
            metalness: 0.1,
          });
          const baseRock = new THREE.Mesh(baseGeometry, baseMaterial);
          rockGroup.add(baseRock);

          // Ajouter des petites formations sur le dessus
          const topGeometry = new THREE.TetrahedronGeometry(0.4);
          const topMaterial = new THREE.MeshStandardMaterial({
            color: 0x727272,
            roughness: 0.85,
            metalness: 0.15,
          });

          // Placement de quelques tétraèdres
          const top1 = new THREE.Mesh(topGeometry, topMaterial);
          top1.position.set(0.2, 0.5, 0.1);
          top1.rotation.set(0.5, 0.8, 0.2);
          rockGroup.add(top1);

          const top2 = new THREE.Mesh(topGeometry, topMaterial);
          top2.position.set(-0.3, 0.4, -0.2);
          top2.rotation.set(0.3, -0.4, 0.1);
          top2.scale.set(0.7, 0.7, 0.7);
          rockGroup.add(top2);

          // Configurer les ombres
          rockGroup.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          return rockGroup;
      }

      // Pour les types 0-2, créer un mesh simple
      if (rockType < 3) {
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);

        // Déformer légèrement pour plus de naturel
        if (rockGeometry.attributes && rockGeometry.attributes.position) {
          const positionAttribute = rockGeometry.attributes.position;
          const vertex = new THREE.Vector3();

          for (let i = 0; i < positionAttribute.count; i++) {
            vertex.fromBufferAttribute(positionAttribute, i);

            // Déformation aléatoire mais déterministe basée sur la position
            const noise =
              0.1 *
              Math.sin(vertex.x * 5 + index) *
              Math.cos(vertex.y * 3 + index * 2) *
              Math.sin(vertex.z * 4 + index * 3);

            vertex.x += noise;
            vertex.y += noise;
            vertex.z += noise;

            positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
          }

          positionAttribute.needsUpdate = true;
          rockGeometry.computeVertexNormals();
        }

        rock.castShadow = true;
        rock.receiveShadow = true;

        return rock;
      }
    } catch (error) {
      console.error('Erreur lors de la création du modèle de rocher:', error);
      return this.createBackupRockModel();
    }
  }

  // Crée un modèle de panneau pour le pool
  createSignModel(index) {
    try {
      // Varier les types de panneaux en fonction de l'index
      const signType = index % 3;
      const signGroup = new THREE.Group();

      // Matériaux communs
      const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x8d6e63,
        roughness: 0.9,
        metalness: 0.0,
      });

      // Types de panneaux
      switch (signType) {
        case 0: // Panneau de direction
          // Poteau
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6),
            woodMaterial
          );
          post.position.y = 1.2;
          signGroup.add(post);

          // Panneau directionnel
          const arrowGeometry = new THREE.BoxGeometry(1.2, 0.4, 0.06);
          const arrowMaterial = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.5,
            metalness: 0.1,
          });
          const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
          arrow.position.y = 2.0;
          arrow.position.x = 0.4; // Décalé sur le côté
          arrow.rotation.z = Math.PI * 0.05; // Légèrement incliné
          signGroup.add(arrow);

          // Triangle pour la pointe de la flèche
          const triangleShape = new THREE.Shape();
          triangleShape.moveTo(0, 0);
          triangleShape.lineTo(0.3, 0.2);
          triangleShape.lineTo(0, 0.4);
          triangleShape.lineTo(0, 0);

          const extrudeSettings = {
            steps: 1,
            depth: 0.06,
            bevelEnabled: false,
          };

          const triangleGeometry = new THREE.ExtrudeGeometry(
            triangleShape,
            extrudeSettings
          );
          const triangle = new THREE.Mesh(triangleGeometry, arrowMaterial);
          triangle.position.set(
            arrow.position.x + 0.6,
            arrow.position.y - 0.2,
            -0.03
          );
          signGroup.add(triangle);
          break;

        case 1: // Panneau d'information
          // Poteau
          const infoPost = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.12, 2.2, 6),
            woodMaterial
          );
          infoPost.position.y = 1.1;
          signGroup.add(infoPost);

          // Panneau carré
          const panelGeometry = new THREE.BoxGeometry(1.0, 0.8, 0.04);
          const panelMaterial = new THREE.MeshStandardMaterial({
            color: 0x4fc3f7,
            roughness: 0.5,
            metalness: 0.2,
          });
          const panel = new THREE.Mesh(panelGeometry, panelMaterial);
          panel.position.y = 1.9;
          signGroup.add(panel);

          // Cadre en bois pour le panneau
          const frameGeometry = new THREE.BoxGeometry(1.1, 0.9, 0.02);
          const frame = new THREE.Mesh(frameGeometry, woodMaterial);
          frame.position.y = 1.9;
          frame.position.z = -0.03;
          signGroup.add(frame);
          break;

        case 2: // Panneau d'avertissement
          // Double poteau
          const post1 = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 2.6, 0.1),
            woodMaterial
          );
          post1.position.set(-0.4, 1.3, 0);
          signGroup.add(post1);

          const post2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 2.6, 0.1),
            woodMaterial
          );
          post2.position.set(0.4, 1.3, 0);
          signGroup.add(post2);

          // Panneau d'avertissement triangulaire
          const warnShape = new THREE.Shape();
          warnShape.moveTo(0, 0.8);
          warnShape.lineTo(-0.7, -0.4);
          warnShape.lineTo(0.7, -0.4);
          warnShape.lineTo(0, 0.8);

          const warnExtrudeSettings = {
            steps: 1,
            depth: 0.05,
            bevelEnabled: false,
          };

          const warnGeometry = new THREE.ExtrudeGeometry(
            warnShape,
            warnExtrudeSettings
          );
          const warnMaterial = new THREE.MeshStandardMaterial({
            color: 0xffeb3b,
            roughness: 0.5,
            metalness: 0.3,
          });
          const warnPanel = new THREE.Mesh(warnGeometry, warnMaterial);
          warnPanel.position.set(0, 2.0, 0);
          signGroup.add(warnPanel);

          // Point d'exclamation
          const exclamationBar = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.4, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x000000 })
          );
          exclamationBar.position.set(0, 1.9, 0.03);
          signGroup.add(exclamationBar);

          const exclamationDot = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.08, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x000000 })
          );
          exclamationDot.position.set(0, 1.65, 0.03);
          signGroup.add(exclamationDot);
          break;
      }

      // Configurer les ombres pour tous les enfants
      signGroup.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      return signGroup;
    } catch (error) {
      console.error('Erreur lors de la création du modèle de panneau:', error);
      return this.createBackupSignModel();
    }
  }

  // Obtenir la rigidité du segment en fonction du type de chunk
  getSegmentRigidity(chunkType) {
    // Déterminer le multiplicateur de rigidité selon le type de terrain
    switch (chunkType) {
      case 'gap':
        return 0.1; // Rigidité réduite pour les trous
      case 'ramp':
        return 1.5; // Rigidité augmentée pour les rampes
      case 'washboard':
        return 1.2; // Rigidité accrue pour les zones ondulées
      case 'valley':
        return 0.8; // Rigidité moyenne pour les vallées
      case 'plateau':
        return 1.0; // Rigidité standard pour les plateaux
      default:
        return 1.0; // Rigidité standard pour les autres types
    }
  }

  initTerrain() {
    this.playerPosCache = { x: 0, z: 0 };
    this.terrainMeshes = [];
    this.renderDistance = 800; // Distance de rendu
    this.preloadDistance = 400; // Distance de préchargement

    // Créer un nombre suffisant de segments initiaux (20 segments à partir de -5)
    const initialSegments = 20;
    const startOffset = -5;

    for (let i = startOffset; i < initialSegments + startOffset; i++) {
      this.createTerrainSegment(i * this.segmentWidth, false);
    }

    // Appliquer les niveaux de détail immédiatement
    this.updateLOD();
  }
}
