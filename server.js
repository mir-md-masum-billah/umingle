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

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find_match", () => {
    // আগের queue থেকে disconnected socket সরাও
    waitingQueue = waitingQueue.filter((s) => s.connected);

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const room = `room_${socket.id}_${partner.id}`;

      socket.join(room);
      partner.join(room);

      rooms.set(room, [socket, partner]);

      socket.emit("matched", { room, initiator: false });
      partner.emit("matched", { room, initiator: true });

      // Room এ কে আছে track করো
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
    // Queue থেকে সরাও
    waitingQueue = waitingQueue.filter((s) => s.id !== socket.id);

    // যদি কোনো room এ ছিল, partner কে জানাও
    // এবং partner কে auto re-search এ পাঠাও
    if (socket.currentRoom) {
      const room = socket.currentRoom;
      socket.to(room).emit("partner_left"); // partner চলে গেছে
      rooms.delete(room);
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
