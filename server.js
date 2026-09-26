const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let customTasks = [
  "Water the biology class plant",
  "Count 10 lockers on the 2nd floor",
  "Wipe the main hallway whiteboard",
  "Throw away 1 piece of trash in the cafeteria"
];

let gameState = {
  status: 'LOBBY',
  players: {},
  impostorId: null,
  deadBodies: [],
  votes: {}
};

io.on('connection', (socket) => {
  socket.on('addTask', (taskText) => {
    if (taskText.trim()) {
      customTasks.push(taskText.trim());
      io.emit('tasksUpdated', customTasks);
    }
  });

  socket.on('getTasks', () => {
    socket.emit('tasksUpdated', customTasks);
  });

  socket.on('joinGame', (name) => {
    gameState.players[socket.id] = {
      id: socket.id,
      name: name,
      role: 'Crewmate',
      alive: true,
      tasks: []
    };
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('startGame', () => {
    const ids = Object.keys(gameState.players);
    if (ids.length < 3) return;

    const impostorIndex = Math.floor(Math.random() * ids.length);
    gameState.impostorId = ids[impostorIndex];

    ids.forEach((id) => {
      const player = gameState.players[id];
      player.alive = true;
      player.role = (id === gameState.impostorId) ? 'Impostor' : 'Crewmate';

      if (player.role === 'Crewmate') {
        const shuffled = [...customTasks].sort(() => 0.5 - Math.random());
        player.tasks = shuffled.slice(0, 3).map(t => ({ text: t, done: false }));
      }
    });

    gameState.status = 'PLAYING';
    gameState.deadBodies = [];
    io.emit('gameStarted');
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
      reporter: gameState.players[socket.id]?.name,
      victim: victimName
    });
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('callEmergencyMeeting', () => {
    if (gameState.status !== 'PLAYING') return;
    gameState.status = 'MEETING';

    io.emit('notifyEmergencyMeeting', {
      caller: gameState.players[socket.id]?.name
    });
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('completeTask', (taskIndex) => {
    const player = gameState.players[socket.id];
    if (player && player.tasks[taskIndex]) {
      player.tasks[taskIndex].done = true;
      io.emit('stateUpdate', getPublicState());
    }
  });

  socket.on('castVote', (targetId) => {
    if (gameState.status === 'MEETING' && gameState.players[socket.id]?.alive) {
      gameState.votes[socket.id] = targetId;

      const activePlayers = Object.values(gameState.players).filter(p => p.alive);
      if (Object.keys(gameState.votes).length >= activePlayers.length) {
        gameState.status = 'PLAYING';
        gameState.votes = {};
        io.emit('stateUpdate', getPublicState());
      }
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
      role: p.role
    }))
  };
}

server.listen(3000, () => console.log('Server active on port 3000'));
