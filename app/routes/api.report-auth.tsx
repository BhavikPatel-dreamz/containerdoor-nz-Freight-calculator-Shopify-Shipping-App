import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import prisma from "../db.server";
import { createReportSession, destroyReportSession } from "../lib/report-auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent");

  // ── Logout ────────────────────────────────────────────────────────────────
  if (intent === "logout") {
    return destroyReportSession(request);
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  const body = await request.json();
  const { email, password, shop } = body as {
    email: string;
    password: string;
    shop?: string;
  };

  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedShop = shop?.trim();

  if (!normalizedEmail || !password) {
    return data({ error: "Email and password are required." }, { status: 400 });
  }

  // Find user — prefer the current shop if provided, otherwise fall back to any active account.
  let user = normalizedShop
    ? await prisma.externalUser.findFirst({
        where: { shop: normalizedShop, email: normalizedEmail, isActive: true },
      })
    : null;

  if (!user) {
    user = await prisma.externalUser.findFirst({
      where: { email: normalizedEmail, isActive: true },
    });
  }

  if (!user || !user.passwordHash) {
    return data({ error: "Invalid email or password." }, { status: 401 });
  }

  const isBcryptHash = /^\$2[aby]\$\d{2}\$/.test(user.passwordHash);
  const valid = isBcryptHash
    ? await bcrypt.compare(password, user.passwordHash)
    : password === user.passwordHash;

  if (!valid) {
    return data({ error: "Invalid email or password." }, { status: 401 });
  }

  if (!isBcryptHash) {
    await prisma.externalUser.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
  }

  // Create session token
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  await prisma.externalSession.create({
    data: { userId: user.id, token, expiresAt },
  });

  return createReportSession(request, token);
}