# 🎥 Umingle

A random video chat web app — no account, no signup. Just open and start chatting with strangers instantly.

**Live Demo:** [umingle-one.vercel.app](https://umingle-one.vercel.app)

---

## ✨ Features

- 🎲 Random stranger matching
- 📹 Real-time video chat (WebRTC)
- 💬 Text chat alongside video
- ⏭️ Skip to next stranger anytime
- 🔄 Auto re-match when stranger disconnects
- 📱 Mobile-first responsive design
- 🔒 No account or login required

---

## 🛠️ Tech Stack

| Part | Technology |
|------|-----------|
| Frontend | Next.js 14 (App Router) |
| Signaling Server | Node.js + Socket.io |
| Video | WebRTC (via simple-peer) |
| TURN Server | Metered.ca |
| Frontend Hosting | Vercel |
| Server Hosting | Railway |

---

## 📁 Project Structure

```
umingle/
├── umingle-server/          # Signaling server
│   ├── server.js            # Socket.io server
│   └── package.json
│
└── umingle-frontend/        # Next.js frontend
    ├── app/
    │   └── page.js          # Main page
    ├── .env.local            # Environment variables
    └── package.json
```

---

## 🚀 Local Setup

### 1. Clone the repo

```bash
git clone https://github.com/mir-md-masum-billah/umingle.git
cd umingle
```

### 2. Start Signaling Server

```bash
cd umingle-server
npm install
node server.js
# Running on http://localhost:3001
```

### 3. Start Frontend

```bash
cd umingle-frontend
npm install
npm run dev
# Running on http://localhost:3000
```

### 4. Environment Variables

`umingle-frontend/.env.local` ফাইলে এই variables দাও:

```env
NEXT_PUBLIC_SIGNALING_SERVER=http://localhost:3001
NEXT_PUBLIC_TURN_USERNAME=your_turn_username
NEXT_PUBLIC_TURN_CREDENTIAL=your_turn_credential
```

TURN credentials পেতে [Metered.ca](https://www.metered.ca) তে free account খোলো।

---

## 🌐 Deployment

### Signaling Server → Railway

1. [railway.app](https://railway.app) এ GitHub দিয়ে login করো
2. New Project → Deploy from GitHub repo
3. `umingle-server` folder select করো
4. Environment Variable: `PORT=3001`
5. Deploy করো → URL copy করো

### Frontend → Vercel

1. [vercel.com](https://vercel.com) এ GitHub দিয়ে login করো
2. New Project → `umingle` repo select করো
3. Root Directory: `umingle-frontend`
4. Environment Variables:
   ```
   NEXT_PUBLIC_SIGNALING_SERVER=https://your-railway-url.up.railway.app
   NEXT_PUBLIC_TURN_USERNAME=your_turn_username
   NEXT_PUBLIC_TURN_CREDENTIAL=your_turn_credential
   ```
5. Deploy করো

---

## 💰 Cost

| Service | Cost |
|---------|------|
| Vercel | ✅ Free |
| Railway | ✅ Free ($5 credit/month) |
| Metered.ca TURN | ✅ Free (1GB/month) |

প্রথম ১০০ জন user পর্যন্ত সম্পূর্ণ বিনামূল্যে চালানো যাবে।

---

## 📄 License

MIT License — feel free to use and modify.
