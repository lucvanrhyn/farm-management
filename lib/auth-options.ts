import { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compareSync } from 'bcryptjs';
import { getUserByIdentifier, getFarmsForUser, isEmailVerified } from './meta-db';
import { checkRateLimit } from './rate-limit';
import { AUTH_ERROR_CODES } from './auth-errors';
import type { SessionFarm } from '../types/next-auth';

// Re-export the client-safe codes so tests + docs can keep importing from
// auth-options while client components import from auth-errors directly.
export { AUTH_ERROR_CODES } from './auth-errors';
export type { AuthErrorCode } from './auth-errors';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        identifier: { label: 'Email or Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) {
          throw new Error(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
        }

        // Rate limit: 10 attempts per minute per identifier to slow brute-force.
        // Throw so the UI can tell the user to wait instead of blaming their password.
        const rl = checkRateLimit(`login:${credentials.identifier}`, 10, 60_000);
        if (!rl.allowed) {
          throw new Error(AUTH_ERROR_CODES.RATE_LIMITED);
        }

        let user: Awaited<ReturnType<typeof getUserByIdentifier>>;
        try {
          user = await getUserByIdentifier(credentials.identifier);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? (err.stack ?? '') : '';
          console.error('[authorize] meta DB error:', message, stack);

          // A thrown "must be set in environment variables" error originates
          // from meta-db.getMetaClient() — treat as a preview/env misconfig
          // so the operator can spot it immediately instead of chasing a
          // phantom "wrong password" bug.
          if (/must be set in environment variables/i.test(message)) {
            throw new Error(AUTH_ERROR_CODES.SERVER_MISCONFIGURED);
          }
          throw new Error(AUTH_ERROR_CODES.DB_UNAVAILABLE);
        }

        if (!user) {
          // Keep generic to avoid account enumeration.
          throw new Error(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
        }

        const valid = compareSync(credentials.password, user.passwordHash);
        if (!valid) {
          throw new Error(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
        }

        // Users without email (e.g. LOGGER role) are auto-verified at creation.
        // Only check email verification for users who have an email address.
        if (user.email) {
          let verified: boolean;
          try {
            verified = await isEmailVerified(user.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[authorize] email verification check failed:', message);
            throw new Error(AUTH_ERROR_CODES.DB_UNAVAILABLE);
          }
          if (!verified) {
            throw new Error(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
          }
        }

        const farms = await getFarmsForUser(user.id);

        // role = highest-privilege farm role (ADMIN > DASHBOARD > LOGGER)
        const rolePriority: Record<string, number> = { ADMIN: 3, DASHBOARD: 2, LOGGER: 1 };
        const topRole = farms.reduce(
          (best, f) => ((rolePriority[f.role] ?? 0) > (rolePriority[best] ?? 0) ? f.role : best),
          'LOGGER',
        );

        return {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name ?? undefined,
          role: topRole,
          farms,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // Initial sign-in: authorize() already loaded farms + role, so we copy
      // them into the token and are done — no meta-db round-trip.
      if (user) {
        token.role = (user as { role: string }).role;
        token.username = (user as { username: string }).username;
        token.farms = (user as { farms: SessionFarm[] }).farms;
        return token;
      }
      // Explicit `useSession().update()` from the client — re-fetch on demand.
      // This is the only path that hits meta-db after sign-in; subsequent
      // `getServerSession()` reads use the cached farms from the JWT.
      //
      // Routes that need fresh ADMIN verification (bulk resets, tenant-wide
      // settings PATCH) call `verifyFreshAdminRole()` directly — see lib/auth.ts.
      if (trigger === 'update' && token.sub) {
        try {
          const farms = await getFarmsForUser(token.sub);
          token.farms = farms;
          const rolePriority: Record<string, number> = { ADMIN: 3, DASHBOARD: 2, LOGGER: 1 };
          token.role = farms.reduce(
            (best, f) => ((rolePriority[f.role] ?? 0) > (rolePriority[best] ?? 0) ? f.role : best),
            'LOGGER',
          );
        } catch (err) {
          console.error('[jwt] failed to refresh farms on update trigger:', err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
        session.user.username = token.username as string;
        session.user.farms = (token.farms ?? []) as SessionFarm[];
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};
