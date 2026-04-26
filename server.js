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
  },
});

let waitingQueue = [];
const rooms = new Map(); // room -> [socket1, socket2]

// Helper: socket এবং তার partner কে room থেকে properly বের করো
function cleanupRoom(room, rooms) {
  const roomSockets = rooms.get(room);
  if (!roomSockets) return;

  roomSockets.forEach((s) => {
    s.leave(room);
    s.currentRoom = null;
  });

  rooms.delete(room);
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find_match", () => {
    // Disconnected socket গুলো queue থেকে সরাও
    waitingQueue = waitingQueue.filter((s) => s.connected);

    // আগের room এ থাকলে আগে সেটা clean করো
    if (socket.currentRoom) {
      cleanupRoom(socket.currentRoom, rooms);
    }

    // ইতিমধ্যে queue তে থাকলে দুইবার add করো না
    if (waitingQueue.some((s) => s.id === socket.id)) {
      return;
    }

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const room = `room_${socket.id}_${partner.id}`;

      socket.join(room);
      partner.join(room);

      rooms.set(room, [socket, partner]);

      socket.currentRoom = room;
      partner.currentRoom = room;

      socket.emit("matched", { room, initiator: false });
      partner.emit("matched", { room, initiator: true });

      console.log(`Matched: ${socket.id} <-> ${partner.id}`);
    } else {
      waitingQueue.push(socket);
      socket.emit("waiting");
    }
  });

  socket.on("signal", ({ room, data }) => {
    socket.to(room).emit("signal", { data });
  });

  socket.on("message", ({ room, text }) => {
    socket.to(room).emit("message", { text });
  });

  socket.on("skip", ({ room }) => {
    // Partner কে জানাও তার আগে
    socket.to(room).emit("partner_skipped");

    // উভয় socket কে room থেকে বের করো এবং currentRoom clear করো
    cleanupRoom(room, rooms);
  });

  socket.on("disconnect", () => {
    // Queue থেকে সরাও
    waitingQueue = waitingQueue.filter((s) => s.id !== socket.id);

    // যদি কোনো room এ ছিল, partner কে জানাও এবং room clean করো
    if (socket.currentRoom) {
      const room = socket.currentRoom;
      const roomSockets = rooms.get(room);

      if (roomSockets) {
        const partner = roomSockets.find((s) => s.id !== socket.id);
        if (partner) {
          partner.emit("partner_left");
          partner.leave(room);
          partner.currentRoom = null;
        }
        rooms.delete(room);
      }

      socket.currentRoom = null;
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
