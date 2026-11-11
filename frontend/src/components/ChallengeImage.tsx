import { useState } from "react";

export function ChallengeImage({
  url,
  title,
  thumbnail = false,
}: {
  url: string | null;
  title: string;
  thumbnail?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) return null;
  return (
    <img
      key={url}
      src={url}
      alt={`Reference for ${title}`}
      loading="lazy"
      className={thumbnail
        ? "mt-3 h-24 max-w-full rounded-lg bg-slate-50 object-contain"
        : "mt-3 max-h-80 w-full rounded-lg bg-slate-50 object-contain"}
      onError={() => setFailedUrl(url)}
    />
  );
}
