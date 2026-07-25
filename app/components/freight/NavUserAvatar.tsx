type NavUserAvatarProps = {
  name: string;
  email?: string;
  initials: string;
};

/** Simple avatar for embedded admin OMS (no logout — Shopify host owns that). */
export function NavUserAvatar({ name, email, initials }: NavUserAvatarProps) {
  return (
    <div className="fo-avatar" title={email && email !== name ? `${name} · ${email}` : name}>
      {initials}
    </div>
  );
}
