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
     * @returns {string} - The assigned player ID (e.g., 'P1', 'P3').
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

      return {
        currentPositions,
        turn: 0, // Index of the current player in the players array
        diceValue: null,
        killOccurred: false,
      };
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
     * Determines the opponent's player ID.
     * @param {Array} players - Array of player objects.
     * @param {string} currentPlayerId - The current player's ID.
     * @returns {string|null} - The opponent's player ID or null.
     */
    function getOpponentId(players, currentPlayerId) {
      const opponent = players.find((player) => player.playerId !== currentPlayerId);
      return opponent ? opponent.playerId : null;
    }

    /**
     * Checks if a position is locked (occupied by two or more opponent pieces).
     * @param {Object} gameState - The current game state.
     * @param {number} position - The position to check.
     * @param {string} opponentId - The opponent's player ID.
     * @returns {boolean} - True if the position is locked, false otherwise.
     */
    function isPositionLocked(gameState, position, opponentId) {
      const opponentPieces = gameState.currentPositions[opponentId];
      let count = 0;
      opponentPieces.forEach((pos) => {
        if (pos === position) count++;
      });
      return count >= 2;
    }

    /**
     * Retrieves all eligible pieces that can move based on the current dice value.
     * @param {Object} gameState - The current game state.
     * @param {string} playerId - The player ID.
     * @param {number} diceValue - The rolled dice value.
     * @returns {Array<number>} - Array of eligible piece indices.
     */
    function getEligiblePieces(gameState, playerId, diceValue) {
      const pieces = gameState.currentPositions[playerId];
      const eligiblePieces = [];

      pieces.forEach((currentPosition, pieceIndex) => {
        if (currentPosition === HOME_POSITIONS[playerId]) {
          // Piece already at home
          return;
        }

        if (BASE_POSITIONS[playerId].includes(currentPosition)) {
          // Piece is in base
          if (diceValue === 6) {
            eligiblePieces.push(pieceIndex);
          }
          return;
        }

        if (HOME_ENTRANCE[playerId].includes(currentPosition)) {
          const index = HOME_ENTRANCE[playerId].indexOf(currentPosition);
          const stepsToHome = HOME_ENTRANCE[playerId].length - index;
          if (diceValue > stepsToHome) {
            // Dice value is too high to reach home
            return;
          }
        }

        // All other pieces are eligible
        eligiblePieces.push(pieceIndex);
      });

      return eligiblePieces;
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

      // Find all eligible pieces based on dice roll
      const eligiblePieces = getEligiblePieces(game.gameState, currentPlayer.playerId, diceValue);

      if (eligiblePieces.length === 0) {
        // No eligible pieces to move
        io.in(room).emit('diceRolled', {
          playerId: currentPlayer.playerId,
          diceValue,
          movablePieces: [], // No pieces can be moved
        });
        return;
      }

      // Determine opponent's ID
      const opponentId = getOpponentId(game.players, currentPlayer.playerId);
      if (!opponentId) {
        io.to(socketId).emit('errorMessage', 'Opponent not found.');
        return;
      }

      // Identify movable pieces that won't land on locked positions
      const movablePieces = eligiblePieces.filter((pieceIndex) => {
        const currentPos = game.gameState.currentPositions[currentPlayer.playerId][pieceIndex];
        let newPos = currentPos;

        if (currentPos >= 500) {
          // Moving out of home
          newPos = START_POSITIONS[currentPlayer.playerId];
        } else {
          // Calculate new position step by step
          for (let i = 0; i < diceValue; i++) {
            newPos = getNextPosition(currentPlayer.playerId, newPos);
          }
        }

        // Check if the new position is locked by opponent
        return !isPositionLocked(game.gameState, newPos, opponentId);
      });

      if (movablePieces.length > 0) {
        // Notify players about the dice roll and movable pieces
        io.in(room).emit('diceRolled', {
          playerId: currentPlayer.playerId,
          diceValue,
          movablePieces, // Array of piece indices that can be moved to unlocked positions
        });
      } else {
        // Player misses their turn due to locked positions
        io.in(room).emit('playerMissedTurn', {
          playerId: currentPlayer.playerId,
          diceValue,
          reason: 'All possible moves are blocked by locked positions.',
        });

        // Switch turn to the next player
        game.gameState.turn = (game.gameState.turn + 1) % game.players.length;
        game.gameState.diceValue = null; // Reset dice value

        // Notify players about the turn switch
        io.in(room).emit('updateGameState', { gameState: game.gameState });
        console.log(`Player ${currentPlayer.playerId} missed their turn in ${room}`);
      }
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
        io.to(socketId).emit('errorMessage', 'Invalid move.');
        return;
      }

      // Apply move and get movement data
      const moveData = applyMove(game.gameState, playerId, pieceIndex);

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

      // Send updated game state to clients, including movement data
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

      // Send updated game state to clients
      io.in(room).emit('updateGameState', { gameState: game.gameState });
    }

    /**
     * Validates a player's move based on the game state and rules.
     * @param {Object} gameState - The current game state.
     * @param {string} playerId - The player ID ('P1', 'P3').
     * @param {number} pieceIndex - The index of the piece being moved (0-3).
     * @returns {boolean} - True if the move is valid, false otherwise.
     */
    function validateMove(gameState, playerId, pieceIndex) {
      const currentPosition = gameState.currentPositions[playerId][pieceIndex];
      const diceValue = gameState.diceValue;

      // If the piece is at home position (500+)
      if (currentPosition >= 500) {
        // Can only move out of home if dice roll is 6
        if (diceValue !== 6) {
          return false;
        }
        return true;
      }

      // Simulate moving the piece
      let newPosition = currentPosition;
      for (let i = 0; i < diceValue; i++) {
        newPosition = getNextPosition(playerId, newPosition);
      }

      // Check if the new position is beyond the home position
      if (isBeyondHome(playerId, newPosition)) {
        return false;
      }

      // Check if the new position is locked by opponent
      const opponentId = getOpponentId(game.players, playerId);
      if (isPositionLocked(gameState, newPosition, opponentId)) {
        return false; // Move is blocked
      }

      return true;
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
     * Handles a player's move and updates the game state accordingly.
     * @param {Object} gameState - The current game state.
     * @param {string} playerId - The player ID making the move.
     * @param {number} pieceIndex - The index of the piece being moved.
     * @returns {Object} - The movement data.
     */
    function applyMove(gameState, playerId, pieceIndex) {
      let currentPosition = gameState.currentPositions[playerId][pieceIndex];
      const diceValue = gameState.diceValue;
      let newPosition = currentPosition;

      let path = []; // To record the sequence of positions

      if (currentPosition >= 500) {
        // Move out of home to starting position
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

      // Return movement data
      return {
        playerId,
        pieceIndex,
        path,
        killOccurred: gameState.killOccurred,
        killedPieces, // Include the details of killed pieces
      };
    }
  });
};