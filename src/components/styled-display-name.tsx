import { DisplayNameStyle } from "@/lib/types";
import { CSSProperties } from "react";

type Props = {
  displayName: string;
  style?: DisplayNameStyle;
  className?: string;
};

export function StyledDisplayName({ displayName, style, className = "" }: Props) {
  if (!style) {
    return <span className={className} title={displayName}>{displayName}</span>;
  }

  const classes: string[] = [];
  const inlineStyles: CSSProperties = {};

  // Font styles
  if (style.bold) {
    classes.push("display-name-bold");
  }

  if (style.fontFamily === "serif") {
    classes.push("display-name-serif");
  } else if (style.fontFamily === "mono") {
    classes.push("display-name-mono");
  } else if (style.fontFamily === "cursive") {
    classes.push("display-name-cursive");
  } else {
    classes.push("display-name-sans");
  }

  // Color or gradient
  if (style.gradientEnabled) {
    classes.push("display-name-gradient");
  } else if (style.color) {
    inlineStyles.color = style.color;
  }

  // Animation (only on hover via CSS)
  if (style.animation === "pulse") {
    classes.push("display-name-pulse");
  } else if (style.animation === "glow") {
    classes.push("display-name-glow");
  } else if (style.animation === "rainbow") {
    classes.push("display-name-rainbow");
  }

  // Background
  let bgClasses = "";
  if (style.showBackground && style.backgroundColor) {
    const opacity = style.backgroundOpacity ?? 100;
    const opacityClass =
      opacity >= 100
        ? "bg-opacity-100"
        : opacity >= 80
          ? "bg-opacity-80"
          : opacity >= 60
            ? "bg-opacity-60"
            : opacity >= 40
              ? "bg-opacity-40"
              : "bg-opacity-20";
    bgClasses = `display-name-with-bg ${opacityClass}`;
    inlineStyles.backgroundColor = style.backgroundColor;
  }

  const shouldTruncate = className.includes("truncate");

  return (
    <span
      className={`display-name-wrapper ${className}`}
      title={displayName}
      style={{
        display: shouldTruncate ? "block" : "inline-block",
        ...(shouldTruncate ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const } : {}),
      }}
    >
      <span
        className={`${classes.join(" ")} ${bgClasses}`}
        style={inlineStyles}
      >
        {displayName}
      </span>
    </span>
  );
}
