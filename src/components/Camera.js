import * as THREE from 'three';

export default class Camera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(); // Position cible de la caméra
    this.position = new THREE.Vector3(); // Position actuelle de la caméra
    this.velocity = new THREE.Vector3(0, 0, 0); // Vélocité pour l'effet de retard
    this.lastUpdateTime = Date.now();

    // Paramètres pour le suivi dynamique basé sur la vitesse
    this.lastVehiclePos = new THREE.Vector3();
    this.vehicleSpeed = 0;
  }

  update(vehiclePosition) {
    // Calculer le delta time pour une animation plus fluide
    const now = Date.now();
    const deltaTime = Math.min((now - this.lastUpdateTime) / 1000, 0.1); // en secondes, limité à 0.1s
    this.lastUpdateTime = now;

    // Calcul approximatif de la vitesse du véhicule
    if (this.lastVehiclePos.x !== 0) {
      const distance = new THREE.Vector3()
        .subVectors(vehiclePosition, this.lastVehiclePos)
        .length();
      this.vehicleSpeed = distance / deltaTime; // units/second
    }
    this.lastVehiclePos.copy(vehiclePosition);

    // Facteur de suivi dynamique basé sur la vitesse
    // Plus le véhicule va vite, moins on lisse (réponse plus directe)
    const speedFactor = Math.min(this.vehicleSpeed / 50, 1); // Normaliser entre 0 et 1

    // Position idéale : vue de côté (style 2.5D)
    // Ajuster les distances en fonction de la vitesse
    const idealOffset = new THREE.Vector3(
      -3 - speedFactor * 2, // Plus en arrière à haute vitesse
      8 + speedFactor * 2, // Plus haut à haute vitesse
      22 // Distance horizontale constante
    );

    // Position cible de la caméra : augmenter la distance de regard en fonction de la vitesse
    const lookAheadFactor = 5 + speedFactor * 10; // Regarder plus loin à haute vitesse
    const targetPosition = new THREE.Vector3();
    targetPosition.set(
      vehiclePosition.x + lookAheadFactor, // Regarder plus loin devant à haute vitesse
      vehiclePosition.y + 3, // Un peu plus haut
      0 // Toujours centré en Z
    );

    // Réduire la smooth à haute vitesse pour éviter les à-coups
    const baseCameraStiffness = 3.0;
    const baseCameraDamping = 2.0;

    // Augmenter la réactivité quand on va vite
    const cameraStiffness = baseCameraStiffness + speedFactor * 5; // Plus réactif à haute vitesse
    const cameraDamping = Math.max(baseCameraDamping - speedFactor, 0.5); // Moins d'amortissement à haute vitesse

    // Force de rappel du ressort: position idéale - position actuelle
    const springForce = new THREE.Vector3()
      .subVectors(targetPosition, this.target)
      .multiplyScalar(cameraStiffness);

    // Force d'amortissement: -vélocité * amortissement
    const dampingForce = this.velocity.clone().multiplyScalar(-cameraDamping);

    // Accélération = somme des forces
    const acceleration = new THREE.Vector3().addVectors(
      springForce,
      dampingForce
    );

    // Mise à jour de la vélocité: a * dt
    this.velocity.add(acceleration.multiplyScalar(deltaTime));

    // Mise à jour de la position: v * dt
    this.target.add(this.velocity.clone().multiplyScalar(deltaTime));

    // Calculer la position idéale de la caméra
    const idealPosition = new THREE.Vector3();
    idealPosition.copy(this.target).add(idealOffset);

    // Facteur de lerp dynamique - plus direct à haute vitesse
    const baseLerpFactor = 0.08;
    const camLerpFactor = Math.min(baseLerpFactor + speedFactor * 0.4, 1.0); // Augmente avec la vitesse mais plafonné à 1.0
    this.position.lerp(idealPosition, camLerpFactor);

    // Mise à jour immédiate à très haute vitesse pour éviter les à-coups
    if (this.vehicleSpeed > 150) {
      // Au-delà d'une certaine vitesse, suivre le véhicule directement
      this.position.copy(idealPosition);
    }

    // Mettre à jour la position de la caméra
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }
}
