import { cn } from "@/shared/lib/cn";

type JarvisResponseProps = {
  text: string | null;
  working: boolean;
};

/** The concierge's current spoken answer, shown large and glowing. */
export function JarvisResponse({ text, working }: JarvisResponseProps) {
  return (
    <div className="jarvis-panel flex min-h-32 flex-col justify-center rounded-md p-4">
      <div className="jarvis-glow-text mb-2 text-2xs font-semibold tracking-[0.3em] opacity-70">
        RESPONSE
        {working ? <span className="jarvis-amber ml-2">▍</span> : null}
      </div>
      {text ? (
        <p
          data-testid="jarvis-response"
          className={cn(
            "jarvis-glow-text text-base leading-relaxed",
            working && "opacity-90",
          )}
        >
          {text}
        </p>
      ) : (
        <p className="text-sm opacity-40">
          {working ? "…working" : "Standing by. Ask me anything."}
        </p>
      )}
    </div>
  );
}
