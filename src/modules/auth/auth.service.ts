import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../../infrastructure/db/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/errorHandler.js";
import crypto from "node:crypto";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "EDITOR",
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
});

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LEN = 64;
const PBKDF2_DIGEST = "sha512";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(
    password, 
    salt, 
    PBKDF2_ITERATIONS, 
    PBKDF2_KEY_LEN, 
    PBKDF2_DIGEST
  ).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;

    // Check 100,000 iterations
    const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, PBKDF2_DIGEST).toString("hex");
    const keyBuf = Buffer.from(key, "hex");
    const derivedBuf = Buffer.from(derived, "hex");

    if (keyBuf.length === derivedBuf.length && crypto.timingSafeEqual(keyBuf, derivedBuf)) {
      return true;
    }

    // Check legacy 1,000 iteration fallback for backward-compatibility during migration
    const legacyDerived = crypto.pbkdf2Sync(password, salt, 1000, PBKDF2_KEY_LEN, PBKDF2_DIGEST).toString("hex");
    const legacyBuf = Buffer.from(legacyDerived, "hex");

    if (keyBuf.length === legacyBuf.length && crypto.timingSafeEqual(keyBuf, legacyBuf)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export class AuthService {
  async register(data: {
    name: string;
    email: string;
    password: string;
    role?: "ADMIN" | "EDITOR" | "CURATOR" | "REVIEWER" | string;
  }) {
    const email = data.email.toLowerCase().trim();
    const name = data.name.trim();

    if (!name || name.length < 2) {
      throw new AppError("Full name must be at least 2 characters long", 400);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError("A valid email address is required", 400);
    }

    if (!data.password || data.password.length < 6) {
      throw new AppError("Password must be at least 6 characters long", 400);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError("An account with this email address already exists", 409);
    }

    const hashedPassword = hashPassword(data.password);
    const role = (data.role || "EDITOR").toUpperCase();

    const user = await prisma.user.create({
      data: {
        name,
        email,
        role: role as any,
        emailVerified: true,
        accounts: {
          create: {
            accountId: email,
            providerId: "credential",
            password: hashedPassword,
          },
        },
        profile: {
          create: {
            preferredLanguage: "hi",
            autoSnapToShots: true,
            minScoreFilter: 0.70,
            themePreference: "dark",
          },
        },
      },
      include: {
        profile: true,
      },
    });

    // Create 7-day session token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
      token,
      expiresAt,
    };
  }

  async login(credentials: { email: string; password: string }) {
    const email = credentials.email.toLowerCase().trim();
    const password = credentials.password;

    if (!email || !password) {
      throw new AppError("Email and password are required", 400);
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        accounts: true,
        profile: true,
      },
    });

    if (!user) {
      throw new AppError("Invalid email or password", 401);
    }

    const account = user.accounts.find((a) => a.providerId === "credential");
    if (!account || !account.password) {
      throw new AppError("Invalid email or password", 401);
    }

    const isValid = verifyPassword(password, account.password);
    if (!isValid) {
      throw new AppError("Invalid email or password", 401);
    }

    // Generate session token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
      token,
      expiresAt,
    };
  }

  async getCurrentUser(token?: string) {
    if (!token) {
      throw new AppError("Authentication token is required", 401);
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: {
        user: {
          include: { profile: true },
        },
      },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        // Clean up expired session
        await prisma.session.delete({ where: { token } }).catch(() => {});
      }
      throw new AppError("Session expired or invalid", 401);
    }

    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      image: session.user.image,
    };
  }

  async logout(token?: string) {
    if (token) {
      await prisma.session.deleteMany({ where: { token } }).catch(() => {});
    }
    return { success: true };
  }
}

export const authService = new AuthService();


