/**
 * Action menus, on Radix DropdownMenu: arrow keys and type-ahead through the
 * items, Enter to run one, Escape or an outside press to close, and focus back
 * on the trigger afterwards.
 *
 * `ActionMenu` is the common case, a "more" button with a list of actions.
 * The parts are exported for anything that needs a different shape.
 */

"use client";

import { MoreHorizontal } from "lucide-react";
import { DropdownMenu as Primitive } from "radix-ui";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { POP_PANEL } from "./popover";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;

export const DropdownMenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Primitive.Content>>(function DropdownMenuContent(
  { className, style, sideOffset = 4, collisionPadding = 8, ...props },
  ref,
) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        style={{ "--origin": "var(--radix-dropdown-menu-content-transform-origin)", ...style } as React.CSSProperties}
        className={cn(POP_PANEL, "min-w-48 p-1 outline-none", className)}
        {...props}
      />
    </Primitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Primitive.Item> & { destructive?: boolean; icon?: ReactNode }
>(function DropdownMenuItem({ className, destructive, icon, children, ...props }, ref) {
  return (
    <Primitive.Item
      ref={ref}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none select-none",
        "data-disabled:pointer-events-none data-disabled:opacity-40",
        destructive ? "text-alarm data-highlighted:bg-alarm/10" : "text-fg-2 data-highlighted:bg-surface-3 data-highlighted:text-fg",
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 opacity-80">{icon}</span> : null}
      {children}
    </Primitive.Item>
  );
});

export function DropdownMenuSeparator() {
  return <Primitive.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function ActionMenu({
  items,
  label = "More actions",
  className,
  align = "right",
  trigger,
  triggerClassName,
}: {
  /** `null` entries draw a separator. */
  items: (MenuItem | null)[];
  /** The trigger's accessible name. */
  label?: string;
  className?: string;
  align?: "left" | "right";
  /** Button content; defaults to a "more" icon. */
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  return (
    <div className={className}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={label}
          className={cn(
            "press flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-3 hover:text-fg",
            "data-[state=open]:bg-surface-3 data-[state=open]:text-fg",
            triggerClassName,
          )}
        >
          {trigger ?? <MoreHorizontal size={17} />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align === "right" ? "end" : "start"}>
          {items.map((item, index) =>
            item === null ? (
              <DropdownMenuSeparator key={`separator-${index}`} />
            ) : (
              <DropdownMenuItem key={index} icon={item.icon} destructive={item.destructive} disabled={item.disabled} onSelect={item.onSelect}>
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
