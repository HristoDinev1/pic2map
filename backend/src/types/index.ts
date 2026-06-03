export type Role = 'USER' | 'MODERATOR' | 'ADMIN';

export interface AuthUser {
  id: string;          // internal users.id
  cognitoSub: string;
  username: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
