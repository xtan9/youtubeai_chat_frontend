export function ChatCapCounter({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  // Silent until 2 messages from the cap, per spec — counter pressure
  // appears only when it's actually relevant. Pro users (limit=-1 or
  // limit=Infinity) never see the counter.
  if (limit < 0 || !Number.isFinite(limit)) return null;
  if (used < limit - 2) return null;
  return (
    <p
      className="mt-1 text-center text-caption text-text-muted"
      data-paywall-counter="chat"
    >
      {used} of {limit} free messages used
    </p>
  );
}
