import Icon from "./Icon";

type WipPlaceholderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  icon?: string;
};

export default function WipPlaceholder({
  title,
  eyebrow = "Working In Progress",
  description = "This surface is reserved in the Market Desk JS architecture and will be wired into the Conviction Desk workflow next.",
  icon = "template",
}: WipPlaceholderProps) {
  return (
    <div className="wip-placeholder">
      <div>
        <div className="wip-placeholder__icon">
          <Icon name={icon} />
        </div>
        <p className="t-overline">{eyebrow}</p>
        <h2 className="t-h1">{title}</h2>
        <p className="t-body-small mx-auto mt-2 max-w-xl">{description}</p>
      </div>
    </div>
  );
}
