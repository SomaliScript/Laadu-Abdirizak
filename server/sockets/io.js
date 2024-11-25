// ludo/server/sockets/io.js

// io.js

module.exports = (io) => {
  // Import constants from constants_server.js
  const {
    COORDINATES_MAP,
    BASE_POSITIONS,
    HOME_ENTRANCE,
    HOME_POSITIONS,
    PLAYERS,
    SAFE_POSITIONS,
    START_POSITIONS,
    TURNING_POINTS,
    STATE,
  } = require('./constants_server');

  // Object to store active games indexed by room IDs
  const games = {};

  io.on('connection', (socket) => {
    console.log(`New socket connection: ${socket.id}`);

    // Handle 'joinGame' event from clients
    socket.on('joinGame', () => {
      // Find or create a room for the player
      let room = findAvailableRoom();

      if (!room) {
        // Create a new room if no available rooms
        room = `room-${socket.id}`;
        games[room] = {
          players: [],
          gameState: null,
        };
        console.log(`Created new room: ${room}`);
      }

      // Join the room
      socket.join(room);
      const playerId = assignPlayerId(room, socket.id);
      console.log(`Player ${playerId} (${socket.id}) joined ${room}`);

      if (playerId) {
        // Send the assigned player ID and room info to the client
        socket.emit('playerAssigned', { playerId, room });

        // Start the game when two players have joined
        if (games[room].players.length === 2) {
          // Initialize game state
          games[room].gameState = initializeGameState(games[room].players);
          // Notify players that the game is starting
          io.in(room).emit('startGame', {
            gameState: games[room].gameState,
            players: games[room].players.map((p) => p.playerId),
          });
          console.log(`Game started in ${room}`);
        }
      }

      // Handle player disconnection
      socket.on('disconnect', () => {
        console.log(`Player ${socket.id} disconnected`);
        handleDisconnect(room, socket.id);
      });

      // Handle game actions
      socket.on('rollDice', () => {
        handleDiceRoll(room, socket.id);
      });

      socket.on('makeMove', (data) => {
        handleMakeMove(room, socket.id, data);
      });

      socket.on('noMoves', () => {
        handleNoMoves(room, socket.id);
      });
    });

    /**
     * Finds an available room with less than 2 players.
     * @returns {string|null} - The room ID or null if no room is available.
     */
    function findAvailableRoom() {
      for (const room in games) {
        if (games[room].players.length < 2) {
          return room;
        }
      }
      return null;
    }

    /**
     * Assigns a player ID to a socket in a room.
     * @param {string} room - The room ID.
     * @param {string} socketId - The socket ID.
     * @returns {string|null} - The assigned player ID (e.g., 'P1', 'P3'), or null if room is full.
     */
    function assignPlayerId(room, socketId) {
      const existingPlayerIds = games[room].players.map((player) => player.playerId);

      // Define the possible player IDs
      const possiblePlayerIds = ['P1', 'P3'];

      // Find the first available player ID
      const playerId = possiblePlayerIds.find((id) => !existingPlayerIds.includes(id));

      if (!playerId) {
        // Room is full
        socket.emit('errorMessage', 'Room is full.');
        return null;
      }

      games[room].players.push({ socketId, playerId });
      return playerId;
    }

    /**
     * Initializes the game state for a room.
     * @param {Array} players - The array of player objects in the room.
     * @returns {Object} - The initial game state.
     */
    function initializeGameState(players) {
      const currentPositions = {};

      players.forEach((player) => {
        const playerId = player.playerId;

        if (BASE_POSITIONS[playerId]) {
          currentPositions[playerId] = [...BASE_POSITIONS[playerId]]; // Copy base positions
        } else {
          console.error(`Unknown player ID: ${playerId}`);
        }
      });

      const gameState = {
        currentPositions,
        turn: 0, // Index of the current player in the players array
        diceValue: null,
        killOccurred: false,
        lockedPositions: [], // Initialize locked positions
      };

      // Update locked positions initially
      updateLockedPositions(gameState);

      return gameState;
    }

    /**
     * Handles a player's disconnection from a room.
     * @param {string} room - The room ID.
     * @param {string} socketId - The socket ID of the disconnected player.
     */
    function handleDisconnect(room, socketId) {
      if (games[room]) {
        // Remove the player from the room
        games[room].players = games[room].players.filter(
          (player) => player.socketId !== socketId
        );

        // Notify remaining player
        if (games[room].players.length > 0) {
          io.in(room).emit('opponentLeft', 'Your opponent has left the game.');
        } else {
          // Delete the game if no players are left
          delete games[room];
          console.log(`Room ${room} deleted`);
        }
      }
    }

    /**
     * Handles a player's request to roll the dice.
     * @param {string} room - The room ID.
     * @param {string} socketId - The socket ID of the player rolling the dice.
     */
    function handleDiceRoll(room, socketId) {
      const game = games[room];
      if (!game) return;

      const currentPlayer = game.players[game.gameState.turn];
      if (currentPlayer.socketId !== socketId) {
        io.to(socketId).emit('errorMessage', 'It is not your turn to roll the dice.');
        return;
      }

      // Roll the dice
      const diceValue = Math.floor(Math.random() * 6) + 1;
      game.gameState.diceValue = diceValue;

      console.log(`Player ${currentPlayer.playerId} rolled a ${diceValue}`);

      // Notify both players about the dice roll, including lockedPositions
      io.in(room).emit('diceRolled', {
        playerId: currentPlayer.playerId,
        diceValue,
        lockedPositions: game.gameState.lockedPositions, // Include locked positions
      });
    }

    /**
     * Handles a player's move action.
     * @param {string} room - The room ID.
     * @param {string} socketId - The socket ID of the player making the move.
     * @param {Object} data - The move data from the client.
     */
    function handleMakeMove(room, socketId, data) {
      const game = games[room];
      if (!game) return;

      const currentPlayer = game.players[game.gameState.turn];
      if (currentPlayer.socketId !== socketId) {
        io.to(socketId).emit('errorMessage', 'It is not your turn to move.');
        return;
      }

      const { pieceIndex } = data;
      const playerId = currentPlayer.playerId;

      // Validate move
      const isValid = validateMove(game.gameState, playerId, pieceIndex);
      if (!isValid) {
        io.to(socketId).emit('errorMessage', 'Invalid move. You cannot move past or land on a locked position.');
        return;
      }

      // Apply move and get movement data
      const moveData = applyMove(game.gameState, playerId, pieceIndex);

      if (!moveData) {
        io.to(socketId).emit('errorMessage', 'Invalid move due to locking rules.');
        return;
      }

      // Check for a win condition
      if (hasPlayerWon(game.gameState, playerId)) {
        io.in(room).emit('gameOver', { winner: playerId });
        delete games[room]; // End the game
        return;
      }

      // Check if the player gets another turn
      const extraTurn = game.gameState.diceValue === 6 || game.gameState.killOccurred;
      if (!extraTurn) {
        // Switch turn
        game.gameState.turn = (game.gameState.turn + 1) % game.players.length;
      }
      game.gameState.diceValue = null; // Reset dice value
      game.gameState.killOccurred = false; // Reset kill flag

      // Send updated game state to clients, including movement data and locked positions
      io.in(room).emit('updateGameState', {
        gameState: game.gameState,
        moveData: moveData,
      });
    }

    /**
     * Handles when a player has no moves.
     * @param {string} room - The room ID.
     * @param {string} socketId - The socket ID of the player.
     */
    function handleNoMoves(room, socketId) {
      const game = games[room];
      if (!game) return;

      const currentPlayer = game.players[game.gameState.turn];
      if (currentPlayer.socketId !== socketId) {
        io.to(socketId).emit('errorMessage', 'It is not your turn.');
        return;
      }

      // Switch turn
      game.gameState.turn = (game.gameState.turn + 1) % game.players.length;
      game.gameState.diceValue = null;

      // Send updated game state to clients, including locked positions
      io.in(room).emit('updateGameState', { gameState: game.gameState });
    }

    /**
     * Validates a player's move based on the game state and locking rules.
     * @param {Object} gameState - The current game state.
     * @param {string} playerId - The player ID ('P1', 'P3').
     * @param {number} pieceIndex - The index of the piece being moved (0-3).
     * @returns {boolean} - True if the move is valid, false otherwise.
     */
    function validateMove(gameState, playerId, pieceIndex) {
      const currentPosition = gameState.currentPositions[playerId][pieceIndex];
      const diceValue = gameState.diceValue;

      // Rule 3: If piece is in base, can only move out with a six and starting position isn't locked
      if (currentPosition >= 500) {
        if (diceValue !== 6) {
          return false;
        }
        if (gameState.lockedPositions.includes(START_POSITIONS[playerId])) {
          return false; // Starting position is locked
        }
        return true;
      }

      // Simulate moving the piece step by step
      let newPosition = currentPosition;

      for (let i = 0; i < diceValue; i++) {
        newPosition = getNextPosition(playerId, newPosition);

        // Rule 2: Cannot pass through or land on a locked position
        if (gameState.lockedPositions.includes(newPosition)) {
          return false;
        }
      }

      // Check if the new position is beyond the home position
      if (isBeyondHome(playerId, newPosition)) {
        return false;
      }

      return true;
    }

    /**
     * Applies a player's move to the game state.
     * @param {Object} gameState - The current game state.
     * @param {string} playerId - The player ID ('P1', 'P3').
     * @param {number} pieceIndex - The index of the piece being moved (0-3).
     * @returns {Object} - Movement data including path of the piece and killed pieces.
     */
    function applyMove(gameState, playerId, pieceIndex) {
      let currentPosition = gameState.currentPositions[playerId][pieceIndex];
      const diceValue = gameState.diceValue;
      let newPosition = currentPosition;

      let path = []; // To record the sequence of positions

      if (currentPosition >= 500) {
        // Move out of base to starting position
        newPosition = START_POSITIONS[playerId];
        path.push(newPosition);
      } else {
        // Move piece step by step
        for (let i = 0; i < diceValue; i++) {
          newPosition = getNextPosition(playerId, newPosition);
          path.push(newPosition);
        }
      }

      // Update the piece's position
      gameState.currentPositions[playerId][pieceIndex] = newPosition;

      // Check for kills
      const killedPieces = checkForKill(gameState, playerId, newPosition);
      gameState.killOccurred = killedPieces.length > 0;

      // Update locked positions after the move
      updateLockedPositions(gameState);

      // Return movement data
      return {
        playerId,
        pieceIndex,
        path,
        killOccurred: gameState.killOccurred,
        killedPieces, // Include the details of killed pieces
      };
    }

    /**
     * Calculates the next position for a piece.
     * @param {string} playerId - The player ID ('P1', 'P3').
     * @param {number} currentPosition - The current position of the piece.
     * @returns {number} - The next position of the piece.
     */
    function getNextPosition(playerId, currentPosition) {
      if (currentPosition === TURNING_POINTS[playerId]) {
        return HOME_ENTRANCE[playerId][0];
      } else if (HOME_ENTRANCE[playerId].includes(currentPosition)) {
        const index = HOME_ENTRANCE[playerId].indexOf(currentPosition);
        if (index + 1 < HOME_ENTRANCE[playerId].length) {
          return HOME_ENTRANCE[playerId][index + 1];
        } else {
          return HOME_POSITIONS[playerId]; // Reached home
        }
      } else if (currentPosition === 51) {
        return 0;
      } else {
        return currentPosition + 1;
      }
    }

    /**
     * Checks if a position is beyond the home position.
     * @param {string} playerId - The player ID ('P1', 'P3').
     * @param {number} position - The position to check.
     * @returns {boolean} - True if the position is beyond home, false otherwise.
     */
    function isBeyondHome(playerId, position) {
      const homePosition = HOME_POSITIONS[playerId];
      if (HOME_ENTRANCE[playerId].includes(position) || position === homePosition) {
        return false;
      }
      return position > homePosition;
    }

    /**
     * Checks if a kill has occurred due to a player's move.
     * @param {Object} gameState - The current game state.
     * @param {string} playerId - The player ID who moved.
     * @param {number} newPosition - The new position of the moved piece.
     * @returns {Array} - Array of killed pieces with details.
     */
    function checkForKill(gameState, playerId, newPosition) {
      if (SAFE_POSITIONS.includes(newPosition)) {
        // No kill can occur on safe positions
        return [];
      }

      let killedPieces = [];

      // Check all opponent players
      for (const opponentId in gameState.currentPositions) {
        if (opponentId !== playerId) {
          const opponentPositions = gameState.currentPositions[opponentId];
          opponentPositions.forEach((position, index) => {
            if (position === newPosition) {
              // Send opponent's piece back to base
              gameState.currentPositions[opponentId][index] = BASE_POSITIONS[opponentId][index];
              killedPieces.push({ opponentId, pieceIndex: index });
            }
          });
        }
      }

      return killedPieces;
    }

    /**
     * Determines if a player has won the game.
     * @param {Object} gameState - The current game state.
     * @param {string} playerId - The player ID to check.
     * @returns {boolean} - True if the player has won, false otherwise.
     */
    function hasPlayerWon(gameState, playerId) {
      return gameState.currentPositions[playerId].every(
        (position) => position === HOME_POSITIONS[playerId]
      );
    }

    /**
     * Determines if a position is a base or home position.
     * @param {number} position - The position to check.
     * @returns {boolean} - True if it's a base or home position, false otherwise.
     */
    function isBaseOrHome(position) {
      return (
        Object.values(BASE_POSITIONS).flat().includes(parseInt(position)) ||
        Object.values(HOME_POSITIONS).includes(parseInt(position))
      );
    }

    /**
     * Updates the lockedPositions array in the gameState based on currentPositions.
     * A position is locked if two or more pieces occupy it (excluding base and home positions).
     * @param {Object} gameState - The current game state.
     */
    function updateLockedPositions(gameState) {
      const positionCounts = {};

      // Count the number of pieces on each position
      for (const playerId in gameState.currentPositions) {
        gameState.currentPositions[playerId].forEach(position => {
          if (!isBaseOrHome(position)) {
            positionCounts[position] = (positionCounts[position] || 0) + 1;
          }
        });
      }

      // Identify locked positions
      const lockedPositions = [];
      for (const position in positionCounts) {
        if (positionCounts[position] >= 2) {
          lockedPositions.push(parseInt(position));
        }
      }

      gameState.lockedPositions = lockedPositions;
    }
  });

};