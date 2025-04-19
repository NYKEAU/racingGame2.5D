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
    // Création du châssis - Modifications pour le rendre extrêmement léger et réactif
    this.carBody = new CANNON.Body({
      mass: 1.5, // Masse drastiquement réduite (était 3) pour un comportement ultra-léger
      position: new CANNON.Vec3(5, 7, 0), // Position initiale
      shape: new CANNON.Box(new CANNON.Vec3(1.5, 0.4, 1.5)), // Châssis compact
      angularDamping: 0.05, // Presque pas d'amortissement angulaire pour des rotations folles
      linearDamping: 0.02, // Presque pas d'amortissement linéaire pour glisser partout
      allowSleep: true, // Permettre la mise en veille des corps pour économiser les ressources
    });

    // Ajuster le centre de masse vers l'avant et vers le haut pour favoriser les wheelies et front flips
    this.carBody.shapeOffsets[0] = new CANNON.Vec3(0.4, 0.2, 0);

    // Contraindre le mouvement pour rester en 2.5D
    this.carBody.linearFactor = new CANNON.Vec3(1, 1, 0);
    this.carBody.angularFactor = new CANNON.Vec3(0, 0, 1);

    // Paramètres de sommeil pour optimiser les performances
    this.carBody.sleepSpeedLimit = 0.5; // Mettre en veille si la vitesse est inférieure
    this.carBody.sleepTimeLimit = 1.0; // Temps en secondes avant la mise en veille

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
    const mass = 0.1; // Masse des roues très réduite pour un effet ultra-léger
    const axisWidth = 3;
    const wheelShape = new CANNON.Sphere(0.8);
    const down = new CANNON.Vec3(0, -1, 0);

    // Configuration des positions des roues
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
      wheelBody.angularDamping = 0.05; // Réduit drastiquement pour favoriser la rotation des roues
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
    // Création d'un groupe pour le chassis de la voiture télécommandée
    const chassisGroup = new THREE.Group();
    this.scene.add(chassisGroup);

    // Base du chassis (plus large pour une meilleure visibilité)
    const baseGeometry = new THREE.BoxGeometry(3, 0.4, 3);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x33ccff, // Cyan plus prononcé pour la base
      roughness: 0.3,
      metalness: 0.5,
    });
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    baseMesh.position.set(0.3, -0.1, 0);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    chassisGroup.add(baseMesh);

    // Cabine / cockpit (plus grand et plus visible) - à l'avant à droite
    const cockpitGeometry = new THREE.BoxGeometry(1.5, 0.6, 2.2);
    const cockpitMaterial = new THREE.MeshStandardMaterial({
      color: 0xff6600, // Orange plus foncé pour correspondre à l'image
      roughness: 0.4,
      metalness: 0.4,
    });
    const cockpitMesh = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
    cockpitMesh.position.set(0.8, 0.45, 0); // À l'avant (droite)
    cockpitMesh.castShadow = true;
    cockpitMesh.receiveShadow = true;
    chassisGroup.add(cockpitMesh);

    // Pare-brise simplifié (plus grand et visible) - à l'avant
    const windshieldGeometry = new THREE.BoxGeometry(0.8, 0.5, 1.8);
    const windshieldMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // Blanc au lieu de bleu-blanc pour être plus visible
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.8,
    });
    const windshieldMesh = new THREE.Mesh(
      windshieldGeometry,
      windshieldMaterial
    );
    windshieldMesh.position.set(1.5, 0.3, 0); // À l'extrémité avant (droite)
    windshieldMesh.rotation.z = -Math.PI * 0.15; // Inclinaison
    windshieldMesh.castShadow = false;
    windshieldMesh.receiveShadow = false;
    chassisGroup.add(windshieldMesh);

    // Aileron arrière (élément caractéristique simplifié) - à l'arrière
    const spoilerGeometry = new THREE.BoxGeometry(0.6, 0.2, 3.3);
    const spoilerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdd00, // Jaune vif comme sur l'image
      roughness: 0.5,
      metalness: 0.3,
    });
    const spoilerMesh = new THREE.Mesh(spoilerGeometry, spoilerMaterial);
    spoilerMesh.position.set(-1.1, 0.6, 0); // À l'arrière (gauche)
    spoilerMesh.castShadow = true;
    spoilerMesh.receiveShadow = true;
    chassisGroup.add(spoilerMesh);

    // Assigner le groupe comme chassis pour le véhicule
    this.meshes.chassis = chassisGroup;

    // Roues avec un aspect plus détaillé - INCHANGÉ comme demandé
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
    this.inAir = verticalVelocity > 0.1; // Seuil très bas pour détecter l'état "en l'air" encore plus facilement

    if (this.inAir) {
      console.log(`Applying air control: direction ${direction}`);
      // Force de rotation extrême en l'air pour des cascades spectaculaires
      const airTorque = 12 * direction; // Augmenté à 12 pour des rotations extrêmement rapides

      // Appliquer un couple pour faire pivoter le véhicule
      this.carBody.torque.set(0, 0, airTorque);

      // Appliquer une impulsion vers le haut plus forte pendant les rotations
      if (Math.abs(this.carBody.angularVelocity.z) > 2) {
        this.carBody.applyImpulse(
          new CANNON.Vec3(0, 1.0, 0),
          new CANNON.Vec3(0, 0, 0)
        );
      }

      return true;
    }

    return false;
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
      // Zone "instable" (de côté) - aucune aide de stabilité pour permettre plus de cascade
      // Ne rien faire délibérément pour laisser le véhicule se retourner naturellement
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

    // Limiter la vitesse angulaire pour éviter les rotations trop rapides
    // mais permettre quand même des rotations spectaculaires
    const maxAngularVelocity = 15; // Augmenté pour permettre des rotations plus rapides
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

  // Nouvelles méthodes accesseurs pour simplifier l'accès aux propriétés
  getChassisBody() {
    return this.carBody;
  }

  isInAir() {
    return this.inAir;
  }

  getSpeedKmh() {
    if (!this.carBody) return 0;

    // Convertir vitesse de m/s en km/h (facteur 3.6)
    const speed = this.carBody.velocity.length() * 3.6;

    // Arrondir à l'entier le plus proche
    return Math.round(speed);
  }

  // Getter pour accéder à la mesh du véhicule
  get mesh() {
    return this.meshes.chassis;
  }
}
