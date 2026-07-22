import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import {
  Bold, Italic, Underline as UIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight,
  Link as LinkIcon, Code, Eraser, Pilcrow,
} from "lucide-react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  onEditor?: (e: Editor | null) => void;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, onEditor, placeholder }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "text-primary underline" } }),
      Placeholder.configure({ placeholder: placeholder ?? "Начните писать текст..." }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value || "<p></p>",
    editorProps: {
      attributes: {
        class:
          "tiptap-editor prose prose-sm dark:prose-invert max-w-none focus:outline-none px-6 py-4 min-h-full",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    immediatelyRender: false,
  });

  useEffect(() => { onEditor?.(editor); return () => onEditor?.(null); }, [editor, onEditor]);

  // Sync when value changes externally (e.g. reopen dialog)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value && value !== current) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return <div className="h-full border rounded-md" />;

  return (
    <div className="flex flex-col h-full min-h-0 border rounded-md bg-background overflow-hidden">
      <Toolbar editor={editor} />
      <div className="flex-1 min-h-0 overflow-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}


function Toolbar({ editor }: { editor: Editor }) {
  const btn = (active: boolean) =>
    `h-8 w-8 p-0 ${active ? "bg-accent text-accent-foreground" : ""}`;
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL ссылки", prev ?? "https://");
    if (url === null) return;
    if (url === "") { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-2 py-1 sticky top-0 z-10">
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => editor.chain().focus().undo().run()} title="Отменить (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => editor.chain().focus().redo().run()} title="Повторить"><Redo2 className="h-4 w-4" /></Button>
      <Sep />
      <Button size="sm" variant="ghost" className={btn(editor.isActive("paragraph"))} onClick={() => editor.chain().focus().setParagraph().run()} title="Обычный текст"><Pilcrow className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1"><Heading1 className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2"><Heading2 className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3"><Heading3 className="h-4 w-4" /></Button>
      <Sep />
      <Button size="sm" variant="ghost" className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} title="Жирный (Ctrl+B)"><Bold className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Курсив (Ctrl+I)"><Italic className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Подчёркнутый (Ctrl+U)"><UIcon className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Зачёркнутый"><Strikethrough className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("code"))} onClick={() => editor.chain().focus().toggleCode().run()} title="Код"><Code className="h-4 w-4" /></Button>
      <Sep />
      <Button size="sm" variant="ghost" className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Список"><List className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Нумерованный"><ListOrdered className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Цитата"><Quote className="h-4 w-4" /></Button>
      <Sep />
      <Button size="sm" variant="ghost" className={btn(editor.isActive({ textAlign: "left" }))} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="По левому"><AlignLeft className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive({ textAlign: "center" }))} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="По центру"><AlignCenter className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className={btn(editor.isActive({ textAlign: "right" }))} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="По правому"><AlignRight className="h-4 w-4" /></Button>
      <Sep />
      <Button size="sm" variant="ghost" className={btn(editor.isActive("link"))} onClick={setLink} title="Ссылка"><LinkIcon className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Очистить форматирование"><Eraser className="h-4 w-4" /></Button>
    </div>
  );
}

function Sep() { return <div className="w-px h-5 bg-border mx-1" />; }
