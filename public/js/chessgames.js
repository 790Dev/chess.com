const socket = io();
const chess = new Chess();
const boardElement = document.querySelector(".chessboard");

// --- DOM ELEMENTS ---
const setupModal = document.getElementById("setup-modal");
const gameOverModal = document.getElementById("game-over-modal"); // NEW
const gameResultText = document.getElementById("game-result"); // NEW
const gameReasonText = document.getElementById("game-reason"); // NEW

const timeButtons = document.querySelectorAll(".time-btn");
const readyBtn = document.getElementById("ready-btn");
const waitingMsg = document.getElementById("waiting-message");
const timeSelectionDiv = document.getElementById("time-selection");
const countdownEl = document.getElementById("countdown");
const statusText = document.getElementById("status-text");

let draggedPiece = null;
let sourceSquare = null;
let playerRole = null;
let gameStarted = false;

/* --- 1. SETUP & UI LOGIC --- */

timeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (playerRole === "w") {
      const mins = parseInt(btn.dataset.min);
      socket.emit("selectTime", mins);
      timeButtons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    }
  });
});

readyBtn.addEventListener("click", () => {
  socket.emit("playerReady");
  readyBtn.innerText = "Waiting for opponent...";
  readyBtn.disabled = true;
});

/* --- 2. GAME OVER HANDLING (No more alerts) --- */

const showGameOverModal = (title, reason) => {
  gameResultText.innerText = title;
  gameReasonText.innerText = reason;

  // Un-hide the modal
  gameOverModal.classList.remove("hidden");

  // Stop the game interaction
  gameStarted = false;
};

// Check for Checkmate/Draw locally (happens after every move)
const checkGameOver = () => {
  if (chess.isGameOver()) {
    let title = "Game Over";
    let reason = "";

    if (chess.isCheckmate()) {
      const winner = chess.turn() === "w" ? "Black" : "White";
      title = `${winner} Wins!`;
      reason = "Checkmate";
    } else if (chess.isDraw()) {
      title = "Draw";
      reason = "Stalemate / Insufficient Material";
    } else if (chess.isStalemate()) {
      title = "Draw";
      reason = "Stalemate";
    } else if (chess.isThreefoldRepetition()) {
      title = "Draw";
      reason = "Threefold Repetition";
    }

    showGameOverModal(title, reason);
  }
};

/* --- 3. SOCKET EVENTS --- */

socket.on("playerRole", (role) => {
  playerRole = role;
  renderBoard();
  if (role === "b") {
    timeSelectionDiv.classList.add("hidden");
    waitingMsg.classList.remove("hidden");
    statusText.innerText = "Waiting for host to pick time...";
  } else {
    statusText.innerText = "Please select a time control.";
  }
});

socket.on("timeSelected", (seconds) => {
  const minutes = seconds / 60;
  waitingMsg.classList.add("hidden");
  statusText.innerText =
    playerRole === "b"
      ? `Host selected ${minutes} min. Click Ready!`
      : `Time set to ${minutes} min. Click Ready!`;
  readyBtn.disabled = false;
  updateTimerDisplay({ w: seconds, b: seconds });
});

socket.on("updateReadyState", (readyState) => {
  if (readyState.white && readyState.black) {
    statusText.innerText = "Both players ready! Starting...";
  }
});

socket.on("countdown", (count) => {
  timeSelectionDiv.classList.add("hidden");
  readyBtn.classList.add("hidden");
  waitingMsg.classList.add("hidden");
  statusText.classList.add("hidden");

  countdownEl.classList.remove("hidden");
  countdownEl.innerText = count > 0 ? count : "GO!";
});

socket.on("startGame", () => {
  setupModal.classList.add("hidden");
  gameStarted = true;
});

socket.on("timerUpdate", (timers) => {
  updateTimerDisplay(timers);
});

// Handle Server-Side Game Over (Timeout / Disconnect)
socket.on("gameOver", (data) => {
  // data = { winner: "Black", reason: "Timeout" }
  showGameOverModal(`${data.winner} Wins!`, data.reason);
});

socket.on("spectatorRole", () => {
  playerRole = null;
  renderBoard();
});

socket.on("boardState", (fen) => {
  chess.load(fen);
  renderBoard();
  checkGameOver();
});

socket.on("move", (move) => {
  chess.move(move);
  renderBoard();
  removeHighlights();
  checkGameOver(); // Check if this move caused game over
});

/* --- 4. BOARD RENDERING & INTERACTION --- */

const renderBoard = () => {
  boardElement.innerHTML = "";

  // Re-append modals so they stay on top
  boardElement.appendChild(setupModal);
  boardElement.appendChild(gameOverModal);

  const board = chess.board();

  board.forEach((row, rowindex) => {
    row.forEach((square, squareIndex) => {
      const squareElement = document.createElement("div");
      squareElement.classList.add(
        "square",
        (rowindex + squareIndex) % 2 === 0 ? "light" : "dark",
      );
      squareElement.dataset.row = rowindex;
      squareElement.dataset.col = squareIndex;

      if (square) {
        const pieceElement = document.createElement("div");
        pieceElement.classList.add(
          "piece",
          square.color === "w" ? "white" : "black",
        );
        pieceElement.innerText = getPieceUnicode(square);
        pieceElement.draggable = playerRole === square.color && gameStarted;

        pieceElement.addEventListener("dragstart", (e) => {
          if (pieceElement.draggable) {
            draggedPiece = pieceElement;
            sourceSquare = { row: rowindex, col: squareIndex };
            e.dataTransfer.setData("text/plain", "");
          }
        });
        pieceElement.addEventListener("dragend", () => {
          draggedPiece = null;
          sourceSquare = null;
        });
        squareElement.appendChild(pieceElement);
      }

      squareElement.addEventListener("dragover", (e) => e.preventDefault());
      squareElement.addEventListener("drop", (e) => {
        e.preventDefault();
        if (draggedPiece && gameStarted) {
          const targetSource = {
            row: parseInt(squareElement.dataset.row),
            col: parseInt(squareElement.dataset.col),
          };
          handleMove(sourceSquare, targetSource);
        }
      });
      boardElement.appendChild(squareElement);
    });
  });

  if (playerRole === "b") {
    boardElement.classList.add("flipped");
    document.getElementById("bottom-player-name").innerText = "You (Black)";
    document.getElementById("top-player-name").innerText = "Opponent (White)";
  } else {
    boardElement.classList.remove("flipped");
    document.getElementById("bottom-player-name").innerText = "You (White)";
    document.getElementById("top-player-name").innerText = "Opponent (Black)";
  }
  updateCapturedPieces();
};

boardElement.addEventListener("click", (e) => {
  if (!gameStarted) return;

  const square = e.target.closest(".square");
  if (!square) return;

  const row = parseInt(square.dataset.row);
  const col = parseInt(square.dataset.col);
  const pieceElement = square.querySelector(".piece");

  // Move
  if (sourceSquare) {
    const moveAttempt = {
      from: `${String.fromCharCode(97 + sourceSquare.col)}${8 - sourceSquare.row}`,
      to: `${String.fromCharCode(97 + col)}${8 - row}`,
      promotion: "q",
    };
    const validMove = chess.move(moveAttempt);
    if (validMove) {
      chess.undo();
      handleMove(sourceSquare, { row, col });
      removeHighlights();
      sourceSquare = null;
      return;
    }
  }

  // Select
  if (pieceElement) {
    const pieceData = chess.board()[row][col];
    if (pieceData && pieceData.color === playerRole) {
      removeHighlights();
      sourceSquare = { row, col };
      square.classList.add("highlight");
      showValidMoves(row, col);
    } else {
      removeHighlights();
      sourceSquare = null;
    }
  } else {
    removeHighlights();
    sourceSquare = null;
  }
});

const showValidMoves = (row, col) => {
  const moves = chess.moves({
    square: `${String.fromCharCode(97 + col)}${8 - row}`,
    verbose: true,
  });
  moves.forEach((move) => {
    const targetCol = move.to.charCodeAt(0) - 97;
    const targetRow = 8 - parseInt(move.to[1]);
    const targetSquare = document.querySelector(
      `.square[data-row="${targetRow}"][data-col="${targetCol}"]`,
    );
    if (targetSquare) {
      const indicator = document.createElement("div");
      indicator.classList.add(move.captured ? "capture-ring" : "move-dot");
      targetSquare.appendChild(indicator);
    }
  });
};

const removeHighlights = () => {
  sourceSquare = null;
  document
    .querySelectorAll(".square")
    .forEach((sq) => sq.classList.remove("highlight"));
  document
    .querySelectorAll(".move-dot, .capture-ring")
    .forEach((el) => el.remove());
};

const handleMove = (from, to) => {
  const move = {
    from: `${String.fromCharCode(97 + from.col)}${8 - from.row}`,
    to: `${String.fromCharCode(97 + to.col)}${8 - to.row}`,
    promotion: "q",
  };
  socket.emit("move", move);
};

const getPieceUnicode = (piece) => {
  const map = {
    p: "♙",
    r: "♖",
    n: "♘",
    b: "♗",
    q: "♕",
    k: "♔",
    P: "♟",
    R: "♜",
    N: "♞",
    B: "♝",
    Q: "♛",
    K: "♚",
  };
  return map[piece.type] || "";
};

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

const updateTimerDisplay = (timers) => {
  const whiteTime = formatTime(timers.w);
  const blackTime = formatTime(timers.b);
  const bottomTimer = document.getElementById("bottom-timer");
  const topTimer = document.getElementById("top-timer");

  if (playerRole === "b") {
    bottomTimer.innerText = blackTime;
    topTimer.innerText = whiteTime;
    if (chess.turn() === "b") {
      bottomTimer.classList.add("active");
      topTimer.classList.remove("active");
    } else {
      topTimer.classList.add("active");
      bottomTimer.classList.remove("active");
    }
  } else {
    bottomTimer.innerText = whiteTime;
    topTimer.innerText = blackTime;
    if (chess.turn() === "w") {
      bottomTimer.classList.add("active");
      topTimer.classList.remove("active");
    } else {
      topTimer.classList.add("active");
      bottomTimer.classList.remove("active");
    }
  }
};

const updateCapturedPieces = () => {
  const board = chess.board();
  const currentPieces = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  board.forEach((row) => {
    row.forEach((square) => {
      if (square) currentPieces[square.color][square.type]++;
    });
  });
  const startPieces = { p: 8, n: 2, b: 2, r: 2, q: 1 };

  const createHtml = (color) => {
    let html = "";
    const map = {
      p: color === "w" ? "♙" : "♟",
      n: color === "w" ? "♘" : "♞",
      b: color === "w" ? "♗" : "♝",
      r: color === "w" ? "♖" : "♜",
      q: color === "w" ? "♕" : "♛",
    };
    for (const type in startPieces) {
      const count = startPieces[type] - currentPieces[color][type];
      for (let i = 0; i < count; i++) {
        html += `<span class="captured-piece" style="color:${color === "w" ? "white" : "black"}">${map[type]}</span>`;
      }
    }
    return html;
  };

  let bottomHtml = createHtml("b");
  let topHtml = createHtml("w");
  if (playerRole === "b") {
    bottomHtml = createHtml("w");
    topHtml = createHtml("b");
  }
  document.getElementById("bottom-captured").innerHTML = bottomHtml;
  document.getElementById("top-captured").innerHTML = topHtml;
};

renderBoard();
