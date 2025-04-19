import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import { Clock, Vector3 } from 'three';

import Vehicle from './Vehicle';
import Terrain from './Terrain';
import Camera from './Camera';
import Controls from './Controls';

// Post-processing pour améliorer le rendu visuel
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// Import des shaders pour l'effet cartoon
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import {
  ToonShader1,
  ToonShader2,
  ToonShaderHatching,
  ToonShaderDotted,
} from 'three/examples/jsm/shaders/ToonShader.js';

// Constantes pour les paramètres de debug et physique
const DEBUG = {
  SHOW_PHYSICS: false, // Désactivé pour ne plus afficher les formes physiques
  WIREFRAME: false,
  SHOW_FPS: true,
  CARTOON_STYLE: true, // Activer le style cartoon
};

const PHYSICS_TIME_STEP = 1 / 60;

// Après les autres constantes, ajoutons la configuration de simplification
const TERRAIN_CONFIG = {
  // Autres configurations existantes
  PHYSICS_SIMPLIFICATION: {
    SKIP_MINOR_SEGMENTS: true, // Ignorer les très petits segments
    SEGMENT_STEP: 2, // Prendre 1 segment sur 2
    REDUCE_DECORATION_PHYSICS: true, // Réduire la physique des décorations
  },
};

export default class Game {
  constructor(params = {}) {
    // Récupérer le canvas et extraire les paramètres
    this.canvas = document.getElementById(params.canvasId);
    if (!this.canvas) throw new Error('Canvas introuvable');

    // Utiliser la seed fournie par l'utilisateur ou en générer une aléatoire
    this.currentSeed = params.seed
      ? params.seed
      : Math.floor(Math.random() * 100000);
    console.log(`Seed: ${this.currentSeed}`);

    // Initialisation des statistiques du jeu
    this.gameStats = {
      distanceTraveled: 0, // Distance parcourue en mètres
      maxSpeed: 0, // Vitesse maximale atteinte en km/h
      startPosition: 0, // Position de départ
      lastPosition: 0, // Dernière position connue
    };

    // Propriétés de base
    this.scene = null;
    this.renderer = null;
    this.camera = null;
    this.physicsWorld = null;
    this.vehicle = null;
    this.terrain = null;
    this.isRunning = false; // Démarrer en pause jusqu'à l'initialisation complète
    this.clock = new Clock();
    this.loadingScreen = null;
    this.gameCamera = null;
    this.controls = null;
    this.initialized = false;

    // Variables pour l'affichage FPS
    this.frameCount = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.fpsDisplay = null;

    // Rendre l'instance de jeu accessible globalement pour les contrôles
    window.gameInstance = this;

    // Factory pour les matériaux cartoon
    this.cartoonMaterials = new Map();

    // Initialiser la config du terrain avec nos options de simplification
    window.TERRAIN_CONFIG = TERRAIN_CONFIG;

    try {
      console.log("Début de l'initialisation du jeu");
      // Initialisation des composants de base - ordre crucial
      this.initScene();

      // Vérification que la scène a été créée
      if (!this.scene) {
        throw new Error("Erreur lors de l'initialisation de la scène");
      }

      this.initPhysics();
      this.initLighting();

      // Afficher la SEED actuelle
      this.displaySeed();

      // Créer tout de suite un debugger pour la physique
      if (DEBUG.SHOW_PHYSICS) {
        this.debugger = new CannonDebugger(this.scene, this.physicsWorld);
      }

      // Démarrer la boucle d'animation immédiatement
      this.animate();
      console.log("Boucle d'animation démarrée");

      // Montrer l'écran de chargement
      this.showLoadingScreen();

      // Démarrer l'initialisation progressive
      setTimeout(() => {
        this.startLoading();
      }, 100);
    } catch (error) {
      console.error("Erreur lors de l'initialisation du jeu:", error);
      throw error;
    }
  }

  // Initialisation complète et progressive du jeu
  async initializeProgressively() {
    try {
      console.log("Début de l'initialisation progressive");
      this.showLoadingScreen();
      this.updateLoadingProgress(10, 'Initialisation du monde physique');

      // S'assurer que le monde physique est créé avant d'accéder à ses propriétés
      if (!this.physicsWorld) {
        this.physicsWorld = new CANNON.World();
        this.physicsWorld.gravity.set(0, -2, 0); // Gravité faible au départ
        this.physicsWorld.broadphase = new CANNON.SAPBroadphase(
          this.physicsWorld
        );
        this.physicsWorld.solver.iterations = 10;
        this.physicsWorld.defaultContactMaterial.contactEquationStiffness = 1e7;
        this.physicsWorld.defaultContactMaterial.contactEquationRelaxation = 4;
      } else {
        // Réduire la gravité si le monde existe déjà
        this.physicsWorld.gravity.set(0, -2, 0);
      }

      console.log('Monde physique initialisé');
      this.updateLoadingProgress(40, 'Génération du terrain initial');

      // Initialiser le terrain avec moins de segments au départ
      if (this.terrain) {
        this.terrain.initialize(10); // Réduire le nombre de segments initiaux
        this.updateLoadingProgress(70, 'Finalisation');

        // Planifier l'augmentation progressive de la gravité
        setTimeout(() => {
          this.increaseGravityGradually();
          this.updateLoadingProgress(100, 'Prêt à jouer!');
          this.completeLoading();
        }, 500);
      } else {
        // Si pas de terrain, finir quand même le chargement
        this.updateLoadingProgress(100, 'Prêt à jouer!');
        this.completeLoading();
      }

      console.log('Initialisation progressive terminée avec succès');
    } catch (error) {
      console.error("Erreur lors de l'initialisation progressive:", error);
      this.updateLoadingProgress(100, 'Erreur lors du chargement');
      this.hideLoadingScreen();
    }
  }

  // Orchestration du chargement progressif
  async startLoading() {
    try {
      console.log('Démarrage du chargement progressif');

      // 1. Initialiser le monde physique (10%)
      await this.initializePhysicsWorld();
      this.updateLoadingProgress(10, 'Monde physique initialisé');

      // 2. Initialiser la base du terrain (40%)
      await this.initializeTerrainBase();
      this.updateLoadingProgress(40, 'Terrain de base généré');

      // 3. Créer le véhicule (60%)
      await this.createVehicle();
      this.updateLoadingProgress(60, 'Véhicule créé');

      // 4. Configurer la caméra (70%)
      await this.setupCamera();
      this.updateLoadingProgress(70, 'Caméra configurée');

      // 5. Initialiser les contrôles (80%)
      await this.initializeControls();
      this.updateLoadingProgress(80, 'Contrôles initialisés');

      // 6. Finaliser l'initialisation (100%)
      await this.finalizeInitialization();
      this.updateLoadingProgress(100, 'Chargement terminé!');

      // Démarrer le jeu après un court délai
      setTimeout(() => {
        this.completeLoading();
      }, 500);
    } catch (error) {
      console.error('Erreur critique durant le chargement:', error);
      this.updateLoadingProgress(100, 'Erreur lors du chargement');
      // Afficher un message d'erreur à l'utilisateur
      alert(
        'Une erreur est survenue lors du chargement du jeu. Veuillez actualiser la page.'
      );
    }
  }

  // 1. Initialisation du monde physique
  async initializePhysicsWorld() {
    return new Promise((resolve) => {
      // Créer le monde physique
      this.physicsWorld = new CANNON.World();
      this.physicsWorld.gravity.set(0, -14, 0); // Gravité initiale réduite
      this.physicsWorld.broadphase = new CANNON.SAPBroadphase(
        this.physicsWorld
      );
      this.physicsWorld.solver.iterations = 10;
      this.physicsWorld.defaultContactMaterial.friction = 0.5;

      // Augmenter progressivement la gravité
      this.increaseGravityGradually();

      // Résoudre après un court délai
      setTimeout(resolve, 300);
    });
  }

  // 2. Initialisation de la base du terrain
  async initializeTerrainBase() {
    return new Promise((resolve) => {
      try {
        console.log('Initialisation du terrain...');
        // Créer l'objet terrain
        this.terrain = new Terrain(
          this.scene,
          this.physicsWorld,
          this.currentSeed
        );

        // Forcer la génération complète dès le début
        this.terrain.visibleSegments = 15; // Nombre de segments visibles

        // Initialiser le terrain avec tous les segments (pas de réduction)
        this.terrain.initialize();

        // Appliquer le style cartoon au terrain si activé
        if (DEBUG.CARTOON_STYLE && this.terrain.meshes) {
          this.terrain.meshes.forEach((mesh) => {
            this.applyCartoonStyle(mesh, 0x33cc33); // Couleur verte pour le terrain
          });
        }

        // Forcer la génération des côtés immédiatement
        if (typeof this.terrain.generateAdditionalSegments === 'function') {
          console.log('Génération des segments additionnels du terrain...');
          this.terrain.generateAdditionalSegments();
        }

        // Résoudre après un court délai pour laisser le temps au rendu
        setTimeout(resolve, 1000);
      } catch (error) {
        console.error("Erreur lors de l'initialisation du terrain:", error);
        resolve(); // Continuer malgré l'erreur
      }
    });
  }

  // 3. Création du véhicule
  async createVehicle() {
    return new Promise((resolve) => {
      try {
        // Créer le véhicule avec position initiale au début du terrain
        let startX = 5; // Position de départ par défaut
        let startY = 10; // Hauteur de départ par défaut

        // Essayer d'obtenir la position de départ du terrain si disponible
        if (
          this.terrain &&
          typeof this.terrain.getTerrainHeightAt === 'function'
        ) {
          const terrainY = this.terrain.getTerrainHeightAt(startX);
          if (terrainY !== null && terrainY !== undefined) {
            startY = terrainY + 5; // 5 unités au-dessus du terrain
          }
        }

        // Créer le véhicule avec les paramètres directs
        this.vehicle = new Vehicle(this.scene, this.physicsWorld);

        // Appliquer le style cartoon au véhicule si activé
        if (DEBUG.CARTOON_STYLE && this.vehicle.mesh) {
          this.applyCartoonStyle(this.vehicle.mesh, 0x3366ff); // Couleur bleue pour le véhicule
        }

        // Résoudre après un court délai
        setTimeout(resolve, 400);
      } catch (error) {
        console.error('Erreur lors de la création du véhicule:', error);
        resolve(); // Continuer malgré l'erreur
      }
    });
  }

  // 4. Configuration de la caméra
  async setupCamera() {
    return new Promise((resolve) => {
      try {
        // Vérifier que la caméra principale existe
        if (!this.camera) {
          console.warn(
            "La caméra principale n'existe pas, création d'une nouvelle caméra"
          );
          // Créer une caméra de base si elle n'existe pas
          const aspect = window.innerWidth / window.innerHeight;
          this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 5000);
        }

        // Créer la caméra de jeu qui suivra le véhicule
        if (!this.gameCamera) {
          this.gameCamera = new Camera(this.camera);
          console.log('Camera de jeu initialisée');
        }

        // Positionner la caméra à un point de vue initial plus éloigné
        this.camera.position.set(15, 20, 20);
        this.camera.lookAt(new THREE.Vector3(0, 0, 0));

        // Si le véhicule existe, positionner la caméra derrière lui
        if (this.vehicle && this.vehicle.getChassisBody) {
          const vehiclePosition = this.vehicle.getChassisBody().position;
          this.camera.position.set(
            vehiclePosition.x - 10,
            vehiclePosition.y + 5,
            vehiclePosition.z
          );
          this.camera.lookAt(vehiclePosition);
        }

        // Résoudre immédiatement
        resolve();
      } catch (error) {
        console.error('Erreur lors de la configuration de la caméra:', error);
        resolve(); // Continuer malgré l'erreur
      }
    });
  }

  // 5. Initialisation des contrôles
  async initializeControls() {
    return new Promise((resolve) => {
      try {
        // Initialiser les contrôles mais les désactiver jusqu'à la fin du chargement
        this.controls = new Controls(this.vehicle, (x) => {
          return this.terrain && this.terrain.getTerrainHeightAt
            ? this.terrain.getTerrainHeightAt(x)
            : 0;
        });
        this.controls.enabled = false;

        // Résoudre immédiatement
        resolve();
      } catch (error) {
        console.error("Erreur lors de l'initialisation des contrôles:", error);
        resolve(); // Continuer malgré l'erreur
      }
    });
  }

  // 6. Finalisation de l'initialisation
  async finalizeInitialization() {
    return new Promise((resolve) => {
      try {
        // Générer des segments supplémentaires du terrain si possible
        if (
          this.terrain &&
          typeof this.terrain.generateAdditionalSegments === 'function'
        ) {
          this.terrain.generateAdditionalSegments();
        }

        // Initialiser les statistiques finales
        this.setupStats();

        // Résoudre après un court délai
        setTimeout(resolve, 300);
      } catch (error) {
        console.error('Erreur lors de la finalisation:', error);
        resolve(); // Continuer malgré l'erreur
      }
    });
  }

  // Méthode pour initialiser l'affichage des statistiques
  setupStats() {
    // Initialiser l'affichage des statistiques du jeu
    this.initStatsDisplay();
  }

  // Compléter le chargement et commencer le jeu
  completeLoading() {
    // Attendre un petit délai pour que l'utilisateur puisse voir le 100%
    setTimeout(() => {
      // Générer des segments de terrain supplémentaires si la méthode existe
      if (
        this.terrain &&
        typeof this.terrain.generateAdditionalSegments === 'function'
      ) {
        this.terrain.generateAdditionalSegments();
      }

      // Activer les contrôles et cacher l'écran de chargement
      if (this.controls) {
        this.controls.enabled = true;
        console.log('Contrôles activés');
      } else {
        console.warn(
          'Contrôles non disponibles, création de nouveaux contrôles'
        );
        // Créer les contrôles s'ils n'existent pas encore
        this.controls = new Controls(this.vehicle, (x) => {
          return this.terrain && this.terrain.getTerrainHeightAt
            ? this.terrain.getTerrainHeightAt(x)
            : 0;
        });
        this.controls.enabled = true;
      }

      // Démarrer le jeu
      this.isRunning = true;

      this.hideLoadingScreen();
      console.log('Chargement terminé, jeu prêt');
    }, 1000);
  }

  // Augmenter progressivement la gravité
  increaseGravityGradually() {
    const targetGravity = -14; // Gravité cible augmentée (était -9.82)
    const currentGravity = this.physicsWorld.gravity.y;
    const steps = 10; // Moins d'étapes pour une transition plus rapide
    const interval = 50; // Intervalle réduit pour une transition plus rapide

    const gravityIncrement = (targetGravity - currentGravity) / steps;

    let step = 0;
    const gravityInterval = setInterval(() => {
      if (step >= steps) {
        clearInterval(gravityInterval);
        console.log('Gravité normale restaurée:', this.physicsWorld.gravity.y);
        return;
      }

      const newGravity = currentGravity + gravityIncrement * step;
      this.physicsWorld.gravity.set(0, newGravity, 0);
      step++;

      console.log('Gravité ajustée à:', this.physicsWorld.gravity.y);
    }, interval);
  }

  // Afficher l'écran de chargement
  showLoadingScreen() {
    // Vérifier si l'écran existe déjà
    if (this.loadingScreen) {
      this.loadingScreen.style.display = 'flex';
      return;
    }

    // Créer l'écran de chargement
    this.loadingScreen = document.createElement('div');
    this.loadingScreen.id = 'loading-screen';

    // Styles pour l'écran de chargement
    Object.assign(this.loadingScreen.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: '1000',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      transition: 'opacity 1s',
      opacity: '1',
    });

    // Titre
    const title = document.createElement('h1');
    title.textContent = 'CHARGEMENT';
    Object.assign(title.style, {
      fontSize: '3em',
      color: '#ff6600',
      margin: '0 0 10px 0',
    });

    // Sous-titre
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Préparation de la course...';
    Object.assign(subtitle.style, {
      fontSize: '1.5em',
      margin: '0 0 30px 0',
      opacity: '0.8',
    });

    // Conteneur de la barre de progression
    const progressContainer = document.createElement('div');
    Object.assign(progressContainer.style, {
      width: '80%',
      maxWidth: '500px',
      height: '20px',
      backgroundColor: '#333',
      borderRadius: '10px',
      overflow: 'hidden',
      margin: '0 0 15px 0',
    });

    // Barre de progression
    this.progressBar = document.createElement('div');
    Object.assign(this.progressBar.style, {
      width: '0%',
      height: '100%',
      backgroundColor: '#ff6600',
      transition: 'width 0.5s',
    });
    progressContainer.appendChild(this.progressBar);

    // Texte de progression
    this.progressText = document.createElement('p');
    this.progressText.textContent = 'Initialisation...';
    Object.assign(this.progressText.style, {
      fontSize: '1em',
      margin: '10px 0',
    });

    // Information sur la seed
    const seedInfo = document.createElement('div');
    Object.assign(seedInfo.style, {
      marginTop: '30px',
      fontSize: '0.9em',
      opacity: '0.6',
    });
    seedInfo.textContent = `Seed: ${this.currentSeed || 'N/A'}`;

    // Ajouter les éléments à l'écran
    this.loadingScreen.appendChild(title);
    this.loadingScreen.appendChild(subtitle);
    this.loadingScreen.appendChild(progressContainer);
    this.loadingScreen.appendChild(this.progressText);
    this.loadingScreen.appendChild(seedInfo);

    // Ajouter l'écran au DOM
    document.body.appendChild(this.loadingScreen);
  }

  // Mettre à jour la progression du chargement
  updateLoadingProgress(percent, message) {
    if (!this.loadingScreen) return;

    // Mettre à jour la barre de progression
    if (this.progressBar) {
      this.progressBar.style.width = `${percent}%`;
    }

    // Mettre à jour le message si fourni
    if (message && this.progressText) {
      this.progressText.textContent = message;
    }
  }

  // Masquer l'écran de chargement
  hideLoadingScreen() {
    if (!this.loadingScreen) return;

    // Effet de fondu avant de retirer l'élément
    this.loadingScreen.style.opacity = '0';

    // Retirer l'élément après la transition
    setTimeout(() => {
      if (this.loadingScreen && this.loadingScreen.parentNode) {
        this.loadingScreen.parentNode.removeChild(this.loadingScreen);
        this.loadingScreen = null;
      }
    }, 1000);
  }

  initScene() {
    // Configuration de la scène Three.js
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Ciel bleu

    // Configuration de la caméra - Augmenter la distance de rendu
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 5000); // Far plane à 5000 au lieu de 1000

    // Positionner la caméra à un point de vue initial plus éloigné
    this.camera.position.set(15, 20, 20);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));

    // Ajouter un fog pour une transition douce à l'horizon
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 1000);

    // Configuration du renderer avec le canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });

    // Configurer la taille du renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Désactiver les ombres pour améliorer les performances
    this.renderer.shadowMap.enabled = false;

    // Appliquer l'effet cartoon/cel-shading si activé
    if (DEBUG.CARTOON_STYLE) {
      this.outlineEffect = new OutlineEffect(this.renderer, {
        defaultThickness: 0.01,
        defaultColor: [0, 0, 0],
        defaultAlpha: 0.8,
        defaultKeepAlive: true,
      });
    }

    // Gestion du redimensionnement de la fenêtre
    window.addEventListener('resize', this.onWindowResize.bind(this));

    console.log('Scene, camera et renderer initialisés');
  }

  initPhysics() {
    // Configuration du monde physique avec une gravité plus forte
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -14, 0), // Gravité augmentée (était -9.82)
    });

    // Configuration du solveur pour de meilleures performances
    this.physicsWorld.solver.iterations = 10;
    this.physicsWorld.solver.tolerance = 0.01;

    console.log(
      'Monde physique initialisé avec gravité:',
      this.physicsWorld.gravity
    );
  }

  initLighting() {
    // Éclairage ambiant - plus fort pour le style cartoon qui n'a pas d'ombres
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    // Lumière directionnelle principale
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(50, 200, 100);
    // Désactiver les ombres pour améliorer les performances
    directionalLight.castShadow = false;
    this.scene.add(directionalLight);

    // Lumière secondaire pour accentuer les contours
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
    fillLight.position.set(-50, 50, -50);
    this.scene.add(fillLight);

    // Lumière d'arrière-plan pour accentuer les silhouettes
    const backLight = new THREE.DirectionalLight(0xffeedd, 0.5);
    backLight.position.set(0, 20, -100);
    this.scene.add(backLight);

    console.log('Éclairage style cartoon initialisé');
  }

  onWindowResize() {
    // Mettre à jour la taille du renderer et le ratio d'aspect de la caméra
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate = () => {
    // Toujours exécuter l'animation, même si le jeu n'est pas "en cours"
    requestAnimationFrame(this.animate);

    // Mettre à jour les éléments de la scène seulement si le jeu est en cours
    if (this.isRunning) {
      const deltaTime = this.clock.getDelta();

      // Gestion de la physique
      if (this.physicsWorld) {
        this.physicsWorld.step(PHYSICS_TIME_STEP);
      }

      // Mise à jour des contrôles
      if (this.controls && this.controls.enabled) {
        this.controls.update();
      }

      // Mise à jour des éléments visuels
      if (this.vehicle) {
        this.vehicle.update();

        // Vérifier si le véhicule est tombé hors du terrain
        if (this.vehicle.getChassisBody()) {
          this.checkOutOfBounds();
        }

        // Mise à jour des statistiques du jeu
        this.updateStatsDisplay();
      }

      if (this.terrain) {
        this.terrain.update(
          this.vehicle && this.vehicle.getChassisBody()
            ? this.vehicle.getChassisBody().position
            : new THREE.Vector3(0, 0, 0)
        );
      }

      // Mise à jour de la caméra - vérification plus stricte des conditions
      if (
        this.gameCamera &&
        this.vehicle &&
        this.vehicle.getChassisBody &&
        this.vehicle.getChassisBody()
      ) {
        this.gameCamera.update(this.vehicle.getChassisBody().position);

        // S'assurer que la caméra principale suit la caméra de jeu
        if (this.camera && this.gameCamera.camera) {
          this.camera.position.copy(this.gameCamera.camera.position);
          this.camera.quaternion.copy(this.gameCamera.camera.quaternion);
        }
      } else if (this.gameCamera) {
        // Mise à jour de secours si le véhicule n'est pas encore prêt
        this.gameCamera.update(new THREE.Vector3(5, 10, 0));
      } else if (this.camera && !this.gameCamera) {
        // Initialisation de secours de la caméra si elle n'existe pas encore
        console.log('Creating gameCamera in animate loop as fallback');
        this.gameCamera = new Camera(this.camera);
      }

      // Afficher le débugger physique si activé
      if (DEBUG.SHOW_PHYSICS && this.debugger) {
        this.debugger.update();
      }

      // Affichage des FPS si activé
      if (DEBUG.SHOW_FPS) {
        this.frameCount++;
        this.fpsTime += deltaTime;

        if (this.fpsTime >= 1) {
          this.fps = Math.round(this.frameCount / this.fpsTime);
          this.frameCount = 0;
          this.fpsTime = 0;

          // Mettre à jour l'affichage des FPS
          if (!this.fpsDisplay) {
            this.fpsDisplay = document.createElement('div');
            this.fpsDisplay.id = 'fps-display';
            this.fpsDisplay.style.cssText = `
              position: absolute;
              top: 120px;
              right: 20px;
              background: rgba(0, 0, 0, 0.7);
              color: white;
              padding: 8px 12px;
              border-radius: 5px;
              font-size: 14px;
              z-index: 1000;
            `;
            document.body.appendChild(this.fpsDisplay);
          }

          this.fpsDisplay.textContent = `FPS: ${this.fps}`;
        }
      }
    }

    // Toujours effectuer le rendu de la scène, même si le jeu n'est pas en cours
    if (this.scene && this.camera && this.renderer) {
      if (DEBUG.CARTOON_STYLE && this.outlineEffect) {
        // Rendu avec effet de contour pour style cartoon
        this.outlineEffect.render(this.scene, this.camera);
      } else if (this.composer && this.composer.passes.length > 0) {
        // Rendu avec post-processing
        this.composer.render();
      } else {
        // Rendu standard
        this.renderer.render(this.scene, this.camera);
      }
    }
  };

  // Méthodes publiques pour interagir avec le jeu
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  // Mettre le jeu en pause ou reprendre
  togglePause() {
    this.isRunning = !this.isRunning;
    console.log(`Jeu ${this.isRunning ? 'repris' : 'en pause'}`);

    // Si les contrôles existent, les désactiver ou réactiver
    if (this.controls) {
      this.controls.enabled = this.isRunning;
    }

    return this.isRunning;
  }

  // Vérifier si le jeu est en pause
  isPaused() {
    return !this.isRunning;
  }

  reset() {
    try {
      console.log('Réinitialisation complète avec SEED:', this.currentSeed);

      // Mettre le jeu en pause pendant la réinitialisation
      const wasRunning = this.isRunning;
      this.isRunning = false;

      // Réinitialiser les statistiques
      this.gameStats = {
        distanceTraveled: 0,
        maxSpeed: 0,
        startPosition: 0,
        lastPosition: 0,
      };

      // Mettre à jour l'affichage des statistiques
      this.updateStatsDisplay();

      // Vérifier que le véhicule existe
      if (!this.vehicle || !this.vehicle.getChassisBody()) {
        console.warn("Le véhicule n'existe pas, réinitialisation complète");
        this.resetWithSameSeed();
        return;
      }

      const vehicleBody = this.vehicle.getChassisBody();

      // Réinitialiser la position à 0m (position de départ)
      const resetX = 5; // Position de départ standard

      // Obtenir la hauteur du terrain à cette position
      const terrainHeight = this.terrain.getTerrainHeightAt(resetX);
      const resetY = terrainHeight ? terrainHeight + 7 : 12; // Hauteur augmentée davantage (7 unités au-dessus du terrain)

      // Réinitialiser position et vitesse
      vehicleBody.position.set(resetX, resetY, 0);
      vehicleBody.quaternion.set(0, 0, 0, 1);
      vehicleBody.velocity.set(0, 0, 0);
      vehicleBody.angularVelocity.set(0, 0, 0);

      // Réinitialiser les roues si possible
      if (this.vehicle.wheelBodies) {
        this.vehicle.wheelBodies.forEach((wheel) => {
          if (wheel) {
            wheel.velocity.set(0, 0, 0);
            wheel.angularVelocity.set(0, 0, 0);
          }
        });
      }

      // Repositionner la caméra
      if (this.gameCamera) {
        this.gameCamera.target.set(resetX, resetY, 0);
        this.gameCamera.velocity.set(0, 0, 0);
      }

      // Réinitialiser les statistiques
      this.gameStats = {
        distanceTraveled: 0,
        maxSpeed: 0,
        startPosition: resetX,
        lastPosition: resetX,
      };

      // Mettre à jour l'affichage
      this.updateStatsDisplay();

      // Reprendre le jeu si nécessaire
      if (wasRunning) {
        setTimeout(() => {
          this.isRunning = true;
          if (this.controls) this.controls.enabled = true;
        }, 100);
      }

      console.log('Véhicule réinitialisé à la position de départ (0m)');
    } catch (error) {
      console.error('Erreur lors de la réinitialisation à 0m:', error);
      // En cas d'erreur, faire un reset complet
      this.resetWithSameSeed();
    }
  }

  // Nouvelle méthode pour réinitialiser le véhicule à une position sûre
  resetVehicle() {
    try {
      // Vérifier que le véhicule et le terrain existent
      if (!this.vehicle || !this.terrain) {
        return;
      }

      // Obtenir la position actuelle du véhicule
      const vehicleBody = this.vehicle.getChassisBody();
      if (!vehicleBody) {
        return;
      }

      // Obtenir la position X du véhicule pour reset légèrement en arrière
      const currentX = Math.max(5, vehicleBody.position.x - 5); // Recul de 5 unités, mais min 5

      // Réinitialiser le véhicule en utilisant la fonction de hauteur du terrain
      this.vehicle.reset((x) => {
        const terrainHeight = this.terrain.getTerrainHeightAt(x);
        // Hauteur beaucoup plus élevée pour éviter les collisions
        return terrainHeight ? terrainHeight + 5 : 10;
      });

      // Positionner explicitement le véhicule à la position reculée
      vehicleBody.position.x = currentX;

      // Conserver la distance parcourue (ne pas la réinitialiser)
      // Mise à jour de la position de référence
      this.gameStats.lastPosition = vehicleBody.position.x;

      console.log('Véhicule réinitialisé à la position X:', currentX);
    } catch (error) {
      console.error('Erreur lors de la réinitialisation du véhicule:', error);
    }
  }

  // Nouvelle méthode pour réinitialiser complètement le jeu en gardant la même SEED
  resetWithSameSeed() {
    try {
      console.log('Réinitialisation avec SEED:', this.currentSeed);

      // Sauvegarder la SEED actuelle
      const savedSeed = this.currentSeed;

      // Réinitialiser les statistiques
      this.gameStats = {
        distanceTraveled: 0,
        maxSpeed: 0,
        startPosition: 0,
        lastPosition: 0,
      };

      // Réinitialiser l'affichage des statistiques
      this.initStatsDisplay();

      // Arrêter la boucle d'animation actuelle
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }

      // Nettoyer les ressources existantes
      this.dispose();

      // Réinitialiser l'état
      this.errorCount = 0;
      this.isDisposed = false;

      // Restaurer la SEED
      this.currentSeed = savedSeed;

      // Recréer tous les composants
      this.initScene();
      this.initPhysics();
      this.initLighting();

      // Recréer les objets du jeu avec la même SEED
      this.terrain = new Terrain(
        this.scene,
        this.physicsWorld,
        this.currentSeed
      );
      this.vehicle = new Vehicle(this.scene, this.physicsWorld);
      this.gameCamera = new Camera(this.camera);
      this.controls = new Controls(
        this.vehicle,
        this.terrain.getTerrainHeightAt.bind(this.terrain)
      );

      // Afficher la SEED
      this.displaySeed();

      // Recréer le débogueur
      this.debugger = new CannonDebugger(this.scene, this.physicsWorld);

      // Enregistrer la position initiale
      if (this.vehicle && this.vehicle.getChassisBody()) {
        this.gameStats.startPosition = this.vehicle.getChassisBody().position.x;
        this.gameStats.lastPosition = this.gameStats.startPosition;
      }

      // Relancer la boucle d'animation
      this.animate();

      console.log('Jeu réinitialisé avec succès (même SEED)');
    } catch (error) {
      console.error(
        'Erreur critique lors de la réinitialisation du jeu:',
        error
      );
      this.isDisposed = true; // Empêcher de nouvelles tentatives
    }
  }

  // Nettoyage des ressources lors de la destruction de l'instance
  dispose() {
    try {
      // Marquer comme disposé pour arrêter la boucle d'animation
      this.isDisposed = true;

      // Stopper la boucle d'animation
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }

      // Supprimer les écouteurs d'événements
      window.removeEventListener('resize', this.onWindowResize);

      // Supprimer les écouteurs d'événements des contrôles
      if (this.controls) {
        this.controls.dispose();
      }

      // Nettoyer les ressources du terrain
      if (this.terrain) {
        this.terrain.dispose();
      }

      // Supprimer tous les éléments d'UI qui pourraient exister
      const elementsToRemove = [
        '.terrain-info',
        '.game-controls',
        '#game-stats',
        '#seed-display',
        '#controls-display',
      ];

      elementsToRemove.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => el.remove());
      });

      // Supprimer les corps physiques
      if (this.physicsWorld) {
        // Vider le monde physique
        if (Array.isArray(this.physicsWorld.bodies)) {
          const bodies = [...this.physicsWorld.bodies]; // Créer une copie pour éviter des problèmes pendant l'itération
          bodies.forEach((body) => {
            if (body) {
              this.physicsWorld.removeBody(body);
            }
          });
        }
      }

      // Nettoyer la scène
      if (this.scene) {
        // Supprimer tous les objets de la scène
        while (this.scene.children && this.scene.children.length > 0) {
          const object = this.scene.children[0];
          if (object) {
            // Nettoyer les géométries et matériaux
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach((material) => {
                  if (material) material.dispose();
                });
              } else {
                object.material.dispose();
              }
            }
            this.scene.remove(object);
          }
        }
      }

      // Nettoyer le renderer en toute sécurité
      if (this.renderer) {
        try {
          this.renderer.dispose();
          this.renderer.forceContextLoss();
          // Ne pas tenter de modifier directement des propriétés read-only
          this.renderer.domElement = null;
        } catch (rendererError) {
          console.warn('Erreur lors du nettoyage du renderer:', rendererError);
          // Ignorer les erreurs du renderer, car elles ne sont pas critiques
        }
      }

      // Nettoyer la référence à la caméra
      this.gameCamera = null;
    } catch (error) {
      console.error('Erreur lors de la libération des ressources:', error);
    }
  }

  // Méthode pour afficher la SEED du jeu
  displaySeed() {
    // Supprimer l'ancien affichage s'il existe
    const oldSeedDisplay = document.getElementById('seed-display');
    if (oldSeedDisplay) oldSeedDisplay.remove();

    // Créer l'élément d'affichage de la SEED
    const seedDisplay = document.createElement('div');
    seedDisplay.id = 'seed-display';
    seedDisplay.className = 'hud-element';
    seedDisplay.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 5px;
      font-size: 14px;
      z-index: 1000;
    `;

    seedDisplay.innerHTML = `<span style="color:#4dc1f9">SEED:</span> ${this.currentSeed}`;

    // Ajouter au DOM
    document.body.appendChild(seedDisplay);
  }

  // Méthode pour initialiser l'affichage des statistiques
  initStatsDisplay() {
    // Supprimer l'ancien affichage s'il existe
    const oldStats = document.getElementById('game-stats');
    if (oldStats) oldStats.remove();

    // Créer l'élément d'affichage des statistiques
    const statsDisplay = document.createElement('div');
    statsDisplay.id = 'game-stats';
    statsDisplay.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-family: 'Arial', sans-serif;
      font-size: 16px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      z-index: 1000;
    `;

    // Créer les éléments pour la vitesse et la distance
    const speedDisplay = document.createElement('div');
    speedDisplay.id = 'speed-display';
    speedDisplay.innerHTML =
      '<span style="color:#4dc1f9">Vitesse:</span> 0 km/h';

    const distanceDisplay = document.createElement('div');
    distanceDisplay.id = 'distance-display';
    distanceDisplay.innerHTML =
      '<span style="color:#4dc1f9">Distance:</span> 0 m';

    const maxSpeedDisplay = document.createElement('div');
    maxSpeedDisplay.id = 'max-speed-display';
    maxSpeedDisplay.innerHTML =
      '<span style="color:#4dc1f9">Vitesse max:</span> 0 km/h';

    // Ajouter au DOM
    statsDisplay.appendChild(speedDisplay);
    statsDisplay.appendChild(distanceDisplay);
    statsDisplay.appendChild(maxSpeedDisplay);
    document.body.appendChild(statsDisplay);
  }

  // Méthode pour mettre à jour l'affichage des statistiques
  updateStatsDisplay() {
    // Vérifier que le véhicule existe
    if (!this.vehicle || !this.vehicle.getChassisBody()) return;

    // Récupérer la position actuelle et calculer la distance parcourue
    const currentPosition = this.vehicle.getChassisBody().position.x;
    const deltaDistance = Math.max(
      0,
      currentPosition - this.gameStats.lastPosition
    );

    // Mettre à jour la distance totale
    this.gameStats.distanceTraveled += deltaDistance;
    this.gameStats.lastPosition = currentPosition;

    // Obtenir la vitesse actuelle
    const currentSpeed = this.vehicle.getSpeedKmh();

    // Mettre à jour la vitesse maximale
    if (currentSpeed > this.gameStats.maxSpeed) {
      this.gameStats.maxSpeed = currentSpeed;
    }

    // Mettre à jour l'affichage
    const speedDisplay = document.getElementById('speed-display');
    const distanceDisplay = document.getElementById('distance-display');
    const maxSpeedDisplay = document.getElementById('max-speed-display');

    if (speedDisplay) {
      speedDisplay.innerHTML = `<span style="color:#4dc1f9">Vitesse:</span> ${currentSpeed} km/h`;
      // Changer la couleur si la vitesse est élevée
      if (currentSpeed > 50) {
        speedDisplay.style.color = '#f94d4d';
      } else {
        speedDisplay.style.color = 'white';
      }
    }

    if (distanceDisplay) {
      // Afficher en mètres ou kilomètres selon la distance
      if (this.gameStats.distanceTraveled >= 1000) {
        const distanceKm = (this.gameStats.distanceTraveled / 1000).toFixed(2);
        distanceDisplay.innerHTML = `<span style="color:#4dc1f9">Distance:</span> ${distanceKm} km`;
      } else {
        const distanceM = Math.floor(this.gameStats.distanceTraveled);
        distanceDisplay.innerHTML = `<span style="color:#4dc1f9">Distance:</span> ${distanceM} m`;
      }
    }

    if (maxSpeedDisplay) {
      maxSpeedDisplay.innerHTML = `<span style="color:#4dc1f9">Vitesse max:</span> ${this.gameStats.maxSpeed} km/h`;
    }
  }

  startInitPhases() {
    // Phase 0: Mise en place de base (déjà fait dans le constructeur)

    // Phase 1: Terrain minimum + physique de base
    setTimeout(() => {
      this.initPhase = 1;
      this.physicsWorld.solver.iterations = 5; // Réduire la précision au départ

      // Phase 2: Activation progressive de la physique complète
      setTimeout(() => {
        this.initPhase = 2;
        this.physicsWorld.solver.iterations = 10; // Précision complète

        // Phase 3: Génération complète de l'environnement
        setTimeout(() => {
          this.initPhase = 3;
          // Générer les décorations et éléments de terrain supplémentaires
        }, 1000);
      }, 1000);
    }, 500);
  }

  // Mise en place de la scène et des rendus 3D
  setupScene() {
    // Création de la scène Three.js
    this.scene = new THREE.Scene();
    this.debugObjects = new THREE.Group();
    this.scene.add(this.debugObjects);

    // Ajout de brouillard pour améliorer l'impression de profondeur et cacher le pop-in
    const fogColor = new THREE.Color(0xc2d3dd); // Couleur bleutée pour le ciel
    this.scene.fog = new THREE.Fog(fogColor, 30, 80); // Début et fin du brouillard
    this.scene.background = fogColor;

    // Mise en place du rendu principal
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas: this.canvas,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Activer les ombres pour le rendu
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Augmenter la distance de rendu
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.setClearColor(fogColor);

    // Paramètres de post-processing pour ajouter de la profondeur
    if (!DEBUG.WIREFRAME) {
      this.setupPostProcessing();
    }

    // Éclairage de la scène
    this.setupLights();

    // Configuration des événements de redimensionnement
    window.addEventListener('resize', () => this.handleResize());

    // Initialiser la caméra dès le début du setup
    if (!this.gameCamera && this.camera) {
      this.gameCamera = new Camera(this.camera);
      console.log('Camera initialized in setupGame');
    }
  }

  // Configuration du post-processing pour améliorer le rendu visuel
  setupPostProcessing() {
    // Créer le compositeur pour le post-processing
    this.composer = new EffectComposer(this.renderer);

    // Rendu de base
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Shader de contour (cartoon)
    if (DEBUG.CARTOON_STYLE) {
      const toonPass = new ShaderPass(ToonShader1);
      toonPass.uniforms.uBaseColor.value = new THREE.Color(0xffffff);
      toonPass.uniforms.uLineColor1.value = new THREE.Color(0x000000);
      toonPass.uniforms.uLineColor2.value = new THREE.Color(0x000000);
      toonPass.material.extensions.derivatives = true;
      this.composer.addPass(toonPass);
    }

    // Simple bloom pour les lumières
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3, // Force réduite
      0.4, // Rayon réduit
      0.9 // Seuil augmenté
    );
    this.composer.addPass(bloomPass);

    // Anti-aliasing final
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.x =
      1 / (window.innerWidth * this.renderer.getPixelRatio());
    fxaaPass.material.uniforms['resolution'].value.y =
      1 / (window.innerHeight * this.renderer.getPixelRatio());
    this.composer.addPass(fxaaPass);
  }

  // Mise en place des lumières pour mettre en valeur l'arrière-plan
  setupLights() {
    // Lumière ambiante
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(this.ambientLight);

    // Lumière directionnelle (soleil)
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 0);
    // Désactiver les ombres pour améliorer les performances
    directionalLight.castShadow = false;
    this.scene.add(directionalLight);

    // Lumière secondaire pour accentuer les contours
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
    fillLight.position.set(-50, 50, -50);
    this.scene.add(fillLight);

    // Lumière d'arrière-plan pour accentuer les silhouettes
    const backLight = new THREE.DirectionalLight(0xffeedd, 0.5);
    backLight.position.set(0, 20, -100);
    this.scene.add(backLight);

    console.log('Éclairage style cartoon initialisé');
  }

  // Mise à jour de la taille du rendu lors du redimensionnement
  handleResize() {
    // Mettre à jour les dimensions de la caméra
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    // Mettre à jour la taille du rendu
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Mettre à jour le compositeur de post-processing
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);

      // Mettre à jour la résolution pour le shader FXAA
      const fxaaPass = this.composer.passes.find(
        (pass) =>
          pass.material &&
          pass.material.uniforms &&
          pass.material.uniforms.resolution
      );
      if (fxaaPass) {
        fxaaPass.material.uniforms.resolution.value.x =
          1 / (window.innerWidth * this.renderer.getPixelRatio());
        fxaaPass.material.uniforms.resolution.value.y =
          1 / (window.innerHeight * this.renderer.getPixelRatio());
      }
    }
  }

  // Vérifier si le véhicule est sorti des limites du terrain
  checkOutOfBounds() {
    const chassisBody = this.vehicle.getChassisBody();
    if (!chassisBody) return;

    const position = chassisBody.position;
    const minHeight = -20; // Hauteur minimale avant de considérer que le véhicule est tombé

    // Si la position Y est inférieure à la hauteur minimale, le joueur est tombé
    if (position.y < minHeight) {
      this.showGameOver('VOUS ÊTES TOMBÉ !');
    }
  }

  // Afficher l'écran de fin de jeu
  showGameOver(message) {
    // Mettre le jeu en pause
    this.isRunning = false;
    if (this.controls) {
      this.controls.enabled = false;
    }

    // Supprimer l'écran de game over existant s'il y en a un
    const existingGameOver = document.getElementById('game-over');
    if (existingGameOver) {
      existingGameOver.remove();
    }

    // Créer l'écran de game over
    const gameOverScreen = document.createElement('div');
    gameOverScreen.id = 'game-over';
    gameOverScreen.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      color: white;
      font-family: Arial, sans-serif;
      z-index: 3000;
      backdrop-filter: blur(5px);
    `;

    // Titre game over
    const gameOverTitle = document.createElement('h1');
    gameOverTitle.textContent = 'GAME OVER';
    gameOverTitle.style.cssText = `
      font-size: 4rem;
      color: #e74c3c;
      margin-bottom: 20px;
      text-shadow: 0 0 10px rgba(231, 76, 60, 0.7);
    `;
    gameOverScreen.appendChild(gameOverTitle);

    // Message de game over
    const gameOverMessage = document.createElement('p');
    gameOverMessage.textContent = message;
    gameOverMessage.style.cssText = `
      font-size: 2rem;
      margin-bottom: 40px;
    `;
    gameOverScreen.appendChild(gameOverMessage);

    // Stats de jeu
    const stats = document.createElement('div');
    stats.style.cssText = `
      margin-bottom: 40px;
      font-size: 1.5rem;
      text-align: center;
    `;

    // Distance parcourue
    stats.innerHTML = `
      <p>Distance parcourue: ${Math.floor(
        this.gameStats.distanceTraveled
      )} m</p>
      <p>Vitesse maximale: ${this.gameStats.maxSpeed} km/h</p>
      <p>SEED: <span style="color:#4dc1f9">${this.currentSeed}</span></p>
    `;
    gameOverScreen.appendChild(stats);

    // Bouton pour copier la seed
    const copySeedButton = document.createElement('button');
    copySeedButton.textContent = 'COPIER LA SEED';
    copySeedButton.style.cssText = `
      background-color: #4dc1f9;
      color: white;
      border: none;
      border-radius: 5px;
      padding: 15px 30px;
      font-size: 1.2rem;
      cursor: pointer;
      margin: 10px;
      transition: background-color 0.3s, transform 0.2s;
    `;
    copySeedButton.addEventListener('click', () => {
      // Copier la SEED dans le presse-papier
      navigator.clipboard
        .writeText(this.currentSeed.toString())
        .then(() => {
          // Changement temporaire du texte du bouton pour confirmer la copie
          const originalText = copySeedButton.textContent;
          copySeedButton.textContent = 'SEED COPIÉE !';
          copySeedButton.style.backgroundColor = '#00cc00';
          setTimeout(() => {
            copySeedButton.textContent = originalText;
            copySeedButton.style.backgroundColor = '#4dc1f9';
          }, 1500);
        })
        .catch((err) => {
          console.error('Erreur lors de la copie de la SEED:', err);
          copySeedButton.textContent = 'ERREUR DE COPIE';
          copySeedButton.style.backgroundColor = '#e74c3c';
        });
    });
    gameOverScreen.appendChild(copySeedButton);

    // Bouton pour retourner au menu principal
    const menuButton = document.createElement('button');
    menuButton.textContent = 'MENU PRINCIPAL';
    menuButton.style.cssText = `
      background-color: #e74c3c;
      color: white;
      border: none;
      border-radius: 5px;
      padding: 15px 30px;
      font-size: 1.2rem;
      cursor: pointer;
      margin: 10px;
      transition: background-color 0.3s, transform 0.2s;
    `;
    menuButton.addEventListener('click', () => {
      // Rediriger vers la page d'accueil ou déclencher l'événement approprié
      window.location.reload();
    });
    gameOverScreen.appendChild(menuButton);

    // Ajouter l'écran au document
    document.body.appendChild(gameOverScreen);
  }

  // Fonction pour créer un matériau cartoon
  createCartoonMaterial(color, emissive = 0x000000) {
    // Vérifier si le matériau existe déjà dans le cache
    const key = `${color.toString()}_${emissive.toString()}`;
    if (this.cartoonMaterials.has(key)) {
      return this.cartoonMaterials.get(key);
    }

    // Créer un nouveau matériau Toon
    const material = new THREE.MeshToonMaterial({
      color: color,
      emissive: emissive,
      shininess: 0,
      specular: 0x000000,
      flatShading: true,
      gradientMap: this.createToonGradientTexture(),
    });

    // Stocker le matériau dans le cache
    this.cartoonMaterials.set(key, material);
    return material;
  }

  // Créer une texture de gradient pour le style cartoon
  createToonGradientTexture() {
    // Si une texture existe déjà, la retourner
    if (this.toonGradientTexture) {
      return this.toonGradientTexture;
    }

    // Créer une texture de gradient pour l'effet toon
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 1;
    const context = canvas.getContext('2d');

    // Créer un gradient horizontal simple à 3 étapes
    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, '#666666');
    gradient.addColorStop(0.5, '#bbbbbb');
    gradient.addColorStop(1, '#ffffff');

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    // Stocker la texture pour une utilisation ultérieure
    this.toonGradientTexture = texture;
    return texture;
  }

  // Appliquer le style cartoon à un objet 3D
  applyCartoonStyle(object, defaultColor = 0x44aa88) {
    if (!object) return;

    if (object.isMesh) {
      // Pour les mesh, appliquer un matériau cartoon
      const originalMaterial = object.material;
      const color =
        originalMaterial && originalMaterial.color
          ? originalMaterial.color.getHex()
          : defaultColor;

      object.material = this.createCartoonMaterial(color);
      object.castShadow = false;
      object.receiveShadow = false;
    }

    // Appliquer récursivement à tous les enfants
    if (object.children && object.children.length > 0) {
      object.children.forEach((child) =>
        this.applyCartoonStyle(child, defaultColor)
      );
    }
  }
}
