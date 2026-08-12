import { useId } from "react";
import type { HTMLAttributes } from "react";

const ICON_PATHS = {
  add:
    "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  arrow_drop_down:
    "M7 10l5 5 5-5H7Z",
  auto_awesome:
    "m19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9ZM8.5 21l2.1-4.6L15 14l-4.4-2.4L8.5 7l-2.1 4.6L2 14l4.4 2.4L8.5 21Zm0-4.85L7.5 14l1-2.15 1 2.15-1 2.15ZM19 23l1.25-2.75L23 19l-2.75-1.25L19 15l-1.25 2.75L15 19l2.75 1.25L19 23Z",
  article:
    "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6Zm-1 7V3.5L18.5 9H13ZM8 13h8v1.5H8V13Zm0 3h8v1.5H8V16Zm0-6h4v1.5H8V10Z",
  bolt:
    "M7 22v-8H3l8-12v8h4l-8 12Zm2-7.4v1.3l2.2-3.4H9V8.1l-2.4 3.8H9v2.7Z",
  build:
    "m22 19-9.4-9.4a6 6 0 0 0-7.8-7.3l3.6 3.6-2.5 2.5-3.6-3.6a6 6 0 0 0 7.3 7.8L19 22l3-3ZM5 20.5A1.5 1.5 0 1 1 5 17a1.5 1.5 0 0 1 0 3.5Z",
  check_circle:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.1 14.2-4.1-4.1 1.4-1.4 2.7 2.7 5.5-5.5 1.4 1.4-6.9 6.9Z",
  chevron_right:
    "M9.3 17.3 7.9 15.9 11.8 12 7.9 8.1 9.3 6.7 14.6 12l-5.3 5.3Z",
  close:
    "M6.4 19 5 17.6 10.6 12 5 6.4 6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19Z",
  drag_indicator:
    "M9 20.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm-6-7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm-6-7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z",
  description:
    "M6 2h8l5 5v15H6V2Zm7 2v5h4l-4-5Zm-4 9v2h7v-2H9Zm0 4v2h7v-2H9Z",
  edit_note:
    "M4 19.5v-2h8v2H4Zm0-4v-2h12v2H4Zm0-4v-2h12v2H4Zm0-4v-2h12v2H4Zm13.5 12v-3.1l3.3-3.3c.2-.2.4-.3.7-.3.3 0 .5.1.7.3l1.2 1.2c.2.2.3.4.3.7 0 .3-.1.5-.3.7l-3.3 3.3h-2.6Zm1.4-1.4h.6l2.5-2.5-.6-.6-2.5 2.5v.6Z",
  error:
    "M12 2 1 21h22L12 2Zm1 16h-2v-2h2v2Zm0-4h-2v-4h2v4Z",
  expand_more:
    "M12 15.4 6.6 10 8 8.6l4 4 4-4 1.4 1.4-5.4 5.4Z",
  expand_less:
    "M12 8.6 17.4 14 16 15.4l-4-4-4 4L6.6 14 12 8.6Z",
  help:
    "M11 18h2v-2h-2v2Zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm0-14a3.5 3.5 0 0 0-3.5 3.5h2A1.5 1.5 0 1 1 12 11c-1.5 0-2.5 1-2.5 2.5V15h2v-1.5c0-.3.2-.5.5-.5a3.5 3.5 0 0 0 0-7Z",
  home:
    "M4 20v-9l8-6 8 6v9h-6v-6h-4v6H4Zm2-2h2v-6h8v6h2v-6l-6-4.5L6 12v6Z",
  health_and_safety:
    "M12 2 4 5v6c0 5.1 3.4 9.8 8 11 4.6-1.2 8-5.9 8-11V5l-8-3Zm1 14h-2v-3H8v-2h3V8h2v3h3v2h-3v3Z",
  keyboard_arrow_down:
    "M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z",
  keyboard_arrow_up:
    "M7.4 15.4 6 14l6-6 6 6-1.4 1.4L12 10.8l-4.6 4.6Z",
  library_music:
    "M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Zm-2 5h-3v6.5a2.5 2.5 0 1 1-1.5-2.3V5H18v2ZM4 6H2v16c0 1.1.9 2 2 2h16v-2H4V6Z",
  menu_book:
    "M21 4.5c-1.1-.4-2.3-.7-3.5-.7-2 0-3.9.7-5.5 2v13c1.6-1.3 3.5-2 5.5-2 1.2 0 2.4.2 3.5.7v-13ZM6.5 3.8c-1.2 0-2.4.2-3.5.7v13c1.1-.4 2.3-.7 3.5-.7 2 0 3.9.7 5.5 2v-13c-1.6-1.3-3.5-2-5.5-2Z",
  more_horiz:
    "M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  music_note:
    "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z",
  pause:
    "M6 19h4V5H6v14Zm8-14v14h4V5h-4Z",
  play_arrow:
    "M8 5v14l11-7L8 5Z",
  playlist_play:
    "M4 6h10v2H4V6Zm0 4h10v2H4v-2Zm0 4h7v2H4v-2Zm11-3 6 4-6 4v-8Z",
  privacy_tip:
    "M12 2 4 5v6c0 5.1 3.4 9.8 8 11 4.6-1.2 8-5.9 8-11V5l-8-3Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z",
  queue_music:
    "M15 6H3V4h12v2Zm0 4H3V8h12v2ZM3 14h8v-2H3v2Zm14-2v6.5a2.5 2.5 0 1 1-1.5-2.3V10h5V8h-3.5Z",
  remove_circle_outline:
    "M7 11v2h10v-2H7Zm5-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z",
  report:
    "M12 2 2 12l10 10 10-10L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z",
  search:
    "M9.5 4a5.5 5.5 0 0 0 0 11 5.5 5.5 0 0 0 4.2-9.1A5.5 5.5 0 0 0 9.5 4Zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm5.8 8.4 4.3 4.3-1.4 1.4-4.3-4.3 1.4-1.4Z",
  settings:
    "M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-2.6-1.5L14 2h-4l-.4 2.9A7.5 7.5 0 0 0 7 6.4l-2.5-1-2 3.5 2.1 1.6c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2.1 1.6 2 3.5 2.5-1c.8.6 1.6 1.1 2.6 1.5L10 22h4l.4-2.9c1-.3 1.8-.8 2.6-1.5l2.5 1 2-3.5-2.1-1.6ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z",
  skip_next:
    "M6 18l8.5-6L6 6v12Zm9-12v12h2V6h-2Z",
  skip_previous:
    "M7 6h2v12H7V6Zm3.5 6L19 18V6l-8.5 6Z",
  speed:
    "M12 3a9 9 0 0 0-9 9c0 2.4.9 4.6 2.6 6.3l1.4-1.4A7 7 0 1 1 17 17l1.4 1.4A9 9 0 0 0 12 3Zm1 9.4V7h-2v6l4.2 2.5 1-1.7-3.2-1.9Z",
  star:
    "m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2.1 9.1 8.7 2 9.3 7.4 14l-1.6 7 6.2-3.7Z",
  star_outline:
    "m12 6.8 1.6 3.7 4 .3-3 2.6.9 3.9-3.5-2.1-3.5 2.1.9-3.9-3-2.6 4-.3L12 6.8ZM12 2l-2.9 6.7-7.1.6L7.4 14l-1.6 7 6.2-3.7 6.2 3.7-1.6-7L22 9.3l-7.1-.6L12 2Z",
  stop:
    "M6 6h12v12H6V6Z",
  subtitles:
    "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2ZM4 12h8v2H4v-2Zm0 4h5v2H4v-2Zm16 2h-9v-2h9v2Zm0-4h-6v-2h6v2Z",
  task_alt:
    "M20.3 5.7 9 17l-5.3-5.3 1.4-1.4L9 14.2 18.9 4.3l1.4 1.4ZM12 2a10 10 0 1 0 9.8 12h-2.1A8 8 0 1 1 12 4c1.1 0 2.2.2 3.2.7l1.5-1.5A10 10 0 0 0 12 2Z",
  view_agenda:
    "M4 5h16v5H4V5Zm0 9h16v5H4v-5Z",
  view_list:
    "M4 5h4v4H4V5Zm6 0h10v4H10V5ZM4 10h4v4H4v-4Zm6 0h10v4H10v-4ZM4 15h4v4H4v-4Zm6 0h10v4H10v-4Z",
  volume_up:
    "M4 9v6h4l5 5V4L8 9H4Zm11.5-.5a5 5 0 0 1 0 7l1.4 1.4a7 7 0 0 0 0-9.8l-1.4 1.4Zm2.8-2.8a9 9 0 0 1 0 12.6l1.4 1.4a11 11 0 0 0 0-15.4l-1.4 1.4Z",
  volume_down:
    "M4 9v6h4l5 5V4L8 9H4Zm11.5-.5a5 5 0 0 1 0 7l1.4 1.4a7 7 0 0 0 0-9.8l-1.4 1.4Z",
  volume_off:
    "m3.3 2 18.7 18.7-1.3 1.3-3.4-3.4a8.8 8.8 0 0 1-1.4 1.1l-1-1.8c.4-.2.7-.5 1-.8L13 14.2V20l-5-5H4V9h1.2L2 3.3 3.3 2ZM13 4v5.2L9.7 5.9 13 4Zm4.9 1.1a10.8 10.8 0 0 1 1.2 11.4l-1.6-1.6a8.9 8.9 0 0 0-1-8.5l1.4-1.3Zm-2.4 3.4a5 5 0 0 1 .9 4.4l-1.8-1.8c0-.9-.2-1.8-.8-2.6l1.7-1Z",
  warning:
    "M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z"
} as const;

export type MaterialIconName = keyof typeof ICON_PATHS;

type MaterialIconProps = HTMLAttributes<HTMLSpanElement> & {
  name: MaterialIconName;
  size?: number | string;
  title?: string;
};

export default function MaterialIcon({
  name,
  size = 20,
  title,
  className = "",
  style,
  ...props
}: MaterialIconProps) {
  const titleId = useId();
  const resolvedSize = typeof size === "number" ? `${size}px` : size;
  const path = ICON_PATHS[name];

  return (
    <span
      {...props}
      className={["material-icon", className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      style={{
        width: resolvedSize,
        height: resolvedSize,
        fontSize: resolvedSize,
        ...style
      }}
    >
      <svg
        viewBox="0 0 24 24"
        focusable="false"
        role={title ? "img" : undefined}
        aria-labelledby={title ? titleId : undefined}
      >
        {title && <title id={titleId}>{title}</title>}
        <path d={path} fill="currentColor" />
      </svg>
    </span>
  );
}
