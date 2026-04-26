const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

let waitingQueue = [];
const rooms = new Map(); // room -> { sockets: [socket1, socket2], createdAt: timestamp }

// Proper room cleanup
function cleanupRoom(roomId) {
  const roomData = rooms.get(roomId);
  if (!roomData) return;

  roomData.sockets.forEach((socket) => {
    if (socket) {
      socket.currentRoom = null;
      // connected socket কে leave করাও, disconnected socket automatically leave করে
      if (socket.connected) socket.leave(roomId);
    }
  });

  rooms.delete(roomId);
  console.log(`Room ${roomId} cleaned up. Remaining rooms: ${rooms.size}`);
}

// Queue থেকে disconnected socket সরাও
function cleanWaitingQueue() {
  const before = waitingQueue.length;
  waitingQueue = waitingQueue.filter((s) => s && s.connected);
  if (before !== waitingQueue.length) {
    console.log(`Queue cleaned: ${before} -> ${waitingQueue.length}`);
  }
}

// FIX: Matching logic আলাদা function এ — server-side retry সহজ হয়,
// client emit এর উপর নির্ভর করতে হয় না
function tryMatch(socket) {
  cleanWaitingQueue();

  // Queue থেকে নিজেকে বাদ দাও (duplicate entry এড়াতে)
  waitingQueue = waitingQueue.filter((s) => s.id !== socket.id);

  // Disconnected partner skip করে পরের জন কে নাও
  while (waitingQueue.length > 0) {
    const partner = waitingQueue.shift();
    if (!partner || !partner.connected) continue;

    const roomId = `room_${Date.now()}_${socket.id}_${partner.id}`;

    socket.join(roomId);
    partner.join(roomId);

    rooms.set(roomId, {
      sockets: [socket, partner],
      createdAt: Date.now(),
    });

    socket.currentRoom = roomId;
    partner.currentRoom = roomId;

    socket.emit("matched", { room: roomId, initiator: false });
    partner.emit("matched", { room: roomId, initiator: true });

    console.log(`✅ Matched: ${socket.id} <-> ${partner.id} in room ${roomId}`);
    return;
  }

  // কেউ নেই — queue তে রাখো
  waitingQueue.push(socket);
  socket.emit("waiting");
  console.log(`Added to queue: ${socket.id}. Queue size: ${waitingQueue.length}`);
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("find_match", () => {
    console.log(`Find match called: ${socket.id}`);

    // আগের room এ থাকলে আগে সেটা clean করো
    if (socket.currentRoom) {
      const oldRoom = socket.currentRoom;
      if (rooms.has(oldRoom)) {
        const roomData = rooms.get(oldRoom);
        const partner = roomData.sockets.find((s) => s.id !== socket.id);
        if (partner && partner.connected) {
          partner.emit("partner_left");
          partner.currentRoom = null;
        }
      }
      cleanupRoom(oldRoom);
      socket.currentRoom = null;
    }

    // FIX: server-side tryMatch — disconnected partner হলে loop করে পরের জন নেয়
    tryMatch(socket);
  });

  // WebRTC signal
  socket.on("signal", ({ room, data }) => {
    if (!room || !rooms.has(room)) {
      console.log(`Signal received for invalid room: ${room}`);
      return;
    }
    socket.to(room).emit("signal", { data });
  });

  // Chat message
  socket.on("message", ({ room, text }) => {
    if (!room || !rooms.has(room)) {
      console.log(`Message for invalid room: ${room}`);
      return;
    }
    socket.to(room).emit("message", { text });
  });

  // Partner skip
  socket.on("skip", ({ room }) => {
    console.log(`Skip request: ${socket.id} from room ${room}`);

    if (!room || !rooms.has(room)) {
      // Room নেই — সরাসরি নতুন match খোঁজো
      tryMatch(socket);
      return;
    }

    const roomData = rooms.get(room);
    const partner = roomData.sockets.find((s) => s.id !== socket.id);

    // Partner কে জানাও
    if (partner && partner.connected) {
      partner.emit("partner_skipped");
    }

    // Room cleanup করো (উভয়ের currentRoom null হবে)
    cleanupRoom(room);

    // FIX: client emit নয় — server-side directly নতুন match খোঁজো
    setTimeout(() => {
      if (socket.connected && !socket.currentRoom) {
        tryMatch(socket);
      }
    }, 100);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`⚠️ User disconnected: ${socket.id}`);

    waitingQueue = waitingQueue.filter((s) => s && s.id !== socket.id);

    if (socket.currentRoom && rooms.has(socket.currentRoom)) {
      const roomId = socket.currentRoom;
      const roomData = rooms.get(roomId);

      if (roomData) {
        const partner = roomData.sockets.find((s) => s && s.id !== socket.id);

        if (partner && partner.connected) {
          console.log(`Notifying partner ${partner.id} about disconnect`);
          partner.emit("partner_left");
          // FIX: server থেকে partner এ "find_match" emit করা হয় না
          // কারণ client এই event listen করে না — partner_left handler এ
          // client নিজেই find_match emit করবে
        }
      }

      cleanupRoom(roomId);
    }

    // disconnecting socket এর currentRoom clear করো
    socket.currentRoom = null;

    console.log(`Queue size after disconnect: ${waitingQueue.length}`);
  });

  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Periodic cleanup (every 10 seconds)
setInterval(() => {
  cleanWaitingQueue();

  // ১ ঘণ্টার বেশি পুরনো room সরাও
  const now = Date.now();
  for (const [roomId, roomData] of rooms.entries()) {
    if (now - roomData.createdAt > 3600000) {
      console.log(`Cleaning old room: ${roomId}`);
      cleanupRoom(roomId);
    }
  }
}, 10000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Signaling server running on port ${PORT}`);
});
