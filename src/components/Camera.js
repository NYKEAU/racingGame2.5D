import * as THREE from 'three';

export default class Camera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(); // Position cible de la caméra
    this.position = new THREE.Vector3(); // Position actuelle de la caméra
    this.velocity = new THREE.Vector3(0, 0, 0); // Vélocité pour l'effet de retard
    this.lastUpdateTime = Date.now();
  }

  update(vehiclePosition) {
    // Calculer le delta time pour une animation plus fluide
    const now = Date.now();
    const deltaTime = Math.min((now - this.lastUpdateTime) / 1000, 0.1); // en secondes, limité à 0.1s
    this.lastUpdateTime = now;

    // Position idéale : vue de côté (style 2.5D)
    const idealOffset = new THREE.Vector3(
      -4, // Un peu plus en arrière (était -2)
      8, // Un peu plus haut (était 7)
      22 // Distance horizontale (recul)
    );

    // Position cible de la caméra : centrée sur le véhicule avec un peu plus d'espace devant
    const targetPosition = new THREE.Vector3();
    targetPosition.set(
      vehiclePosition.x + 5, // Regarder plus loin devant le véhicule (était juste vehiclePosition.x)
      vehiclePosition.y + 3, // Un peu plus haut (était +2)
      0 // Toujours centré en Z
    );

    // Améliorer les paramètres du ressort pour une caméra plus fluide
    const cameraStiffness = 3.0; // Moins rigide (était 4.0)
    const cameraDamping = 2.0; // Moins d'amortissement (était 2.5)

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

    // Appliquer un retard dynamique à la caméra
    const camLerpFactor = 0.08; // Légèrement plus doux (était 0.1)
    this.position.lerp(idealPosition, camLerpFactor);

    // Mettre à jour la position de la caméra
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }
}
