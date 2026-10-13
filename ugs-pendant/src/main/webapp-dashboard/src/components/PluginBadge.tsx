import { pluginHue, pluginInitials } from "../utils/pluginPins";

type Props = {
  id: string;
  name: string;
  iconUrl?: string | null;
  size: number;
};

// A plugin's own icon, or - for a plugin that ships none - a tile with its
// initials on a colour derived from its id, so every plugin is recognisable at
// a glance even in the icon-only rail.
const PluginBadge = ({ id, name, iconUrl, size }: Props) => {
  if (iconUrl) {
    return <img src={iconUrl} alt="" className="pluginBadge pluginBadgeImage" style={{ width: size, height: size }} />;
  }
  const hue = pluginHue(id);
  return (
    <span
      className="pluginBadge pluginBadgeInitials"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        background: `hsl(${hue} 55% 38%)`,
        color: "#fff",
      }}
    >
      {pluginInitials(name)}
    </span>
  );
};

export default PluginBadge;
