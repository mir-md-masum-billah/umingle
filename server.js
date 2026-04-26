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

// Cleanup function - proper room cleanup
function cleanupRoom(roomId) {
  const roomData = rooms.get(roomId);
  if (!roomData) return;
  
  const { sockets } = roomData;
  
  sockets.forEach((socket) => {
    if (socket && socket.connected) {
      socket.currentRoom = null;
      socket.leave(roomId);
    }
  });
  
  rooms.delete(roomId);
  console.log(`Room ${roomId} cleaned up. Remaining rooms: ${rooms.size}`);
}

// Remove disconnected sockets from queue
function cleanWaitingQueue() {
  const before = waitingQueue.length;
  waitingQueue = waitingQueue.filter(socket => socket && socket.connected);
  if (before !== waitingQueue.length) {
    console.log(`Queue cleaned: ${before} -> ${waitingQueue.length}`);
  }
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  let matchAttemptTimeout = null;

  // Main matching logic
  socket.on("find_match", () => {
    console.log(`Find match called: ${socket.id}`);
    
    // Clear previous match attempt timeout
    if (matchAttemptTimeout) clearTimeout(matchAttemptTimeout);
    
    // Clean queue before matching
    cleanWaitingQueue();
    
    // If already in a room, cleanup first
    if (socket.currentRoom) {
      const oldRoom = socket.currentRoom;
      if (rooms.has(oldRoom)) {
        const roomData = rooms.get(oldRoom);
        const partner = roomData.sockets.find(s => s.id !== socket.id);
        if (partner && partner.connected) {
          partner.emit("partner_left");
          partner.currentRoom = null;
        }
      }
      cleanupRoom(socket.currentRoom);
      socket.currentRoom = null;
    }
    
    // Remove from waiting queue if already there
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    
    // Check if someone is waiting
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      
      // Verify partner is still connected
      if (!partner || !partner.connected) {
        console.log(`Partner ${partner?.id} disconnected, retrying match`);
        socket.emit("find_match");
        return;
      }
      
      // Create unique room ID
      const roomId = `room_${Date.now()}_${socket.id}_${partner.id}`;
      
      // Join both to room
      socket.join(roomId);
      partner.join(roomId);
      
      // Store room data
      rooms.set(roomId, {
        sockets: [socket, partner],
        createdAt: Date.now()
      });
      
      // Set current room for both
      socket.currentRoom = roomId;
      partner.currentRoom = roomId;
      
      // Emit matched events
      socket.emit("matched", { room: roomId, initiator: false });
      partner.emit("matched", { room: roomId, initiator: true });
      
      console.log(`✅ Matched: ${socket.id} <-> ${partner.id} in room ${roomId}`);
    } else {
      // Add to waiting queue
      waitingQueue.push(socket);
      socket.emit("waiting");
      console.log(`Added to queue: ${socket.id}. Queue size: ${waitingQueue.length}`);
    }
  });

  // Signal handling (WebRTC)
  socket.on("signal", ({ room, data }) => {
    if (!room || !rooms.has(room)) {
      console.log(`Signal received for invalid room: ${room}`);
      return;
    }
    socket.to(room).emit("signal", { data });
  });

  // Message handling
  socket.on("message", ({ room, text }) => {
    if (!room || !rooms.has(room)) {
      console.log(`Message for invalid room: ${room}`);
      return;
    }
    socket.to(room).emit("message", { text });
  });

  // Skip partner
  socket.on("skip", ({ room }) => {
    console.log(`Skip request: ${socket.id} from room ${room}`);
    
    if (!room || !rooms.has(room)) {
      console.log(`Skip: Room ${room} not found`);
      socket.emit("find_match");
      return;
    }
    
    const roomData = rooms.get(room);
    const partner = roomData.sockets.find(s => s.id !== socket.id);
    
    // Notify partner if connected
    if (partner && partner.connected) {
      partner.emit("partner_skipped");
      partner.currentRoom = null;
    }
    
    // Cleanup room
    cleanupRoom(room);
    socket.currentRoom = null;
    
    // Find new match for current user
    setTimeout(() => {
      if (socket.connected && !socket.currentRoom) {
        console.log(`Auto-finding new match for ${socket.id} after skip`);
        socket.emit("find_match");
      }
    }, 100);
  });

  // Disconnect handling - CRITICAL FIX
  socket.on("disconnect", () => {
    console.log(`⚠️ User disconnected: ${socket.id}`);
    
    // Remove from waiting queue
    waitingQueue = waitingQueue.filter(s => s && s.id !== socket.id);
    
    // Handle if in a room
    if (socket.currentRoom && rooms.has(socket.currentRoom)) {
      const roomId = socket.currentRoom;
      const roomData = rooms.get(roomId);
      
      if (roomData) {
        const partner = roomData.sockets.find(s => s && s.id !== socket.id);
        
        if (partner && partner.connected) {
          console.log(`Notifying partner ${partner.id} about disconnect`);
          partner.emit("partner_left");
          partner.currentRoom = null;
          
          // Auto find new match for partner after disconnect
          setTimeout(() => {
            if (partner.connected && !partner.currentRoom) {
              console.log(`Auto-finding new match for ${partner.id}`);
              partner.emit("find_match");
            }
          }, 500);
        }
      }
      
      // Cleanup the room
      cleanupRoom(roomId);
    }
    
    // Clear any pending timeouts
    if (matchAttemptTimeout) clearTimeout(matchAttemptTimeout);
    
    console.log(`Queue size after disconnect: ${waitingQueue.length}`);
  });
  
  // Error handling
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Periodic queue cleanup (every 10 seconds)
setInterval(() => {
  const before = waitingQueue.length;
  waitingQueue = waitingQueue.filter(socket => socket && socket.connected);
  if (before !== waitingQueue.length) {
    console.log(`Periodic queue cleanup: ${before} -> ${waitingQueue.length}`);
  }
  
  // Clean up old rooms (older than 1 hour)
  const now = Date.now();
  for (const [roomId, roomData] of rooms.entries()) {
    if (now - roomData.createdAt > 3600000) { // 1 hour
      console.log(`Cleaning old room: ${roomId}`);
      cleanupRoom(roomId);
    }
  }
}, 10000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Signaling server running on port ${PORT}`);
});
