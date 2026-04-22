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
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    return stream;
  };

  const startChat = async () => {
    const stream = await getLocalStream();

    socketRef.current = io(process.env.NEXT_PUBLIC_SIGNALING_SERVER);

    socketRef.current.on("waiting", () => setStatus("waiting"));

    socketRef.current.on("matched", ({ room, initiator }) => {
      roomRef.current = room;
      setStatus("connected");
      setMessages([]);

      // পুরনো signal listener সরাও
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
    <main className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-4xl font-bold mb-6 text-blue-400">Umingle</h1>

      {status === "idle" && (
        <button
          onClick={startChat}
          className="bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 rounded-full text-xl"
        >
          Start Chat
        </button>
      )}

      {status === "waiting" && (
        <p className="text-gray-400 text-lg animate-pulse">
          Looking for someone...
        </p>
      )}

      {(status === "waiting" || status === "connected") && (
        <button
          onClick={stopChat}
          className="mt-4 bg-red-500 hover:bg-red-600 px-6 py-2 rounded-full"
        >
          Stop
        </button>
      )}

      {status === "connected" && (
        <div className="w-full max-w-4xl mt-6 flex flex-col md:flex-row gap-4">
          {/* Videos */}
          <div className="flex flex-col gap-3 flex-1">
            <div className="relative w-full">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full bg-black rounded-xl"
              />
              <span className="absolute top-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded-full">Stranger</span>

              <div className="absolute bottom-2 right-2 w-32">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full bg-black rounded-xl border-2 border-blue-400"
                />
                <span className="text-center block text-white text-xs mt-1">You</span>
              </div>
            </div>
            <button
              onClick={skipPartner}
              className="bg-yellow-500 hover:bg-yellow-600 px-6 py-2 rounded-full"
            >
              Next →
            </button>
          </div>

          {/* Chat */}
          <div className="flex flex-col w-full md:w-72 bg-gray-800 rounded-xl p-3 gap-2">
            <div className="flex-1 overflow-y-auto h-64 flex flex-col gap-1">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm px-3 py-1 rounded-full max-w-xs ${msg.from === "you"
                    ? "bg-blue-500 self-end"
                    : "bg-gray-600 self-start"
                    }`}
                >
                  {msg.text}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-gray-700 rounded-full px-3 py-1 text-sm outline-none"
                placeholder="Type a message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              />
              <button
                onClick={sendMessage}
                className="bg-blue-500 px-3 py-1 rounded-full text-sm"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}