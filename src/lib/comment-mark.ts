import { Mark, mergeAttributes, type Editor } from "@tiptap/core";

/**
 * Google-Docs-подобные комментарии: выделенный фрагмент помечается
 * <span data-comment-id="..."> и подсвечивается. Сами комментарии
 * (текст, автор, статус «решено») живут в сторе, а не в HTML.
 */
export const CommentMark = Mark.create({
  name: "seoComment",
  inclusive: false,
  excludes: "",
  keepOnSplit: false,

  addAttributes() {
    return {
      commentId: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-comment-id"),
        renderHTML: (attrs) =>
          attrs.commentId ? { "data-comment-id": attrs.commentId as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "seo-comment" }, HTMLAttributes), 0];
  },
});

/** Ставит метку комментария на текущее выделение. */
export function applyCommentMark(editor: Editor, id: string) {
  editor.chain().focus().setMark("seoComment", { commentId: id }).run();
}

/** Убирает метку комментария с конкретным id по всему документу. */
export function removeCommentMark(editor: Editor, id: string) {
  const { state, view } = editor;
  const type = state.schema.marks.seoComment;
  if (!type) return;
  const tr = state.tr;
  let changed = false;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type === type && m.attrs.commentId === id);
    if (mark) {
      tr.removeMark(pos, pos + node.nodeSize, type);
      changed = true;
    }
  });
  if (changed) view.dispatch(tr);
}

/** Убирает все метки комментариев (используется при экспорте/очистке). */
export function stripCommentSpans(html: string): string {
  return html.replace(/<span[^>]*data-comment-id="[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1");
}

/** Прокручивает к фрагменту и выделяет его. */
export function focusComment(editor: Editor, id: string) {
  const { state } = editor;
  const type = state.schema.marks.seoComment;
  if (!type) return;
  let from: number | null = null;
  let to: number | null = null;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (node.marks.some((m) => m.type === type && m.attrs.commentId === id)) {
      if (from === null) from = pos;
      to = pos + node.nodeSize;
    }
  });
  if (from === null || to === null) return;
  editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
}
