const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {}; 
let puck = { x: 400, y: 300, vx: 0, vy: 0, radius: 12 };
let gameStarted = false;

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
                io.emit('state', { players, puck, gameStarted });
            } else if (availableSlots.length === 0) {
                socket.emit('full');
            }
        } catch (err) {
            console.error('Feil i set-name:', err);
        }
    });

    socket.on('move', (data) => {
        try {
            if (players[socket.id] && data) {
                players[socket.id].vx = data.vx || 0;
                players[socket.id].vy = data.vy || 0;
            }
        } catch (err) {
            console.error('Feil i move:', err);
        }
    });

    socket.on('start-game', () => {
        gameStarted = true;
        resetPuck();
        io.emit('state', { players, puck, gameStarted });
    });

    socket.on('disconnect', () => {
        try {
            if (players[socket.id]) {
                availableSlots.push(players[socket.id].slot);
                availableSlots.sort((a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b));
                delete players[socket.id];
            }
            if (Object.keys(players).length === 0) {
                gameStarted = false;
                puck.vx = 0;
                puck.vy = 0;
                puck.x = 400;
                puck.y = 300;
            }
            io.emit('state', { players, puck, gameStarted });
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

        // 1. Flytt spillere basert på hastighet
        for (let id in players) {
            let p = players[id];
            if (!p) continue;
            p.x += p.vx;
            p.y += p.vy;

            // Hold spillerne innenfor banen
            p.x = Math.max(x1 + p.radius, Math.min(x2 - p.radius, p.x));
            p.y = Math.max(y1 + p.radius, Math.min(y2 - p.radius, p.y));
        }

        if (!gameStarted) {
            io.emit('state', { players, puck, gameStarted });
            return;
        }

        puck.x += puck.vx;
        puck.y += puck.vy;

        const minSpeed = 4;
        let currentSpeed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
        if (currentSpeed < minSpeed && currentSpeed > 0) {
            puck.vx = (puck.vx / currentSpeed) * minSpeed;
            puck.vy = (puck.vy / currentSpeed) * minSpeed;
        }

        let goalScored = false;
        let goalStartY = 300 - goalSizeHalf; 
        let goalEndY = 300 + goalSizeHalf;

        // Kartlegg hvilke slots som har aktive spillere
        let slotPlayers = {};
        for (let id in players) {
            slotPlayers[players[id].slot] = players[id];
        }

        // Sjekk venstre mål / vegg (Slot 0)
        if (puck.x - puck.radius <= x1 && puck.y >= goalStartY && puck.y <= goalEndY) {
            if (slotPlayers[0]) {
                slotPlayers[0].score -= 1;
                goalScored = true;
            } else {
                puck.vx *= -1;
                puck.x = x1 + puck.radius;
            }
        }
        // Sjekk høyre mål / vegg (Slot 3)
        else if (puck.x + puck.radius >= x2 && puck.y >= goalStartY && puck.y <= goalEndY) {
            if (slotPlayers[3]) {
                slotPlayers[3].score -= 1;
                goalScored = true;
            } else {
                puck.vx *= -1;
                puck.x = x2 - puck.radius;
            }
        }
        else {
            if (puck.x - puck.radius < x1) {
                puck.vx *= -1;
                puck.x = x1 + puck.radius;
            } else if (puck.x + puck.radius > x2) {
                puck.vx *= -1;
                puck.x = x2 - puck.radius;
            }
        }

        // Toppmål (Slot 1 og 2)
        let topGoal1StartX = x1 + sectionWidth * 0.25 - goalSizeHalf;
        let topGoal1EndX = topGoal1StartX + (goalSizeHalf * 2);
        let topGoal2StartX = x1 + sectionWidth * 1.25 - goalSizeHalf;
        let topGoal2EndX = topGoal2StartX + (goalSizeHalf * 2);

        if (puck.y - puck.radius <= y1) {
            if (puck.x >= topGoal1StartX && puck.x <= topGoal1EndX) {
                if (slotPlayers[1]) {
                    slotPlayers[1].score -= 1;
                    goalScored = true;
                } else {
                    puck.vy *= -1;
                    puck.y = y1 + puck.radius;
                }
            } else if (puck.x >= topGoal2StartX && puck.x <= topGoal2EndX) {
                if (slotPlayers[2]) {
                    slotPlayers[2].score -= 1;
                    goalScored = true;
                } else {
                    puck.vy *= -1;
                    puck.y = y1 + puck.radius;
                }
            } else {
                puck.vy *= -1;
                puck.y = y1 + puck.radius;
            }
        }

        // Bunnmål (Slot 5 og 4)
        let bottomGoal5StartX = x1 + sectionWidth * 0.25 - goalSizeHalf;
        let bottomGoal5EndX = bottomGoal5StartX + (goalSizeHalf * 2);
        let bottomGoal4StartX = x1 + sectionWidth * 1.25 - goalSizeHalf;
        let bottomGoal4EndX = bottomGoal4StartX + (goalSizeHalf * 2);

        if (puck.y + puck.radius >= y2) {
            if (puck.x >= bottomGoal5StartX && puck.x <= bottomGoal5EndX) {
                if (slotPlayers[5]) {
                    slotPlayers[5].score -= 1;
                    goalScored = true;
                } else {
                    puck.vy *= -1;
                    puck.y = y2 - puck.radius;
                }
            } else if (puck.x >= bottomGoal4StartX && puck.x <= bottomGoal4EndX) {
                if (slotPlayers[4]) {
                    slotPlayers[4].score -= 1;
                    goalScored = true;
                } else {
                    puck.vy *= -1;
                    puck.y = y2 - puck.radius;
                }
            } else {
                puck.vy *= -1;
                puck.y = y2 - puck.radius;
            }
        }

        if (goalScored) {
            resetPuck();
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

        io.emit('state', { players, puck, gameStarted });
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