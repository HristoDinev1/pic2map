import { NextFunction, Request, Response } from 'express';
import { jwtVerifier } from '../lib/cognito';
import { one } from '../lib/db';
import { HttpError } from './error';
import type { AuthUser, Role } from '../types';

function rolesFromGroups(groups: string[] | undefined): Role {
  const g = groups ?? [];
  if (g.includes('Administrators')) return 'ADMIN';
  if (g.includes('Moderators')) return 'MODERATOR';
  return 'USER';
}

/**
 * Verifies the Cognito ID token, then upserts a mirror row in `users`
 * keyed by the Cognito `sub`. Keeps role in sync with Cognito groups.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Missing bearer token');

    const payload = await jwtVerifier.verify(token);
    const sub = payload.sub as string;
    const email = (payload.email as string) ?? '';
    const username =
      (payload['cognito:username'] as string) ?? (payload.email as string) ?? sub;
    const role = rolesFromGroups(payload['cognito:groups'] as string[] | undefined);

    const user = await one<AuthUser>(
      `INSERT INTO users (cognito_sub, username, email, role)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (cognito_sub) DO UPDATE
         SET email = EXCLUDED.email,
             role  = EXCLUDED.role,
             updated_at = now()
       RETURNING id, cognito_sub AS "cognitoSub", username, email, role`,
      [sub, username, email, role]
    );

    if (!user) throw new HttpError(401, 'User sync failed');
    if (!(await one('SELECT 1 FROM users WHERE id=$1 AND is_active', [user.id]))) {
      throw new HttpError(403, 'Account disabled');
    }
    req.user = user;
    next();
  } catch (e) {
    if (e instanceof HttpError) return next(e);
    next(new HttpError(401, 'Invalid or expired token'));
  }
}
