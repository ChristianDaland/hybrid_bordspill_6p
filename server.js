const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {}; // id -> { id, slot, score, pos }
let puck = {
    x: 400,
    y: 300,
    vx: 3,
    vy: 2,
    radius: 12
};

// 6 plasser:
// 0: Venstre kortside
// 1: Langside topp (venstre halvdel)
// 2: Langside topp (høyre halvdel)
// 3: Høyre kortside
// 4: Langside bunn (høyre halvdel)
// 5: Langside bunn (venstre halvdel)
let availableSlots = [0, 1, 2, 3, 4, 5];

io.on('connection', (socket) => {
    console.log('Spiller koblet til:', socket.id);

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
            players[socket.id].pos = data.pos; // 0 til 100
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

// Spill-loop med enkel kollisjon
setInterval(() => {
    puck.x += puck.vx;
    puck.y += puck.vy;

    // Standard veggkollisjon (800x600 bane, ramme fra x:50 til 750, y:50 til 550)
    const minX = 60, maxX = 740, minY = 60, maxY = 540;

    if (puck.x < minX || puck.x > maxX) {
        puck.vx *= -1;
        puck.x = Math.max(minX, Math.min(maxX, puck.x));
    }
    if (puck.y < minY || puck.y > maxY) {
        puck.vy *= -1;
        puck.y = Math.max(minY, Math.min(maxY, puck.y));
    }

    io.emit('state', { players, puck });
}, 1000 / 60);

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server kjører på port ${PORT}`);
});