import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';

import Vehicle from './Vehicle';
import Terrain from './Terrain';
import Camera from './Camera';
import Controls from './Controls';

export default class Game {
  constructor(canvasId, seed = Math.floor(Math.random() * 1000000)) {
    // Configuration de base
    this.canvas = document.getElementById(canvasId);
    this.debugMode = true;

    // Stats du jeu
    this.gameStats = {
      distanceTraveled: 0, // Distance parcourue en mètres
      maxSpeed: 0, // Vitesse maximale atteinte en km/h
      startPosition: 0, // Position de départ
      lastPosition: 0, // Dernière position connue
    };

    // Stocker la SEED pour la génération du terrain
    this.currentSeed = seed;

    // Initialisation des composants
    this.initScene();
    this.initPhysics();
    this.initLighting();

    // Création des objets du jeu
    this.terrain = new Terrain(this.scene, this.physicsWorld, this.currentSeed);
    this.vehicle = new Vehicle(this.scene, this.physicsWorld);
    this.gameCamera = new Camera(this.camera);
    this.controls = new Controls(
      this.vehicle,
      this.terrain.getTerrainHeightAt.bind(this.terrain)
    );

    // Initialisation du compteur de kilomètres
    this.initStatsDisplay();

    // Afficher la SEED actuelle
    this.displaySeed();

    // Initialisation du débogueur
    this.debugger = new CannonDebugger(this.scene, this.physicsWorld);

    // Enregistrer la position initiale
    if (this.vehicle && this.vehicle.getChassisBody()) {
      this.gameStats.startPosition = this.vehicle.getChassisBody().position.x;
      this.gameStats.lastPosition = this.gameStats.startPosition;
    }

    // Démarrer la boucle d'animation
    this.lastUpdateTime = Date.now();
    this.animate();

    console.log(`Jeu initialisé avec SEED: ${this.currentSeed}`);
  }

  initScene() {
    // Configuration de la scène Three.js
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Ciel bleu

    // Configuration de la caméra - Augmenter la distance de rendu
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 5000); // Far plane à 5000 au lieu de 1000

    // Ajouter un fog pour une transition douce à l'horizon
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 1000);

    // Trouver le canvas - soit par ID, soit en utilisant l'élément directement
    if (typeof this.canvas === 'string') {
      this.canvas = document.getElementById(this.canvas);
      if (!this.canvas) {
        throw new Error(
          `Canvas avec ID ${this.canvas} non trouvé. Assurez-vous que l'élément existe dans le DOM.`
        );
      }
    }

    // Configuration du renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;

    // Gestion du redimensionnement de la fenêtre
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Axes helper pour le développement (augmenter la taille)
    const axesHelper = new THREE.AxesHelper(50);
    this.scene.add(axesHelper);
  }

  initPhysics() {
    // Configuration du monde physique avec la gravité
    this.physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });

    // Configuration du solveur pour de meilleures performances
    this.physicsWorld.solver.iterations = 10;
    this.physicsWorld.solver.tolerance = 0.01;
  }

  initLighting() {
    // Éclairage ambiant
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    // Lumière directionnelle pour les ombres
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);
  }

  onWindowResize() {
    // Mettre à jour la taille du renderer et le ratio d'aspect de la caméra
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    // Si le jeu a été détruit ou est en pause, ne pas continuer l'animation
    if (this.isDisposed) {
      return;
    }

    // Demander la prochaine frame d'animation
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));

    try {
      // Mise à jour de la physique
      this.physicsWorld.fixedStep();

      // Vérifier que le véhicule existe toujours
      if (!this.vehicle || !this.vehicle.getChassisBody()) {
        console.warn("Le véhicule n'existe plus, réinitialisation du jeu");
        this.resetWithSameSeed();
        return;
      }

      // Mise à jour des statistiques de jeu
      this.updateStatsDisplay();

      // Mise à jour du terrain en fonction de la position du véhicule
      const vehiclePosition = this.vehicle.getChassisBody().position;

      // Vérifier si le véhicule est tombé hors des limites ou dans un trou
      const terrainHeight = this.terrain.getTerrainHeightAt(vehiclePosition.x);
      const inHole = terrainHeight === null;

      // Les vérifications pour reset le véhicule
      if (
        vehiclePosition.y < -50 || // Tombé trop bas
        (inHole && vehiclePosition.y < -22) // Tombé dans un trou
      ) {
        // Tombé dans un vrai trou
        console.log(
          'Le véhicule est tombé trop bas ou dans un trou, réinitialisation'
        );
        this.resetVehicle();
        return;
      }

      // Vérifier si le terrain existe à la position du véhicule
      const currentSegmentIndex = Math.floor(
        vehiclePosition.x / this.terrain.segmentWidth
      );
      const terrainAtPosition = this.terrain.terrainMeshes.some((segment) => {
        const segmentIndex = Math.floor(
          segment.startX / this.terrain.segmentWidth
        );
        return segmentIndex === currentSegmentIndex;
      });

      // Si pas de terrain à cette position et difficulté proche de 18%
      const difficulty = Math.min(0.1 + currentSegmentIndex * 0.01, 0.9);
      const difficultyPercent = Math.round(difficulty * 100);

      if (
        !terrainAtPosition ||
        (difficultyPercent >= 15 &&
          difficultyPercent <= 20 &&
          this.terrain.terrainMeshes.length < 15)
      ) {
        console.warn(
          `Terrain manquant à ${difficultyPercent}%, régénération forcée`
        );
        // Régénération forcée du terrain dans cette zone problématique
        const baseSegmentX =
          (currentSegmentIndex - 5) * this.terrain.segmentWidth;

        // Supprimer les segments potentiellement problématiques dans cette zone
        this.terrain.terrainMeshes = this.terrain.terrainMeshes.filter(
          (segment) => {
            const segmentIndex = Math.floor(
              segment.startX / this.terrain.segmentWidth
            );
            const isInProblemZone =
              segmentIndex >= currentSegmentIndex - 2 &&
              segmentIndex <= currentSegmentIndex + 10;

            if (isInProblemZone) {
              this.terrain.removeSegment(segment);
              return false;
            }
            return true;
          }
        );

        // Recréer les segments dans cette zone
        for (let i = -2; i <= 10; i++) {
          const segmentX =
            (currentSegmentIndex + i) * this.terrain.segmentWidth;
          const exists = this.terrain.terrainMeshes.some(
            (segment) => Math.abs(segment.startX - segmentX) < 0.1
          );

          if (!exists) {
            this.terrain.createTerrainSegment(segmentX);
          }
        }
      }

      this.terrain.update(vehiclePosition);

      // Stabilisation du véhicule avec gestion des erreurs
      try {
        if (this.vehicle && typeof this.vehicle.stabilize === 'function') {
          this.vehicle.stabilize();
        }
      } catch (vehicleError) {
        console.warn(
          'Erreur lors de la stabilisation du véhicule:',
          vehicleError
        );
        // Ne pas compter cette erreur dans le compteur d'erreurs critiques
      }

      // Mise à jour des contrôles pour s'adapter à l'orientation du véhicule
      try {
        if (
          this.controls &&
          typeof this.controls.updateWheelForces === 'function'
        ) {
          this.controls.updateWheelForces();
        }
      } catch (controlError) {
        console.warn(
          'Erreur lors de la mise à jour des contrôles:',
          controlError
        );
      }

      // Mise à jour de la caméra
      this.gameCamera.update(vehiclePosition);

      // Mise à jour des visuels du véhicule
      this.vehicle.update();

      // Mise à jour du débogueur si activé
      if (this.debugMode && this.debugger) {
        this.debugger.update();
      }

      // Rendu de la scène
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    } catch (error) {
      console.error("Erreur dans la boucle d'animation:", error);
      // Essayer de récupérer après une erreur en réinitialisant le jeu
      this.errorCount = (this.errorCount || 0) + 1;

      if (this.errorCount > 5) {
        console.error("Trop d'erreurs consécutives, réinitialisation du jeu");
        this.resetWithSameSeed();
      }
    }
  }

  // Méthodes publiques pour interagir avec le jeu
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  reset() {
    // Replacer le véhicule à la position 0 sans réinitialiser tout le jeu
    try {
      console.log(
        'Réinitialisation à la position 0m avec la même SEED:',
        this.currentSeed
      );

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

      // Réinitialiser les statistiques tout en gardant la même SEED
      this.gameStats = {
        distanceTraveled: 0,
        maxSpeed: 0,
        startPosition: resetX,
        lastPosition: resetX,
      };

      // Mettre à jour l'affichage
      this.updateStatsDisplay();

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
    seedDisplay.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 5px;
      font-family: 'Arial', sans-serif;
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

    // Supprimer tous les anciens menus de contrôles qui pourraient persister
    document
      .querySelectorAll('#controls-display, .game-controls')
      .forEach((el) => {
        if (el) el.remove();
      });

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
}
