import { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compareSync } from 'bcryptjs';
import { getUserByIdentifier, getFarmsForUser, isEmailVerified } from './meta-db';
import type { SessionFarm } from '../types/next-auth';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        identifier: { label: 'Email or Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null;
        try {
          const user = await getUserByIdentifier(credentials.identifier);
          if (!user) return null;

          const valid = compareSync(credentials.password, user.passwordHash);
          if (!valid) return null;

          // Users without email (e.g. LOGGER role) are auto-verified at creation
          // Only check email verification for users who have an email address
          if (user.email) {
            const verified = await isEmailVerified(user.id);
            if (!verified) return null;
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
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[authorize] meta DB error:', message);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.username = (user as { username: string }).username;
        token.farms = (user as { farms: SessionFarm[] }).farms;
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
