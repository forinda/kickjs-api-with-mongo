---
title: "WebSocket Chat + SSE Stats Streams in KickJS with Express 5"
description: "How I built real-time chat with Socket.IO WebSockets and live dashboard stats with Server-Sent Events in a single KickJS backend, and when to use each."
tags: ["kickjs", "nodejs", "typescript", "mongodb", "websocket"]
canonical_url: ""
published: false
cover_image: ""
---

# WebSocket Chat + SSE Stats Streams in the Same Express 5 App

Vibed is a Jira-like task management app with two very different real-time needs. Chat requires bidirectional communication -- users send messages, join channels, receive typing indicators, all over one persistent connection. The project dashboard needs a simpler pattern -- the server pushes task status counts and online user numbers to the browser every few seconds. No client-to-server messaging needed.

I implemented both in the same Express 5 application using KickJS. Chat runs on WebSockets via Socket.IO. Dashboard stats stream over Server-Sent Events via `ctx.sse()`. This article walks through the real code, explains the architectural decisions, and covers when to pick one protocol over the other.

## Setting Up the WsAdapter

KickJS wraps Socket.IO with a `WsAdapter` that integrates into the framework's adapter lifecycle. Configuration lives in the central adapters file alongside every other adapter:

```typescript
import { WsAdapter } from '@forinda/kickjs-ws';

const wsAdapter = new WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576, // 1MB
});

export const adapters = [
  new MongooseAdapter(env.MONGODB_URI),
  new RedisAdapter(env.REDIS_URL),
  new AuthAdapter({ /* ... */ }),
  wsAdapter,
  new MailerAdapter({ /* ... */ }),
  // ...
];
```

The `path: '/ws'` means Socket.IO clients connect at `ws://your-host/ws`. The `heartbeatInterval` at 30 seconds keeps connections alive through proxies and load balancers. The `maxPayload` caps message size at 1MB, which is generous for a chat application but prevents abuse.

The adapter handles the HTTP upgrade handshake, Socket.IO transport negotiation (long-polling fallback to WebSocket), and heartbeat management. I do not touch any of that. I work with `WsController` classes and decorated message handlers.

## The Chat WebSocket Controller

This is the full chat controller from Vibed. It handles authentication, presence tracking, channel rooms, message CRUD, and typing indicators:

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

  // ... message handlers below
}
```

Let me break down the key decisions.

### Authentication at Connection Time

WebSocket connections do not carry HTTP headers in the same way as REST requests. The KickJS `AuthAdapter` and our `authBridgeMiddleware` operate on HTTP requests -- they cannot protect WebSocket handlers. So authentication happens at connect time using the `ctx.data` object, which contains whatever the client sent during the Socket.IO handshake:

```typescript
@OnConnect()
handleConnect(ctx: WsContext) {
  try {
    const token = ctx.data?.token || '';
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    const userId = payload.sub;
    const email = payload.email;

    ctx.set('userId', userId);
    ctx.set('email', email);
    // ...
  } catch {
    ctx.send('error', { message: 'Invalid authentication token' });
  }
}
```

The client passes the JWT during connection:

```javascript
// Client-side
const socket = io('/chat', {
  path: '/ws',
  auth: { token: accessToken },
});
```

If the token is invalid or expired, we send an error event back. We do not forcibly disconnect -- the client can handle the error and attempt reconnection with a fresh token. Every subsequent message handler checks `ctx.get('userId')` before processing:

```typescript
@OnMessage('message:send')
async handleSend(ctx: WsContext) {
  const userId = ctx.get('userId');
  if (!userId) return ctx.send('error', { message: 'Not authenticated' });
  // ...
}
```

### Presence Tracking with an In-Memory Map

The `onlineUsers` map tracks which socket connections belong to which users:

```typescript
const onlineUsers = new Map<string, { userId: string; userName: string }>();
```

On connect, we add the mapping. On disconnect, we remove it and broadcast the offline event:

```typescript
@OnDisconnect()
handleDisconnect(ctx: WsContext) {
  const info = onlineUsers.get(ctx.id);
  if (info) {
    ctx.broadcastAll('presence:offline', { userId: info.userId });
    onlineUsers.delete(ctx.id);
    logger.info(`User ${info.userName} disconnected (${ctx.id})`);
  }
}
```

This is an in-memory store, which means it does not survive server restarts and does not work across multiple server instances. For a single-server deployment, this is fine. For horizontal scaling, you would move this to Redis with pub/sub for cross-instance broadcast. We run a `PresenceCronJobs` class that periodically cleans stale entries as a safety net.

The `onlineUsers` map is exported as a function so other parts of the application can read it:

```typescript
export function getOnlineUsers() {
  return onlineUsers;
}
```

This becomes important for the SSE stats stream, which I will cover shortly.

### Channel Rooms

Socket.IO has built-in room support, and the KickJS `WsContext` exposes it through `ctx.join()`, `ctx.leave()`, and `ctx.to()`:

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

The room name is prefixed with `channel:` to avoid collisions with other room types. When a user joins a channel room, everyone in that room gets a notification. Messages sent to a channel are broadcast to the room.

### Message CRUD Over WebSocket

Sending a message persists it to MongoDB and broadcasts to the channel room:

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
  ctx.send('message:new', payload); // echo back to sender
}
```

Editing and deleting check ownership before proceeding:

```typescript
@OnMessage('message:edit')
async handleEdit(ctx: WsContext) {
  const userId = ctx.get('userId');
  if (!userId) return;

  const { messageId, content } = ctx.data || {};
  if (!messageId || !content) return;

  const message = await this.messageRepo.findById(messageId);
  if (!message || message.senderId.toString() !== userId) return;

  const updated = await this.messageRepo.update(messageId, { content });
  if (!updated) return;

  ctx.to(`channel:${message.channelId}`).send('message:edited', {
    messageId,
    channelId: message.channelId.toString(),
    content,
    updatedAt: updated.updatedAt,
  });
}

@OnMessage('message:delete')
async handleDelete(ctx: WsContext) {
  const userId = ctx.get('userId');
  if (!userId) return;

  const { messageId } = ctx.data || {};
  if (!messageId) return;

  const message = await this.messageRepo.findById(messageId);
  if (!message || message.senderId.toString() !== userId) return;

  await this.messageRepo.softDelete(messageId);
  ctx.to(`channel:${message.channelId}`).send('message:deleted', {
    messageId,
    channelId: message.channelId.toString(),
  });
}
```

Messages are soft-deleted, not hard-deleted. The `softDelete` method sets a `deletedAt` timestamp. The message remains in the database for audit purposes.

### Typing Indicators

Typing indicators are fire-and-forget broadcasts with no persistence:

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

The client debounces these events -- sending `channel:typing` when the user starts typing and `channel:stop_typing` after a pause. No database, no queue, just a room broadcast.

## SSE for Dashboard Stats

The dashboard does not need bidirectional communication. It needs the server to push updated numbers periodically. Server-Sent Events are perfect for this: unidirectional, auto-reconnecting, and they work over standard HTTP with no upgrade handshake.

KickJS provides `ctx.sse()` on the `RequestContext`, which sets the right headers and returns an SSE writer:

```typescript
@ApiTags('Stats')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class StatsController {
  @Autowired() private taskRepo!: MongoTaskRepository;

  @Get('/workspaces/:workspaceId/stats/live', {
    params: z.object({ workspaceId: z.string() }),
  })
  @Middleware(workspaceMembershipGuard)
  async workspaceLive(ctx: RequestContext) {
    const sse = ctx.sse();
    const workspaceId = ctx.params.workspaceId;

    const sendStats = async () => {
      const onlineUsers = getOnlineUsers();
      sse.send({
        onlineUsersCount: onlineUsers.size,
        timestamp: new Date().toISOString(),
      }, 'stats:update');
    };

    // Send initial data immediately
    await sendStats();

    // Then push updates every 10 seconds
    const interval = setInterval(sendStats, 10000);

    sse.onClose(() => {
      clearInterval(interval);
    });
  }
}
```

The `ctx.sse()` call sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive`. It returns an object with `send()` for data events and `onClose()` for cleanup when the client disconnects.

The project stats stream queries task counts by status and computes a completion rate:

```typescript
@Get('/projects/:projectId/stats/live', {
  params: z.object({ projectId: z.string() }),
})
@Middleware(projectAccessGuard)
async projectLive(ctx: RequestContext) {
  const sse = ctx.sse();
  const projectId = ctx.params.projectId;

  const sendStats = async () => {
    const tasksByStatus = await this.taskRepo.countByStatus(projectId);
    const totalTasks = Object.values(tasksByStatus).reduce(
      (sum, count) => sum + count, 0,
    );
    const doneTasks = tasksByStatus['done'] ?? 0;
    const completionRate = totalTasks > 0
      ? Math.round((doneTasks / totalTasks) * 100) : 0;

    sse.send({
      tasksByStatus,
      totalTasks,
      completionRate,
      timestamp: new Date().toISOString(),
    }, 'stats:update');
  };

  await sendStats();
  const interval = setInterval(sendStats, 10000);

  sse.onClose(() => {
    clearInterval(interval);
  });
}
```

There is also an activity stream endpoint that uses SSE keep-alive comments to maintain the connection:

```typescript
@Get('/workspaces/:workspaceId/activity/live', {
  params: z.object({ workspaceId: z.string() }),
})
@Middleware(workspaceMembershipGuard)
async activityLive(ctx: RequestContext) {
  const sse = ctx.sse();

  // Keep-alive comment every 30 seconds
  const interval = setInterval(() => {
    sse.comment('keep-alive');
  }, 30000);

  sse.onClose(() => {
    clearInterval(interval);
  });
}
```

The `sse.comment()` method sends a line starting with `:` -- the SSE spec says clients must ignore these, but they keep the TCP connection alive through proxies that might otherwise time out idle connections.

### Guards on SSE Routes

Notice that SSE endpoints use the same guards as regular REST endpoints. The workspace stats stream has `@Middleware(workspaceMembershipGuard)`, which verifies the user is a workspace member before establishing the stream. The project stats stream has `@Middleware(projectAccessGuard)`. Auth and authorization are handled identically to REST routes because SSE is just a regular HTTP GET that never closes.

This is one of the advantages of SSE over WebSocket for read-only streams. The entire HTTP middleware chain -- auth, guards, rate limiting, logging -- applies naturally. With WebSocket, I had to reimplement auth in the `@OnConnect` handler.

### Consuming SSE on the Client

The browser's `EventSource` API handles SSE natively, including automatic reconnection:

```javascript
// Client-side
const source = new EventSource(
  '/api/v1/projects/abc123/stats/live',
  { headers: { Authorization: `Bearer ${accessToken}` } }
);

source.addEventListener('stats:update', (event) => {
  const stats = JSON.parse(event.data);
  updateDashboard(stats);
});

source.onerror = () => {
  // EventSource auto-reconnects. Handle UI state here.
  showReconnecting();
};
```

The `EventSource` API is simpler than WebSocket client code. No connection management, no manual reconnection logic, no heartbeat handling. The browser does it all.

## Where the Two Streams Meet

The SSE stats controller imports the WebSocket controller's presence data:

```typescript
import { getOnlineUsers } from '@/modules/messages/presentation/chat.ws-controller';
```

The `getOnlineUsers()` function returns the in-memory map that the WebSocket controller maintains. The SSE stream reads the map size every 10 seconds and pushes it to dashboard clients. This is the bridge between the two real-time systems -- WebSocket manages the live data, SSE distributes aggregated views of it.

## When to Use WebSocket vs SSE

After building both in the same application, here is my decision framework:

**Use WebSocket when:**
- Communication is bidirectional (chat, collaborative editing, gaming)
- The client needs to send structured messages to the server
- You need custom event types beyond what SSE provides
- Low latency on client-to-server messages matters
- You need room/group semantics (Socket.IO rooms)

**Use SSE when:**
- Data flows server-to-client only (dashboards, notifications, live feeds)
- You want to reuse HTTP middleware (auth, guards, rate limiting)
- Auto-reconnection matters and you do not want to implement it yourself
- The update frequency is measured in seconds, not milliseconds
- You need to work through corporate proxies that block WebSocket upgrades

**Use neither when:**
- Polling every 30 seconds is fine for your use case (most admin dashboards)
- The data does not change frequently
- You do not want to manage persistent connections

In Vibed, chat is WebSocket because users send messages and need instant delivery. Dashboard stats are SSE because the server pushes numbers every 10 seconds and clients never send data back. Both run on the same Express 5 server, on the same port, behind the same auth system.

## The Architecture Summary

The final architecture looks like this:

```
Client (browser)
  |
  |--- HTTP REST -----> Express 5 (KickJS controllers)
  |                     auth: authBridgeMiddleware
  |                     guards: workspaceMembershipGuard, projectAccessGuard
  |
  |--- WebSocket -----> Socket.IO via WsAdapter (path: /ws)
  |    (chat)           auth: JWT in handshake data
  |                     rooms: channel:{id}
  |                     persistence: MongoDB via messageRepo
  |
  |--- SSE ------------> Express 5 GET endpoints (ctx.sse())
       (stats)           auth: authBridgeMiddleware (same as REST)
                         guards: same as REST
                         data: reads from in-memory presence + MongoDB aggregates
```

Three transport mechanisms, one server process, one port, one auth system (JWT), shared data stores. The WebSocket controller manages live state. The SSE controller reads that state and pushes aggregated views. REST handles everything else.

The total real-time code is about 250 lines -- 165 for the chat WebSocket controller, 95 for the SSE stats controller. Most of the complexity is in the chat controller's message handling and presence tracking, not in the transport layer. KickJS's `WsContext` and `ctx.sse()` abstractions keep the plumbing minimal.

If you are building an application that needs both interactive real-time features and passive data streams, running both WebSocket and SSE in the same process is simpler than it sounds. Pick the right tool for each feature and let them share the infrastructure.
