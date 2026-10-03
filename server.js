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
    vx: 0,
    vy: 0,
    radius: 12
};

const SLOT_PRIORITY = [1, 4, 5, 2, 0, 3];
let availableSlots = [...SLOT_PRIORITY];

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
        
        // Hvis dette er den første spilleren som kobler seg til, sett i gang pucken!
        if (Object.keys(players).length === 1) {
            resetPuck();
        }
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
            p.vx = p.x - p.prevX; 
            p.vy = p.y - p.prevY;
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            availableSlots.push(players[socket.id].slot);
            availableSlots.sort((a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b));
            delete players[socket.id];
        }
        
        // Hvis alle spillere kobler seg fra, stopp pucken og nullstill hastighet
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

// Spill-loop med fysikk
setInterval(() => {
    // Ikke kjør fysikk eller tell poeng hvis det ikke er noen spillere tilkoblet
    if (Object.keys(players).length === 0) {
        io.emit('state', { players, puck });
        return;
    }

    puck.x += puck.vx;
    puck.y += puck.vy;

    // Sørg for at pucken aldri stopper helt opp når spillet er aktivt
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

    // Sjekk alle 6 soner (0 til 5)
    for (let slot = 0; slot < 6; slot++) {
        let activePlayer = null;
        for (let id in players) {
            if (players[id].slot === slot) {
                activePlayer = players[id];
                break;
            }
        }

        if (activePlayer) {
            let p = activePlayer;
            let gx = 0, gy = 0;
            let goalStartX = 0, goalEndX = 0, goalStartY = 0, goalEndY = 0;

            if (slot === 0) {
                gx = x1 + (p.x * 20);
                gy = ((y1 + y2) / 2) + (p.y * 180);
                goalStartY = y1 + 100; goalEndY = y2 - 100;

                if (puck.x - puck.radius < x1 && puck.y >= goalStartY && puck.y <= goalEndY) {
                    p.score -= 1;
                    resetPuck();
                }
            } 
            else if (slot === 3) {
                gx = x2 - (p.x * 20);
                gy = ((y1 + y2) / 2) + (p.y * 180);
                goalStartY = y1 + 100; goalEndY = y2 - 100;

                if (puck.x + puck.radius > x2 && puck.y >= goalStartY && puck.y <= goalEndY) {
                    p.score -= 1;
                    resetPuck();
                }
            }
            else if (slot === 1 || slot === 2) {
                let startX = slot === 1 ? x1 : x1 + sectionWidth;
                gx = (startX + sectionWidth / 2) + (p.x * (sectionWidth / 2 - 30));
                gy = y1 + (p.y * 20);
                goalStartX = startX + 50; goalEndX = startX + sectionWidth - 50;

                if (puck.y - puck.radius < y1 && puck.x >= goalStartX && puck.x <= goalEndX) {
                    p.score -= 1;
                    resetPuck();
                }
            }
            else if (slot === 4 || slot === 5) {
                let startX = slot === 5 ? x1 : x1 + sectionWidth;
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

            // Kollisjon med målvakten
            let dx = puck.x - gx;
            let dy = puck.y - gy;
            let distance = Math.sqrt(dx * dx + dy * dy);
            let minDist = puck.radius + p.radius;

            if (distance < minDist) {
                let nx = dx / distance;
                let ny = dy / distance;
                let overlap = minDist - distance;
                puck.x += nx * overlap;
                puck.y += ny * overlap;

                let dot = puck.vx * nx + puck.vy * ny;
                puck.vx = (puck.vx - 2 * dot * nx) + (p.vx * 12);
                puck.vy = (puck.vy - 2 * dot * ny) + (p.vy * 12);
            }
        } else {
            // Vegg der det ikke er aktive spillere
            if (slot === 0) {
                if (puck.x - puck.radius <= x1) {
                    if (puck.y >= y1 + 100 && puck.y <= y2 - 100) {
                        resetPuck();
                    } else {
                        puck.vx *= -1;
                        puck.x = x1 + puck.radius;
                    }
                }
            }
            else if (slot === 3) {
                if (puck.x + puck.radius >= x2) {
                    if (puck.y >= y1 + 100 && puck.y <= y2 - 100) {
                        resetPuck();
                    } else {
                        puck.vx *= -1;
                        puck.x = x2 - puck.radius;
                    }
                }
            }
            else if (slot === 1 || slot === 2) {
                let startX = slot === 1 ? x1 : x1 + sectionWidth;
                if (puck.y - puck.radius <= y1) {
                    if (puck.x >= startX + 50 && puck.x <= startX + sectionWidth - 50) {
                        resetPuck();
                    } else {
                        puck.vy *= -1;
                        puck.y = y1 + puck.radius;
                    }
                }
            }
            else if (slot === 4 || slot === 5) {
                let startX = slot === 5 ? x1 : x1 + sectionWidth;
                if (puck.y + puck.radius >= y2) {
                    if (puck.x >= startX + 50 && puck.x <= startX + sectionWidth - 50) {
                        resetPuck();
                    } else {
                        puck.vy *= -1;
                        puck.y = y2 - puck.radius;
                    }
                }
            }
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