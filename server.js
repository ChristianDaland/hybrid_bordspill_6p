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
    vx: 4,
    vy: 3,
    radius: 12
};

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
            availableSlots.sort((a, b) => a - b);
            delete players[socket.id];
        }
        io.emit('state', { players, puck });
        console.log('Spiller koblet fra:', socket.id);
    });
});

// Spill-loop med kollisjon og mål
setInterval(() => {
    puck.x += puck.vx;
    puck.y += puck.vy;

    const x1 = 60, x2 = 740, y1 = 60, y2 = 540;
    const pWidth = 80;
    const pHeight = 16;

    // Sjekk kollisjon og mål for hver spiller
    for (let id in players) {
        let p = players[id];
        let posRatio = p.pos / 100;

        if (p.slot === 0) { // Venstre kortside
            let py = y1 + posRatio * (y2 - y1 - pWidth);
            // Sjekk treff på planke
            if (puck.x - puck.radius <= x1 + pHeight && puck.y >= py && puck.y <= py + pWidth) {
                puck.vx *= -1;
                puck.x = x1 + pHeight + puck.radius;
            }
            // Sjekk mål (gikk forbi venstre vegg)
            else if (puck.x < x1) {
                p.score -= 1; // Straff for å slippe inn mål
                resetPuck();
            }
        } 
        else if (p.slot === 3) { // Høyre kortside
            let py = y1 + posRatio * (y2 - y1 - pWidth);
            // Sjekk treff på planke
            if (puck.x + puck.radius >= x2 - pHeight && puck.y >= py && puck.y <= py + pWidth) {
                puck.vx *= -1;
                puck.x = x2 - pHeight - puck.radius;
            }
            // Sjekk mål (gikk forbi høyre vegg)
            else if (puck.x > x2) {
                p.score -= 1;
                resetPuck();
            }
        }
        else if (p.slot === 1 || p.slot === 2) { // Topp-vegg
            let sectionWidth = (x2 - x1) / 2;
            let startX = p.slot === 1 ? x1 : x1 + sectionWidth;
            let px = startX + posRatio * (sectionWidth - pWidth);

            // Treff på planke
            if (puck.y - puck.radius <= y1 + pHeight && puck.x >= px && puck.x <= px + pWidth) {
                puck.vy *= -1;
                puck.y = y1 + pHeight + puck.radius;
            }
            // Mål (gikk over toppveggen i denne spillerens sone)
            else if (puck.y < y1 && puck.x >= startX && puck.x <= startX + sectionWidth) {
                p.score -= 1;
                resetPuck();
            }
        }
        else if (p.slot === 4 || p.slot === 5) { // Bunn-vegg (Slot 4: høyre, Slot 5: venstre)
            let sectionWidth = (x2 - x1) / 2;
            let startX = p.slot === 5 ? x1 : x1 + sectionWidth;
            let px = startX + posRatio * (sectionWidth - pWidth);

            // Treff på planke
            if (puck.y + puck.radius >= y2 - pHeight && puck.x >= px && puck.x <= px + pWidth) {
                puck.vy *= -1;
                puck.y = y2 - pHeight - puck.radius;
            }
            // Mål (gikk ut i bunnveggen i denne spillerens sone)
            else if (puck.y > y2 && puck.x >= startX && puck.x <= startX + sectionWidth) {
                p.score -= 1;
                resetPuck();
            }
        }
    }

    // Generell sprett i hjørner/vegger der det ikke er aktive spillere
    if (puck.x < x1 + 5 || puck.x > x2 - 5) puck.vx *= -1;
    if (puck.y < y1 + 5 || puck.y > y2 - 5) puck.vy *= -1;

    io.emit('state', { players, puck });
}, 1000 / 60);

function resetPuck() {
    puck.x = 400;
    puck.y = 300;
    puck.vx = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 2);
    puck.vy = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 2);
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server kjører på port ${PORT}`);
});