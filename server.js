const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Default master task pool
let masterTaskPool = [
  "Water the biology class plant",
  "Count 10 lockers on the 2nd floor",
  "Wipe the main hallway whiteboard",
  "Throw away 1 piece of trash in the cafeteria",
  "Inspect the library bookshelf",
  "Check the gym door lock",
  "Clean the teacher's desk whiteboard eraser",
  "Count the steps on the main staircase"
];

let gameState = {
  status: 'LOBBY',
  players: {},
  impostorId: null,
  deadBodies: [],
  votes: {}
};

io.on('connection', (socket) => {
  // Sync tasks on connect
  socket.emit('tasksUpdated', masterTaskPool);

  socket.on('addTask', (taskText) => {
    if (taskText && taskText.trim()) {
      masterTaskPool.push(taskText.trim());
      io.emit('tasksUpdated', masterTaskPool);
    }
  });

  socket.on('getTasks', () => {
    socket.emit('tasksUpdated', masterTaskPool);
  });

  socket.on('joinGame', (name) => {
    gameState.players[socket.id] = {
      id: socket.id,
      name: name || `Player-${socket.id.substring(0, 4)}`,
      role: 'Crewmate',
      alive: true,
      tasks: []
    };
    io.emit('stateUpdate', getPublicState());
  });

  // START GAME (Triggers from PC Host or Phone)
  socket.on('startGame', () => {
    const playerIds = Object.keys(gameState.players);

    // If fewer than 2 players, alert clients and prevent start
    if (playerIds.length < 2) {
      io.emit('gameStartError', 'At least 2 players are needed to start!');
      return;
    }

    // 1. Pick 1 Impostor randomly
    const impostorIndex = Math.floor(Math.random() * playerIds.length);
    gameState.impostorId = playerIds[impostorIndex];

    // 2. Assign Roles and Unique Randomized Tasks
    playerIds.forEach((id) => {
      const player = gameState.players[id];
      player.alive = true;
      player.role = (id === gameState.impostorId) ? 'Impostor' : 'Crewmate';

      if (player.role === 'Crewmate') {
        // Shuffle master task pool randomly for each individual player
        const shuffled = [...masterTaskPool].sort(() => 0.5 - Math.random());
        // Select 3 unique randomized tasks
        const assignedTasks = shuffled.slice(0, 3);
        player.tasks = assignedTasks.map(t => ({ text: t, done: false }));
      } else {
        player.tasks = []; // Impostor gets no real tasks
      }
    });

    gameState.status = 'PLAYING';
    gameState.deadBodies = [];
    gameState.votes = {};

    io.emit('gameStarted');
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('hostForceMeeting', () => {
    if (gameState.status === 'PLAYING') {
      gameState.status = 'MEETING';
      io.emit('notifyEmergencyMeeting', { caller: 'HOST CONTROL' });
      io.emit('stateUpdate', getPublicState());
    }
  });

  socket.on('hostEndGame', () => {
    gameState.status = 'LOBBY';
    gameState.deadBodies = [];
    gameState.votes = {};
    Object.values(gameState.players).forEach(p => {
      p.alive = true;
      p.role = 'Crewmate';
      p.tasks = [];
    });
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('killPlayer', (targetId) => {
    const killer = gameState.players[socket.id];
    const victim = gameState.players[targetId];

    if (killer?.role === 'Impostor' && killer?.alive && victim?.alive) {
      victim.alive = false;
      gameState.deadBodies.push({ id: victim.id, name: victim.name });

      io.to(victim.id).emit('youDied');
      io.emit('stateUpdate', getPublicState());
    }
  });

  socket.on('reportDeadBody', (victimName) => {
    if (gameState.status !== 'PLAYING') return;
    gameState.status = 'MEETING';

    io.emit('notifyBodyFound', {
      reporter: gameState.players[socket.id]?.name || 'A player',
      victim: victimName
    });
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('callEmergencyMeeting', () => {
    if (gameState.status !== 'PLAYING') return;
    gameState.status = 'MEETING';

    io.emit('notifyEmergencyMeeting', {
      caller: gameState.players[socket.id]?.name || 'A player'
    });
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('completeTask', (taskIndex) => {
    const player = gameState.players[socket.id];
    if (player && player.tasks[taskIndex] && player.role === 'Crewmate') {
      player.tasks[taskIndex].done = true;
      io.emit('stateUpdate', getPublicState());
    }
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    io.emit('stateUpdate', getPublicState());
  });
});

function getPublicState() {
  return {
    status: gameState.status,
    deadBodies: gameState.deadBodies,
    players: Object.values(gameState.players).map(p => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: p.role,
      tasks: p.tasks
    }))
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
