const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {}; 
let puck = { x: 400, y: 300, vx: 0, vy: 0, radius: 12 };

const SLOT_PRIORITY = [1, 4, 5, 2, 0, 3];
let availableSlots = [...SLOT_PRIORITY];

io.on('connection', (socket) => {
    console.log('Klient koblet til:', socket.id);

    socket.on('set-name', (name) => {
        if (!players[socket.id] && availableSlots.length > 0) {
            let slot = availableSlots.shift();
            players[socket.id] = { 
                id: socket.id, 
                slot: slot, 
                name: name || `Spiller ${slot + 1}`,
                score: 0, 
                x: 400, y: 300, // Starter på midten
                radius: 20 
            };
            socket.emit('assigned-slot', slot);
            io.emit('state', { players, puck });
        } else if (availableSlots.length === 0) {
            socket.emit('full');
        }
    });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            let p = players[socket.id];
            // Spillere kan bevege seg fritt innenfor banen (60 til 740 i X, 60 til 540 i Y)
            p.x = Math.max(80, Math.min(720, data.x));
            p.y = Math.max(80, Math.min(520, data.y));
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            availableSlots.push(players[socket.id].slot);
            availableSlots.sort((a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b));
            delete players[socket.id];
        }
        
        if (Object.keys(players).length === 0) {
            puck.vx = 0;
            puck.vy = 0;
            puck.x = 400;
            puck.y = 300;
        }

        io.emit('state', { players, puck });
        console.log('Spiller koblet fra:', socket.id);
    });
});

setInterval(() => {
    if (Object.keys(players).length === 0) {
        io.emit('state', { players, puck });
        return;
    }

    if (puck.vx === 0 && puck.vy === 0) {
        resetPuck();
    }

    puck.x += puck.vx;
    puck.y += puck.vy;

    const minSpeed = 4;
    let currentSpeed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
    if (currentSpeed < minSpeed && currentSpeed > 0) {
        puck.vx = (puck.vx / currentSpeed) * minSpeed;
        puck.vy = (puck.vy / currentSpeed) * minSpeed;
    } else if (currentSpeed === 0) {
        puck.vx = 5;
        puck.vy = 3;
    }

    const x1 = 60, x2 = 740, y1 = 60, y2 = 540;
    const sectionWidth = (x2 - x1) / 2;
    const goalSizeHalf = 55;

    // Sjekk mål for hver sone
    for (let slot = 0; slot < 6; slot++) {
        let activePlayer = null;
        for (let id in players) {
            if (players[id].slot === slot) {
                activePlayer = players[id];
                break;
            }
        }

        if (activePlayer) {
            let goalStartY = 0, goalEndY = 0, goalStartX = 0, goalEndX = 0;

            if (slot === 0) {
                goalStartY = 300 - goalSizeHalf; goalEndY = 300 + goalSizeHalf;
                if (puck.x - puck.radius < x1 && puck.y >= goalStartY && puck.y <= goalEndY) {
                    activePlayer.score -= 1;
                    resetPuck();
                }
            } else if (slot === 3) {
                goalStartY = 300 - goalSizeHalf; goalEndY = 300 + goalSizeHalf;
                if (puck.x + puck.radius > x2 && puck.y >= goalStartY && puck.y <= goalEndY) {
                    activePlayer.score -= 1;
                    resetPuck();
                }
            } else if (slot === 1 || slot === 2) {
                let startX = slot === 1 ? x1 : x1 + sectionWidth;
                goalStartX = startX + sectionWidth/2 - goalSizeHalf; 
                goalEndX = startX + sectionWidth/2 + goalSize/2;
                if (puck.y - puck.radius < y1 && puck.x >= goalStartX && puck.x <= goalEndX) {
                    activePlayer.score -= 1;
                    resetPuck();
                }
            } else if (slot === 4 || slot === 5) {
                let startX = slot === 5 ? x1 : x1 + sectionWidth;
                goalStartX = startX + sectionWidth/2 - goalSizeHalf; 
                goalEndX = startX + sectionWidth/2 + goalSize/2;
                if (puck.y + puck.radius > y2 && puck.x >= goalStartX && puck.x <= goalEndX) {
                    activePlayer.score -= 1;
                    resetPuck();
                }
            }
        } else {
            // Solid vegg der det ikke er noen spiller
            if (slot === 0 && puck.x - puck.radius <= x1) { puck.vx *= -1; puck.x = x1 + puck.radius; }
            else if (slot === 3 && puck.x + puck.radius >= x2) { puck.vx *= -1; puck.x = x2 - puck.radius; }
            else if ((slot === 1 || slot === 2) && puck.y - puck.radius <= y1) {
                let startX = slot === 1 ? x1 : x1 + sectionWidth;
                if (puck.x >= startX && puck.x <= startX + sectionWidth) { puck.vy *= -1; puck.y = y1 + puck.radius; }
            }
            else if ((slot === 4 || slot === 5) && puck.y + puck.radius >= y2) {
                let startX = slot === 5 ? x1 : x1 + sectionWidth;
                if (puck.x >= startX && puck.x <= startX + sectionWidth) { puck.vy *= -1; puck.y = y2 - puck.radius; }
            }
        }
    }

    // Standard kollisjon for spillere (brikker som dytter pucken)
    for (let id in players) {
        let p = players[id];
        let dx = puck.x - p.x;
        let dy = puck.y - p.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        let minDist = puck.radius + p.radius;

        if (distance < minDist) {
            let nx = dx / distance;
            let ny = dy / distance;
            let overlap = minDist - distance;
            puck.x += nx * overlap;
            puck.y += ny * overlap;

            let dot = puck.vx * nx + puck.vy * ny;
            puck.vx = (puck.vx - 2 * dot * nx) * 1.1;
            puck.vy = (puck.vy - 2 * dot * ny) * 1.1;
        }
    }

    if (puck.x < x1) { puck.vx *= -1; puck.x = x1; }
    if (puck.x > x2) { puck.vx *= -1; puck.x = x2; }
    if (puck.y < y1) { puck.vy *= -1; puck.y = y1; }
    if (puck.y > y2) { puck.vy *= -1; puck.y = y2; }

    io.emit('state', { players, puck });
}, 1000 / 60);

function resetPuck() {
    puck.x = 400;
    puck.y = 300;
    puck.vx = (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 2);
    puck.vy = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 2);
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server kjører på port ${PORT}`);
});