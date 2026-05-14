type IconProps = {
  name: string;
  className?: string;
};

export default function Icon({ name, className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`/ds/icons.svg#i-${name}`} />
    </svg>
  );
}
