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
  pingTimeout: 10000,  // 10 সেকেন্ড পরে disconnect ধরবে
  pingInterval: 5000,  // প্রতি 5 সেকেন্ডে ping করবে
});

let waitingQueue = [];
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find_match", () => {
    waitingQueue = waitingQueue.filter((s) => s.connected);

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const room = `room_${socket.id}_${partner.id}`;

      socket.join(room);
      partner.join(room);

      rooms.set(room, [socket, partner]);

      socket.emit("matched", { room, initiator: false });
      partner.emit("matched", { room, initiator: true });

      socket.currentRoom = room;
      partner.currentRoom = room;

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
    socket.to(room).emit("partner_skipped");
    socket.leave(room);
    rooms.delete(room);
  });

  socket.on("disconnect", () => {
    waitingQueue = waitingQueue.filter((s) => s.id !== socket.id);

    if (socket.currentRoom) {
      const room = socket.currentRoom;
      socket.to(room).emit("partner_left");
      rooms.delete(room);
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});