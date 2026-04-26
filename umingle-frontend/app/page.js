"use client";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Peer from "simple-peer";

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isMatchingRef = useRef(false); // Prevent multiple match attempts

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" },
  ];

  // Add TURN if credentials exist
  if (process.env.NEXT_PUBLIC_TURN_USERNAME && process.env.NEXT_PUBLIC_TURN_CREDENTIAL) {
    iceServers.push({
      urls: [
        "turn:global.relay.metered.ca:80",
        "turn:global.relay.metered.ca:443",
        "turns:global.relay.metered.ca:443?transport=tcp"
      ],
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }

  const getLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      setStatus("idle");
      throw error;
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [status]);

  const cleanupPeer = () => {
    if (peerRef.current) {
      peerRef.current.removeAllListeners();
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const startChat = async () => {
    if (isMatchingRef.current) return; // Prevent multiple start attempts
    isMatchingRef.current = true;
    
    try {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      const stream = await getLocalStream();
      
      const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_SERVER || window.location.origin;
      socketRef.current = io(signalingUrl, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socketRef.current.on("connect", () => {
        console.log("Socket connected");
        socketRef.current.emit("find_match");
      });

      socketRef.current.on("waiting", () => {
        setStatus("waiting");
        setMessages([]);
        isMatchingRef.current = false;
      });

      socketRef.current.on("matched", ({ room, initiator }) => {
        console.log("Matched in room:", room);
        roomRef.current = room;
        setStatus("connected");
        setMessages([]);
        isMatchingRef.current = false;

        // Remove old signal listeners
        socketRef.current.off("signal");
        
        // Clean up existing peer
        cleanupPeer();

        const peer = new Peer({
          initiator,
          trickle: true,
          stream: stream,
          config: { iceServers },
        });

        peer.on("signal", (data) => {
          if (socketRef.current && roomRef.current) {
            socketRef.current.emit("signal", { room: roomRef.current, data });
          }
        });

        peer.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });

        peer.on("error", (err) => {
          console.error("Peer error:", err);
          cleanupPeer();
          if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit("find_match");
          }
        });

        peer.on("connect", () => {
          console.log("Peer connected successfully");
        });

        socketRef.current.on("signal", ({ data }) => {
          if (peerRef.current && !peerRef.current.destroyed) {
            peerRef.current.signal(data);
          } else if (peer && !peer.destroyed) {
            peer.signal(data);
          }
        });

        peerRef.current = peer;
      });

      socketRef.current.on("partner_skipped", () => {
        console.log("Partner skipped");
        cleanupPeer();
        roomRef.current = null;
        setMessages([]);
        setStatus("waiting");
        setTimeout(() => {
          if (socketRef.current && socketRef.current.connected && !roomRef.current) {
            socketRef.current.emit("find_match");
          }
        }, 500);
      });

      socketRef.current.on("partner_left", () => {
        console.log("Partner left");
        cleanupPeer();
        roomRef.current = null;
        setMessages([]);
        setStatus("waiting");
        setTimeout(() => {
          if (socketRef.current && socketRef.current.connected && !roomRef.current) {
            socketRef.current.emit("find_match");
          }
        }, 500);
      });

      socketRef.current.on("message", ({ text }) => {
        setMessages((prev) => [...prev, { from: "stranger", text }]);
      });

      socketRef.current.on("connect_error", (error) => {
        console.error("Socket connect error:", error);
        setStatus("idle");
        isMatchingRef.current = false;
      });

      socketRef.current.on("disconnect", () => {
        console.log("Socket disconnected");
        cleanupPeer();
        roomRef.current = null;
        setStatus("idle");
        isMatchingRef.current = false;
      });

    } catch (error) {
      console.error("Error starting chat:", error);
      setStatus("idle");
      isMatchingRef.current = false;
    }
  };

  const skipPartner = () => {
    cleanupPeer();
    
    if (socketRef.current && roomRef.current && socketRef.current.connected) {
      socketRef.current.emit("skip", { room: roomRef.current });
    }
    
    roomRef.current = null;
    setStatus("waiting");
    setMessages([]);
  };

  const stopChat = () => {
    cleanupPeer();
    isMatchingRef.current = false;
    
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    
    setStatus("idle");
    setMessages([]);
    roomRef.current = null;
  };

  const sendMessage = () => {
    if (!inputText.trim() || status !== "connected") return;
    if (socketRef.current && roomRef.current && socketRef.current.connected) {
      socketRef.current.emit("message", {
        room: roomRef.current,
        text: inputText,
      });
      setMessages((prev) => [...prev, { from: "you", text: inputText }]);
      setInputText("");
    }
  };

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
      }
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  const isWaiting = status === "waiting";

  return (
    <main className="min-h-screen min-h-dvh bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 flex-shrink-0">
        <h1 className="text-xl sm:text-2xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          Umingle
        </h1>
        {(status === "waiting" || status === "connected") && (
          <button
            onClick={stopChat}
            className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white h-9 w-9 rounded-full font-medium transition-all duration-200 flex items-center justify-center text-sm"
          >
            ✕
          </button>
        )}
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-4 pb-4">
        {status === "idle" && (
          <button
            onClick={startChat}
            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 active:scale-95 text-white px-8 sm:px-10 py-3 sm:py-4 rounded-full text-base sm:text-lg font-semibold shadow-xl transition-all duration-300 hover:scale-105"
          >
            ✨ Start Chat
          </button>
        )}

        {(status === "connected" || status === "waiting") && (
          <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-3 sm:gap-4 lg:gap-6 lg:items-stretch">
            <div className="w-full lg:flex-1 lg:min-w-0">
              <div className="relative bg-black/40 rounded-2xl overflow-hidden border border-white/10 shadow-2xl w-full">
                {isWaiting ? (
                  <div className="flex flex-col items-center justify-center gap-4 w-full aspect-video min-h-[200px] sm:min-h-[280px]">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-gray-300 text-sm sm:text-lg animate-pulse">
                      Looking for someone...
                    </p>
                  </div>
                ) : (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full aspect-video object-cover min-h-[200px] sm:min-h-[280px]"
                  />
                )}
                <div className="absolute top-3 left-3 bg-black/60 rounded-full px-2.5 py-1 text-xs font-medium flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Stranger
                </div>
                <div className="absolute top-3 right-3 w-20 sm:w-28 md:w-32 lg:w-36 aspect-video rounded-xl overflow-hidden shadow-lg border-2 border-blue-400/50 bg-black/50">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                </div>
              </div>
            </div>

            <div
              className="w-full lg:w-80 xl:w-96 flex flex-col bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl overflow-hidden"
              style={{ height: "clamp(260px, 40vw, 420px)" }}
            >
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2 flex-shrink-0">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <h3 className="font-semibold text-gray-200 text-sm sm:text-base">Live Chat</h3>
              </div>

              <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400 text-xs sm:text-sm italic">
                    {isWaiting
                      ? "Waiting for a match..."
                      : "Say hello to start the conversation"}
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.from === "you" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs sm:text-sm shadow-md break-words ${
                          msg.from === "you"
                            ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                            : "bg-white/10 text-gray-200"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="flex items-center gap-2 p-2 sm:p-3 border-t border-white/10 flex-shrink-0">
                <button
                  onClick={skipPartner}
                  className="flex-shrink-0 px-2.5 sm:px-3 h-10 text-xs sm:text-sm bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-95 text-white font-semibold rounded-xl transition-all duration-200 whitespace-nowrap"
                >
                  Next ›
                </button>

                <input
                  className="flex-1 min-w-0 text-xs sm:text-sm bg-white/10 border border-white/20 rounded-full px-3 sm:px-4 py-2 outline-none focus:ring-2 focus:ring-blue-400/50 placeholder:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  placeholder={isWaiting ? "Waiting for match..." : "Type a message..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  disabled={isWaiting}
                />

                <button
                  onClick={sendMessage}
                  disabled={isWaiting}
                  className="flex-shrink-0 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 active:scale-95 text-white w-10 h-10 rounded-full transition-all duration-200 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  <svg className="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
          }
