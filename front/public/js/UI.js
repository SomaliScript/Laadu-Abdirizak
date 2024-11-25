// UI.js

import { COORDINATES_MAP, PLAYERS, STEP_LENGTH } from './constants.js';

const diceButtonElement = document.querySelector('#dice-btn');
const playerPiecesElements = {
  P1: document.querySelectorAll('[player-id="P1"].player-piece'),
  // P2: document.querySelectorAll('[player-id="P2"].player-piece'),
  P3: document.querySelectorAll('[player-id="P3"].player-piece'),
  // P4: document.querySelectorAll('[player-id="P4"].player-piece'),
};

export class UI {
  /**
   * Sets up the event listener for the dice button click.
   * @param {Function} callback - The function to call when the dice is clicked.
   */
  static listenDiceClick(callback) {
    diceButtonElement.addEventListener('click', callback);
  }

  /**
   * Sets up the event listener for the reset button click.
   * @param {Function} callback - The function to call when the reset button is clicked.
   */
  static listenResetClick(callback) {
    document.querySelector('button#reset-btn').addEventListener('click', callback);
  }

  /**
   * Sets up the event listener for the player pieces click.
   * @param {Function} callback - The function to call when a piece is clicked.
   */
  static listenPieceClick(callback) {
    document.querySelector('.player-pieces').addEventListener('click', callback);
  }

  /**
   * Updates the positions of all pieces on the board based on the current game state.
   * @param {Object} currentPositions - The current positions of all players' pieces.
   */
  static updateBoard(currentPositions) {
    PLAYERS.forEach((player) => {
      currentPositions[player].forEach((position, pieceIndex) => {
        this.setPiecePosition(player, pieceIndex, position);
      });
    });
  }

  /**
   * Sets the position of a specific piece on the board.
   * @param {string} player - The player ID (e.g., 'P1').
   * @param {number} piece - The index of the piece (0-3).
   * @param {number} newPosition - The new position index on the board.
   */
  static setPiecePosition(player, piece, newPosition) {
    if (!playerPiecesElements[player] || !playerPiecesElements[player][piece]) {
      console.error(`Player element for player: ${player} and piece: ${piece} not found`);
      return;
    }

    const coordinates = COORDINATES_MAP[newPosition];

    if (!coordinates) {
      console.error(`Invalid position: ${newPosition} for player: ${player} piece: ${piece}`);
      return;
    }

    const [x, y] = coordinates;
    const pieceElement = playerPiecesElements[player][piece];
    pieceElement.style.top = y * STEP_LENGTH + '%';
    pieceElement.style.left = x * STEP_LENGTH + '%';
  }

  /**
   * Displays the current player's turn in the UI.
   * @param {string} playerId - The player ID whose turn it is.
   */
  static setTurn(playerId) {
    if (!PLAYERS.includes(playerId)) {
      console.error('Invalid player ID!');
      return;
    }

    // Display player ID
    document.querySelector('.active-player span').innerText = playerId;

    // Highlight the active player's base
    document.querySelectorAll('.player-base').forEach((base) => {
      base.classList.remove('highlight');
    });
    const activeBase = document.querySelector(`.player-base[player-id="${playerId}"]`);
    if (activeBase) {
      activeBase.classList.add('highlight');
    }
  }

  /**
   * Enables the dice button.
   */
  static enableDice() {
    diceButtonElement.removeAttribute('disabled');
  }

  /**
   * Disables the dice button.
   */
  static disableDice() {
    diceButtonElement.setAttribute('disabled', '');
  }

  /**
   * Highlights the eligible pieces that can be moved.
   * @param {string} player - The player ID.
   * @param {number[]} pieces - An array of piece indices to highlight.
   */
  static highlightPieces(player, pieces) {
    pieces.forEach((piece) => {
      const pieceElement = playerPiecesElements[player][piece];
      if (pieceElement) {
        pieceElement.classList.add('highlight');
      }
    });
  }

  /**
   * Removes highlights from all pieces.
   */
  static unhighlightPieces() {
    document.querySelectorAll('.player-piece.highlight').forEach((ele) => {
      ele.classList.remove('highlight');
    });
  }

  /**
   * Sets the displayed value of the dice.
   * @param {number|string} value - The dice value to display.
   */
  static setDiceValue(value) {
    document.querySelector('.dice-value').innerText = value;
  }
}

// UI.setPiecePosition('P1', 0, 0);
// UI.setTurn(0);
// UI.setTurn(1);

// UI.disableDice();
// UI.enableDice();
// UI.highlightPieces('P1', [0]);
// UI.unhighlightPieces();
// UI.setDiceValue(5);