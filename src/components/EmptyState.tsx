import Link from "next/link";
import { Icon, type IconName } from "./Icons";

type EmptyStateProps = {
  icon: IconName;
  title: string;
  description: string;
  action?: {
    href: string;
    label: string;
  };
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? (
        <Link href={action.href} className="button">
          {action.label}
          <Icon name="arrowRight" size={16} />
        </Link>
      ) : null}
    </div>
  );
}