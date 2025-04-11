import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export default class Vehicle {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.vehicle = null;
    this.carBody = null;
    this.wheelBodies = [];
    this.meshes = {
      chassis: null,
      wheels: [],
    };

    // Limites de vitesse et état du véhicule
    this.maxWheelAngularVelocity = 50; // Limite de vitesse angulaire des roues
    this.inAir = false; // État pour savoir si le véhicule est en l'air

    // Matériau pour les roues
    this.wheelMaterial = new CANNON.Material('wheel');
    this.setupContactMaterial();
    this.setupVehicle();
    this.setupVisuals();
  }

  setupContactMaterial() {
    // Configuration du matériau de contact entre roues et sol
    const groundMaterial = new CANNON.Material('ground');
    const wheelGroundContactMaterial = new CANNON.ContactMaterial(
      this.wheelMaterial,
      groundMaterial,
      {
        friction: 0.8,
        restitution: 0.01,
        contactEquationStiffness: 1e6,
        contactEquationRelaxation: 10,
      }
    );
    this.physicsWorld.addContactMaterial(wheelGroundContactMaterial);
    this.groundMaterial = groundMaterial;

    // Exposer le groundMaterial pour que d'autres composants (comme Terrain) puissent l'utiliser
    return groundMaterial;
  }

  setupVehicle() {
    // Création du châssis
    this.carBody = new CANNON.Body({
      mass: 7, // Masse augmentée (était 2) pour plus de stabilité
      position: new CANNON.Vec3(5, 7, 0), // Position initiale légèrement plus haute
      shape: new CANNON.Box(new CANNON.Vec3(1.5, 0.4, 1.5)), // Châssis compact
      angularDamping: 0.3, // Augmenté (était 0.2) pour réduire les rotations excessives
      linearDamping: 0.15, // Augmenté (était 0.1) pour un meilleur contrôle
    });

    // Ajuster le centre de masse vers l'avant
    this.carBody.shapeOffsets[0] = new CANNON.Vec3(0.3, 0, 0);

    // Contraindre le mouvement pour rester en 2.5D
    this.carBody.linearFactor = new CANNON.Vec3(1, 1, 0);
    this.carBody.angularFactor = new CANNON.Vec3(0, 0, 1);

    // Création du véhicule rigide
    this.vehicle = new CANNON.RigidVehicle({
      chassisBody: this.carBody,
    });

    // Ajout des roues
    this.addWheels();

    // Ajouter le véhicule au monde physique
    this.vehicle.addToWorld(this.physicsWorld);
  }

  addWheels() {
    const mass = 0.5;
    const axisWidth = 3;
    const wheelShape = new CANNON.Sphere(0.8);
    const down = new CANNON.Vec3(0, -1, 0);

    // Configuration des positions des roues - Augmenter la distance au châssis
    const wheelPositions = [
      { pos: new CANNON.Vec3(-0.8, -0.6, axisWidth / 2), isFront: true },
      { pos: new CANNON.Vec3(-0.8, -0.6, -axisWidth / 2), isFront: true },
      { pos: new CANNON.Vec3(1.2, -0.6, axisWidth / 2), isFront: false },
      { pos: new CANNON.Vec3(1.2, -0.6, -axisWidth / 2), isFront: false },
    ];

    // Création des roues
    wheelPositions.forEach((wheel, index) => {
      const wheelBody = new CANNON.Body({
        mass,
        material: this.wheelMaterial,
      });

      wheelBody.addShape(wheelShape);
      wheelBody.angularDamping = 0.2;
      wheelBody.linearFactor = new CANNON.Vec3(1, 1, 0); // Contrainte en Z

      this.vehicle.addWheel({
        body: wheelBody,
        position: wheel.pos,
        axis: new CANNON.Vec3(0, 0, 1),
        direction: down,
      });

      this.wheelBodies.push(wheelBody);
    });
  }

  setupVisuals() {
    // Châssis - plus coloré et mieux visible - Ajuster la position visuelle pour correspondre à la physique
    const boxGeometry = new THREE.BoxGeometry(3, 0.8, 3);
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: 0x4287f5, // Bleu plus vif
      roughness: 0.4,
      metalness: 0.6,
      emissive: 0x112244, // Légère lueur pour mieux se démarquer
      emissiveIntensity: 0.2,
    });
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    boxMesh.position.set(0.3, 0, 0);
    boxMesh.castShadow = true; // Ajouter des ombres
    boxMesh.receiveShadow = true;
    this.scene.add(boxMesh);
    this.meshes.chassis = boxMesh;

    // Roues avec un aspect plus détaillé
    for (let i = 0; i < 4; i++) {
      // Groupe pour contenir la roue et ses détails
      const wheelGroup = new THREE.Group();

      // Pneu principal
      const sphereGeometry = new THREE.SphereGeometry(0.8);
      const sphereMaterial = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.9,
        metalness: 0.1,
      });
      const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphereMesh.castShadow = true;
      sphereMesh.receiveShadow = true;
      wheelGroup.add(sphereMesh);

      // Jante (un peu plus petite)
      const hubGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8);
      const hubMaterial = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.2,
        metalness: 0.8,
      });
      const hubMesh = new THREE.Mesh(hubGeometry, hubMaterial);
      hubMesh.rotation.x = Math.PI / 2; // Orienter correctement
      hubMesh.castShadow = true;
      wheelGroup.add(hubMesh);

      this.scene.add(wheelGroup);
      this.meshes.wheels.push(wheelGroup);
    }
  }

  // Méthodes de contrôle
  setWheelForce(force, wheelIndex) {
    this.vehicle.setWheelForce(force, wheelIndex);
  }

  // Appliquer des forces à toutes les roues
  applyForceToAllWheels(force) {
    // Vérifier si le véhicule est en l'air
    const verticalVelocity = Math.abs(this.carBody.velocity.y);
    this.inAir = verticalVelocity > 0.5;

    // En l'air, réduire considérablement la force appliquée aux roues
    const adjustedForce = this.inAir ? force * 0.1 : force;

    // Appliquer la force à toutes les 4 roues
    for (let i = 0; i < 4; i++) {
      // Vérifier si la vitesse angulaire de la roue est déjà au maximum
      if (this.wheelBodies[i]) {
        const wheelAngularSpeed = Math.abs(
          this.wheelBodies[i].angularVelocity.z
        );

        // Si force > 0, on accélère; si force < 0, on freine
        if (
          (adjustedForce > 0 &&
            wheelAngularSpeed < this.maxWheelAngularVelocity) ||
          adjustedForce < 0 ||
          adjustedForce === 0
        ) {
          this.vehicle.setWheelForce(adjustedForce, i);
        } else {
          // La roue a atteint sa vitesse max et on essaie d'accélérer
          this.vehicle.setWheelForce(0, i);
        }
      }
    }
  }

  // Appliquer une rotation en l'air
  applyAirControl(direction) {
    // Vérifier si le véhicule est en l'air en mesurant la vitesse verticale
    const verticalVelocity = Math.abs(this.carBody.velocity.y);
    this.inAir = verticalVelocity > 0.5;

    if (this.inAir) {
      // Force de rotation plus faible en l'air pour un contrôle subtil
      const airTorque = 4 * direction;

      // Appliquer un couple pour faire pivoter le véhicule
      this.carBody.torque.set(0, 0, airTorque);

      // Légère poussée dans la direction du mouvement pour simuler un accélérateur/frein en l'air
      // Réduction significative de la force pour empêcher l'accélération excessive
      const forwardForce = new CANNON.Vec3(direction * 0.5, 0, 0);
      this.carBody.applyLocalForce(forwardForce, new CANNON.Vec3(0, 0, 0));

      return true; // Contrôle aérien appliqué
    }

    return false; // Véhicule au sol
  }

  // Méthode pour réinitialiser le véhicule
  reset(terrainHeightFunction) {
    // Vérifier que le véhicule existe toujours
    if (!this.carBody || !this.vehicle) {
      console.warn("Tentative de réinitialiser un véhicule qui n'existe plus.");
      return;
    }

    const resetX = this.carBody.position.x;
    const resetY = terrainHeightFunction
      ? terrainHeightFunction(resetX) + 7 // Hauteur augmentée davantage pour éviter les collisions (était 3)
      : 12; // Hauteur par défaut augmentée (était 7)

    // Réinitialiser position et rotation
    this.carBody.position.set(resetX, resetY, 0);
    this.carBody.quaternion.set(0, 0, 0, 1);

    // Arrêter tous les mouvements
    this.carBody.velocity.set(0, 0, 0);
    this.carBody.angularVelocity.set(0, 0, 0);

    // Réinitialiser les roues
    if (this.vehicle.wheels && Array.isArray(this.vehicle.wheels)) {
      this.vehicle.wheels.forEach((wheel) => {
        if (wheel && wheel.body) {
          wheel.body.velocity.set(0, 0, 0);
          wheel.body.angularVelocity.set(0, 0, 0);
        }
      });
    }
  }

  // Méthode pour stabiliser le véhicule (éviter les retournements)
  stabilize() {
    // Vérifier l'angle du véhicule
    const upVector = new CANNON.Vec3(0, 1, 0);
    const carUpVector = new CANNON.Vec3();
    this.carBody.vectorToWorldFrame(upVector, carUpVector);

    // Calcul de l'inclinaison
    const tiltAngle = Math.acos(carUpVector.y);

    // Fonctionnalité de conduite à l'envers
    if (carUpVector.y < -0.9) {
      // Le véhicule est presque ou complètement retourné
      // Améliorer l'adhérence en position inversée
      if (
        this.vehicle &&
        this.vehicle.wheels &&
        Array.isArray(this.vehicle.wheels)
      ) {
        this.vehicle.wheels.forEach((wheel, index) => {
          if (wheel) {
            // Vérifier que la roue existe
            if (wheel.sideFriction !== undefined) {
              // Renforcer l'adhérence de toutes les roues en mode inversé
              wheel.sideFriction = 2.0; // Plus d'adhérence pour faciliter la conduite à l'envers
            }
          }
        });
      }
    } else if (carUpVector.y < 0.1 && carUpVector.y >= -0.9) {
      // Zone "instable" (de côté) - légère aide à la stabilité sans forcer le redressement
      if (Math.abs(this.carBody.angularVelocity.z) < 2) {
        // Appliquer une force de rotation très légère pour aider à se remettre droit ou à finir de se retourner
        // mais seulement si le véhicule n'est pas déjà en train de tourner rapidement
        const helpRotation = new CANNON.Vec3(0, 0, carUpVector.x > 0 ? 1 : -1);
        this.carBody.angularVelocity.vadd(
          helpRotation,
          this.carBody.angularVelocity
        );
      }
    } else {
      // Mode normal (à l'endroit)
      // Réinitialiser la friction standard
      if (
        this.vehicle &&
        this.vehicle.wheels &&
        Array.isArray(this.vehicle.wheels)
      ) {
        this.vehicle.wheels.forEach((wheel) => {
          if (wheel && wheel.sideFriction !== undefined) {
            wheel.sideFriction = 1;
          }
        });
      }
    }

    // Limiter la vitesse angulaire pour éviter les rotations excessives
    const maxAngularVelocity = 10; // Augmenté pour permettre des rotations plus rapides
    if (this.carBody.angularVelocity.z > maxAngularVelocity) {
      this.carBody.angularVelocity.z = maxAngularVelocity;
    } else if (this.carBody.angularVelocity.z < -maxAngularVelocity) {
      this.carBody.angularVelocity.z = -maxAngularVelocity;
    }

    // Centrer le véhicule sur l'axe Z
    if (Math.abs(this.carBody.position.z) > 0.1) {
      const centeringForce = new CANNON.Vec3(
        0,
        0,
        -this.carBody.position.z * 10
      );
      this.carBody.applyForce(centeringForce, this.carBody.position);
    }
  }

  // Méthode pour mettre à jour les visuels en fonction de la physique
  update() {
    try {
      // Vérifier que les objets nécessaires existent avant de les utiliser
      if (this.meshes && this.meshes.chassis && this.carBody) {
        this.meshes.chassis.position.copy(this.carBody.position);
        this.meshes.chassis.quaternion.copy(this.carBody.quaternion);
      }

      // Vérifier que les tableaux sont définis et ont la même longueur
      if (
        this.wheelBodies &&
        this.meshes &&
        this.meshes.wheels &&
        Array.isArray(this.wheelBodies) &&
        Array.isArray(this.meshes.wheels)
      ) {
        // N'itérer que sur la longueur la plus courte pour éviter les out of bounds
        const count = Math.min(
          this.wheelBodies.length,
          this.meshes.wheels.length
        );

        // Limiter la vitesse angulaire des roues
        for (let index = 0; index < this.wheelBodies.length; index++) {
          const wheelBody = this.wheelBodies[index];
          if (wheelBody) {
            // Si la roue tourne trop vite, limiter sa vitesse
            if (
              Math.abs(wheelBody.angularVelocity.z) >
              this.maxWheelAngularVelocity
            ) {
              const direction = wheelBody.angularVelocity.z > 0 ? 1 : -1;
              wheelBody.angularVelocity.z =
                this.maxWheelAngularVelocity * direction;
            }
          }
        }

        for (let index = 0; index < count; index++) {
          const wheelBody = this.wheelBodies[index];
          const wheelMesh = this.meshes.wheels[index];

          if (wheelMesh && wheelBody) {
            wheelMesh.position.copy(wheelBody.position);
            wheelMesh.quaternion.copy(wheelBody.quaternion);
          }
        }
      }
    } catch (error) {
      console.warn(
        'Erreur lors de la mise à jour visuelle du véhicule:',
        error
      );
      // Cette erreur n'est pas critique, donc on ne la propage pas
    }
  }

  // Getter pour accéder au corps du véhicule
  getChassisBody() {
    return this.carBody;
  }

  // Getter pour vérifier si le véhicule est en l'air
  isInAir() {
    return this.inAir;
  }

  // Getter pour obtenir la vitesse du véhicule en km/h
  getSpeedKmh() {
    if (!this.carBody) return 0;

    // Calculer la vitesse à partir de la vélocité horizontale (x)
    const speedMs = Math.abs(this.carBody.velocity.x);

    // Convertir m/s en km/h (1 m/s = 3.6 km/h)
    return Math.round(speedMs * 3.6);
  }
}
