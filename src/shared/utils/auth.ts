import type { RequestContext } from '@forinda/kickjs-http';
import { HttpException } from '@forinda/kickjs-core';

export interface AuthUser {
  id: string;
  email: string;
  globalRole: string;
}

/**
 * Get the authenticated user from the request.
 * Reads from req.user (set by authBridgeMiddleware).
 *
 * NOTE: ctx.get('user') does NOT work across middleware → handler because
 * each gets a separate RequestContext with its own metadata Map.
 * req is the shared object across all contexts for a request.
 */
export function getUser(ctx: RequestContext): AuthUser {
  const user = (ctx.req as any).user as AuthUser | undefined;
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }
  return user;
}
