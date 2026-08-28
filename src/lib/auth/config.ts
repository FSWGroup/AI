import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { z } from "zod";

/**
 * Authentication configuration.
 *
 * Providers activate purely from environment configuration — no code changes:
 *  - Credentials (email/password): AUTH_ENABLE_PASSWORD !== "false"
 *  - Magic link:                   EMAIL_SERVER_HOST + EMAIL_FROM present
 *  - Microsoft Entra ID (OIDC):    AUTH_MICROSOFT_ENTRA_ID_* present
 *
 * MFA is delegated to the identity provider (Entra ID), which is the correct
 * place for it in an organization that already runs Microsoft 365.
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function isPasswordAuthEnabled(): boolean {
  return process.env.AUTH_ENABLE_PASSWORD !== "false";
}

export function isMagicLinkEnabled(): boolean {
  return Boolean(process.env.EMAIL_SERVER_HOST && process.env.EMAIL_FROM);
}

export function isMicrosoftSsoEnabled(): boolean {
  return Boolean(
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
      process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
      process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
  );
}

function buildProviders(): NextAuthConfig["providers"] {
  const providers: NextAuthConfig["providers"] = [];

  if (isPasswordAuthEnabled()) {
    providers.push(
      Credentials({
        id: "credentials",
        name: "Email and password",
        credentials: {
          email: { label: "Work email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;

          const email = parsed.data.email.toLowerCase().trim();
          const user = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
              passwordHash: true,
              status: true,
            },
          });

          // Uniform failure: never reveal whether the account exists.
          if (!user?.passwordHash || user.status === "INACTIVE") {
            // Equalize timing against the bcrypt comparison below.
            await bcrypt.compare(
              parsed.data.password,
              "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv",
            );
            return null;
          }

          const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
          if (!ok) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          };
        },
      }),
    );
  }

  if (isMagicLinkEnabled()) {
    providers.push(
      Nodemailer({
        server: {
          host: process.env.EMAIL_SERVER_HOST,
          port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
          auth:
            process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD
              ? {
                  user: process.env.EMAIL_SERVER_USER,
                  pass: process.env.EMAIL_SERVER_PASSWORD,
                }
              : undefined,
        },
        from: process.env.EMAIL_FROM,
      }),
    );
  }

  if (isMicrosoftSsoEnabled()) {
    providers.push(
      MicrosoftEntraId({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      }),
    );
  }

  return providers;
}

export const authConfig = {
  adapter: PrismaAdapter(prisma),
  providers: buildProviders(),
  session: {
    strategy: "jwt",
    maxAge: Number(process.env.SESSION_MAX_AGE_SECONDS ?? 60 * 60 * 12),
  },
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
    error: "/sign-in",
  },
  trustHost: true,
  callbacks: {
    async signIn({ user }) {
      // Deactivated people cannot sign in through any provider, including SSO.
      if (!user.email) return false;
      const record = await prisma.user.findUnique({
        where: { email: user.email.toLowerCase() },
        select: { status: true },
      });
      // SSO may present a person who has no FSW record: refuse rather than
      // auto-provision. SCIM/HRIS provisioning is the supported path.
      if (!record) return false;
      return record.status !== "INACTIVE";
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await prisma.auditEvent.create({
        data: {
          actorId: user.id,
          actorEmail: user.email ?? null,
          action: "auth.sign_in",
          entityType: "USER",
          entityId: user.id,
        },
      });
    },
  },
} satisfies NextAuthConfig;

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
