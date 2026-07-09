import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const categoryMasks = [
  { mask: "{min_price}", desc: "Минимальная цена товара в категории" },
  { mask: "{goods_count}", desc: "Количество товаров в категории или разделе" },
  { mask: "{category}", desc: "Название категории товаров (Игры, Програмное обеспечение, Сервисы и соцсети, Внутриигровые ценности)" },
  { mask: "{section}", desc: "Название раздела" },
  { mask: "{sub_section}", desc: "Название подраздела" },
  { mask: "{h1}", desc: "Заголовок текущей страницы" },
  { mask: "{direction}", desc: "Жанр или направления, например: (Файтинги, Продукция Майкрософт)" },
  { mask: "{platform}", desc: "Поддерживаемая платформа, такая как Steam, Ps5, Xbox. из категорий" },
  { mask: "{pay_method}", desc: "Статический список способов оплаты (Visa, MasterCard, USDT, СБП)" },
  { mask: "{review}", desc: "Количество отзывов на товар или категорию" },
  { mask: "{last_section}", desc: "Последняя вложенность, например: издания для игр (Ultimate Edition, Standard Edition)" },
];

const virtualMasks = [
  { mask: "{min_price}", desc: "Минимальная цена товара в категории" },
  { mask: "{section}", desc: "Название раздела" },
  { mask: "{h1}", desc: "Заголовок текущей страницы" },
  { mask: "{pay_method}", desc: "Статический список способов оплаты (Visa, MasterCard, USDT, СБП)" },
];

function MaskList({ title, items }: { title: string; items: { mask: string; desc: string }[] }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground mb-1">
        {title}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <div key={item.mask} className="flex gap-2 text-[11px] leading-snug">
            <code className="shrink-0 font-mono text-primary bg-primary/10 border border-primary/20 px-1 rounded">
              {item.mask}
            </code>
            <span className="text-foreground/85">{item.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VariableHint() {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition"
            aria-label="Подсказка по переменным"
          >
            <Info className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-[360px] bg-popover text-popover-foreground border border-border shadow-lg px-3 py-2"
        >
          <div className="text-xs font-semibold mb-1.5">Маски и их значение</div>
          <MaskList title="Для категории" items={categoryMasks} />
          <MaskList title="Для виртуальной категории" items={virtualMasks} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
