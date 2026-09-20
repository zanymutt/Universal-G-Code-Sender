type Face = "top" | "left" | "right" | "bottom" | "all";

type Props = { face: Face };

// A small isometric cube with the face you'd be looking at filled in, for the
// view buttons once they collapse to icons. "bottom" is the same cube seen from
// underneath, so it's drawn flipped with its (now lower) top face filled.
const FACES = {
  top: "12,2 20.66,7 12,12 3.34,7",
  left: "3.34,7 12,12 12,22 3.34,17",
  right: "12,12 20.66,7 20.66,17 12,22",
};

const ViewCubeIcon = ({ face }: Props) => {
  const filled = face === "all" ? [FACES.top, FACES.left, FACES.right] : [FACES[face === "bottom" ? "top" : face]];
  return (
    <svg
      className="viewCubeIcon"
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={face === "bottom" ? "translate(0 24) scale(1 -1)" : undefined}>
        {filled.map((points) => (
          <polygon key={points} points={points} fill="currentColor" fillOpacity={face === "all" ? 0.3 : 0.85} />
        ))}
        <polygon
          points="12,2 20.66,7 20.66,17 12,22 3.34,17 3.34,7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M3.34 7 L12 12 L20.66 7 M12 12 L12 22" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </g>
    </svg>
  );
};

export default ViewCubeIcon;
