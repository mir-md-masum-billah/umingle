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
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find_match", () => {
    // clean queue
    waitingQueue = waitingQueue.filter((s) => s.connected);

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
    const users = rooms.get(room);

    if (users) {
      users.forEach((user) => {
        user.leave(room);
        user.currentRoom = null;
      });
    }

    socket.to(room).emit("partner_skipped");
    rooms.delete(room);
  });

  socket.on("disconnect", () => {
    waitingQueue = waitingQueue.filter((s) => s.id !== socket.id);

    if (socket.currentRoom) {
      const room = socket.currentRoom;

      socket.to(room).emit("partner_left");

      const users = rooms.get(room);
      if (users) {
        users.forEach((user) => {
          user.leave(room);
          user.currentRoom = null;
        });
      }

      rooms.delete(room);
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
