import jwt from 'jsonwebtoken';
import { HttpException } from '@forinda/kickjs-core';
import type { MiddlewareHandler } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';
import { env } from '@/config/env';

/**
 * Validates JWT from Authorization header and attaches user to req and ctx.
 *
 * NOTE: Each middleware and handler gets a separate RequestContext instance
 * with its own metadata Map (see router-builder.ts). So ctx.set() in middleware
 * is NOT visible to ctx.get() in the handler. We store on req as the shared object,
 * and also set on ctx for use within the same middleware.
 */
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  // Check if already authenticated
  if ((ctx.req as any).user) {
    ctx.set('user', (ctx.req as any).user);
    return next();
  }

  // Validate JWT from Authorization header
  const authHeader = ctx.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Authentication required');
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    const user = {
      id: payload.sub,
      email: payload.email,
      globalRole: payload.globalRole ?? 'user',
    };
    // Store on req (shared across all RequestContext instances for this request)
    (ctx.req as any).user = user;
    ctx.set('user', user);
  } catch {
    throw HttpException.unauthorized('Invalid or expired token');
  }

  next();
};
