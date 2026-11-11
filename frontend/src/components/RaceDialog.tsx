import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export function RaceDialog({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);
  return <dialog ref={ref} className="race-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className="race-dialog-header"><span className="race-eyebrow">HOST CONTROL</span><button type="button" className="race-icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>
    <h2 id={titleId}>{title}</h2>
    <div className="race-dialog-body">{children}</div>
    {footer ? <div className="race-dialog-footer">{footer}</div> : null}
  </dialog>;
}
