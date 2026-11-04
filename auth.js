import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

export const authConfigured = !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.AUTH_SECRET);

// GitHub OAuth with the smallest scope: read:user (public profile; public repos are readable with any token).
// The access token is kept only inside the encrypted, httpOnly Auth.js JWT cookie and is read server-side
// (lib/guard.js -> userToken). It is never put in the session object the browser can see.
export const { handlers, auth } = NextAuth({
  providers: [GitHub({ authorization: { params: { scope: 'read:user' } } })],
  session: { strategy: 'jwt', maxAge: 7 * 24 * 3600 },
  trustHost: true,
  callbacks: {
    jwt({ token, account, profile }) {
      if (account && profile) { token.gh = account.access_token; token.login = String(profile.login || ''); token.ghId = profile.id; }
      return token;
    },
    session({ session, token }) {
      session.user = { login: token.login, name: session.user && session.user.name ? String(session.user.name).slice(0, 80) : token.login };
      return session;
    }
  }
});
