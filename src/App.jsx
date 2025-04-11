import { useState, useEffect, useRef } from 'react';
import Game from './components/Game';
import './App.css';

function App() {
  const [showMenu, setShowMenu] = useState(true);
  const [seed, setSeed] = useState(Math.floor(Math.random() * 1000000));
  const [gameInstance, setGameInstance] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Nettoyer les ressources lors du démontage du composant
    return () => {
      if (gameInstance) {
        gameInstance.dispose();
      }
    };
  }, [gameInstance]);

  // Effet pour initialiser le jeu une fois que le canvas est dans le DOM
  useEffect(() => {
    if (!showMenu && canvasRef.current && !gameInstance) {
      // Petite temporisation pour s'assurer que le canvas est complètement rendu
      const timer = setTimeout(() => {
        try {
          // Initialiser le jeu avec la référence du canvas
          const game = new Game(canvasRef.current.id, seed);
          setGameInstance(game);
          window.gameInstance = game; // Pour permettre l'accès depuis d'autres composants
        } catch (error) {
          console.error("Erreur lors de l'initialisation du jeu:", error);
          // Retour au menu en cas d'erreur
          setShowMenu(true);
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [showMenu, seed, gameInstance]);

  const startGame = () => {
    setShowMenu(false);
    // L'initialisation du jeu se fait dans le useEffect ci-dessus
  };

  const returnToMenu = () => {
    if (gameInstance) {
      gameInstance.dispose();
      setGameInstance(null);
      window.gameInstance = null;
    }
    setShowMenu(true);
  };

  return (
    <>
      {showMenu ? (
        <div id="main-menu" className="menu-container">
          <h1 className="game-title">Vroom Vroom 2.5D</h1>
          <button className="menu-button" onClick={startGame}>
            Nouvelle partie
          </button>
          <div className="seed-container">
            <label htmlFor="seed-input">SEED: </label>
            <input
              id="seed-input"
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
            />
            <button
              className="random-seed-button"
              title="Générer une SEED aléatoire"
              onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
            >
              🎲
            </button>
          </div>
          <div className="instructions">
            <p>Z ou ↑ pour avancer</p>
            <p>S ou ↓ pour reculer</p>
            <p>R pour revenir à la position de départ</p>
            <p>Contrôlez votre véhicule en l'air avec ↑ et ↓</p>
          </div>
        </div>
      ) : (
        <>
          <canvas id="myThreeJsCanvas" ref={canvasRef} />
          <button
            id="back-to-menu"
            className="back-button"
            onClick={returnToMenu}
          >
            Menu
          </button>
          <div className="controls-info">
            <p>Flèches Haut/Bas ou Z/S pour avancer/reculer</p>
            <p>
              Touche R pour réinitialiser le véhicule en cas de retournement
            </p>
          </div>
        </>
      )}
    </>
  );
}

export default App;
