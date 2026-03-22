import jwt from 'jsonwebtoken';
import { HttpException } from '@forinda/kickjs-core';
import type { MiddlewareHandler } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';
import { env } from '@/config/env';

/**
 * Validates JWT from Authorization header, sets user in ctx metadata,
 * and rejects unauthenticated requests with 401.
 *
 * Apply at class level on all controllers that require authentication.
 * For public routes, don't use this middleware.
 */
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  // Check if AuthAdapter already set req.user
  const existingUser = (ctx.req as any).user;
  if (existingUser) {
    ctx.set('user', existingUser);
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
    (ctx.req as any).user = user;
    ctx.set('user', user);
  } catch {
    throw HttpException.unauthorized('Invalid or expired token');
  }

  next();
};
