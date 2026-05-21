import { Router } from "express";
import { db, userProfilesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

/** POST /api/auth/login */
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      res.status(400).json({ error: "email and password required" });
      return;
    }

    const rows = await db.execute(
      sql`SELECT user_id, email, role, password_hash FROM user_profiles WHERE email = ${email.toLowerCase().trim()} LIMIT 1`,
    );

    const user = rows.rows[0] as
      | {
          user_id: string;
          email: string;
          role: string;
          password_hash: string | null;
        }
      | undefined;

    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (!user.password_hash) {
      res.status(401).json({
        error:
          "Account not set up for password login — ask an admin to set your password",
      });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    req.session.userId = user.user_id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );

    res.json({ ok: true, userId: user.user_id, role: user.role });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/logout */
router.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

/** POST /api/auth/set-password — admin sets any user's password, or user sets their own */
router.post("/set-password", requireAuth, async (req, res, next) => {
  try {
    const { userId, password } = req.body as {
      userId?: string;
      password?: string;
    };
    if (!password || password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    const targetId = userId || req.auth!.userId;
    if (targetId !== req.auth!.userId && !req.auth!.isAdmin) {
      res.status(403).json({ error: "admin required to set another user's password" });
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    await db.execute(
      sql`UPDATE user_profiles SET password_hash = ${hash}, updated_at = now() WHERE user_id = ${targetId}`,
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
