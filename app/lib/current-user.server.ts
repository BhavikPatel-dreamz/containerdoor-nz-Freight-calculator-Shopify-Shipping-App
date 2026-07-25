/**
 * Resolve the current OMS operator from a Shopify session.
 * Online sessions often include firstName/lastName/email on the Session row.
 * Offline sessions usually only have shop — fall back to shop label.
 */
export type CurrentOmsUser = {
  name: string;
  email: string;
  initials: string;
  /** Short author stamp used on notes / bulk performedBy (e.g. "JD") */
  noteAuthor: string;
};

function initialsFrom(name: string, email: string, shop: string): string {
  const fromName = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  if (fromName) return fromName;
  if (email) return email.slice(0, 2).toUpperCase();
  const shopLabel = shop.replace(/\.myshopify\.com$/i, "").replace(/[^a-zA-Z0-9]/g, "");
  return (shopLabel.slice(0, 2) || "OMS").toUpperCase();
}

export function currentUserFromSession(session: {
  shop: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): CurrentOmsUser {
  const first = (session.firstName ?? "").trim();
  const last = (session.lastName ?? "").trim();
  const email = (session.email ?? "").trim();
  const name =
    [first, last].filter(Boolean).join(" ") ||
    email ||
    session.shop.replace(/\.myshopify\.com$/i, "");
  const initials = initialsFrom(name, email, session.shop);
  return {
    name,
    email,
    initials,
    noteAuthor: initials,
  };
}
