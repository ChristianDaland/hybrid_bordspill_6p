const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {}; // id -> { id, slot, score, x, y }
let puck = {
    x: 400,
    y: 300,
    vx: 3,
    vy: 2,
    radius: 12
};

// 6 plasser: 
// 0: Venstre kortside
// 1: Langside topp (venstre del)
// 2: Langside topp (høyre del)
// 3: Høyre kortside
// 4: Langside bunn (høyre del)
// 5: Langside bunn (venstre del)
let availableSlots = [0, 1, 2, 3, 4, 5];

io.on('connection', (socket) => {
    console.log('En spiller koblet til:', socket.id);

    if (availableSlots.length > 0) {
        let slot = availableSlots.shift();
        players[socket.id] = { id: socket.id, slot: slot, score: 0, pos: 50 };
        socket.emit('assigned-slot', slot);
    } else {
        socket.emit('full');
    }

    io.emit('state', { players, puck });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].pos = data.pos; // 0 til 100 langs sin vegg
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            availableSlots.push(players[socket.id].slot);
            availableSlots.sort();
            delete players[socket.id];
        }
        io.emit('state', { players, puck });
        console.log('Spiller koblet fra:', socket.id);
    });
});

// Enkel spill-loop for puck-fysikk
setInterval(() => {
    puck.x += puck.vx;
    puck.y += puck.vy;

    // Enkel veggkollisjon (banen er f.eks. 800x600)
    if (puck.x < 15 || puck.x > 785) puck.vx *= -1;
    if (puck.y < 15 || puck.y > 585) puck.vy *= -1;

    io.emit('state', { players, puck });
}, 1000 / 60);

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server kjører på port ${PORT}`);
});