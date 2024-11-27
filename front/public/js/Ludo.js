// Ludo.js

import { UI } from './UI.js';
import {
  STATE,
  PLAYERS,
  BASE_POSITIONS,
  HOME_ENTRANCE,
  HOME_POSITIONS,
  SAFE_POSITIONS,
  START_POSITIONS,
  TURNING_POINTS,
} from './constants.js';

export class Ludo {
  constructor() {
    // Initialize properties
    this.socket = io(); // Ensure 'io' is available globally or adjust as necessary
    this.playerId = null;
    this.room = null;
    this.currentPositions = {};
    this.lockedPositions = {}
    this.turn = null;
    this.diceValue = null;
    this.state = null;
    this.players = [];

    // Set up event listeners
    this.setupSocketListeners();
    this.setupUIListeners();

    // Join the game
    this.socket.emit('joinGame');
  }

  /**
   * Set up event listeners for socket events from the server.
   */
  setupSocketListeners() {
    this.socket.on('playerAssigned', this.onPlayerAssigned.bind(this));
    this.socket.on('startGame', this.onStartGame.bind(this));
    this.socket.on('diceRolled', this.onDiceRolled.bind(this));
    this.socket.on('updateGameState', this.onUpdateGameState.bind(this));
    this.socket.on('gameOver', this.onGameOver.bind(this));
    this.socket.on('opponentLeft', this.onOpponentLeft.bind(this));
    this.socket.on('errorMessage', this.onErrorMessage.bind(this));
  }

  /**
   * Set up UI event listeners for user interactions.
   */
  setupUIListeners() {
    UI.listenDiceClick(this.onDiceClick.bind(this));
    UI.listenPieceClick(this.onPieceClick.bind(this));
    UI.listenResetClick(this.onResetClick.bind(this));
  }

  /**
   * Handler for when the server assigns a player ID and room.
   */
  onPlayerAssigned({ playerId, room }) {
    this.playerId = playerId;
    this.room = room;
    console.log(`Assigned ${playerId} in ${room}`);
  }

  /**
   * Handler for when the game starts.
   */
  onStartGame({ gameState, players }) {
    this.players = players; // Store the players array
    this.currentPositions = gameState.currentPositions;
    this.turn = gameState.turn;
    this.diceValue = gameState.diceValue;
    this.state = STATE.DICE_NOT_ROLLED;
    UI.updateBoard(this.currentPositions);
    UI.setTurn(this.getCurrentPlayerId());
    UI.setDiceValue('-');
    console.log('Game started');
  }

  /**
   * Handler for when the dice is rolled.
   */
  onDiceRolled({ playerId, diceValue }) {
    this.diceValue = diceValue;
    UI.setDiceValue(diceValue);
    UI.unhighlightPieces();

    console.log(`Dice rolled by ${playerId}, value: ${diceValue}`);

    if (playerId === this.playerId) {
      this.state = STATE.DICE_ROLLED;
      console.log('It is my turn. Checking for eligible pieces.');
      this.checkForEligiblePieces();
    } else {
      this.state = STATE.WAITING_FOR_OPPONENT;
      console.log('Waiting for opponent to move.');
    }
  }

  /**
   * Handler for when the game state is updated by the server.
   */
  onUpdateGameState({ gameState, moveData }) {
    console.log('Received updated game state:', gameState);

    // Update local game state
    this.currentPositions = gameState.currentPositions;
    this.lockedPositions = gameState.lockedPositions || {}; // Store locked positions
    this.turn = gameState.turn;
    this.diceValue = gameState.diceValue;

    UI.setTurn(this.getCurrentPlayerId());

    // Update positions of killed pieces immediately
    if (moveData && moveData.killedPieces && moveData.killedPieces.length > 0) {
      moveData.killedPieces.forEach(({ opponentId, pieceIndex }) => {
        const newPos = this.currentPositions[opponentId][pieceIndex];
        this.setPiecePosition(opponentId, pieceIndex, newPos);
      });
    }

    if (moveData) {
      const { playerId, pieceIndex, path } = moveData;

      // Animate the move
      this.animateMove(playerId, pieceIndex, path);
    } else {
      // If no move data, just update the board
      UI.updateBoard(this.currentPositions);
    }

    // Handle state changes
    if (this.getCurrentPlayerId() === this.playerId) {
      if (this.state !== STATE.DICE_ROLLED) {
        this.state = STATE.DICE_NOT_ROLLED;
        UI.enableDice();
      }
    } else {
      this.state = STATE.WAITING_FOR_OPPONENT;
      UI.disableDice();
    }
  }

  /**
   * Animates the movement of a piece along a given path.
   */
  animateMove(playerId, pieceIndex, path) {
    if (path.length === 0) {
      return;
    }

    let moveBy = path.length;
    const interval = setInterval(() => {
      const nextPosition = path.shift();
      if (nextPosition !== undefined) {
        this.setPiecePosition(playerId, pieceIndex, nextPosition);
      }
      moveBy--;

      if (moveBy === 0 || path.length === 0) {
        clearInterval(interval);
        // After moving, check for any additional actions if needed
      }
    }, 300); // Adjust the interval time as needed
  }

  /**
   * Sets the piece's position locally.
   */
  setPiecePosition(player, piece, newPosition) {
    this.currentPositions[player][piece] = newPosition;
    UI.setPiecePosition(player, piece, newPosition);
  }

  /**
   * Handler for when the game is over.
   */
  onGameOver({ winner }) {
    if (winner === this.playerId) {
      alert('Congratulations! You won!');
    } else {
      alert('You lost. Better luck next time!');
    }
    // Optionally reset the game or redirect to a lobby
  }

  /**
   * Handler for when the opponent leaves the game.
   */
  onOpponentLeft(message) {
    alert(message);
    // Optionally reset the game or wait for a new player
  }

  /**
   * Handler for error messages from the server.
   */
  onErrorMessage(message) {
    alert(message);
  }

  /**
   * Handler for when the dice is clicked.
   */
  onDiceClick() {
    if (this.state !== STATE.DICE_NOT_ROLLED || this.playerId !== this.getCurrentPlayerId()) {
      alert('It is not your turn to roll the dice.');
      return;
    }
    console.log('Rolling the dice.');
    // Emit the rollDice event to the server
    this.socket.emit('rollDice');
    UI.disableDice();
  }

  /**
   * Handler for when a piece is clicked.
   */
  onPieceClick(event) {
    const target = event.target;

    if (!target.classList.contains('player-piece') || !target.classList.contains('highlight')) {
      return;
    }
    console.log('Piece clicked');

    const player = target.getAttribute('player-id');
    const piece = parseInt(target.getAttribute('piece'));

    if (player !== this.playerId) {
      alert('You can only move your own pieces.');
      return;
    }

    if (this.state !== STATE.DICE_ROLLED || this.playerId !== this.getCurrentPlayerId()) {
      alert('It is not your turn to move.');
      return;
    }

    // Handle the piece click logic
    this.handlePieceClick(player, piece);
    UI.unhighlightPieces();
  }

  /**
   * Handles the logic when a piece is clicked.
   */
  handlePieceClick(player, piece) {
    console.log(`Handling piece click for player ${player}, piece ${piece}`);
    // We don't move the piece here; we wait for the server to confirm and send the move data

    // Send the move to the server
    this.socket.emit('makeMove', { pieceIndex: piece });
    this.state = STATE.DICE_NOT_ROLLED;
  }

  /**
   * Checks for eligible pieces to move after a dice roll.
   */
  checkForEligiblePieces() {
    const eligiblePieces = this.getEligiblePieces(this.playerId);
    if (eligiblePieces.length > 0) {
      UI.highlightPieces(this.playerId, eligiblePieces);
    } else {
      // No eligible pieces, notify the server to end the turn
      this.socket.emit('noMoves');
    }
  }

  /*
  /**
   * Determines which pieces are eligible to move.
   */
  getEligiblePieces(player) {
    const pieces = this.currentPositions[player];
    const diceValue = this.diceValue;
    const eligiblePieces = [];

    pieces.forEach((currentPosition, pieceIndex) => {
      if (currentPosition === HOME_POSITIONS[player]) {
        // Piece already at home
        return;
      }

      if (BASE_POSITIONS[player].includes(currentPosition)) {
        // Piece is in base
        if (diceValue === 6) {
          // Check if starting position is blocked by opponent's lock
          const startingPosition = START_POSITIONS[player];
          const lockOwner = this.lockedPositions[startingPosition];
          if (!lockOwner || lockOwner === player) {
            eligiblePieces.push(pieceIndex);
          }
        }
        return;
      }

      // Calculate the path for the piece
      const path = this.getPath(player, currentPosition, diceValue);

      // Check if any position in path is blocked by an opponent's lock
      const isBlocked = path.some((pos) => {
        const lockOwner = this.lockedPositions[pos];
        // Position is locked by opponent
        return lockOwner && lockOwner !== player;
      });

      if (!isBlocked) {
        eligiblePieces.push(pieceIndex);
      }
    });

    return eligiblePieces;
  }
    
  /**
   * Retrieves the indices of the player's locked pieces.
   * @param {string} player - The player ID ('P1', 'P3').
   * @returns {Array<number>} - An array of piece indices that are locked.
   */
  getLockedPieces(player) {
    const lockedPieces = [];
    this.currentPositions[player].forEach((position, index) => {
      if (this.lockedPositions[position] === player) {
        lockedPieces.push(index);
      }
    });
    return lockedPieces;
  }
    
  /**
   * Checks if moving a piece from currentPosition with diceValue is blocked by any locked positions.
   * @param {string} player - The player ID ('P1', 'P3').
   * @param {number} currentPosition - The current position of the piece.
   * @param {number} diceValue - The number of steps to move.
   * @returns {boolean} - True if the move is blocked, false otherwise.
   */
  isMoveBlocked(player, currentPosition, diceValue) {
    const path = this.getPath(player, currentPosition, diceValue);

    for (const pos of path) {
      const lockOwner = this.lockedPositions[pos];
      if (lockOwner && lockOwner !== player) {
        // Path is blocked by an opponent's lock
        return true;
      }
    }

    return false;
  }

  /**
   * Generates the path a piece will take based on currentPosition and diceValue.
   * @param {string} player - The player ID ('P1', 'P3').
   * @param {number} currentPosition - The current position of the piece.
   * @param {number} diceValue - The number of steps to move.
   * @returns {Array<number>} - An array of positions the piece will traverse.
   */
  getPath(player, currentPosition, diceValue) {
    const path = [];
    let pos = currentPosition;

    for (let i = 0; i < diceValue; i++) {
      pos = this.getNextPosition(player, pos);
      path.push(pos);

      // Stop adding to path if piece reaches home
      if (this.isHomePosition(player, pos)) {
        break;
      }
    }

    return path;
  }
  
  /**
   * Determines if a position is the home position for a player.
   * @param {string} playerId - The player ID ('P1', 'P3').
   * @param {number} position - The position to check.
   * @returns {boolean} - True if it's the home position, false otherwise.
   */
  isHomePosition(playerId, position) {
    return HOME_POSITIONS[playerId] === position;
  }

  
  /**
   * Calculates the next position for a piece.
   * @param {string} playerId - The player ID ('P1', 'P3').
   * @param {number} currentPosition - The current position of the piece.
   * @returns {number} - The next position of the piece.
   */
  getNextPosition(playerId, currentPosition) {
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
   * Handler for when the reset button is clicked.
   */
  onResetClick() {
    // Optionally implement a reset functionality
    alert('Reset is not implemented in multiplayer mode.');
  }

  /**
   * Gets the current player's ID based on the turn.
   */
  getCurrentPlayerId() {
    return this.getPlayerIdByIndex(this.turn);
  }

  /**
   * Gets the player ID by index.
   */
  getPlayerIdByIndex(index) {
    return this.players[index];
  }
}