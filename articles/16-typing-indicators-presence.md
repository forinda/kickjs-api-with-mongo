---
title: "Real-Time Typing Indicators and Presence Tracking with KickJS and Socket.IO"
published: false
description: "Implementing typing indicators, presence tracking, and room-based broadcasting in a channel-based chat system using KickJS WsAdapter and Socket.IO. Code from a production-ready Jira-like backend."
tags: kickjs, mongodb, typescript, websocket, socketio
series: "Building with KickJS"
cover_image: ""
---

## TL;DR

- KickJS `WsAdapter` wraps Socket.IO with decorator-driven WebSocket controllers
- Room-based broadcasting (`ctx.join()`, `ctx.to().send()`) is the right abstraction for channel-based apps like Slack or Jira comments
- Typing indicators use `channel:typing` / `channel:stop_typing` events with room-scoped broadcasting
- In-memory presence tracking with a `Map<socketId, userInfo>` handles online/offline status
- A cron job cleans up stale presence entries for resilience
- Rooms beat individual socket tracking for multi-channel apps because they eliminate manual fan-out logic

---

## The Setup: WebSocket Namespaces with KickJS

Vibed has a real-time chat system built into its task management backend. Users join workspace channels and exchange messages in real time. The WebSocket layer handles message delivery, typing indicators, and presence — while REST endpoints handle message history, editing, and deletion.

KickJS wraps Socket.IO behind a decorator-driven API via `WsAdapter`. The adapter is configured in `config/adapters.ts`:

```typescript
import { WsAdapter } from '@forinda/kickjs-ws';

const wsAdapter = new WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576, // 1MB
});

export const adapters = [
  // ... other adapters
  wsAdapter,
  // ...
];
```

The `path: '/ws'` sets the Socket.IO handshake endpoint. Clients connect with:

```typescript
const socket = io('http://localhost:3000', { path: '/ws' });
```

The `heartbeatInterval: 30000` means Socket.IO pings every 30 seconds to detect dead connections. The `maxPayload` caps message size at 1MB to prevent abuse.

---

## The WebSocket Controller

KickJS provides decorators for WebSocket event handling that mirror the HTTP controller pattern. Instead of `@Get` and `@Post`, you use `@OnConnect`, `@OnDisconnect`, and `@OnMessage`.

Here's the complete `ChatWsController` from Vibed:

```typescript
import { WsController, OnConnect, OnDisconnect, OnMessage } from '@forinda/kickjs-ws';
import type { WsContext } from '@forinda/kickjs-ws';
import { Autowired, Logger } from '@forinda/kickjs-core';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { MongoMessageRepository } from '../infrastructure/repositories/mongo-message.repository';

const logger = Logger.for('ChatWsController');

// In-memory online users map
const onlineUsers = new Map<string, { userId: string; userName: string }>();

@WsController('/chat')
export class ChatWsController {
  @Autowired() private messageRepo!: MongoMessageRepository;

  @OnConnect()
  handleConnect(ctx: WsContext) {
    try {
      const token = ctx.data?.token || '';
      const payload = jwt.verify(token, env.JWT_SECRET) as any;
      const userId = payload.sub;
      const email = payload.email;

      ctx.set('userId', userId);
      ctx.set('email', email);
      onlineUsers.set(ctx.id, { userId, userName: email });

      ctx.send('welcome', { id: ctx.id, userId });
      ctx.broadcastAll('presence:online', { userId, userName: email });
      logger.info(`User ${email} connected (${ctx.id})`);
    } catch {
      ctx.send('error', { message: 'Invalid authentication token' });
      logger.warn(`Connection rejected: invalid token (${ctx.id})`);
    }
  }

  @OnDisconnect()
  handleDisconnect(ctx: WsContext) {
    const info = onlineUsers.get(ctx.id);
    if (info) {
      ctx.broadcastAll('presence:offline', { userId: info.userId });
      onlineUsers.delete(ctx.id);
      logger.info(`User ${info.userName} disconnected (${ctx.id})`);
    }
  }

  // ... message and typing handlers below
}
```

The `@WsController('/chat')` decorator registers this controller under the `/chat` namespace. So the full connection URL is `ws://localhost:3000/ws/chat`. The namespace is important — it means Vibed could add other namespaces later (like `/notifications` for real-time notification push) without interference.

### Authentication on Connect

WebSocket connections don't carry HTTP headers the same way REST calls do. I handle auth during the connection handshake by requiring the client to send a JWT token in the connection payload:

```typescript
// Client-side
const socket = io('http://localhost:3000/chat', {
  path: '/ws',
  auth: { token: accessToken },
});
```

On the server, `ctx.data?.token` reads the auth payload. If `jwt.verify()` throws, the connection stays alive but the user gets an error event. In a stricter setup, you could disconnect them immediately — but for Vibed, I let the connection stay open so the client can retry with a fresh token.

The verified user info is stored in two places:
- `ctx.set('userId', userId)` — for the current connection's context, so later event handlers can read it
- `onlineUsers.set(ctx.id, ...)` — for the global presence map, so other connections can query who's online

---

## Room-Based Broadcasting

This is the core concept that makes channel-based chat work efficiently. Instead of maintaining a list of socket IDs per channel and manually emitting to each one, Socket.IO (and KickJS's `WsContext`) provides **rooms**.

### Joining and Leaving Rooms

When a user opens a channel in the UI, the client emits `channel:join`. When they navigate away, it emits `channel:leave`:

```typescript
@OnMessage('channel:join')
handleJoin(ctx: WsContext) {
  const channelId = ctx.data?.channelId;
  if (!channelId) return;
  ctx.join(`channel:${channelId}`);
  ctx.to(`channel:${channelId}`).send('channel:user_joined', {
    channelId,
    userId: ctx.get('userId'),
  });
}

@OnMessage('channel:leave')
handleLeave(ctx: WsContext) {
  const channelId = ctx.data?.channelId;
  if (!channelId) return;
  ctx.leave(`channel:${channelId}`);
  ctx.to(`channel:${channelId}`).send('channel:user_left', {
    channelId,
    userId: ctx.get('userId'),
  });
}
```

The key methods:

- `ctx.join('channel:abc')` — Adds this socket to the `channel:abc` room. The socket can be in multiple rooms simultaneously (a user can have multiple channels open in tabs).
- `ctx.leave('channel:abc')` — Removes this socket from the room.
- `ctx.to('channel:abc').send(event, data)` — Broadcasts to all sockets in the room **except** the sender.

The room name is prefixed with `channel:` as a namespace convention. This prevents collisions if I later add `project:` or `workspace:` rooms for different broadcast purposes.

### Sending Messages

When a user sends a message, it's persisted to MongoDB via the message repository and then broadcast to the room:

```typescript
@OnMessage('message:send')
async handleSend(ctx: WsContext) {
  const userId = ctx.get('userId');
  if (!userId) return ctx.send('error', { message: 'Not authenticated' });

  const { channelId, content } = ctx.data || {};
  if (!channelId || !content) return;

  const message = await this.messageRepo.create({
    channelId: channelId as any,
    senderId: userId as any,
    content,
    mentions: [],
  });

  const info = onlineUsers.get(ctx.id);
  const payload = {
    messageId: message._id.toString(),
    channelId,
    senderId: userId,
    senderName: info?.userName ?? 'Unknown',
    content: message.content,
    createdAt: message.createdAt,
  };

  ctx.to(`channel:${channelId}`).send('message:new', payload);
  ctx.send('message:new', payload); // Echo back to sender
}
```

Notice that `ctx.to().send()` excludes the sender, so I explicitly send the message back to the sender with `ctx.send()`. This is intentional — the sender needs the server-generated `messageId` and `createdAt` to update their local UI. In an optimistic-UI approach, you'd show the message immediately and then reconcile when the echo arrives.

---

## Typing Indicators

Typing indicators are the "X is typing..." status you see in Slack, Discord, and every modern chat app. They need to be fast (low latency), cheap (no database writes), and scoped (only visible to users in the same channel).

### The Events

Two events handle the full lifecycle:

```typescript
@OnMessage('channel:typing')
handleTyping(ctx: WsContext) {
  const { channelId } = ctx.data || {};
  if (!channelId) return;
  const info = onlineUsers.get(ctx.id);
  ctx.to(`channel:${channelId}`).send('channel:typing', {
    channelId,
    userId: ctx.get('userId'),
    userName: info?.userName,
  });
}

@OnMessage('channel:stop_typing')
handleStopTyping(ctx: WsContext) {
  const { channelId } = ctx.data || {};
  if (!channelId) return;
  ctx.to(`channel:${channelId}`).send('channel:stop_typing', {
    channelId,
    userId: ctx.get('userId'),
  });
}
```

The server is a pure relay here. It doesn't track typing state — it just broadcasts the event to the room. This is by design: typing indicators are ephemeral, and storing them adds complexity with zero value.

### Client-Side Implementation

The client needs debouncing to avoid flooding the server with typing events on every keystroke:

```typescript
// Client-side typing indicator logic
let typingTimeout: ReturnType<typeof setTimeout> | null = null;
let isTyping = false;

function handleInput(channelId: string) {
  if (!isTyping) {
    socket.emit('channel:typing', { channelId });
    isTyping = true;
  }

  if (typingTimeout) clearTimeout(typingTimeout);

  typingTimeout = setTimeout(() => {
    socket.emit('channel:stop_typing', { channelId });
    isTyping = false;
  }, 2000); // Stop typing after 2 seconds of inactivity
}

// Listening for others typing
const typingUsers = new Map<string, string>();

socket.on('channel:typing', ({ userId, userName }) => {
  typingUsers.set(userId, userName);
  updateTypingUI();
});

socket.on('channel:stop_typing', ({ userId }) => {
  typingUsers.delete(userId);
  updateTypingUI();
});

function updateTypingUI() {
  const names = Array.from(typingUsers.values());
  if (names.length === 0) {
    typingLabel.textContent = '';
  } else if (names.length === 1) {
    typingLabel.textContent = `${names[0]} is typing...`;
  } else if (names.length === 2) {
    typingLabel.textContent = `${names[0]} and ${names[1]} are typing...`;
  } else {
    typingLabel.textContent = `${names[0]} and ${names.length - 1} others are typing...`;
  }
}
```

The debounce pattern: emit `typing` on first keystroke, then wait 2 seconds after the last keystroke to emit `stop_typing`. This gives a natural "typing..." experience without sending an event per character.

### Why Rooms Make This Trivial

Without rooms, the typing handler would need to:

1. Look up which users are in the channel (database query or in-memory lookup)
2. Find their socket IDs (another lookup)
3. Emit to each socket individually (loop)
4. Handle the case where a user has multiple tabs open (deduplication)

With rooms, it's one line: `ctx.to('channel:${channelId}').send(...)`. Socket.IO handles fan-out, multi-tab, and cleanup automatically. This is why rooms exist — they're the right primitive for group-scoped broadcasting.

---

## In-Memory Presence Tracking

Presence tracking answers the question: "Who's online right now?" Vibed uses a module-level `Map` for this:

```typescript
const onlineUsers = new Map<string, { userId: string; userName: string }>();
```

The key is the socket ID (`ctx.id`), and the value contains the user's identity. This map is updated on connect and disconnect:

```typescript
// On connect
onlineUsers.set(ctx.id, { userId, userName: email });
ctx.broadcastAll('presence:online', { userId, userName: email });

// On disconnect
const info = onlineUsers.get(ctx.id);
if (info) {
  ctx.broadcastAll('presence:offline', { userId: info.userId });
  onlineUsers.delete(ctx.id);
}
```

The `ctx.broadcastAll()` sends to every connected socket, not just a room. Presence is a global concern — you want to show who's online in the workspace sidebar, not just in a specific channel.

### Multi-Tab Handling

One user might have multiple tabs open, each with its own socket connection. The `onlineUsers` map has one entry per socket, not per user. This means a user with 3 tabs has 3 entries.

When broadcasting `presence:offline`, you need to check whether the user has other connections still alive:

```typescript
@OnDisconnect()
handleDisconnect(ctx: WsContext) {
  const info = onlineUsers.get(ctx.id);
  if (info) {
    onlineUsers.delete(ctx.id);

    // Check if user has other active connections
    const stillOnline = Array.from(onlineUsers.values())
      .some(u => u.userId === info.userId);

    if (!stillOnline) {
      ctx.broadcastAll('presence:offline', { userId: info.userId });
    }

    logger.info(`User ${info.userName} disconnected (${ctx.id})`);
  }
}
```

Without this check, closing one tab would show the user as offline while they're still active in another tab.

### Exporting the Presence Map

The `onlineUsers` map is exported so other parts of the application can query it. For example, the SSE stats endpoint uses it to show the number of online users:

```typescript
// In chat.ws-controller.ts
export function getOnlineUsers() {
  return onlineUsers;
}

// In stats.controller.ts
import { getOnlineUsers } from '@/modules/messages/presentation/chat.ws-controller';

@Get('/workspaces/:workspaceId/stats/live')
@Middleware(workspaceMembershipGuard)
async workspaceLive(ctx: RequestContext) {
  const sse = ctx.sse();

  const sendStats = async () => {
    const onlineUsers = getOnlineUsers();
    sse.send({
      onlineUsersCount: onlineUsers.size,
      timestamp: new Date().toISOString(),
    }, 'stats:update');
  };

  await sendStats();
  const interval = setInterval(sendStats, 10000);
  sse.onClose(() => clearInterval(interval));
}
```

This bridges WebSocket presence data into the SSE-powered dashboard. The SSE endpoint pushes the online user count every 10 seconds without the dashboard needing a WebSocket connection itself.

---

## Presence Cleanup Cron

In-memory presence tracking is fast but fragile. If the server crashes, all presence data is lost. If a client disconnects without a clean `disconnect` event (network failure, browser kill), the `onlineUsers` entry becomes stale.

KickJS's `CronAdapter` provides scheduled job support. I use it to clean up stale presence entries:

```typescript
import { Service, Logger } from '@forinda/kickjs-core';
import { Cron } from '@forinda/kickjs-cron';

const logger = Logger.for('PresenceCronJobs');

@Service()
export class PresenceCronJobs {
  @Cron('*/5 * * * *', { description: 'Clean up stale presence entries' })
  async cleanupPresence() {
    logger.info('Running presence cleanup...');
    // Check Redis presence hash, remove entries with stale heartbeats
  }
}
```

The cron runs every 5 minutes. In a production implementation, you'd:

1. Store each user's last heartbeat timestamp in Redis
2. On each cron run, find entries where the heartbeat is older than the `heartbeatInterval` (30 seconds) plus some grace period
3. Remove those entries from both Redis and the in-memory map
4. Broadcast `presence:offline` for cleaned-up users

The cron adapter is registered in `config/adapters.ts`:

```typescript
import { CronAdapter } from '@forinda/kickjs-cron';
import { PresenceCronJobs } from '@/modules/cron/infrastructure/jobs/presence-cleanup.cron';

new CronAdapter({
  services: [PresenceCronJobs, /* other cron services */],
  enabled: true,
});
```

---

## Why Rooms Beat Individual Socket Tracking

For channel-based applications, rooms are categorically better than tracking individual sockets. Here's the comparison:

### Without Rooms (Manual Tracking)

```typescript
// You'd need to maintain this yourself
const channelMembers = new Map<string, Set<string>>(); // channelId -> socketIds

function joinChannel(channelId: string, socketId: string) {
  if (!channelMembers.has(channelId)) {
    channelMembers.set(channelId, new Set());
  }
  channelMembers.get(channelId)!.add(socketId);
}

function broadcastToChannel(channelId: string, event: string, data: any, excludeId?: string) {
  const members = channelMembers.get(channelId);
  if (!members) return;
  for (const socketId of members) {
    if (socketId === excludeId) continue;
    const socket = io.sockets.get(socketId);
    if (socket) {
      socket.emit(event, data);
    } else {
      // Socket disconnected without cleanup — stale entry
      members.delete(socketId);
    }
  }
}

function leaveChannel(channelId: string, socketId: string) {
  channelMembers.get(channelId)?.delete(socketId);
  if (channelMembers.get(channelId)?.size === 0) {
    channelMembers.delete(channelId);
  }
}
```

You're managing membership, fan-out, cleanup, and stale detection manually. Every edge case (disconnect without leave, server crash, multi-tab) needs explicit handling.

### With Rooms (Socket.IO + KickJS)

```typescript
// Join
ctx.join(`channel:${channelId}`);

// Broadcast to room (excludes sender automatically)
ctx.to(`channel:${channelId}`).send('channel:typing', { userId, userName });

// Leave
ctx.leave(`channel:${channelId}`);

// Automatic cleanup on disconnect — Socket.IO removes the socket from all rooms
```

Four lines replace 30+ lines of manual tracking. Socket.IO handles:

- **Membership management**: `join()` and `leave()` maintain the room's socket set
- **Fan-out**: `to().send()` iterates the room's members and emits to each
- **Disconnect cleanup**: When a socket disconnects, Socket.IO automatically removes it from all rooms
- **Multi-tab**: Each socket (each tab) joins independently; closing one tab doesn't affect other tabs in the same room

### When Individual Tracking Makes Sense

Rooms aren't always the answer. For direct messages (1-to-1), you might track socket IDs per user because there's no "room" concept. For notifications, you might use the user ID as a room name (`room:user_${userId}`) and join every socket for that user.

But for channel-based communication — Slack channels, Discord servers, Jira project boards — rooms are the natural primitive. They match the domain model: a channel is a group, a room is a group.

---

## The Complete Event Flow

Here's how all the pieces fit together for a typical interaction:

```
User A opens #general channel
  → Client emits: channel:join { channelId: 'general' }
  → Server: ctx.join('channel:general')
  → Server broadcasts to room: channel:user_joined { userId: 'A' }

User A starts typing
  → Client emits: channel:typing { channelId: 'general' }
  → Server: ctx.to('channel:general').send('channel:typing', { userId: 'A', userName: 'alice' })
  → User B's client receives: channel:typing → shows "alice is typing..."

User A sends a message
  → Client emits: message:send { channelId: 'general', content: 'Hello!' }
  → Server: persists message to MongoDB
  → Server: ctx.to('channel:general').send('message:new', { ... })
  → Server: ctx.send('message:new', { ... }) // echo to sender
  → User B receives: message:new → renders message in chat
  → User A receives: message:new echo → confirms delivery, gets messageId

User A stops typing (2s timeout on client)
  → Client emits: channel:stop_typing { channelId: 'general' }
  → Server: ctx.to('channel:general').send('channel:stop_typing', { userId: 'A' })
  → User B's client receives: channel:stop_typing → removes typing indicator

User A navigates away from #general
  → Client emits: channel:leave { channelId: 'general' }
  → Server: ctx.leave('channel:general')
  → Server broadcasts to room: channel:user_left { userId: 'A' }
```

The REST API handles everything that needs persistence or history:

```
GET /channels/:channelId/messages   → Paginated message history
PATCH /messages/:messageId          → Edit message (author only)
DELETE /messages/:messageId         → Soft-delete message (author only)
```

WebSocket handles everything that's ephemeral or real-time: message delivery, typing indicators, presence, and join/leave events.

---

## Scaling Considerations

The in-memory `onlineUsers` Map works for a single server instance. For horizontal scaling, you'd need:

1. **Redis-backed presence**: Store presence in a Redis hash instead of (or in addition to) the in-memory map. All server instances read/write the same Redis store.

2. **Socket.IO Redis adapter**: `@socket.io/redis-adapter` makes rooms work across multiple server instances. A `join()` on server 1 is visible to `to().send()` on server 2.

3. **Sticky sessions**: Socket.IO long-polling fallback requires sticky sessions. WebSocket transport doesn't, but the initial handshake does.

KickJS's `WsAdapter` uses Socket.IO under the hood, so the Redis adapter integration is straightforward:

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: env.REDIS_URL });
const subClient = pubClient.duplicate();

const wsAdapter = new WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  adapter: createAdapter(pubClient, subClient), // Multi-instance rooms
});
```

---

## Key Takeaways

1. **Use rooms for group-scoped events** — channels, projects, workspaces. Don't manually track socket sets.

2. **Keep typing indicators stateless on the server** — the server is a relay, not a state machine. Clients manage their own typing debounce timers.

3. **Export presence data for cross-concern access** — the SSE stats endpoint needs WebSocket presence data. Export the map, don't duplicate the tracking.

4. **Clean up stale presence with cron** — in-memory tracking is fast but fragile. A periodic cleanup prevents ghost users.

5. **Separate persistence from real-time** — messages are persisted via REST or during WebSocket `message:send`. Typing indicators and presence are never persisted. Use the right transport for the right data.

6. **Auth on connect, not on every message** — verify the JWT once during `@OnConnect`, store the user in context, and trust it for the connection's lifetime. Re-auth on reconnect.

---

*This is part of a series on building a Jira-like backend with KickJS. Next up: the complete project guide covering everything from scaffold to production.*
