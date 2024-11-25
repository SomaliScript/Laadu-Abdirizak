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
        // Piece is in base (home position)
        if (diceValue === 6) {
          eligiblePieces.push(pieceIndex);
        }
        return;
      }

      if (HOME_ENTRANCE[player].includes(currentPosition)) {
        const index = HOME_ENTRANCE[player].indexOf(currentPosition);
        const stepsToHome = HOME_ENTRANCE[player].length - index;
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