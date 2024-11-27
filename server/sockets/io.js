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
      if (playerId === null) {
        console.log(`Player ${socket.id} could not join room ${room} as it is full.`);
        return;
      }
      console.log(`Player ${playerId} (${socket.id}) joined ${room}`);

      // Send the assigned player ID and room info to the client
      socket.emit('playerAssigned', { playerId, room });

      // Start the game when two players have joined
      if (games[room].players.length === 2) {
        // Initialize game state
        games[room].gameState = initializeGameState(games[room].players);
        // Update locked positions initially (likely none)
        updateLockedPositions(games[room].gameState);
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
     * @returns {string|null} - The assigned player ID (e.g., 'P1', 'P3') or null if room is full.
     */
    function assignPlayerId(room, socketId) {
      const existingPlayerIds = games[room].players.map((player) => player.playerId);

      // Define the possible player IDs
      const possiblePlayerIds = ['P1', 'P3'];

      // Find the first available player ID
      const playerId = possiblePlayerIds.find((id) => !existingPlayerIds.includes(id));

      if (!playerId) {
        // Room is full
        console.log(`assignPlayerId: Room ${room} is full. Player ${socketId} cannot join.`);
        io.to(socketId).emit('errorMessage', 'Room is full.');
        return null;
      }

      games[room].players.push({ socketId, playerId });
      console.log(`assignPlayerId: Assigned Player ${playerId} to socket ${socketId} in room ${room}`);
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
          console.error(`initializeGameState: Unknown player ID: ${playerId}`);
        }
      });

      return {
        currentPositions,
        turn: 0, // Index of the current player in the players array
        diceValue: null,
        killOccurred: false,
        lockedPositions: {}, // Initialize lockedPositions as an empty object
      };
    }

    /**
     * Updates the lockedPositions in the game state based on currentPositions.
     * A position is locked if a player has two or more pieces on it (excluding base and home positions).
     * @param {Object} gameState - The current game state.
     */
    function updateLockedPositions(gameState) {
      const positionCount = {};

      console.log(`updateLockedPositions: Updating locked positions.`);

      // Iterate through each player's pieces
      for (const playerId in gameState.currentPositions) {
        const positions = gameState.currentPositions[playerId];
        positions.forEach((position) => {
          // Skip base and home positions
          if (
            BASE_POSITIONS[playerId].includes(position) ||
            HOME_POSITIONS[playerId] === position
          ) {
            return;
          }

          if (!positionCount[position]) {
            positionCount[position] = {};
          }

          if (!positionCount[position][playerId]) {
            positionCount[position][playerId] = 0;
          }

          positionCount[position][playerId]++;
        });
      }

      // Reset lockedPositions
      gameState.lockedPositions = {};

      // Determine locked positions
      for (const position in positionCount) {
        for (const playerId in positionCount[position]) {
          if (positionCount[position][playerId] >= 2) {
            gameState.lockedPositions[position] = playerId;
            console.log(`updateLockedPositions: Position ${position} locked by ${playerId}`);
          }
        }
      }

      console.log(`updateLockedPositions: Locked positions updated:`, gameState.lockedPositions);
    }

    /**
     * Checks if a position is locked.
     * @param {Object} gameState - The current game state.
     * @param {number} position - The position to check.
     * @returns {string|null} - The player ID who has locked the position or null if not locked.
     */
    function isPositionLocked(gameState, position) {
      return gameState.lockedPositions[position] || null;
    }

    /**
     * Handles a player's disconnection from a room.
     * @param {string} room - The room ID.
     * @param {string} socketId - The socket ID of the disconnected player.
     */
    function handleDisconnect(room, socketId) {
      if (games[room]) {
        // Remove the player from the room
        const removedPlayer = games[room].players.find((player) => player.socketId === socketId);
        games[room].players = games[room].players.filter(
          (player) => player.socketId !== socketId
        );

        console.log(`handleDisconnect: Player ${removedPlayer ? removedPlayer.playerId : socketId} left room ${room}`);

        // Notify remaining player
        if (games[room].players.length > 0) {
          io.in(room).emit('opponentLeft', 'Your opponent has left the game.');
        } else {
          // Delete the game if no players are left
          delete games[room];
          console.log(`handleDisconnect: Room ${room} deleted`);
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
      if (!game || !game.gameState) {
        console.log(`handleDiceRoll: Game not found for room ${room}`);
        return;
      }

      const currentPlayer = game.players[game.gameState.turn];
      if (currentPlayer.socketId !== socketId) {
        console.log(`handleDiceRoll: Player ${socketId} attempted to roll dice out of turn.`);
        io.to(socketId).emit('errorMessage', 'It is not your turn to roll the dice.');
        return;
      }

      // Roll the dice
      const diceValue = Math.floor(Math.random() * 6) + 1;
      game.gameState.diceValue = diceValue;

      console.log(`handleDiceRoll: Player ${currentPlayer.playerId} rolled a ${diceValue}`);

      // Notify both players about the dice roll
      io.in(room).emit('diceRolled', {
        playerId: currentPlayer.playerId,
        diceValue,
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
      if (!game || !game.gameState) {
        console.log(`handleMakeMove: Game not found for room ${room}`);
        return;
      }

      const currentPlayer = game.players[game.gameState.turn];
      if (currentPlayer.socketId !== socketId) {
        console.log(`handleMakeMove: Player ${socketId} attempted to move out of turn.`);
        io.to(socketId).emit('errorMessage', 'It is not your turn to move.');
        return;
      }

      const { pieceIndex } = data;
      const playerId = currentPlayer.playerId;

      console.log(`handleMakeMove: Player ${playerId} attempting to move piece ${pieceIndex}`);

      // Validate move
      const isValid = validateMove(game.gameState, playerId, pieceIndex);
      console.log(`handleMakeMove: Move validation result: ${isValid}`);
      if (!isValid) {
        io.to(socketId).emit('errorMessage', 'Invalid move due to locked positions.');
        return;
      }

      // Apply move and get movement data
      const moveData = applyMove(game.gameState, playerId, pieceIndex);
      console.log(`handleMakeMove: Move applied:`, moveData);

      // Check for a win condition
      if (hasPlayerWon(game.gameState, playerId)) {
        console.log(`handleMakeMove: Player ${playerId} has won the game.`);
        io.in(room).emit('gameOver', { winner: playerId });
        delete games[room]; // End the game
        return;
      }

      // Check if the player gets another turn
      const extraTurn = game.gameState.diceValue === 6 || game.gameState.killOccurred;
      console.log(`handleMakeMove: Extra turn: ${extraTurn}`);
      if (!extraTurn) {
        // Switch turn
        game.gameState.turn = (game.gameState.turn + 1) % game.players.length;
        console.log(`handleMakeMove: Turn switched to player index ${game.gameState.turn}`);
      }
      game.gameState.diceValue = null; // Reset dice value
      game.gameState.killOccurred = false; // Reset kill flag

      // Send updated game state to clients, including movement data
      io.in(room).emit('updateGameState', {
        gameState: game.gameState, // This includes lockedPositions
        moveData: moveData,
      });

      console.log(`handleMakeMove: updateGameState emitted to room ${room}`);
    }

    /**
     * Handles when a player has no moves.
     * @param {string} room - The room ID.
     * @param {string} socketId - The socket ID of the player.
     */
    function handleNoMoves(room, socketId) {
      const game = games[room];
      if (!game || !game.gameState) {
        console.log(`handleNoMoves: Game not found for room ${room}`);
        return;
      }

      const currentPlayer = game.players[game.gameState.turn];
      if (currentPlayer.socketId !== socketId) {
        console.log(`handleNoMoves: Player ${socketId} attempted to end turn out of turn.`);
        io.to(socketId).emit('errorMessage', 'It is not your turn.');
        return;
      }

      console.log(`handleNoMoves: Player ${currentPlayer.playerId} has no moves.`);

      // Switch turn
      game.gameState.turn = (game.gameState.turn + 1) % game.players.length;
      game.gameState.diceValue = null;

      // Send updated game state to clients
      io.in(room).emit('updateGameState', { gameState: game.gameState });

      console.log(`handleNoMoves: updateGameState emitted to room ${room}`);
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

      console.log(`validateMove: Player ${playerId}, Piece ${pieceIndex}, Current Position ${currentPosition}, Dice Value ${diceValue}`);

      // If the piece is at home position (500+)
      if (currentPosition >= 500) {
        console.log(`validateMove: Piece is in base.`);
        // Can only move out of home if dice roll is 6
        if (diceValue !== 6) {
          console.log(`validateMove: Invalid move - Dice value not 6 to exit base.`);
          return false;
        }
        // Additionally, check if the starting position is locked by opponent
        const startingPosition = START_POSITIONS[playerId];
        const lockOwner = isPositionLocked(gameState, startingPosition);
        console.log(`validateMove: Starting position ${startingPosition} lock owner: ${lockOwner}`);
        if (lockOwner && lockOwner !== playerId) {
          console.log(`validateMove: Starting position is locked by opponent.`);
          // Starting position is locked by an opponent; cannot enter
          return false;
        }
        return true;
      }

      // Get the path the piece will take
      const path = getPath(gameState, playerId, currentPosition, diceValue);
      console.log(`validateMove: Path calculated: ${path}`);

      // Check each position in the path for locks
      for (const pos of path) {
        const lockOwner = isPositionLocked(gameState, pos);
        console.log(`validateMove: Checking position ${pos}, lock owner: ${lockOwner}`);
        if (lockOwner && lockOwner !== playerId) {
          // Path is blocked by an opponent's lock
          console.log(`validateMove: Move blocked by opponent's lock at position ${pos}`);
          return false;
        }
      }

      // Simulate moving to the final position to check beyond home
      const finalPosition = path[path.length - 1];
      console.log(`validateMove: Final position after move: ${finalPosition}`);
      if (isBeyondHome(playerId, finalPosition)) {
        console.log(`validateMove: Invalid move - Position ${finalPosition} is beyond home.`);
        return false;
      }

      console.log(`validateMove: Move is valid.`);
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

      console.log(`applyMove: Applying move for Player ${playerId}, Piece ${pieceIndex}, Current Position ${currentPosition}, Dice Value ${diceValue}`);

      if (currentPosition >= 500) {
        // Move out of home to starting position
        newPosition = START_POSITIONS[playerId];
        path.push(newPosition);
        console.log(`applyMove: Piece moved out of base to starting position ${newPosition}`);
      } else {
        // Move piece step by step
        for (let i = 0; i < diceValue; i++) {
          newPosition = getNextPosition(playerId, newPosition);
          path.push(newPosition);
          console.log(`applyMove: Step ${i + 1}, moved to position ${newPosition}`);
        }
      }

      // Update the piece's position
      gameState.currentPositions[playerId][pieceIndex] = newPosition;
      console.log(`applyMove: Piece ${pieceIndex} new position: ${newPosition}`);

      // Check for kills
      const killedPieces = checkForKill(gameState, playerId, newPosition);
      gameState.killOccurred = killedPieces.length > 0;
      if (gameState.killOccurred) {
        console.log(`applyMove: Kill occurred:`, killedPieces);
      }

      // Update locked positions after the move and potential kills
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
      } else if (currentPosition === 51) { // Assuming 51 loops back to 0
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

      // Check if the position is locked
      const lockOwner = isPositionLocked(gameState, newPosition);
      if (lockOwner) {
        // If the lock is owned by the moving player, no kill occurs
        if (lockOwner === playerId) {
          return [];
        } else {
          // Position is locked by an opponent, no kill can occur
          return [];
        }
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
              console.log(`checkForKill: Player ${playerId} killed Player ${opponentId}'s piece ${index} at position ${newPosition}`);
            }
          });
        }
      }

      return killedPieces;
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

      console.log(`validateMove: Player ${playerId}, Piece ${pieceIndex}, Current Position ${currentPosition}, Dice Value ${diceValue}`);

      // If the piece is at home position (500+)
      if (currentPosition >= 500) {
        console.log(`validateMove: Piece is in base.`);
        // Can only move out of home if dice roll is 6
        if (diceValue !== 6) {
          console.log(`validateMove: Invalid move - Dice value not 6 to exit base.`);
          return false;
        }
        // Additionally, check if the starting position is locked by opponent
        const startingPosition = START_POSITIONS[playerId];
        const lockOwner = isPositionLocked(gameState, startingPosition);
        console.log(`validateMove: Starting position ${startingPosition} lock owner: ${lockOwner}`);
        if (lockOwner && lockOwner !== playerId) {
          console.log(`validateMove: Starting position is locked by opponent.`);
          // Starting position is locked by an opponent; cannot enter
          return false;
        }
        return true;
      }

      // Get the path the piece will take
      const path = getPath(gameState, playerId, currentPosition, diceValue);
      console.log(`validateMove: Path calculated: ${path}`);

      // Check each position in the path for locks
      for (const pos of path) {
        const lockOwner = isPositionLocked(gameState, pos);
        console.log(`validateMove: Checking position ${pos}, lock owner: ${lockOwner}`);
        if (lockOwner && lockOwner !== playerId) {
          // Path is blocked by an opponent's lock
          console.log(`validateMove: Move blocked by opponent's lock at position ${pos}`);
          return false;
        }
      }

      // Simulate moving to the final position to check beyond home
      const finalPosition = path[path.length - 1];
      console.log(`validateMove: Final position after move: ${finalPosition}`);
      if (isBeyondHome(playerId, finalPosition)) {
        console.log(`validateMove: Invalid move - Position ${finalPosition} is beyond home.`);
        return false;
      }

      console.log(`validateMove: Move is valid.`);
      return true;
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
  });
};