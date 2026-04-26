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
  const localStreamRef = useRef(null);
  const roomRef = useRef(null);
  const messagesEndRef = useRef(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
  ];

  // ✅ Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ✅ Get media
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
    } catch (err) {
      alert("Camera/Microphone permission denied");
      throw err;
    }
  };

  const cleanupPeer = () => {
    if (peerRef.current && !peerRef.current.destroyed) {
      peerRef.current.destroy();
    }
    peerRef.current = null;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const startChat = async () => {
    if (socketRef.current) return;

    try {
      const stream = await getLocalStream();

      const socket = io(process.env.NEXT_PUBLIC_SIGNALING_SERVER, {
        transports: ["websocket"],
      });

      socketRef.current = socket;

      socket.on("connect_error", () => {
        alert("Server connection failed");
        stopChat();
      });

      socket.on("waiting", () => {
        setStatus("waiting");
        setMessages([]);
      });

      socket.on("matched", ({ room, initiator }) => {
        roomRef.current = room;
        setStatus("connected");
        setMessages([]);

        cleanupPeer();

        const peer = new Peer({
          initiator,
          trickle: true,
          stream,
          config: { iceServers },
        });

        peer.on("signal", (data) => {
          socket.emit("signal", { room, data });
        });

        peer.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });

        peer.on("error", () => skipPartner());

        socket.off("signal").on("signal", ({ data }) => {
          if (peer && !peer.destroyed) {
            peer.signal(data);
          }
        });

        peerRef.current = peer;
      });

      socket.on("partner_left", skipPartner);
      socket.on("partner_skipped", skipPartner);

      socket.on("message", ({ text }) => {
        setMessages((prev) => [...prev, { from: "stranger", text }]);
      });

      socket.emit("find_match");
    } catch (err) {
      socketRef.current = null;
      setStatus("idle");
    }
  };

  const skipPartner = () => {
    cleanupPeer();

    if (socketRef.current && roomRef.current) {
      socketRef.current.emit("skip", { room: roomRef.current });
    }

    setMessages([]);
    setStatus("waiting");

    socketRef.current?.emit("find_match");
  };

  const stopChat = () => {
    cleanupPeer();

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    setStatus("idle");
    setMessages([]);
    roomRef.current = null;
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;

    if (socketRef.current && roomRef.current) {
      socketRef.current.emit("message", {
        room: roomRef.current,
        text: inputText,
      });

      setMessages((prev) => [...prev, { from: "you", text: inputText }]);
      setInputText("");
    }
  };

  useEffect(() => {
    return () => stopChat();
  }, []);

  return (
    <main className="min-h-screen bg-gray-900 text-white flex flex-col">

      {/* Header */}
      <header className="flex justify-between p-4">
        <h1 className="text-xl font-bold">Umingle</h1>
        {(status === "waiting" || status === "connected") && (
          <button onClick={stopChat}>✖</button>
        )}
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-3">

        {status === "idle" && (
          <button onClick={startChat} className="bg-blue-500 px-6 py-3 rounded">
            ▶ Start Chat
          </button>
        )}

        {(status === "waiting" || status === "connected") && (
          <div className="w-full max-w-5xl flex flex-col md:flex-row gap-4">

            {/* Video */}
            <div className="flex-1 bg-black rounded overflow-hidden relative">
              {status === "waiting" ? (
                <div className="h-60 flex items-center justify-center">
                  Searching...
                </div>
              ) : (
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full" />
              )}

              <video
                ref={localVideoRef}
                autoPlay
                muted
                className="absolute bottom-2 right-2 w-24 rounded"
              />
            </div>

            {/* Chat */}
            <div className="w-full md:w-80 bg-gray-800 rounded flex flex-col">
              <div className="flex-1 overflow-y-auto p-2">
                {messages.map((msg, i) => (
                  <div key={i} className={msg.from === "you" ? "text-right" : ""}>
                    <span className="bg-gray-700 px-2 py-1 rounded inline-block m-1">
                      {msg.text}
                    </span>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="flex p-2 gap-2">
                <button onClick={skipPartner}>Next</button>

                <input
                  className="flex-1 text-black px-2"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                />

                <button onClick={sendMessage}>Send</button>
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  );
        }
