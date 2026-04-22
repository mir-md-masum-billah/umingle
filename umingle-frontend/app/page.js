"use client";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Peer from "simple-peer";

export default function Home() {
  const [status, setStatus] = useState("idle"); // idle, waiting, connected
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomRef = useRef(null);

  const iceServers = [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    },
  ];

  const getLocalStream = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localStreamRef.current = stream;
    return stream;
  };

  useEffect(() => {
    if (localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [status]);

  const startChat = async () => {
    const stream = await getLocalStream();

    socketRef.current = io(process.env.NEXT_PUBLIC_SIGNALING_SERVER);

    socketRef.current.on("waiting", () => setStatus("waiting"));

    socketRef.current.on("matched", ({ room, initiator }) => {
      roomRef.current = room;
      setStatus("connected");
      setMessages([]);

      socketRef.current.off("signal");

      const peer = new Peer({
        initiator,
        trickle: true,
        stream,
        config: { iceServers },
      });

      peer.on("signal", (data) => {
        socketRef.current.emit("signal", { room, data });
      });

      peer.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      });

      socketRef.current.on("signal", ({ data }) => {
        if (peerRef.current && !peerRef.current.destroyed) {
          peerRef.current.signal(data);
        }
      });

      peerRef.current = peer;
    });

    socketRef.current.on("partner_skipped", () => {
      cleanupPeer();
      setStatus("waiting");
      socketRef.current.emit("find_match");
    });
    socketRef.current.on("partner_left", () => {
      cleanupPeer();
      setMessages([]);
      setStatus("waiting");
      socketRef.current.emit("find_match");
    });
    socketRef.current.on("message", ({ text }) => {
      setMessages((prev) => [...prev, { from: "stranger", text }]);
    });

    socketRef.current.emit("find_match");
  };

  const cleanupPeer = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const skipPartner = () => {
    cleanupPeer();
    socketRef.current.emit("skip", { room: roomRef.current });
    setStatus("waiting");
    socketRef.current.emit("find_match");
  };

  const stopChat = () => {
    cleanupPeer();
    if (socketRef.current) socketRef.current.disconnect();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    setStatus("idle");
    setMessages([]);
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;
    socketRef.current.emit("message", {
      room: roomRef.current,
      text: inputText,
    });
    setMessages((prev) => [...prev, { from: "you", text: inputText }]);
    setInputText("");
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      {/* Header */}
      <div className="container mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-screen">
        <div className="text-center mb-12 space-y-3">
          <h1 className="text-5xl md:text-7xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Umingle
          </h1>
          <p className="text-gray-300 text-sm md:text-base">
            Connect with someone new in real-time
          </p>
        </div>

        {/* Status Section */}
        <div className="flex flex-col items-center gap-6 w-full max-w-md">
          {status === "idle" && (
            <button
              onClick={startChat}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white px-10 py-4 rounded-full text-lg font-semibold shadow-xl transition-all duration-300 hover:scale-105"
            >
              ✨ Start Chat
            </button>
          )}

          {status === "waiting" && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-300 text-lg animate-pulse">
                Looking for someone...
              </p>
            </div>
          )}

          {(status === "waiting" || status === "connected") && (
            <button
              onClick={stopChat}
              className="bg-red-500/80 hover:bg-red-600 text-white px-8 py-2.5 rounded-full font-medium transition-all duration-300"
            >
              ✕ Disconnect
            </button>
          )}
        </div>

        {/* Connected UI */}
        {status === "connected" && (
          <div className="w-full max-w-6xl mt-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Video Section */}
              <div className="lg:col-span-2 space-y-4">
                <div className="relative bg-black/40 rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full aspect-video object-cover"
                  />
                  <div className="absolute top-4 left-4 bg-black/60 rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Stranger
                  </div>
                  <div className="absolute bottom-4 right-4 w-32 md:w-40 aspect-video rounded-xl overflow-hidden shadow-lg border-2 border-blue-400/50 bg-black/50">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-center text-white text-[10px] py-1">
                      You
                    </div>
                  </div>
                </div>
                <button
                  onClick={skipPartner}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-3 rounded-xl transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"></path>
                  </svg>
                  Next Partner
                </button>
              </div>

              {/* Chat Section */}
              <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl flex flex-col h-[500px] lg:h-auto overflow-hidden">
                <div className="p-4 border-b border-white/10 flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <h3 className="font-semibold text-gray-200">Live Chat</h3>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.from === "you" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm shadow-md ${
                          msg.from === "you"
                            ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-br-none"
                            : "bg-white/10 text-gray-200 rounded-bl-none"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {messages.length === 0 && (
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm italic">
                      Say hello to start the conversation
                    </div>
                  )}
                </div>
                
                <div className="p-4 border-t border-white/10">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-white/10 border border-white/20 rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/50 placeholder:text-gray-400"
                      placeholder="Type a message..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                    />
                    <button
                      onClick={sendMessage}
                      className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white px-5 rounded-full transition-all duration-300 flex items-center justify-center"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}