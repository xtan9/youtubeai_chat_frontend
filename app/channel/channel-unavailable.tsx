export function ChannelUnavailable() {
  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-12 sm:px-6 sm:py-16"
      data-channel-release="unavailable"
      aria-labelledby="channel-unavailable-heading"
    >
      <h1
        id="channel-unavailable-heading"
        className="text-3xl font-semibold tracking-[-0.03em] text-text-primary"
      >
        Channel is temporarily unavailable
      </h1>
      <p className="max-w-prose text-body-md leading-7 text-text-secondary">
        Channel account state could not be verified. Try again later; no
        Channel or external action was started.
      </p>
    </main>
  );
}
