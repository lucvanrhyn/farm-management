import type { DefaultSession } from 'next-auth';
import type { DefaultJWT } from 'next-auth/jwt';

export interface SessionFarm {
  slug: string;
  displayName: string;
  role: string;
  logoUrl: string | null;
  tier: string;
  subscriptionStatus: string;
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string | null;
      username: string;
      name?: string | null;
      role: string;          // role on the most recently selected farm (kept for backward compat)
      farms: SessionFarm[];  // all farms the user has access to
    } & DefaultSession['user'];
  }

  interface User {
    role: string;
    username: string;
    farms: SessionFarm[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    role: string;
    username: string;
    farms: SessionFarm[];
  }
}
