import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export default class Controls {
  constructor(vehicle, getTerrainHeightCallback) {
    this.vehicle = vehicle;
    this.getTerrainHeight = getTerrainHeightCallback;
    this.enabled = true; // Enable controls by default

    // Vitesse du véhicule
    this.maxForce = 1000;
    this.brakeForce = 20;

    // État des touches
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    // Touches personnalisables
    this.keyMapping = {
      forward: ['ArrowUp', 'w', 'z'],
      backward: ['ArrowDown', 's'],
      left: ['ArrowLeft', 'a', 'q'],
      right: ['ArrowRight', 'd'],
    };

    console.log('Controls constructor: enabled =', this.enabled);

    // Initialiser les écouteurs d'événements
    this.initEventListeners();
  }

  initEventListeners() {
    // Gestionnaire d'événements de touche pressée
    this.keyDownHandler = (event) => {
      if (!this.enabled) {
        console.log('Controls disabled: ignoring keydown event');
        return;
      }

      const key = event.key.toLowerCase();

      // Gestion des touches
      if (this.keyMapping.forward.map((k) => k.toLowerCase()).includes(key)) {
        this.keys.forward = true;
      } else if (
        this.keyMapping.backward.map((k) => k.toLowerCase()).includes(key)
      ) {
        this.keys.backward = true;
      } else if (
        this.keyMapping.left.map((k) => k.toLowerCase()).includes(key)
      ) {
        this.keys.left = true;
      } else if (
        this.keyMapping.right.map((k) => k.toLowerCase()).includes(key)
      ) {
        this.keys.right = true;
      }
    };

    // Gestionnaire d'événements de touche relâchée
    this.keyUpHandler = (event) => {
      if (!this.enabled) return;

      const key = event.key.toLowerCase();

      // Gestion des touches
      if (this.keyMapping.forward.map((k) => k.toLowerCase()).includes(key)) {
        this.keys.forward = false;
      } else if (
        this.keyMapping.backward.map((k) => k.toLowerCase()).includes(key)
      ) {
        this.keys.backward = false;
      } else if (
        this.keyMapping.left.map((k) => k.toLowerCase()).includes(key)
      ) {
        this.keys.left = false;
      } else if (
        this.keyMapping.right.map((k) => k.toLowerCase()).includes(key)
      ) {
        this.keys.right = false;
      }
    };

    // Ajouter les écouteurs d'événements
    document.addEventListener('keydown', this.keyDownHandler);
    document.addEventListener('keyup', this.keyUpHandler);

    console.log(
      'Controls: Event listeners initialized with mappings:',
      this.keyMapping
    );
  }

  // Nouvelle méthode pour déterminer si le véhicule est à l'envers
  isVehicleUpsideDown() {
    try {
      const chassisBody = this.vehicle.getChassisBody();
      if (chassisBody) {
        // Récupérer le vecteur "up" du véhicule
        const upVector = new CANNON.Vec3(0, 1, 0);
        const carUpVector = new CANNON.Vec3();
        chassisBody.vectorToWorldFrame(upVector, carUpVector);

        // Si le Y est négatif, le véhicule est à l'envers
        return carUpVector.y < -0.5;
      }
    } catch (error) {
      console.warn(
        "Erreur lors de la vérification de l'orientation du véhicule:",
        error
      );
    }

    // Par défaut, considérer que le véhicule est à l'endroit
    return false;
  }

  // Méthode pour appliquer les forces en tenant compte de l'orientation
  updateWheelForces() {
    // Si les contrôles sont désactivés, ne rien faire
    if (!this.enabled) return;

    const maxForce = 40; // Force maximale
    const forceIncrement = 2.5; // Vitesse d'accélération
    const forceDamping = 1; // Vitesse de décélération

    // Touche Z ou flèche haut pour accélérer (avec valeur négative car notre système de forces est inversé)
    if (this.keys['z'] || this.keys['arrowup']) {
      this.wheelForce = Math.max(this.wheelForce - forceIncrement, -maxForce);
      this.brakeForce = 0;
    }
    // Touche S ou flèche bas pour freiner/reculer (avec valeur positive car notre système de forces est inversé)
    else if (this.keys['s'] || this.keys['arrowdown']) {
      this.wheelForce = Math.min(this.wheelForce + forceIncrement, maxForce);
      this.brakeForce = 0;
    }
    // Si aucune touche n'est enfoncée, réduire progressivement la force
    else {
      if (this.wheelForce > 0) {
        this.wheelForce = Math.max(0, this.wheelForce - forceDamping);
      } else if (this.wheelForce < 0) {
        this.wheelForce = Math.min(0, this.wheelForce + forceDamping);
      }
    }

    // Appliquer les forces aux roues
    this.vehicle.applyForceToAllWheels(this.wheelForce);

    // Contrôle en l'air - seulement si les touches de contrôle aérien sont enfoncées
    if (this.keys['arrowup'] || this.keys['arrowdown']) {
      // Correction: inverser aussi la direction du contrôle aérien
      const airControlDirection = this.keys['arrowup'] ? -1 : 1;
      this.airControlActive = this.vehicle.applyAirControl(airControlDirection);
    } else {
      this.airControlActive = false;
    }
  }

  update() {
    if (!this.enabled) {
      return;
    }

    if (!this.vehicle) {
      console.warn('Contrôles activés mais véhicule non disponible');
      return;
    }

    // Calcul de la force à appliquer
    let force = 0;
    let steeringAngle = 0;

    // Accélération avant (droite)/arrière (gauche) - INVERSÉ pour correspondre à l'orientation désirée
    if (this.keys.forward) {
      // Avancer vers la droite (valeur positive)
      force = this.maxForce;
    } else if (this.keys.backward) {
      // Reculer vers la gauche (valeur négative)
      force = -this.maxForce / 2;
    }

    // Freinage
    if (this.keys.forward && this.keys.backward) {
      force = -this.brakeForce;
    }

    // Direction gauche/droite
    if (this.keys.left) {
      steeringAngle = 0.5; // Rotation à gauche
    } else if (this.keys.right) {
      steeringAngle = -0.5; // Rotation à droite
    }

    // S'assurer que le véhicule a les méthodes nécessaires
    if (typeof this.vehicle.applyForceToAllWheels === 'function') {
      // Multiplier la force par -1 pour inverser la direction
      this.vehicle.applyForceToAllWheels(-force); // Le signe est inversé pour correspondre à la direction désirée
    } else {
      console.error('La méthode applyForceToAllWheels est manquante');
    }

    // Appliquer la rotation
    this.applySteeringAngle(steeringAngle);

    // Contrôle aérien si le véhicule est en l'air
    this.applyAirControl();
  }

  applySteeringAngle(angle) {
    // S'assurer que le véhicule existe
    if (!this.vehicle) return;

    try {
      // Rotation du châssis du véhicule
      const chassisBody = this.vehicle.getChassisBody();
      if (chassisBody) {
        // Appliquer une rotation au châssis
        chassisBody.angularVelocity.z = angle * 3;
      }
    } catch (error) {
      console.error("Erreur lors de l'application de la direction:", error);
    }
  }

  applyAirControl() {
    // S'assurer que le véhicule existe
    if (!this.vehicle) return;

    try {
      // Vérifier si le véhicule est en l'air
      if (this.vehicle.inAir) {
        // Direction pour le contrôle aérien
        let direction = 0;

        if (this.keys.left) {
          direction += 1;
        }
        if (this.keys.right) {
          direction -= 1;
        }

        // Appliquer le contrôle aérien si nécessaire
        if (direction !== 0) {
          this.vehicle.applyAirControl(direction);
        }
      }
    } catch (error) {
      console.error("Erreur lors de l'application du contrôle aérien:", error);
    }
  }

  resetVehicle() {
    try {
      // Récupération directe de gameInstance depuis window
      // avec une vérification plus robuste
      if (window && typeof window.gameInstance !== 'undefined') {
        if (typeof window.gameInstance.reset === 'function') {
          window.gameInstance.reset();
          return;
        }
      }

      // Solution de secours si gameInstance n'est pas accessible
      console.warn(
        'gameInstance non trouvée, tentative de réinitialisation directe du véhicule'
      );
      if (this.vehicle && typeof this.vehicle.reset === 'function') {
        // Position Y par défaut
        const defaultHeight = 6;

        // Essayer de réinitialiser le véhicule directement
        this.vehicle.reset((x) => {
          return this.getTerrainHeight
            ? this.getTerrainHeight(x) || defaultHeight
            : defaultHeight;
        });
      }
    } catch (error) {
      console.error('Erreur lors de la réinitialisation:', error);
    }
  }

  // Libérer les ressources et supprimer les écouteurs
  dispose() {
    document.removeEventListener('keydown', this.keyDownHandler);
    document.removeEventListener('keyup', this.keyUpHandler);
  }
}
