import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export default class Controls {
  constructor(vehicle, getTerrainHeightAt) {
    this.vehicle = vehicle;
    this.getTerrainHeightAt = getTerrainHeightAt;
    this.maxForce = 25;
    this.keys = {};
    this.wheelForce = 0;
    this.brakeForce = 0;
    this.airControlActive = false;
    this.setupControls();

    // Ajout d'un état pour suivre les touches actuellement pressées
    this.keysPressed = {
      forward: false,
      backward: false,
    };

    // Définition explicite de gameInstance pour éviter les erreurs
    if (window.gameInstance === undefined) {
      console.warn(
        "gameInstance n'est pas définie dans window, l'initialisation est susceptible d'échouer"
      );
    }
  }

  setupControls() {
    // Gestionnaire pour les touches enfoncées
    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onKeyUp = this.handleKeyUp.bind(this);

    // Ajouter les écouteurs d'événements
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  handleKeyDown(event) {
    this.keys[event.key.toLowerCase()] = true;

    // Touche R pour reset
    if (event.key.toLowerCase() === 'r') {
      this.resetVehicle();
    }
  }

  handleKeyUp(event) {
    this.keys[event.key.toLowerCase()] = false;
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
    const maxForce = 40; // Force maximale
    const forceIncrement = 2.5; // Vitesse d'accélération
    const forceDamping = 1; // Vitesse de décélération

    // CORRECTION: Touches Z et S étaient inversées
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
          return this.getTerrainHeightAt
            ? this.getTerrainHeightAt(x) || defaultHeight
            : defaultHeight;
        });
      }
    } catch (error) {
      console.error('Erreur lors de la réinitialisation:', error);
    }
  }

  // Libérer les ressources et supprimer les écouteurs
  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
