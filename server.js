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
  pingTimeout: 60000, // 60 seconds ping timeout
  pingInterval: 25000, // 25 seconds ping interval
});

let waitingQueue = [];
const rooms = new Map(); // room -> { sockets: [socket1, socket2], createdAt: timestamp }

// Cleanup inactive sockets from queue periodically
setInterval(() => {
  waitingQueue = waitingQueue.filter((s) => s && s.connected);
}, 30000); // Clean every 30 seconds

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.currentRoom = null;

  socket.on("find_match", () => {
    // Clean queue before finding match
    waitingQueue = waitingQueue.filter((s) => s && s.connected);

    // If user already in a room, don't find new match
    if (socket.currentRoom) {
      console.log("User already in room, ignoring find_match:", socket.id);
      return;
    }

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      
      // Double check partner is still connected
      if (!partner || !partner.connected) {
        // Partner disconnected, try again
        socket.emit("find_match");
        return;
      }
      
      const room = `room_${Date.now()}_${socket.id}`;

      socket.join(room);
      partner.join(room);

      rooms.set(room, {
        sockets: [socket, partner],
        createdAt: Date.now(),
      });

      socket.emit("matched", { room, initiator: false });
      partner.emit("matched", { room, initiator: true });

      socket.currentRoom = room;
      partner.currentRoom = room;

      console.log(`Matched: ${socket.id} <-> ${partner.id} in room ${room}`);
    } else {
      waitingQueue.push(socket);
      socket.emit("waiting");
      console.log(`User ${socket.id} added to waiting queue`);
    }
  });

  socket.on("signal", ({ room, data }) => {
    if (room && socket.currentRoom === room) {
      socket.to(room).emit("signal", { data });
    }
  });

  socket.on("message", ({ room, text }) => {
    if (room && socket.currentRoom === room && text && text.trim()) {
      socket.to(room).emit("message", { text: text.trim() });
    }
  });

  socket.on("skip", ({ room }) => {
    if (room && socket.currentRoom === room) {
      const roomData = rooms.get(room);
      if (roomData) {
        const partner = roomData.sockets.find((s) => s.id !== socket.id);
        
        socket.to(room).emit("partner_skipped");
        socket.leave(room);
        
        if (partner && partner.connected) {
          partner.leave(room);
          partner.currentRoom = null;
          // Auto re-queue partner for new match
          setTimeout(() => {
            if (partner && partner.connected && !partner.currentRoom) {
              partner.emit("find_match");
            }
          }, 500);
        }
        
        rooms.delete(room);
        socket.currentRoom = null;
        console.log(`User ${socket.id} skipped partner in room ${room}`);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    
    // Remove from waiting queue
    waitingQueue = waitingQueue.filter((s) => s && s.id !== socket.id);

    // Handle room cleanup if user was in a room
    if (socket.currentRoom) {
      const room = socket.currentRoom;
      const roomData = rooms.get(room);
      
      if (roomData) {
        const partner = roomData.sockets.find((s) => s.id !== socket.id);
        
        if (partner && partner.connected) {
          socket.to(room).emit("partner_left");
          partner.currentRoom = null;
          
          // Auto re-queue partner
          setTimeout(() => {
            if (partner && partner.connected && !partner.currentRoom) {
              partner.emit("find_match");
            }
          }, 500);
        }
        
        rooms.delete(room);
      }
      
      socket.currentRoom = null;
      socket.leave(room);
    }
  });
  
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Waiting for connections...`);
});
