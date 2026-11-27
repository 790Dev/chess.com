const express = require("express");
const socket = require("socket.io");
const http = require("http");
const { Chess } = require("chess.js");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socket(server);

const chess = new Chess();

let players = { white: null, black: null };
let playerReady = { white: false, black: false };
let currentTurn = "w";
let gameActive = false;

let timerInterval = null;
let timeLimit = 180; // 3-minute Blitz mode default
let timers = { w: 180, b: 180 };
let timeSet = false;

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("index", { title: "Chess Game" });
});

io.on("connection", function (uniquesocket) {
  if (!players.white) {
    players.white = uniquesocket.id;
    uniquesocket.emit("playerRole", "w");
  } else if (!players.black) {
    players.black = uniquesocket.id;
    uniquesocket.emit("playerRole", "b");
  } else {
    uniquesocket.emit("spectatorRole");
  }

  uniquesocket.emit("boardState", chess.fen());

  if (timeSet) {
    uniquesocket.emit("timeSelected", timeLimit);
  }

  uniquesocket.on("selectTime", (minutes) => {
    if (uniquesocket.id === players.white && !gameActive) {
      timeLimit = minutes * 60;
      timers.w = timeLimit;
      timers.b = timeLimit;
      timeSet = true;
      io.emit("timeSelected", timeLimit);
    }
  });

  uniquesocket.on("playerReady", () => {
    if (uniquesocket.id === players.white) playerReady.white = true;
    if (uniquesocket.id === players.black) playerReady.black = true;

    io.emit("updateReadyState", playerReady);

    if (playerReady.white && playerReady.black) {
      startCountdown();
    }
  });

  uniquesocket.on("move", (move) => {
    if (!gameActive) return;

    try {
      if (chess.turn() === "w" && uniquesocket.id !== players.white) return;
      if (chess.turn() === "b" && uniquesocket.id !== players.black) return;

      const result = chess.move(move);
      if (result) {
        currentTurn = chess.turn();
        io.emit("move", move);
        io.emit("boardState", chess.fen());
      } else {
        uniquesocket.emit("invalidMove", move);
      }
    } catch (err) {
      uniquesocket.emit("invalidMove", move);
    }
  });

  uniquesocket.on("disconnect", function () {
    if (uniquesocket.id === players.white) {
      delete players.white;
      playerReady.white = false;
      if (gameActive) {
        io.emit("gameOver", { winner: "Black", reason: "White disconnected" });
        endGame();
      }
    } else if (uniquesocket.id === players.black) {
      delete players.black;
      playerReady.black = false;
      if (gameActive) {
        io.emit("gameOver", { winner: "White", reason: "Black disconnected" });
        endGame();
      }
    }

    if (!players.white && !players.black) {
      resetServerState();
    }
  });
});

function startCountdown() {
  let count = 3;
  io.emit("countdown", count);

  const countInterval = setInterval(() => {
    count--;
    io.emit("countdown", count);

    if (count < 0) {
      clearInterval(countInterval);
      startGame();
    }
  }, 1000);
}

function startGame() {
  gameActive = true;
  io.emit("startGame");

  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (!gameActive) return;

    timers[currentTurn]--;
    io.emit("timerUpdate", timers);

    if (timers[currentTurn] <= 0) {
      const winner = currentTurn === "w" ? "Black" : "White";
      io.emit("gameOver", { winner: winner, reason: "Time ran out" });
      endGame();
    }
  }, 1000);
}

function endGame() {
  gameActive = false;
  clearInterval(timerInterval);
}

function resetServerState() {
  endGame();
  timeSet = false;
  playerReady = { white: false, black: false };
  chess.reset();
  currentTurn = "w";
  timers = { w: 600, b: 600 };
}

server.listen(3000, function () {
  console.log(`Server is running on 3000`);
});
