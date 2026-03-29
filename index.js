/* global process */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
loadEnvFile(path.join(path.dirname(__dirname), '.env'))
const port = Number(process.env.PORT || 3001)
const appName = process.env.APP_NAME || 'ConnectArena'
const isVercel = process.env.VERCEL === '1'
const dbPath = process.env.DB_PATH || (isVercel
  ? path.join(os.tmpdir(), 'talkify-db.json')
  : path.join(__dirname, 'data', 'db.json'))

const defaultDb = {
  users: [],
  friendRequests: [],
  messages: [],
  posts: [],
  gameRooms: [],
}

function ensureDb() {
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2))
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function readDb() {
  ensureDb()
  const raw = fs.readFileSync(dbPath, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    friendRequests: Array.isArray(parsed.friendRequests) ? parsed.friendRequests : [],
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    posts: Array.isArray(parsed.posts) ? parsed.posts : [],
    gameRooms: Array.isArray(parsed.gameRooms) ? parsed.gameRooms : [],
  }
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2))
}

function getAllowedOrigins() {
  return (process.env.CORS_ORIGIN ||
    'https://incandescent-unicorn-bb3930.netlify.app,http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function resolveCorsOrigin(req) {
  const requestOrigin = req.headers.origin
  const allowedOrigins = getAllowedOrigins()

  if (!requestOrigin) {
    return allowedOrigins[0] || '*'
  }
  if (allowedOrigins.includes('*') || allowedOrigins.includes(requestOrigin)) {
    return requestOrigin
  }

  return allowedOrigins[0] || '*'
}

function sendJson(req, res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': resolveCorsOrigin(req),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  })
  res.end(JSON.stringify(body))
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
  })
}

function createId() {
  return crypto.randomUUID()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isPhone(value) {
  return /^\+?[0-9]{10,15}$/.test(value)
}

function isStrongPassword(value) {
  return /^(?=.{8,}$)[A-Z](?=.*\d)(?=.*[^A-Za-z0-9]).*$/.test(value)
}

function isValidUsername(value) {
  return /^[a-z][a-z0-9._]{2,19}$/.test(value)
}

function isValidName(value) {
  return /^[A-Za-z][A-Za-z\s'-]{1,29}$/.test(value.trim())
}

function isAdultDob(value) {
  if (!value) return false
  const dob = new Date(value)
  if (Number.isNaN(dob.getTime())) return false

  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }

  return age >= 18
}

function maskPhone(phone) {
  return `${phone.slice(0, 3)}*****${phone.slice(-2)}`
}

function createRoomState(hostId, guestId, type) {
  return {
    id: createId(),
    type,
    hostId,
    guestId,
    status: 'active',
    turn: hostId,
    winnerId: null,
    resultLabel: '',
    board: type === 'tic' ? Array(9).fill(null) : null,
    moves: {},
    rounds: [],
    createdAt: new Date().toISOString(),
  }
}

function findWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]
    }
  }

  return null
}

function decideRpsWinner(hostId, guestId, moves) {
  const host = moves[hostId]
  const guest = moves[guestId]
  if (host === guest) return null
  const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
  return wins[host] === guest ? hostId : guestId
}

function sanitizeState(db) {
  return {
    users: db.users.map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      bio: user.bio,
      city: user.city,
      online: user.online,
      joinedAt: user.joinedAt,
      email: user.email || '',
      phone: user.phone || user.identifier || '',
      contactType: 'phone',
      contactMask: maskPhone(user.phone || user.identifier || ''),
    })),
    friendRequests: db.friendRequests,
    messages: db.messages,
    posts: db.posts,
    gameRooms: db.gameRooms,
  }
}

function matchesPath(pathname, ...candidates) {
  return candidates.includes(pathname)
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(req, res, 204, {})
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const db = readDb()

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      sendJson(req, res, 200, {
        name: appName,
        status: 'ok',
        message: 'Talkify backend is running.',
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(req, res, 200, {
        status: 'ok',
        storage: dbPath,
        vercel: isVercel,
      })
      return
    }

    if (req.method === 'GET' && matchesPath(url.pathname, '/api/state', '/state')) {
      sendJson(req, res, 200, sanitizeState(db))
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/auth/signup', '/signup')) {
      const body = await parseBody(req)
      const firstName = body.firstName?.trim()
      const lastName = body.lastName?.trim()
      const username = body.username?.trim()?.toLowerCase()
      const email = body.email?.trim()?.toLowerCase()
      const phone = body.phone?.trim()
      const password = body.password?.trim()
      const dob = body.dob?.trim()
      const gender = body.gender?.trim()

      if (!firstName || !lastName || !username || !password || !email || !phone || !dob || !gender) {
        sendJson(req, res, 400, { error: 'First name, last name, username, email, phone, date of birth, gender, aur password required hain.' })
        return
      }
      if (!isValidName(firstName) || !isValidName(lastName)) {
        sendJson(req, res, 400, { error: 'First name aur last name mein sirf valid letters hone chahiye.' })
        return
      }
      if (!isEmail(email)) {
        sendJson(req, res, 400, { error: 'Valid email dena hoga.' })
        return
      }
      if (!isPhone(phone)) {
        sendJson(req, res, 400, { error: 'Valid phone number dena hoga.' })
        return
      }
      if (!isAdultDob(dob)) {
        sendJson(req, res, 400, { error: 'Sirf 18 saal ya us se zyada age wale users signup kar sakte hain.' })
        return
      }
      if (!['male', 'female', 'non-binary'].includes(gender)) {
        sendJson(req, res, 400, { error: 'Valid gender select karna hoga.' })
        return
      }
      if (!isValidUsername(username)) {
        sendJson(req, res, 400, { error: 'Username lowercase ho aur sirf letters, numbers, dot, ya underscore use kare.' })
        return
      }
      if (!isStrongPassword(password)) {
        sendJson(req, res, 400, { error: 'Password kam az kam 8 characters ka ho, pehla letter uppercase ho, aur usme number aur special character bhi ho.' })
        return
      }
      if (!body.agreed) {
        sendJson(req, res, 400, { error: 'Terms agreement is required.' })
        return
      }
      if (db.users.some((user) => user.username === username)) {
        sendJson(req, res, 409, { error: 'Username already exists.' })
        return
      }
      if (db.users.some((user) => (user.email || '').toLowerCase() === email)) {
        sendJson(req, res, 409, { error: 'Email already registered hai.' })
        return
      }
      if (db.users.some((user) => (user.phone || user.identifier || '') === phone)) {
        sendJson(req, res, 409, { error: 'Phone number already registered hai.' })
        return
      }

      const user = {
        id: createId(),
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        username,
        password,
        bio: body.bio?.trim() || 'Open to connect, collaborate, and play.',
        city: body.city?.trim() || 'Pakistan',
        email,
        phone,
        dob,
        gender,
        online: true,
        joinedAt: new Date().toISOString(),
      }

      db.users.push(user)
      db.posts.unshift({
        id: createId(),
        authorId: user.id,
        mood: 'Joined',
        content: `Hello everyone. I just joined ${appName}.`,
        createdAt: new Date().toISOString(),
      })
      writeDb(db)
      sendJson(req, res, 200, { userId: user.id, state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/auth/login', '/login')) {
      const body = await parseBody(req)
      const identifier = body.phone?.trim() || body.email?.trim()?.toLowerCase()
      const user = db.users.find(
        (item) =>
          (
            (item.phone || item.identifier || '') === identifier ||
            (item.email || '').toLowerCase() === identifier
          ) &&
          item.password === body.password,
      )
      if (!user) {
        sendJson(req, res, 401, { error: 'Phone number, email, ya password sahi nahin hai.' })
        return
      }
      user.online = true
      writeDb(db)
      sendJson(req, res, 200, { userId: user.id, state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/logout', '/logout')) {
      const body = await parseBody(req)
      const user = db.users.find((item) => item.id === body.userId)
      if (user) {
        user.online = false
        writeDb(db)
      }
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/presence', '/presence')) {
      const body = await parseBody(req)
      const user = db.users.find((item) => item.id === body.userId)
      if (!user) {
        sendJson(req, res, 404, { error: 'User not found.' })
        return
      }
      user.online = !user.online
      writeDb(db)
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/friend-request', '/friend-request')) {
      const body = await parseBody(req)
      const exists = db.friendRequests.some(
        (request) =>
          ((request.from === body.from && request.to === body.to) ||
            (request.from === body.to && request.to === body.from)) &&
          ['pending', 'accepted'].includes(request.status),
      )
      if (!exists) {
        db.friendRequests.push({
          id: createId(),
          from: body.from,
          to: body.to,
          status: 'pending',
          createdAt: new Date().toISOString(),
        })
        writeDb(db)
      }
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/friend-request/respond', '/friend-request/respond')) {
      const body = await parseBody(req)
      const request = db.friendRequests.find((item) => item.id === body.requestId)
      if (!request) {
        sendJson(req, res, 404, { error: 'Request not found.' })
        return
      }
      request.status = body.status
      writeDb(db)
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/post', '/post')) {
      const body = await parseBody(req)
      db.posts.unshift({
        id: createId(),
        authorId: body.authorId,
        mood: body.mood,
        content: body.content?.trim(),
        createdAt: new Date().toISOString(),
      })
      writeDb(db)
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/message', '/message')) {
      const body = await parseBody(req)
      db.messages.push({
        id: createId(),
        from: body.from,
        to: body.to,
        text: body.text?.trim(),
        createdAt: new Date().toISOString(),
      })
      writeDb(db)
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/game-room', '/game-room')) {
      const body = await parseBody(req)
      db.gameRooms.unshift(createRoomState(body.hostId, body.guestId, body.type))
      writeDb(db)
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/game-room/tic', '/game-room/tic')) {
      const body = await parseBody(req)
      const room = db.gameRooms.find((item) => item.id === body.roomId)
      if (!room || room.type !== 'tic' || room.status !== 'active') {
        sendJson(req, res, 404, { error: 'Room unavailable.' })
        return
      }
      if (room.turn !== body.userId || room.board[body.index]) {
        sendJson(req, res, 400, { error: 'Invalid move.' })
        return
      }

      room.board[body.index] = body.userId
      const winnerId = findWinner(room.board)
      const isDraw = room.board.every(Boolean) && !winnerId
      room.winnerId = winnerId
      room.status = winnerId || isDraw ? 'finished' : 'active'
      room.resultLabel = winnerId ? 'Winner found' : isDraw ? 'Match drawn' : ''
      room.turn = body.userId === room.hostId ? room.guestId : room.hostId
      writeDb(db)
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    if (req.method === 'POST' && matchesPath(url.pathname, '/api/game-room/rps', '/game-room/rps')) {
      const body = await parseBody(req)
      const room = db.gameRooms.find((item) => item.id === body.roomId)
      if (!room || room.type !== 'rps' || room.status !== 'active') {
        sendJson(req, res, 404, { error: 'Room unavailable.' })
        return
      }

      room.moves = { ...room.moves, [body.userId]: body.move }
      if (!room.moves[room.hostId] || !room.moves[room.guestId]) {
        room.resultLabel = 'Waiting for other player move.'
        writeDb(db)
        sendJson(req, res, 200, { state: sanitizeState(db) })
        return
      }

      const winnerId = decideRpsWinner(room.hostId, room.guestId, room.moves)
      room.rounds.push({
        id: createId(),
        hostMove: room.moves[room.hostId],
        guestMove: room.moves[room.guestId],
        winnerId,
      })
      room.moves = {}
      room.winnerId = winnerId
      room.status = 'finished'
      room.resultLabel = winnerId ? 'Round completed' : 'Round tied.'
      writeDb(db)
      sendJson(req, res, 200, { state: sanitizeState(db) })
      return
    }

    sendJson(req, res, 404, { error: 'Not found.' })
  } catch (error) {
    sendJson(req, res, 500, { error: error.message || 'Server error.' })
  }
}

export default handleRequest

if (process.argv[1] === __filename) {
  const server = http.createServer(handleRequest)
  server.listen(port, () => {
    console.log(`ConnectArena server running on http://localhost:${port}`)
  })
}
