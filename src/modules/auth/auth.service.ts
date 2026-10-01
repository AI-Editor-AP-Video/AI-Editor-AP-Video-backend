import { auth } from "../../config/auth.config.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { cacheService } from "../../infrastructure/cache/cache.service.js";
import { AppError } from "../../middleware/errorHandler.js";

export { auth };

export interface AuthUserPayload {
  id: string;
  name: string | null;
  email: string;
  role: string;
  image?: string | null;
}

export interface AuthSessionResponse {
  user: AuthUserPayload;
  token: string;
  expiresAt: Date;
}

export class AuthService {
  /**
   * Register a new user exclusively via Better-Auth
   */
  async register(data: {
    name: string;
    email: string;
    password: string;
    role?: string;
  }): Promise<AuthSessionResponse> {
    const email = data.email?.toLowerCase().trim();
    const name = data.name?.trim();
    const role = (data.role || "EDITOR").toUpperCase();

    if (!name || name.length < 2) {
      throw new AppError("Full name must be at least 2 characters long", 400);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError("A valid email address is required", 400);
    }

    if (!data.password || data.password.length < 6) {
      throw new AppError("Password must be at least 6 characters long", 400);
    }

    try {
      // Delegate account creation and password hashing entirely to Better-Auth
      const response = await auth.api.signUpEmail({
        body: {
          name,
          email,
          password: data.password,
          role,
        },
      });

      if (!response || !response.user || !response.token) {
        throw new AppError("Failed to create account via authentication service", 500);
      }

      // Initialize default editorial profile if not present (non-blocking)
      prisma.editorProfile.upsert({
        where: { userId: response.user.id },
        update: {},
        create: {
          userId: response.user.id,
          preferredLanguage: "hi",
          autoSnapToShots: true,
          minScoreFilter: 0.70,
          themePreference: "dark",
        },
      }).catch(() => {});

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const userPayload: AuthUserPayload = {
        id: response.user.id,
        name: response.user.name ?? name,
        email: response.user.email,
        role: (response.user as any).role || role,
        image: response.user.image,
      };

      // Pre-warm memory cache for immediate subsequent requests
      await cacheService.set(`auth:token:${response.token}`, userPayload, 300);

      return {
        user: userPayload,
        token: response.token,
        expiresAt,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      const message = err.message || err.body?.message || "Registration failed";
      const status = err.statusCode || err.status || 400;
      throw new AppError(message, status);
    }
  }

  /**
   * Authenticate user credentials exclusively via Better-Auth
   */
  async login(credentials: {
    email: string;
    password: string;
  }): Promise<AuthSessionResponse> {
    const email = credentials.email?.toLowerCase().trim();
    const password = credentials.password;

    if (!email || !password) {
      throw new AppError("Email and password are required", 400);
    }

    try {
      // Authenticate directly through Better-Auth SDK
      const response = await auth.api.signInEmail({
        body: {
          email,
          password,
        },
      });

      if (!response || !response.user || !response.token) {
        throw new AppError("Invalid email or password", 401);
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const userPayload: AuthUserPayload = {
        id: response.user.id,
        name: response.user.name ?? null,
        email: response.user.email,
        role: (response.user as any).role || "EDITOR",
        image: response.user.image,
      };

      // Pre-warm memory cache for sub-millisecond future auth checks
      await cacheService.set(`auth:token:${response.token}`, userPayload, 300);

      return {
        user: userPayload,
        token: response.token,
        expiresAt,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      const message = err.message || err.body?.message || "Invalid email or password";
      const status = err.statusCode || err.status || 401;
      throw new AppError(message, status);
    }
  }

  /**
   * High-Speed Session & Token Verification (<0.1ms via L1 Cache)
   */
  async getCurrentUser(token?: string, headers?: Headers | Record<string, any>): Promise<AuthUserPayload> {
    // 1. Fast-path: Check memory / Redis token cache first (Zero DB roundtrip)
    if (token) {
      const cached = await cacheService.get<AuthUserPayload>(`auth:token:${token}`);
      if (cached) {
        return cached;
      }
    }

    // 2. If headers provided and no direct token match, try Better-Auth getSession
    if (headers) {
      try {
        const session = await auth.api.getSession({
          headers: headers as any,
        });
        if (session && session.user) {
          const userPayload: AuthUserPayload = {
            id: session.user.id,
            name: session.user.name ?? null,
            email: session.user.email,
            role: (session.user as any).role || "EDITOR",
            image: session.user.image,
          };
          if (session.session?.token) {
            await cacheService.set(`auth:token:${session.session.token}`, userPayload, 120);
          }
          return userPayload;
        }
      } catch {
        // Fallback to token lookup below
      }
    }

    // 3. Database lookup on cache miss
    if (!token) {
      throw new AppError("Authentication token is required", 401);
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: {
        user: true,
      },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        prisma.session.delete({ where: { token } }).catch(() => {});
      }
      await cacheService.del(`auth:token:${token}`);
      throw new AppError("Session expired or invalid", 401);
    }

    const userPayload: AuthUserPayload = {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
      role: session.user.role,
      image: session.user.image,
    };

    // Cache verified session for 120 seconds
    await cacheService.set(`auth:token:${token}`, userPayload, 120);

    return userPayload;
  }

  /**
   * Terminate active session and invalidate cache
   */
  async logout(token?: string, headers?: Headers | Record<string, any>): Promise<{ success: boolean }> {
    if (token) {
      await cacheService.del(`auth:token:${token}`);
      prisma.session.deleteMany({ where: { token } }).catch(() => {});
    }

    if (headers) {
      try {
        await auth.api.signOut({
          headers: headers as any,
        });
      } catch {
        // Fallback
      }
    }

    return { success: true };
  }
}

export const authService = new AuthService();
