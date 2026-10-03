const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {}; // id -> { id, slot, score, x, y, prevX, prevY, vx, vy, radius }
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
        players[socket.id] = { 
            id: socket.id, 
            slot: slot, 
            score: 0, 
            x: 0, y: 0, 
            prevX: 0, prevY: 0,
            vx: 0, vy: 0,
            radius: 20 
        };
        socket.emit('assigned-slot', slot);
    } else {
        socket.emit('full');
    }

    io.emit('state', { players, puck });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            let p = players[socket.id];
            p.prevX = p.x;
            p.prevY = p.y;
            p.x = data.x; // -1 til 1
            p.y = data.y; // -1 til 1
            p.vx = p.x - p.prevX; // Beregn målvaktens hastighet
            p.vy = p.y - p.prevY;
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

// Spill-loop med fysikk og kollisjon
setInterval(() => {
    puck.x += puck.vx;
    puck.y += puck.vy;

    // Friksjon på pucken
    puck.vx *= 0.995;
    puck.vy *= 0.995;

    const x1 = 60, x2 = 740, y1 = 60, y2 = 540;

    // Sjekk kollisjon og mål for hver spiller
    for (let id in players) {
        let p = players[id];
        let gx = 0, gy = 0;
        let goalStartX = 0, goalEndX = 0, goalStartY = 0, goalEndY = 0;

        // Beregn absolutt posisjon for sirkel-målvakten basert på slot
        if (p.slot === 0) { // Venstre kortside
            gx = x1 + (p.x * 20); // Kan bevege seg litt inn/ut
            gy = ((y1 + y2) / 2) + (p.y * 180); // Opp og ned i målet
            goalStartY = y1 + 100; goalEndY = y2 - 100;
            
            // Målsjekk (hvis pucken går forbi venstre vegg)
            if (puck.x - puck.radius < x1 && puck.y >= goalStartY && puck.y <= goalEndY) {
                p.score -= 1;
                resetPuck();
            }
        } 
        else if (p.slot === 3) { // Høyre kortside
            gx = x2 - (p.x * 20);
            gy = ((y1 + y2) / 2) + (p.y * 180);
            goalStartY = y1 + 100; goalEndY = y2 - 100;

            if (puck.x + puck.radius > x2 && puck.y >= goalStartY && puck.y <= goalEndY) {
                p.score -= 1;
                resetPuck();
            }
        }
        else if (p.slot === 1 || p.slot === 2) { // Topp-vegg
            let sectionWidth = (x2 - x1) / 2;
            let startX = p.slot === 1 ? x1 : x1 + sectionWidth;
            gx = (startX + sectionWidth / 2) + (p.x * (sectionWidth / 2 - 30));
            gy = y1 + (p.y * 20);
            goalStartX = startX + 50; goalEndX = startX + sectionWidth - 50;

            if (puck.y - puck.radius < y1 && puck.x >= goalStartX && puck.x <= goalEndX) {
                p.score -= 1;
                resetPuck();
            }
        }
        else if (p.slot === 4 || p.slot === 5) { // Bunn-vegg (Slot 5: venstre, Slot 4: høyre)
            let sectionWidth = (x2 - x1) / 2;
            let startX = p.slot === 5 ? x1 : x1 + sectionWidth;
            gx = (startX + sectionWidth / 2) + (p.x * (sectionWidth / 2 - 30));
            gy = y2 - (p.y * 20);
            goalStartX = startX + 50; goalEndX = startX + sectionWidth - 50;

            if (puck.y + puck.radius > y2 && puck.x >= goalStartX && puck.x <= goalEndX) {
                p.score -= 1;
                resetPuck();
            }
        }

        p.absX = gx;
        p.absY = gy;

        // Sirkel-til-sirkel kollisjon mellom puck og målvakt
        let dx = puck.x - gx;
        let dy = puck.y - gy;
        let distance = Math.sqrt(dx * dx + dy * dy);
        let minDist = puck.radius + p.radius;

        if (distance < minDist) {
            // Normalisert kollisjonsvektor
            let nx = dx / distance;
            let ny = dy / distance;

            // Skyv pucken ut så de ikke henger fast
            let overlap = minDist - distance;
            puck.x += nx * overlap;
            puck.y += ny * overlap;

            // Beregn sprett med tilskudd fra målvaktens egen bevegelseshastighet (fysikk-boost)
            let dot = puck.vx * nx + puck.vy * ny;
            puck.vx = (puck.vx - 2 * dot * nx) + (p.vx * 12);
            puck.vy = (puck.vy - 2 * dot * ny) + (p.vy * 12);
        }
    }

    // Standard veggsprett i ytterkanter der det ikke er mål
    if (puck.x < x1) { puck.vx *= -1; puck.x = x1; }
    if (puck.x > x2) { puck.vx *= -1; puck.x = x2; }
    if (puck.y < y1) { puck.vy *= -1; puck.y = y1; }
    if (puck.y > y2) { puck.vy *= -1; puck.y = y2; }

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