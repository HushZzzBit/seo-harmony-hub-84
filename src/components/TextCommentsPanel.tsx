import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RoundCheckbox } from "@/components/RoundCheckbox";
import { Trash2, MessageSquare, CheckCircle2 } from "lucide-react";
import type { TextComment } from "@/lib/types";

interface Props {
  comments: TextComment[];
  draftQuote: string | null;
  onSubmitDraft: (body: string) => void;
  onCancelDraft: () => void;
  onToggleResolved: (c: TextComment, resolved: boolean) => void;
  onDelete: (c: TextComment) => void;
  onJump: (c: TextComment) => void;
}

export function TextCommentsPanel({
  comments,
  draftQuote,
  onSubmitDraft,
  onCancelDraft,
  onToggleResolved,
  onDelete,
  onJump,
}: Props) {
  const [body, setBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draftQuote !== null) {
      setBody("");
      setTimeout(() => ref.current?.focus(), 30);
    }
  }, [draftQuote]);

  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);
  const list = showResolved ? [...open, ...resolved] : open;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <MessageSquare className="h-4 w-4" />
          Комментарии ({open.length})
        </div>
        {resolved.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? "Скрыть решённые" : `Решённые (${resolved.length})`}
          </button>
        )}
      </div>

      {draftQuote !== null && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2">
          <div className="text-xs text-muted-foreground line-clamp-3 border-l-2 border-primary/50 pl-2 italic">
            {draftQuote || "—"}
          </div>
          <Textarea
            ref={ref}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Что нужно исправить в этом фрагменте?"
            className="text-xs min-h-[64px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
                e.preventDefault();
                onSubmitDraft(body.trim());
              }
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={!body.trim()} onClick={() => onSubmitDraft(body.trim())}>
              Оставить
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelDraft}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      {!list.length && draftQuote === null && (
        <div className="text-xs text-muted-foreground">
          Выделите фрагмент текста в редакторе и нажмите «Комментарий».
        </div>
      )}

      <div className="space-y-2">
        {list.map((c) => (
          <div
            key={c.id}
            className={[
              "rounded-md border p-2 space-y-1.5 cursor-pointer transition",
              c.resolved ? "opacity-60 bg-muted/30" : "bg-background hover:border-primary/50",
            ].join(" ")}
            onClick={() => onJump(c)}
          >
            <div className="flex items-start gap-2">
              <RoundCheckbox
                checked={c.resolved}
                onChange={(v) => onToggleResolved(c, v)}
                aria-label="Отметить как решённый"
                title={c.resolved ? "Вернуть в работу" : "Отметить как решённый"}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground line-clamp-2 border-l-2 border-border pl-2 italic">
                  {c.quote || "—"}
                </div>
                <div className={`text-xs mt-1 whitespace-pre-wrap ${c.resolved ? "line-through" : ""}`}>{c.body}</div>
                <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.resolved && (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      решено
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Удалить комментарий"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
