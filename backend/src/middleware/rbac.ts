import { NextFunction, Request, Response } from 'express';
import { HttpError } from './error';
import type { Role } from '../types';

const rank: Record<Role, number> = { USER: 1, MODERATOR: 2, ADMIN: 3 };

/** Require at least the given role. */
export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Unauthenticated'));
    if (rank[req.user.role] < rank[min]) {
      return next(new HttpError(403, `Requires ${min} role`));
    }
    next();
  };
}
