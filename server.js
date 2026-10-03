const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {}; 
let puck = { x: 400, y: 300, vx: 4, vy: 3, radius: 12 };

const SLOT_PRIORITY = [1, 4, 5, 2, 0, 3];
let availableSlots = [...SLOT_PRIORITY];

io.on('connection', (socket) => {
    console.log('Klient koblet til:', socket.id);

    socket.on('set-name', (name) => {
        try {
            if (!players[socket.id] && availableSlots.length > 0) {
                let slot = availableSlots.shift();
                players[socket.id] = { 
                    id: socket.id, 
                    slot: slot, 
                    name: name || `Spiller ${slot + 1}`,
                    score: 0, 
                    x: 400, 
                    y: 300, 
                    vx: 0,
                    vy: 0,
                    radius: 20 
                };
                socket.emit('assigned-slot', slot);
                io.emit('state', { players, puck });
            } else if (availableSlots.length === 0) {
                socket.emit('full');
            }
        } catch (err) {
            console.error('Feil i set-name:', err);
        }
    });

    // Motta hastighet/retning fra mobil-joysticken
    socket.on('move', (data) => {
        try {
            if (players[socket.id] && data) {
                let p = players[socket.id];
                p.vx = data.vx || 0;
                p.vy = data.vy || 0;
            }
        } catch (err) {
            console.error('Feil i move:', err);
        }
    });

    socket.on('disconnect', () => {
        try {
            if (players[socket.id]) {
                availableSlots.push(players[socket.id].slot);
                availableSlots.sort((a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b));
                delete players[socket.id];
            }
            io.emit('state', { players, puck });
        } catch (err) {
            console.error('Feil ved disconnect:', err);
        }
    });
});

setInterval(() => {
    try {
        const x1 = 60, x2 = 740, y1 = 60, y2 = 540;
        const sectionWidth = (x2 - x1) / 2;
        const goalSizeHalf = 55;

        // Flytt spillere basert på hastighet fra mobilen
        for (let id in players) {
            let p = players[id];
            if (!p) continue;
            p.x += p.vx;
            p.y += p.vy;

            // Hold spillerne innenfor banen
            p.x = Math.max(x1 + p.radius, Math.min(x2 - p.radius, p.x));
            p.y = Math.max(y1 + p.radius, Math.min(y2 - p.radius, p.y));
        }

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
        }

        // Sjekk mål for hver sone
        for (let slot = 0; slot < 6; slot++) {
            let activePlayer = null;
            for (let id in players) {
                if (players[id] && players[id].slot === slot) {
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

        // Kollisjon mellom spillere og puck
        for (let id in players) {
            let p = players[id];
            if (!p) continue;
            let dx = puck.x - p.x;
            let dy = puck.y - p.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            let minDist = puck.radius + p.radius;

            if (distance < minDist && distance > 0) {
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
    } catch (err) {
        console.error('Feil i hovedløkken (setInterval):', err);
    }
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