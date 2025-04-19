import { useState, useEffect, useRef } from 'react';
import Game from './components/Game';
import './App.css';

function App() {
  const [showMenu, setShowMenu] = useState(true);
  const [showPauseMenu, setShowPauseMenu] = useState(false);
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
          // Passer la seed fournie par l'utilisateur
          const game = new Game({
            canvasId: 'myThreeJsCanvas',
            seed: seed, // Utiliser la seed spécifiée dans l'interface
          });
          setGameInstance(game);
          window.gameInstance = game; // For access from other components
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
    setShowPauseMenu(false);
    // L'initialisation du jeu se fait dans le useEffect ci-dessus
  };

  const returnToMenu = () => {
    if (gameInstance) {
      gameInstance.dispose();
      setGameInstance(null);
      window.gameInstance = null;
    }
    setShowMenu(true);
    setShowPauseMenu(false);
  };

  const togglePauseMenu = () => {
    if (gameInstance) {
      const isPaused = gameInstance.togglePause();
      setShowPauseMenu(!isPaused); // Si le jeu est en pause, montrer le menu de pause
    }
  };

  const resumeGame = () => {
    if (gameInstance && gameInstance.isPaused()) {
      gameInstance.togglePause(); // Reprendre le jeu
    }
    setShowPauseMenu(false);
  };

  const reloadPage = () => {
    window.location.reload();
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
            <p>Q/A ou ← pour tourner à gauche</p>
            <p>D ou → pour tourner à droite</p>
            <p>Contrôlez votre véhicule en l'air avec ↑ et ↓</p>
          </div>
        </div>
      ) : (
        <>
          <canvas id="myThreeJsCanvas" ref={canvasRef} />
        </>
      )}
    </>
  );
}

export default App;
