import type { ReactNode, MouseEvent } from "react";

type ModalProps = {
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
  className?: string;
  closeOnOverlay?: boolean;
};

export function Modal({
  open = true,
  onClose,
  children,
  width = 640,
  className = "",
  closeOnOverlay = true,
}: ModalProps) {
  if (!open) return null;

  const handleOverlay = (e: MouseEvent) => {
    if (!closeOnOverlay) return;
    if (e.target === e.currentTarget) onClose();
  };

  const widthStyle = typeof width === "number" ? `${width}px` : width;

  return (
    <div className="fo-overlay" onClick={handleOverlay} role="presentation">
      <div
        className={`fo-modal fo-modal-workspace ${className}`.trim()}
        style={{ width: widthStyle, maxWidth: "95vw" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

type ModalHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
};

export function ModalHeader({ title, subtitle, icon, onClose, closeDisabled }: ModalHeaderProps) {
  return (
    <div className="fo-modal-hdr fo-ws-hdr">
      <div className="fo-ws-hdr-main">
        {icon ? <span className="fo-ws-hdr-icon">{icon}</span> : null}
        <div>
          <div className="fo-modal-title">{title}</div>
          {subtitle ? <div className="fo-modal-sub">{subtitle}</div> : null}
        </div>
      </div>
      {onClose ? (
        <button
          type="button"
          className="fo-modal-close"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function ModalBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`fo-modal-body fo-ws-body ${className}`.trim()}>{children}</div>;
}

export function ModalFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`fo-modal-ftr fo-ws-ftr ${className}`.trim()}>{children}</div>;
}

export function ModalSection({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`fo-ws-section ${className}`.trim()}>
      {title ? <div className="fo-ws-section-title">{title}</div> : null}
      {children}
    </section>
  );
}
