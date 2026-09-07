"use client";
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
const media = "(min-width: 1100px)";
function subscribe(notify: () => void) {
  const query = window.matchMedia(media);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
/** A modeless comparison panel on desktop, a focus-trapped sheet on phones. */
export function BookingInspector({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(media).matches,
    () => false,
  );
  const opener = useRef<HTMLElement | null>(null);
  const content = (
    <DialogPrimitive.Content
      className="booking-inspector"
      onOpenAutoFocus={() => {
        opener.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }}
      onCloseAutoFocus={(event) => {
        if (opener.current?.isConnected) {
          event.preventDefault();
          opener.current.focus({ preventScroll: true });
        }
      }}
      onInteractOutside={(event) => {
        if (desktop) event.preventDefault();
      }}
    >
      <DialogPrimitive.Close
        className="inspector-close"
        aria-label="Close flight details"
      >
        <X className="size-5" />
      </DialogPrimitive.Close>
      {children}
    </DialogPrimitive.Content>
  );
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      modal={!desktop}
    >
      {desktop ? (
        content
      ) : (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="inspector-overlay" />
          {content}
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  );
}
